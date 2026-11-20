import { GAME_WIDTH } from '../../core/types';
import type { Color, Game, GameContext, Key, Screen } from '../../core/types';
import { WORDS } from './words';

// Word Guess: find a hidden five-letter word in six guesses, five words per run.
// After each guess every letter is marked:
//   [A] right letter, right spot   (A) in the word, elsewhere   a  not in the word
// Any five letters count as a guess. P is the host's pause key, so no answer has a P.

export const LEN = 5;
export const TRIES = 6;
export const ROUNDS = 5;
const NOTE_TICKS = 15;

export type Mark = 'hit' | 'near' | 'miss';
export interface Guess { word: string; marks: Mark[] }

export interface WordState {
  answers: string[];   // the run's words, picked at the start
  round: number;       // index into answers
  guesses: Guess[];    // guesses for the current word
  typed: string;       // letters typed for the next guess
  phase: 'guessing' | 'solved' | 'failed';
  score: number;
  solved: number;
  note: string;        // short message under the grid, e.g. "Need 5 letters"
  noteTicks: number;
  over: boolean;
}

/** Mark a guess against the answer. Repeated letters are only marked as often as the answer has them. */
export function markGuess(guess: string, answer: string): Mark[] {
  const marks: Mark[] = Array(LEN).fill('miss');
  const left: Record<string, number> = {};
  for (let i = 0; i < LEN; i++) {
    if (guess[i] === answer[i]) marks[i] = 'hit';
    else left[answer[i]] = (left[answer[i]] ?? 0) + 1;
  }
  for (let i = 0; i < LEN; i++) {
    if (marks[i] === 'hit') continue;
    if ((left[guess[i]] ?? 0) > 0) {
      marks[i] = 'near';
      left[guess[i]] -= 1;
    }
  }
  return marks;
}

/** Points for solving a word: 600 in one guess, 100 less for each extra guess. */
export const pointsFor = (guessesUsed: number) => (TRIES + 1 - guessesUsed) * 100;

/** Pick `n` different words. */
export function pickWords(n: number, ctx: GameContext): string[] {
  const pool = [...WORDS];
  const out: string[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    out.push(pool.splice(Math.floor(ctx.random() * pool.length), 1)[0]);
  }
  return out;
}

function init(ctx: GameContext): WordState {
  return {
    answers: pickWords(ROUNDS, ctx), round: 0, guesses: [], typed: '', phase: 'guessing',
    score: 0, solved: 0, note: '', noteTicks: 0, over: false,
  };
}

const note = (state: WordState, text: string): WordState => ({ ...state, note: text, noteTicks: NOTE_TICKS });

function submit(state: WordState): WordState {
  if (state.typed.length < LEN) return note(state, `Need ${LEN} letters`);
  const answer = state.answers[state.round];
  const guess: Guess = { word: state.typed, marks: markGuess(state.typed, answer) };
  const guesses = [...state.guesses, guess];
  const base = { ...state, guesses, typed: '', note: '', noteTicks: 0 };
  if (guess.word === answer) {
    return { ...base, phase: 'solved', score: state.score + pointsFor(guesses.length), solved: state.solved + 1 };
  }
  if (guesses.length >= TRIES) return { ...base, phase: 'failed' };
  return base;
}

function onKey(state: WordState, key: Key): WordState {
  if (state.over) return state;
  if (state.phase !== 'guessing') {
    if (key !== 'enter' && key !== 'space') return state;
    if (state.round + 1 >= state.answers.length) return { ...state, over: true };
    return { ...state, round: state.round + 1, guesses: [], typed: '', phase: 'guessing', note: '', noteTicks: 0 };
  }
  if (key === 'enter') return submit(state);
  if (key === 'backspace') return state.typed ? { ...state, typed: state.typed.slice(0, -1) } : state;
  if (/^[a-z]$/.test(key) && state.typed.length < LEN) return { ...state, typed: state.typed + key };
  return state;
}

function update(state: WordState): WordState {
  if (state.noteTicks === 0) return state;
  const noteTicks = state.noteTicks - 1;
  return noteTicks === 0 ? { ...state, note: '', noteTicks } : { ...state, noteTicks };
}

