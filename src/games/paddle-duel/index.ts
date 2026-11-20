import { GAME_HEIGHT, GAME_WIDTH } from '../../core/types';
import type { Game, GameContext, Key, Screen } from '../../core/types';

// Paddle Duel: you (left) against the computer (right). Bounce the ball past the
// other paddle to win a point; first to 7 wins. Where the ball meets your paddle sets
// its angle (edges send it steep), and every return makes it a little faster.
// Input is press-only: each press of Up/Down moves your paddle a fixed step.

export const TOP = 1;                      // highest row the ball and paddles use
export const BOTTOM = GAME_HEIGHT - 2;     // lowest row (rows 0 and 19 are walls)
export const PADDLE_H = 4;
export const PLAYER_X = 2;
export const CPU_X = GAME_WIDTH - 3;
export const PLAYER_FACE = PLAYER_X + 0.5; // the ball bounces when it crosses this x
export const CPU_FACE = CPU_X - 0.5;
export const MIN_PADDLE = TOP, MAX_PADDLE = BOTTOM - PADDLE_H + 1; // paddle top row range
export const WIN = 7;
export const STEP = 2;                     // rows per key press

export const SERVE_SPEED = 0.55;           // columns per tick
export const MAX_SPEED = 1.2;
export const SPEEDUP = 0.07;               // added on every paddle hit
export const MAX_VY = 0.5;                 // vertical speed off a paddle edge
export const CPU_SPEED = 0.27;             // rows per tick the computer can move
export const CPU_WAKE_X = 26;              // the computer only tracks the ball past this column
export const AIM_ERROR = 4.0;              // spread of the computer's aim error, in rows
export const SERVE_TICKS = 30;

export interface Ball { x: number; y: number; vx: number; vy: number }

export interface DuelState {
  paddle: number;      // your paddle's top row
  cpu: number;         // computer paddle's top row (fractional: it glides)
  aim: number;         // computer's aiming error in rows, re-rolled on each of your returns
  ball: Ball;
  serve: number;       // ticks until the ball moves again (0 = in play)
  you: number;
  them: number;
  rally: number;       // returns in the current rally
  tick: number;
  over: boolean;
}

const mid = (MIN_PADDLE + MAX_PADDLE) / 2;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A fresh ball in the centre, heading toward `dir` (-1 = you, 1 = the computer). */
export function serveBall(dir: -1 | 1, ctx: GameContext): Ball {
  return {
    x: GAME_WIDTH / 2, y: (TOP + BOTTOM) / 2 + (ctx.random() - 0.5) * 6,
    vx: dir * SERVE_SPEED, vy: (ctx.random() - 0.5) * 0.4,
  };
}

/** Angle off a paddle: -1 at its top edge, 0 in the middle, 1 at the bottom edge. */
export function hitOffset(paddleTop: number, y: number): number {
  return clamp((y - (paddleTop + (PADDLE_H - 1) / 2)) / (PADDLE_H / 2), -1, 1);
}

/** Does a ball crossing the paddle face at row y hit a paddle whose top row is `top`? */
export const covers = (top: number, y: number) => y >= top - 0.5 && y <= top + PADDLE_H - 0.5;

function init(ctx: GameContext): DuelState {
  return {
    paddle: Math.round(mid), cpu: mid, aim: 0, ball: serveBall(-1, ctx), serve: SERVE_TICKS,
    you: 0, them: 0, rally: 0, tick: 0, over: false,
  };
}

function onKey(state: DuelState, key: Key): DuelState {
  if (state.over) return state;
  let d = 0;
  if (key === 'up' || key === 'w') d = -STEP;
  else if (key === 'down' || key === 's') d = STEP;
  else return state;
  const paddle = clamp(state.paddle + d, MIN_PADDLE, MAX_PADDLE);
  return paddle === state.paddle ? state : { ...state, paddle };
}

function moveCpu(state: DuelState): number {
  const b = state.ball;
  const tracking = state.serve === 0 && b.vx > 0 && b.x > CPU_WAKE_X;
  const target = tracking ? b.y + state.aim - (PADDLE_H - 1) / 2 : mid;
  const step = clamp(target - state.cpu, -CPU_SPEED, CPU_SPEED);
  return clamp(state.cpu + step, MIN_PADDLE, MAX_PADDLE);
}

function point(state: DuelState, youScored: boolean, ctx: GameContext): DuelState {
  const you = state.you + (youScored ? 1 : 0);
  const them = state.them + (youScored ? 0 : 1);
  return {
    ...state, you, them, rally: 0, aim: 0,
    ball: serveBall(youScored ? 1 : -1, ctx), // serve toward whoever just lost the point
    serve: SERVE_TICKS, over: you >= WIN || them >= WIN,
  };
}

