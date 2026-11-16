import {
  BRIDGE_HOST,
  BRIDGE_PORTS,
  BRIDGE_PROTOCOL_VERSION,
  isPlausiblePairingKey,
  normalizePairingKey,
  validateHelloResponse,
  type PlaybackState,
} from '@lyricsdock/shared';
import type { ConnectionState } from '../shared/messages';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface BridgeClientOptions {
  fetch: FetchLike;
  clientVersion: string;
  now?: () => number;
  /** Wait at least this long between reconnect attempts after a failure. */
  retryMs?: number;
}

const REQUEST_TIMEOUT_MS = 2500;

/**
 * Talks to the desktop app's loopback bridge. Exchanges the pairing key for a
 * session token, then posts state updates. Recovers automatically when the app
 * restarts (token becomes invalid) or comes back after being closed.
 */
export class BridgeClient {
  private key: string | null = null;
  private token: string | null = null;
  private port: number | null = null;
  private seq = 0;
  private nextAttemptAt = 0;
  private inflight: Promise<void> | null = null;
  private queued: { state: PlaybackState | null } | null = null;
  connection: ConnectionState = 'no-key';
  detail: string | null = null;

  constructor(private readonly opts: BridgeClientOptions) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  get currentPort() {
    return this.port;
  }

  setKey(key: string | null) {
    const normalized = key ? normalizePairingKey(key) : null;
    this.key = normalized && isPlausiblePairingKey(normalized) ? normalized : null;
    this.token = null;
    this.nextAttemptAt = 0;
    this.connection = this.key ? 'connecting' : 'no-key';
    this.detail = null;
  }

  get hasKey() {
    return this.key !== null;
  }

  private async post(port: number, path: string, body: unknown, auth?: string): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.opts.fetch(`http://${BRIDGE_HOST}:${port}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
    } finally {
      clearTimeout(t);
    }
  }

  private async errorCode(res: Response): Promise<string> {
    try {
      const j = (await res.json()) as { error?: unknown };
      return typeof j.error === 'string' ? j.error : `http_${res.status}`;
    } catch {
      return `http_${res.status}`;
    }
  }

  /** Find the app on one of the known ports and authenticate. */
  private async hello(): Promise<boolean> {
    if (!this.key) {
      this.connection = 'no-key';
      return false;
    }
    const ports = this.port
      ? [this.port, ...BRIDGE_PORTS.filter((p) => p !== this.port)]
      : [...BRIDGE_PORTS];
    for (const port of ports) {
      let res: Response;
      try {
        res = await this.post(port, '/v1/hello', {
          protocol: BRIDGE_PROTOCOL_VERSION,
          pairingKey: this.key,
          client: { name: 'LyricsDock for Brave', version: this.opts.clientVersion },
        });
      } catch {
        continue; // nothing listening on this port
      }
      if (res.ok) {
        const parsed = validateHelloResponse(await res.json().catch(() => null));
        if (!parsed.ok) {
          this.connection = 'error';
          this.detail = 'Unexpected reply from LyricsDock';
          return false;
        }
        this.port = port;
        this.token = parsed.value.sessionToken;
        this.seq = 0;
        this.connection = 'connected';
        this.detail = parsed.value.appVersion ? `LyricsDock ${parsed.value.appVersion}` : null;
        return true;
      }
      const code = await this.errorCode(res);
      this.port = port;
      if (code === 'bad_pairing_key') this.connection = 'bad-key';
      else if (code === 'origin_not_paired') this.connection = 'origin-mismatch';
      else if (code === 'too_many_attempts') this.connection = 'locked';
      else if (code === 'bridge_disabled') this.connection = 'disabled';
      else this.connection = 'error';
      this.detail = code;
      return false;
    }
    this.connection = 'app-offline';
    this.detail = null;
    return false;
  }

  /** Send the latest state. Coalesces while a request is in flight. */
  send(state: PlaybackState | null): Promise<void> {
    this.queued = { state };
    if (!this.inflight) {
      this.inflight = this.drain().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async drain(): Promise<void> {
    while (this.queued) {
      const { state } = this.queued;
      this.queued = null;
      await this.sendOne(state);
    }
  }

  private async sendOne(state: PlaybackState | null): Promise<void> {
    if (!this.key) {
      this.connection = 'no-key';
      return;
    }
    if (!this.token) {
      if (this.now() < this.nextAttemptAt) return;
      const ok = await this.hello();
      if (!ok) {
        this.nextAttemptAt = this.now() + (this.opts.retryMs ?? 3000);
        return;
      }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = this.token;
      const port = this.port;
      if (!token || !port) return;
      let res: Response;
      try {
        res = await this.post(
          port,
          '/v1/state',
          { protocol: BRIDGE_PROTOCOL_VERSION, seq: ++this.seq, state },
          token,
        );
      } catch {
        this.token = null;
        this.connection = 'app-offline';
        this.nextAttemptAt = this.now() + (this.opts.retryMs ?? 3000);
        return;
      }
      if (res.ok) {
        this.connection = 'connected';
        return;
      }
      if (res.status === 401 && attempt === 0) {
        // App restarted (sessions are in-memory): re-authenticate once.
        this.token = null;
        if (!(await this.hello())) return;
        continue;
      }
      if (res.status === 429) return; // dropped; next sample supersedes it
      this.connection = res.status === 503 ? 'disabled' : 'error';
      this.detail = await this.errorCode(res);
      this.token = null;
      return;
    }
  }

  /** Politely end the session (e.g. the user removed the key). */
  async bye(): Promise<void> {
    if (!this.token || !this.port) return;
    try {
      await this.post(this.port, '/v1/bye', { protocol: BRIDGE_PROTOCOL_VERSION }, this.token);
    } catch {
      /* app already gone */
    }
    this.token = null;
  }
}