/** Best mark seen so far for every letter guessed this word. */
export function letterMarks(guesses: Guess[]): Record<string, Mark> {
  const rank: Record<Mark, number> = { miss: 0, near: 1, hit: 2 };
  const out: Record<string, Mark> = {};
  for (const g of guesses) {
    g.marks.forEach((m, i) => {
      const ch = g.word[i];
      if (!out[ch] || rank[m] > rank[out[ch]]) out[ch] = m;
    });
  }
  return out;
}

const MARK_COLOR: Record<Mark, Color> = { hit: 'brightGreen', near: 'brightYellow', miss: 'gray' };
const GRID_X = 4, GRID_Y = 2, KEYS_X = 32, KEYS_Y = 3;
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function drawCell(screen: Screen, x: number, y: number, ch: string, mark: Mark | null): void {
  if (mark === 'hit') screen.text(x, y, `[${ch.toUpperCase()}]`, MARK_COLOR.hit);
  else if (mark === 'near') screen.text(x, y, `(${ch.toUpperCase()})`, MARK_COLOR.near);
  else if (mark === 'miss') screen.text(x, y, ` ${ch} `, MARK_COLOR.miss);
  else screen.text(x, y, ch ? ` ${ch.toUpperCase()} ` : ' _ ', ch ? 'brightWhite' : 'gray');
}

function draw(state: WordState, screen: Screen): void {
  const head = `WORD ${Math.min(state.round + 1, ROUNDS)}/${ROUNDS}`;
  screen.text(GRID_X, 0, head, 'brightWhite');
  const sc = `SCORE ${state.score}`;
  screen.text(GAME_WIDTH - 2 - sc.length, 0, sc, 'brightWhite');

  for (let r = 0; r < TRIES; r++) {
    const y = GRID_Y + r * 2;
    const g = state.guesses[r];
    const typing = !g && r === state.guesses.length && state.phase === 'guessing';
    for (let i = 0; i < LEN; i++) {
      const x = GRID_X + i * 4;
      if (g) drawCell(screen, x, y, g.word[i], g.marks[i]);
      else drawCell(screen, x, y, typing ? (state.typed[i] ?? '') : '', null);
    }
    if (typing) screen.put(GRID_X - 2, y, '>', 'brightCyan');
  }

  const seen = letterMarks(state.guesses);
  KEY_ROWS.forEach((row, r) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      const x = KEYS_X + r + i * 2, y = KEYS_Y + r * 2;
      if (ch === 'p') { screen.put(x, y, '-', 'gray'); continue; }
      const m = seen[ch];
      screen.put(x, y, m === 'miss' ? ch : ch.toUpperCase(), m ? MARK_COLOR[m] : 'white');
    }
  });
  screen.text(KEYS_X, KEYS_Y + 6, 'no word has a P', 'gray');

  const answer = state.answers[state.round] ?? '';
  let line = state.note, color: Color = 'brightRed';
  if (state.phase === 'solved') {
    line = `Got it! +${pointsFor(state.guesses.length)}`;
    color = 'brightGreen';
  } else if (state.phase === 'failed') {
    line = `The word was ${answer.toUpperCase()}`;
  }
  if (line) screen.text(KEYS_X, 12, line, color);
  if (state.phase !== 'guessing') {
    const last = state.round + 1 >= state.answers.length;
    screen.text(KEYS_X, 14, last ? 'Enter: finish' : 'Enter: next word', 'white');
  }

  screen.text(GRID_X - 2, 15, '[A] right spot  (A) wrong spot  a  not in word', 'gray');
  screen.text(GRID_X - 2, 17, `Solved ${state.solved} of ${ROUNDS}`, 'gray');
}

const wordGuess: Game<WordState> = {
  id: 'word-guess',
  title: 'Word Guess',
  description: 'Find the hidden five-letter word in six tries. Five words a run.',
  tickMs: 100,
  controls: 'a-z type  Enter guess  Bksp',
  maxScore: ROUNDS * pointsFor(1), // every word in one guess
  length: { kind: 'rounds', minutes: 6 },
  init,
  onKey,
  update,
  draw,
  score: s => s.score,
  isOver: s => s.over,
};

export default wordGuess;
