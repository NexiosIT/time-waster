import { GAME_HEIGHT, GAME_WIDTH } from '../../core/types';
import type { Color, Game, GameContext, Key, Screen } from '../../core/types';

// Turn-based artillery: aim, set power, fire; the computer fires back.
// Row 0 is the HUD; the field is rows 1-19. Positions are in cells (x = column,
// y = row, both fractional while a shell flies). A row is about twice as tall as a
// column is wide, so vertical speed is halved (ASPECT) to keep arcs looking right.

const W = GAME_WIDTH, H = GAME_HEIGHT;
export const MAX_HP = 100;
const BLAST = 3;              // crater radius, in columns
const MAX_DAMAGE = 50;        // a direct hit
const VMAX = 2.2;             // shell speed at power 100, columns per tick
const GRAVITY = 0.035;        // rows per tick^2
const ASPECT = 0.5;
const SUBSTEPS = 4;           // collision checks per tick, so fast shells don't skip cells
const MAX_WIND = 0.006;       // columns per tick^2
const BOOM_TICKS = 8;
const CPU_WAIT_TICKS = 15;
const WIN_BONUS = 100;
const TRAIL = 10;
/** How many ticks of the shell's path the aiming guide shows (a long shot flies ~45). */
export const PREVIEW_TICKS = 16;

type Who = 'player' | 'cpu';
interface Point { x: number; y: number }

export interface Tank {
  x: number;       // centre column; the body is x-1..x+1, one row above the ground
  hp: number;
  angle: number;   // degrees: 0 = right, 90 = straight up, 180 = left
  power: number;   // 5..100
}

export interface Shell { x: number; y: number; vx: number; vy: number; owner: Who; age: number; trail: Point[] }

export type Phase =
  | { kind: 'aim' }
  | { kind: 'flight'; shell: Shell }
  | { kind: 'boom'; owner: Who; x: number | null; y: number | null; t: number }
  | { kind: 'cpuWait'; t: number; power: number };

