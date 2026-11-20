import type { Color } from './types';
import type { CellBuffer } from './buffer';

export const ENTER_ALT = '\x1b[?1049h\x1b[?25l';
export const LEAVE_ALT = '\x1b[0m\x1b[?25h\x1b[?1049l';

const SGR: Record<Color, number> = {
  black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37,
  gray: 90, brightRed: 91, brightGreen: 92, brightYellow: 93, brightBlue: 94,
  brightMagenta: 95, brightCyan: 96, brightWhite: 97,
};

export function renderDiff(prev: CellBuffer | null, next: CellBuffer): string {
  const full = prev === null || prev.width !== next.width || prev.height !== next.height;
  let out = full ? '\x1b[2J' : '';
  let color: Color | null = null; // unknown at the start of every frame
  for (let y = 0; y < next.height; y++) {
    let cursorX = -1; // x where the cursor sits after the last write on this row
    for (let x = 0; x < next.width; x++) {
      const c = next.get(x, y);
      if (!full) {
        const p = prev!.get(x, y);
        if (p.ch === c.ch && p.color === c.color) continue;
      }
      if (cursorX !== x) out += `\x1b[${y + 1};${x + 1}H`;
      if (c.color !== color) {
        out += `\x1b[${SGR[c.color]}m`;
        color = c.color;
      }
      out += c.ch;
      cursorX = x + 1;
    }
  }
  return out;
}
