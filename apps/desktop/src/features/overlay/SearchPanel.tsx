import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import type { LrclibRecord } from '../lyrics/lrclib';
import type { ScoredCandidate } from '../lyrics/matching';
import type { ManualSearchState } from '../lyrics/useLyrics';

interface Props {
  initialTitle: string;
  initialArtist: string;
  suggestions: ScoredCandidate[];
  manual: ManualSearchState;
  onSearch: (title: string, artist: string) => void;
  onChoose: (record: LrclibRecord) => void;
  onClose: () => void;
  canSearch: boolean;
}

function formatDuration(sec: number | null): string {
  if (sec == null) return '';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Result({ c, onChoose }: { c: ScoredCandidate; onChoose: (r: LrclibRecord) => void }) {
  const r = c.record;
  const kind = r.syncedLyrics ? 'Synced' : r.plainLyrics ? 'Plain' : 'Instrumental';
  return (
    <li>
      <button type="button" className="result" onClick={() => onChoose(r)}>
        <span className="result__main">
          <span className="result__title">{r.trackName}</span>
          <span className="result__artist">{r.artistName}</span>
        </span>
        <span className="result__meta">
          <span className={`badge badge--${kind.toLowerCase()}`}>{kind}</span>
          <span>{formatDuration(r.duration)}</span>
        </span>
      </button>
    </li>
  );
}

/** Manual search / "choose match" panel shown in the temporarily enlarged overlay. */
export function SearchPanel(p: Props) {
  const [title, setTitle] = useState(p.initialTitle);
  const [artist, setArtist] = useState(p.initialArtist);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => titleRef.current?.focus(), []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    p.onSearch(title, artist);
  };

  const results = p.manual.results;
  const list = results ?? p.suggestions;

  return (
    <section className="panel" aria-label="Find lyrics">
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
        <h2>Find lyrics</h2>
      </div>
      <form className="panel__form" onSubmit={submit}>
        <label>
          <span>Title</span>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
          />
        </label>
        <label>
          <span>Artist</span>
          <input
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            maxLength={200}
            placeholder="optional"
          />
        </label>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={!p.canSearch || p.manual.busy || !title.trim()}
        >
          <Icon name="search" size={14} />
          {p.manual.busy ? 'Searching…' : 'Search'}
        </button>
      </form>
      <div className="panel__results" aria-live="polite">
        {p.manual.error && <p className="panel__note panel__note--error">{p.manual.error}</p>}
        {results && results.length === 0 && (
          <p className="panel__note">No results. Try a shorter title or leave the artist empty.</p>
        )}
        {!results && list.length > 0 && <p className="panel__note">Possible matches</p>}
        {list.length > 0 && (
          <ul>
            {list.map((c) => (
              <Result key={c.record.id} c={c} onChoose={p.onChoose} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
