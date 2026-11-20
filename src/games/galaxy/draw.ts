import type { Color, Screen } from '../../core/types';
import {
  ROWS, COLS, LIVES, SHIP_Y, enemyAt, kindOfRow,
} from './state';
import type { GalaxyState, Kind } from './state';
import { WAVES } from './waves';

const SPRITE: Record<Kind, string> = { drone: '<o>', brute: '/O\\', stinger: '/V\\' };
const COLOR: Record<Kind, Color> = { drone: 'brightCyan', brute: 'brightMagenta', stinger: 'yellow' };
const BANNER = 'GALAXY CLEARED';

/** Pure draw: reads state, writes screen. Every write is clipped to the area. */
export function drawState(s: GalaxyState, screen: Screen): void {
  const W = screen.width;
  const H = screen.height;
  const put = (x: number, y: number, ch: string, color: Color, minY = 1) => {
    if (x < 0 || x >= W || y < minY || y >= H) return;
    screen.put(x, y, ch, color);
  };

  // HUD (row 0 only).
  const left = `Wave ${s.wave}/${WAVES.length}   Lives `;
  screen.text(0, 0, left, 'white');
  screen.text(left.length, 0, '♥'.repeat(Math.max(0, s.lives)).slice(0, LIVES), 'brightRed');
  const score = `Score ${s.score}`;
  screen.text(W - score.length, 0, score, 'white');

  for (const p of s.debris) put(p.x, p.y, '▓', 'gray');

  for (let r = 0; r < ROWS; r++) {
    const kind = kindOfRow(r);
    for (let c = 0; c < COLS; c++) {
      if (!s.alive[r][c]) continue;
      const e = enemyAt(s, r, c);
      for (let i = 0; i < SPRITE[kind].length; i++) put(e.x + i, e.y, SPRITE[kind][i], COLOR[kind]);
    }
  }

  if (s.shot) put(s.shot.x, s.shot.y, '╎', 'brightWhite');
  for (const p of s.enemyShots) put(p.x, p.y, '¦', 'brightRed');

  if (!(s.blink > 0 && s.tick % 2 === 1)) {
    for (let i = 0; i < 3; i++) put(s.shipX + i, SHIP_Y, '/^\\'[i], 'brightGreen');
  }

  if (s.banner > 0) {
    const x = Math.floor((W - BANNER.length) / 2);
    for (let i = 0; i < BANNER.length; i++) put(x + i, 9, BANNER[i], 'brightYellow');
  }
}
