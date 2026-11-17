import { useEffect, useRef } from 'react';
import { Icon } from '../../components/Icon';
import { isGapLine, type LyricLine } from '../lyrics/lrc';
import type { SyncMapping } from '../lyrics/sync';

interface Props {
  lines: readonly LyricLine[];
  /** Line currently shown as active. */
  index: number;
  mapping: SyncMapping;
  taps: number;
  reducedMotion: boolean;
  onPick: (line: LyricLine) => void;
  onReset: () => void;
  onClose: () => void;
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function describeMapping(m: SyncMapping): string {
  const shift = `${m.shift >= 0 ? '+' : '−'}${Math.abs(m.shift).toFixed(1)}s`;
  const tempo = Math.round(m.scale * 100);
  return tempo === 100 ? `Shift ${shift}` : `Shift ${shift} · tempo ${tempo}%`;
}

/**
 * "Click the line being sung now." Each click pins that line to the current
 * video position; two clicks far apart also fix the tempo (covers, live takes).
 */
export function SyncPanel(p: Props) {
  const currentRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView?.({
      block: 'center',
      behavior: p.reducedMotion ? 'auto' : 'smooth',
    });
  }, [p.index, p.reducedMotion]);

  const custom = p.taps > 0;

  return (
    <section className="panel" aria-label="Sync lyrics">
      <div className="panel__head">
        <button
          type="button"
          className="icon-btn"
          onClick={p.onClose}
          aria-label="Back to lyrics"
          title="Back (Esc)"
        >
          <Icon name="back" />
        </button>
        <h2>Sync lyrics</h2>
        <span className="panel__status" aria-live="polite">
          {custom ? describeMapping(p.mapping) : 'Original timing'}
        </span>
        {custom && (
          <button type="button" className="btn btn--ghost panel__reset" onClick={p.onReset}>
            Reset
          </button>
        )}
      </div>
      <p className="panel__note">
        {p.taps === 0
          ? 'Click the line being sung right now.'
          : p.taps === 1
            ? 'Click again at least 30 s later to match the tempo.'
            : 'Click again anytime the lyrics drift.'}
      </p>
      <div className="panel__results">
        <ul>
          {p.lines.map((l, i) =>
            isGapLine(l.text) ? null : (
              <li key={`${i}-${l.time}`}>
                <button
                  type="button"
                  ref={i === p.index ? currentRef : undefined}
                  className={`sync-line${i === p.index ? ' sync-line--current' : ''}`}
                  aria-current={i === p.index ? 'true' : undefined}
                  onClick={() => p.onPick(l)}
                >
                  <span className="sync-line__time">{formatTime(l.time)}</span>
                  <span className="sync-line__text">{l.text}</span>
                </button>
              </li>
            ),
          )}
        </ul>
      </div>
    </section>
  );
}
