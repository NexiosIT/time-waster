import type { CellBuffer } from '../../src/core/buffer';
import type { Color } from '../../src/core/types';

export const COLOR_CLASSES: readonly Color[] = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'gray', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One HTML string per row: each run of same-coloured cells is a `c-<color>` span. */
export function gridLines(buf: CellBuffer): string[] {
  const lines: string[] = [];
  for (let y = 0; y < buf.height; y++) {
    let html = '';
    let run = '';
    let color: Color | null = null;
    for (let x = 0; x < buf.width; x++) {
      const cell = buf.get(x, y);
      if (cell.color !== color && color !== null) {
        html += `<span class="c-${color}">${escape(run)}</span>`;
        run = '';
      }
      color = cell.color;
      run += cell.ch;
    }
    if (color !== null) html += `<span class="c-${color}">${escape(run)}</span>`;
    lines.push(html);
  }
  return lines;
}