function update(prev: DuelState, ctx: GameContext): DuelState {
  if (prev.over) return prev;
  const state = { ...prev, tick: prev.tick + 1, cpu: moveCpu(prev) };
  if (state.serve > 0) return { ...state, serve: state.serve - 1 };

  const b = state.ball;
  let { vx, vy } = b;
  let x = b.x + vx;
  let y = b.y + vy;

  // Top and bottom walls reflect.
  if (y < TOP) { y = 2 * TOP - y; vy = -vy; }
  if (y > BOTTOM) { y = 2 * BOTTOM - y; vy = -vy; }

  let rally = state.rally;
  let aim = state.aim;
  // Paddles: check where the ball crosses the face this tick, so it can never tunnel.
  const bounce = (face: number, top: number, dir: 1 | -1): boolean => {
    const t = (b.x - face) / (b.x - x);
    const yc = b.y + (y - b.y) * t;
    if (!covers(top, yc)) return false;
    const speed = Math.min(MAX_SPEED, Math.abs(vx) + SPEEDUP);
    vx = dir * speed;
    vy = hitOffset(top, yc) * MAX_VY;
    x = face + (face - x);
    rally += 1;
    return true;
  };
  if (b.vx < 0 && b.x >= PLAYER_FACE && x < PLAYER_FACE) {
    if (bounce(PLAYER_FACE, state.paddle, 1)) aim = (ctx.random() - 0.5) * AIM_ERROR;
  } else if (b.vx > 0 && b.x <= CPU_FACE && x > CPU_FACE) {
    bounce(CPU_FACE, Math.round(state.cpu), -1);
  }

  if (x < 0) return point(state, false, ctx);
  if (x >= GAME_WIDTH) return point(state, true, ctx);
  return { ...state, ball: { x, y, vx, vy }, rally, aim };
}

/** 100 per point you win, plus 100 per point of margin if you win the match. */
export function scoreOf(s: DuelState): number {
  const margin = s.you >= WIN ? s.you - s.them : 0;
  return s.you * 100 + margin * 100;
}

function draw(state: DuelState, screen: Screen): void {
  for (let x = 0; x < GAME_WIDTH; x++) {
    screen.put(x, 0, '─', 'gray');
    screen.put(x, GAME_HEIGHT - 1, '─', 'gray');
  }
  const net = Math.floor(GAME_WIDTH / 2);
  for (let y = TOP; y <= BOTTOM; y += 2) screen.put(net, y, '┆', 'gray');

  const label = ` YOU ${state.you}  :  ${state.them} CPU `;
  screen.text(Math.floor((GAME_WIDTH - label.length) / 2), 0, label, 'brightWhite');

  for (let i = 0; i < PADDLE_H; i++) {
    screen.put(PLAYER_X, state.paddle + i, '█', 'brightCyan');
    screen.put(CPU_X, Math.round(state.cpu) + i, '█', 'brightMagenta');
  }

  if (state.over) {
    const msg = state.you >= WIN ? 'YOU WIN' : 'CPU WINS';
    screen.text(Math.floor((GAME_WIDTH - msg.length) / 2), 9, msg, state.you >= WIN ? 'brightGreen' : 'brightRed');
    return;
  }
  const bx = Math.round(state.ball.x), by = Math.round(state.ball.y);
  if (bx >= 0 && bx < GAME_WIDTH) screen.put(bx, clamp(by, TOP, BOTTOM), '●', 'brightYellow');
  if (state.serve > 0 && state.you + state.them === 0) {
    const msg = 'First to 7. Up/Down moves.';
    screen.text(Math.floor((GAME_WIDTH - msg.length) / 2), 5, msg, 'white');
  }
  if (state.rally >= 5) screen.text(net - 4, GAME_HEIGHT - 1, ` RALLY ${state.rally} `, 'yellow');
}

const paddleDuel: Game<DuelState> = {
  id: 'paddle-duel',
  title: 'Paddle Duel',
  description: 'Bounce the ball past the computer. First to 7 wins.',
  tickMs: 40,
  controls: '↑↓ move',
  maxScore: WIN * 200,   // 7 points x 100, plus a 7-0 margin bonus of 700
  length: { kind: 'rounds', minutes: 4 },
  init,
  onKey,
  update,
  draw,
  score: scoreOf,
  isOver: s => s.over,
};

export default paddleDuel;