export interface DuelState {
  ground: number[];  // per column: the row of the topmost earth cell (H = no earth left)
  player: Tank;
  cpu: Tank;
  wind: number;
  phase: Phase;
  round: number;
  cpuShots: number;  // computer shots this round; it gets more accurate with each
  score: number;
  over: boolean;
  message: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Rolling hills, higher in the middle so shots have to arc over. */
export function makeGround(rnd: () => number): number[] {
  const p1 = rnd() * Math.PI * 2, p2 = rnd() * Math.PI * 2;
  const a1 = 1.5 + rnd() * 2, a2 = 0.5 + rnd() * 1.5;
  const f1 = 1 + rnd(), f2 = 2.5 + rnd() * 2;
  const hill = 2 + rnd() * 3;
  return Array.from({ length: W }, (_, x) => {
    const u = x / W;
    const h = 15 - hill * Math.sin(Math.PI * u) + a1 * Math.sin(Math.PI * f1 * u + p1) + a2 * Math.sin(Math.PI * f2 * u + p2);
    return clamp(Math.round(h), 6, H - 2);
  });
}

function flattenUnder(ground: number[], x: number): number[] {
  const g = ground.slice();
  g[x - 1] = g[x];
  g[x + 1] = g[x];
  return g;
}

function newRound(round: number, score: number, rnd: () => number, message: string): DuelState {
  const px = 4 + Math.floor(rnd() * 8);
  const cx = W - 5 - Math.floor(rnd() * 8);
  const ground = flattenUnder(flattenUnder(makeGround(rnd), px), cx);
  return {
    ground,
    player: { x: px, hp: MAX_HP, angle: 45, power: 60 },
    cpu: { x: cx, hp: MAX_HP, angle: 135, power: 60 },
    wind: newWind(rnd),
    phase: { kind: 'aim' },
    round,
    cpuShots: 0,
    score,
    over: false,
    message,
  };
}

const newWind = (rnd: () => number) => Math.round((rnd() * 2 - 1) * MAX_WIND * 10000) / 10000;

/** The row a tank's body sits on. */
export function tankRow(s: DuelState, t: Tank): number {
  return Math.min(s.ground[t.x], H) - 1;
}

function launch(s: DuelState, who: Who, angle: number, power: number): Shell {
  const t = s[who];
  const v = (power / 100) * VMAX;
  return {
    x: t.x + 0.5,
    y: tankRow(s, t) - 0.5,
    vx: Math.cos(rad(angle)) * v,
    vy: -Math.sin(rad(angle)) * v * ASPECT,
    owner: who,
    age: 0,
    trail: [],
  };
}

type Hit = Point | 'out' | null; // a point = impact, 'out' = left the field, null = still flying

function collide(s: DuelState, sh: Shell): Hit {
  if (sh.x < 0 || sh.x >= W) return 'out';
  if (sh.y >= H) return { x: sh.x, y: H - 0.5 };
  const col = Math.floor(sh.x), row = Math.floor(sh.y);
  if (row >= s.ground[col]) return { x: sh.x, y: sh.y };
  for (const who of ['player', 'cpu'] as const) {
    if (who === sh.owner && sh.age < 6) continue; // just left its own barrel
    const t = s[who];
    if (row === tankRow(s, t) && Math.abs(col - t.x) <= 1) return { x: sh.x, y: sh.y };
  }
  return null;
}

/** Move a shell one tick (in substeps). */
function advance(s: DuelState, shell: Shell): { shell: Shell; hit: Hit } {
  let sh = shell;
  for (let i = 0; i < SUBSTEPS; i++) {
    const vx = sh.vx + s.wind / SUBSTEPS, vy = sh.vy + GRAVITY / SUBSTEPS;
    sh = { ...sh, vx, vy, x: sh.x + vx / SUBSTEPS, y: sh.y + vy / SUBSTEPS, age: sh.age + 1 };
    const hit = collide(s, sh);
    if (hit) return { shell: sh, hit };
  }
  return { shell: sh, hit: null };
}

/** The first ticks of the player's shot as currently aimed, wind included: the aiming guide. */
export function aimPath(s: DuelState): Point[] {
  const path: Point[] = [];
  let sh = launch(s, 'player', s.player.angle, s.player.power);
  for (let i = 0; i < PREVIEW_TICKS; i++) {
    const r = advance(s, sh);
    if (r.hit) break;
    sh = r.shell;
    path.push({ x: sh.x, y: sh.y });
  }
  return path;
}

/** Where a shot would land, or null if it leaves the field (or flies too long). */
export function trace(s: DuelState, who: Who, angle: number, power: number): Point | null {
  let sh = launch(s, who, angle, power);
  for (let i = 0; i < 400; i++) {
    const r = advance(s, sh);
    if (r.hit === 'out') return null;
    if (r.hit) return r.hit;
    sh = r.shell;
  }
  return null;
}

/** Crater plus damage to every tank in reach; damage the player deals is added to the score. */
export function explode(s: DuelState, x: number, y: number, owner: Who): DuelState {
  const ground = s.ground.slice();
  for (let col = Math.floor(x - BLAST); col <= Math.ceil(x + BLAST); col++) {
    if (col < 0 || col >= W) continue;
    const dx = col + 0.5 - x;
    if (Math.abs(dx) > BLAST) continue;
    const ext = Math.sqrt(BLAST * BLAST - dx * dx) * ASPECT;
    if (ground[col] >= y - ext) ground[col] = Math.max(ground[col], Math.min(H, Math.round(y + ext)));
  }
  const hurt = (t: Tank): number => {
    const d = Math.hypot(t.x + 0.5 - x, (tankRow(s, t) + 0.5 - y) / ASPECT);
    const reach = BLAST + 1.5;
    return d >= reach ? 0 : Math.min(t.hp, Math.round(MAX_DAMAGE * (1 - d / reach)));
  };
  const dp = hurt(s.player), dc = hurt(s.cpu);
  const byPlayer = owner === 'player';
  const message = dc > 0 && byPlayer ? `Hit! CPU -${dc}`
    : dp > 0 && !byPlayer ? `Ouch! You -${dp}`
    : dp > 0 ? `You hit yourself! -${dp}`
    : dc > 0 ? `CPU hit itself! -${dc}`
    : byPlayer ? 'Missed.' : 'CPU missed.';
  return {
    ...s,
    ground,
    player: { ...s.player, hp: s.player.hp - dp },
    cpu: { ...s.cpu, hp: s.cpu.hp - dc },
    score: s.score + (byPlayer ? dc : 0),
    message,
  };
}

/**
 * The computer's shot: the angle and power whose simulated landing is closest to
 * you, then the power is thrown off by an error that shrinks with every shot it
 * takes this round and with every round you win. rnd() = 0.5 means no error.
 */
export function aiShot(s: DuelState, rnd: () => number): { angle: number; power: number } {
  const target = s.player.x + 0.5;
  let best = { angle: 135, power: 60, miss: Infinity };
  for (let angle = 100; angle <= 165; angle += 5) {
    for (let power = 20; power <= 100; power += 2) {
      const hit = trace(s, 'cpu', angle, power);
      if (!hit) continue;
      const miss = Math.abs(hit.x - target);
      if (miss < best.miss) best = { angle, power, miss };
    }
  }
  const err = Math.max(1, 14 - 4 * s.cpuShots - 2 * (s.round - 1));
  return { angle: best.angle, power: clamp(Math.round(best.power + (rnd() * 2 - 1) * err), 5, 100) };
}

function init(ctx: GameContext): DuelState {
  return newRound(1, 0, ctx.random, 'Aim with the arrows, Space to fire.');
}

function onKey(s: DuelState, key: Key): DuelState {
  if (s.phase.kind !== 'aim') return s;
  const p = s.player;
  switch (key) {
    case 'left': return { ...s, player: { ...p, angle: Math.min(180, p.angle + 2) } };
    case 'right': return { ...s, player: { ...p, angle: Math.max(0, p.angle - 2) } };
    case 'up': return { ...s, player: { ...p, power: Math.min(100, p.power + 2) } };
    case 'down': return { ...s, player: { ...p, power: Math.max(5, p.power - 2) } };
    case 'space': return { ...s, phase: { kind: 'flight', shell: launch(s, 'player', p.angle, p.power) }, message: '' };
    default: return s;
  }
}

/** After a shot's explosion has played out: decide who is next. */
function resolve(s: DuelState, owner: Who, ctx: GameContext): DuelState {
  if (s.player.hp <= 0) return { ...s, over: true, message: 'Your tank is destroyed!' };
  if (s.cpu.hp <= 0) {
    const bonus = WIN_BONUS + s.player.hp;
    return newRound(s.round + 1, s.score + bonus, ctx.random, `CPU destroyed! +${bonus}  Round ${s.round + 1}`);
  }
  if (owner === 'player') {
    const shot = aiShot(s, ctx.random);
    return { ...s, cpu: { ...s.cpu, angle: shot.angle }, phase: { kind: 'cpuWait', t: CPU_WAIT_TICKS, power: shot.power } };
  }
  return { ...s, phase: { kind: 'aim' }, wind: newWind(ctx.random) };
}

function update(s: DuelState, ctx: GameContext): DuelState {
  const ph = s.phase;
  switch (ph.kind) {
    case 'aim':
      return s;
    case 'flight': {
      const { shell, hit } = advance(s, ph.shell);
      const owner = shell.owner;
      if (hit === 'out') return { ...s, phase: { kind: 'boom', owner, x: null, y: null, t: 1 }, message: owner === 'player' ? 'Missed.' : 'CPU missed.' };
      if (hit) return { ...explode(s, hit.x, hit.y, owner), phase: { kind: 'boom', owner, x: hit.x, y: hit.y, t: BOOM_TICKS } };
      const trail = [...ph.shell.trail, { x: ph.shell.x, y: ph.shell.y }].slice(-TRAIL);
      return { ...s, phase: { kind: 'flight', shell: { ...shell, trail } } };
    }
    case 'boom':
      return ph.t > 1 ? { ...s, phase: { ...ph, t: ph.t - 1 } } : resolve(s, ph.owner, ctx);
    case 'cpuWait': {
      if (ph.t > 1) return { ...s, phase: { ...ph, t: ph.t - 1 }, message: 'CPU is aiming...' };
      const cpu = { ...s.cpu, power: ph.power };
      const next = { ...s, cpu, cpuShots: s.cpuShots + 1, message: '' };
      return { ...next, phase: { kind: 'flight', shell: launch(next, 'cpu', cpu.angle, cpu.power) } };
    }
  }
}

// ---- drawing ----

function barrel(angle: number): { dx: number; ch: string } {
  if (angle < 30) return { dx: 1, ch: '_' };
  if (angle < 70) return { dx: 1, ch: '/' };
  if (angle <= 110) return { dx: 0, ch: '|' };
  if (angle <= 150) return { dx: -1, ch: '\\' };
  return { dx: -1, ch: '_' };
}

function drawTank(s: DuelState, t: Tank, color: Color, screen: Screen): void {
  const y = tankRow(s, t);
  screen.put(t.x - 1, y, '▄', color);
  screen.put(t.x, y, '█', color);
  screen.put(t.x + 1, y, '▄', color);
  const b = barrel(t.angle);
  if (y - 1 >= 1) screen.put(t.x + b.dx, y - 1, b.ch, color);
}

function windText(wind: number): string {
  const n = Math.round((Math.abs(wind) / MAX_WIND) * 3);
  if (n === 0) return 'Wind -';
  return 'Wind ' + (wind < 0 ? '<'.repeat(n) : '>'.repeat(n));
}

function draw(s: DuelState, screen: Screen): void {
  // terrain
  for (let x = 0; x < W; x++) {
    for (let y = Math.max(1, s.ground[x]); y < H; y++) screen.put(x, y, '█', y === s.ground[x] ? 'brightGreen' : 'green');
  }
  if (s.player.hp > 0) drawTank(s, s.player, 'brightCyan', screen);
  if (s.cpu.hp > 0) drawTank(s, s.cpu, 'brightRed', screen);

  const ph = s.phase;
  if (ph.kind === 'aim') {
    for (const p of aimPath(s)) if (p.y >= 1) screen.put(Math.floor(p.x), Math.floor(p.y), '·', 'cyan');
  }
  if (ph.kind === 'flight') {
    for (const p of ph.shell.trail) if (p.y >= 1) screen.put(Math.floor(p.x), Math.floor(p.y), '·', 'gray');
    if (ph.shell.y >= 1) screen.put(Math.floor(ph.shell.x), Math.floor(ph.shell.y), '●', 'brightWhite');
  }
  if (ph.kind === 'boom' && ph.x !== null && ph.y !== null) {
    const r = BLAST * (0.4 + 0.6 * (ph.t / BOOM_TICKS));
    for (let y = Math.floor(ph.y - r); y <= Math.ceil(ph.y + r); y++) {
      for (let x = Math.floor(ph.x - r); x <= Math.ceil(ph.x + r); x++) {
        if (y < 1 || y >= H || x < 0 || x >= W) continue;
        const d = Math.hypot(x + 0.5 - ph.x, (y + 0.5 - ph.y) / ASPECT);
        if (d <= r) screen.put(x, y, d < r / 2 ? '*' : '+', d < r / 2 ? 'brightYellow' : 'red');
      }
    }
  }

  // HUD
  screen.text(0, 0, `YOU ${s.player.hp}`, 'brightCyan');
  screen.text(9, 0, `Angle ${s.player.angle}`, 'white');
  screen.text(20, 0, `Power ${s.player.power}`, 'white');
  screen.text(31, 0, windText(s.wind), 'cyan');
  screen.text(42, 0, `R${s.round}`, 'gray');
  const cpu = `CPU ${s.cpu.hp}`;
  screen.text(W - cpu.length, 0, cpu, 'brightRed');
  if (s.message) screen.text(Math.floor((W - s.message.length) / 2), 2, s.message, 'brightYellow');
}

const tankDuel: Game<DuelState> = {
  id: 'tank-duel',
  title: 'Tank Duel',
  description: 'Aim, set power, fire. The computer shoots back.',
  tickMs: 40,
  controls: '←→↑↓ Spc fire',
  init,
  onKey,
  update,
  draw,
  score: (s) => s.score,
  isOver: (s) => s.over,
};

export default tankDuel;
