import { isGapLine } from './lrc';
import type { LyricsContent } from './content';
import { lineWindow } from './sync';

interface Props {
  content: LyricsContent;
  index: number;
  mode: 'context' | 'single';
}

function Line({ text, role }: { text: string | undefined; role: 'prev' | 'current' | 'next' }) {
  const gap = text === undefined || isGapLine(text);
  return (
    <p className={`line line--${role}${gap ? ' line--gap' : ''}`} data-tauri-drag-region>
      {gap ? (role === 'current' ? '♪' : ' ') : text}
    </p>
  );
}

export function LyricsView({ content, index, mode }: Props) {
  if (content.kind === 'instrumental') {
    return (
      <div className="lyrics lyrics--center" data-tauri-drag-region>
        <p className="line line--current line--gap">♪ Instrumental</p>
      </div>
    );
  }

  if (content.kind === 'plain') {
    return (
      <div
        className="lyrics lyrics--plain"
        tabIndex={0}
        aria-label="Plain lyrics, not synchronized"
      >
        {content.lines.map((l, i) => (
          <p key={i} className={l ? 'plain-line' : 'plain-gap'}>
            {l || ' '}
          </p>
        ))}
      </div>
    );
  }

  const w = lineWindow(content.lines, index);
  // Before the first timestamp, preview the opening line as "next".
  const current = index < 0 ? undefined : w.current?.text;
  return (
    <div className={`lyrics lyrics--synced lyrics--${mode}`} data-tauri-drag-region>
      {mode === 'context' && <Line key={`p${index}`} text={w.previous?.text} role="prev" />}
      <Line key={`c${index}`} text={current} role="current" />
      {mode === 'context' && <Line key={`n${index}`} text={w.next?.text} role="next" />}
    </div>
  );
}
