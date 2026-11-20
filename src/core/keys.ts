import type { Key } from './types';

const ARROWS: Record<string, Key> = { A: 'up', B: 'down', C: 'right', D: 'left' };

export function parseKeys(data: string): Key[] {
  const keys: Key[] = [];
  let i = 0;
  while (i < data.length) {
    const ch = data[i];
    if (ch === '\x1b') {
      const next = data[i + 1];
      if (next === '[') {
        // CSI: parameter/intermediate bytes, then a final byte 0x40-0x7E
        let j = i + 2;
        while (j < data.length && data.charCodeAt(j) >= 0x20 && data.charCodeAt(j) <= 0x3f) j++;
        if (j < data.length) {
          const arrow = j === i + 2 ? ARROWS[data[j]] : undefined;
          if (arrow) keys.push(arrow);
        }
        i = j + 1;
      } else if (next === 'O') {
        const arrow = ARROWS[data[i + 2]];
        if (arrow) keys.push(arrow);
        i += 3;
      } else {
        keys.push('escape');
        i += 1;
      }
      continue;
    }
    const cp = data.codePointAt(i)!;
    const str = String.fromCodePoint(cp);
    i += str.length;
    if (ch === '\r' || ch === '\n') keys.push('enter');
    else if (ch === ' ') keys.push('space');
    else if (ch === '\x03') keys.push('ctrl-c');
    else if (ch === '\x7f' || ch === '\b') keys.push('backspace');
    else if (ch === '\t') keys.push('tab');
    else if (cp >= 0x20) keys.push(str.toLowerCase());
  }
  return keys;
}
