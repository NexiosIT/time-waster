import type { Color, Screen } from './types';

export interface Cell { ch: string; color: Color; }

export class CellBuffer implements Screen {
  private chars: string[];
  private colors: Color[];

  constructor(public width: number, public height: number) {
    this.chars = new Array<string>(width * height).fill(' ');
    this.colors = new Array<Color>(width * height).fill('white');
  }

  get(x: number, y: number): Cell {
    const i = y * this.width + x;
    return { ch: this.chars[i], color: this.colors[i] };
  }

  put(x: number, y: number, ch: string, color: Color = 'white'): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = y * this.width + x;
    this.chars[i] = ch;
    this.colors[i] = color;
  }

  text(x: number, y: number, s: string, color: Color = 'white'): void {
    let cx = x;
    for (const ch of s) this.put(cx++, y, ch, color);
  }

  clear(): void {
    this.chars.fill(' ');
    this.colors.fill('white');
  }

  blit(src: CellBuffer, ox: number, oy: number): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const c = src.get(x, y);
        this.put(ox + x, oy + y, c.ch, c.color);
      }
    }
  }

  rowText(y: number): string {
    return this.chars.slice(y * this.width, (y + 1) * this.width).join('');
  }
}
