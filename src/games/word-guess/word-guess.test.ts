import { describe, expect, it } from 'vitest';
import { createRandom } from '../../core/random';
import type { GameContext } from '../../core/types';
import game, { LEN, ROUNDS, TRIES, letterMarks, markGuess, pickWords, pointsFor, type WordState } from './index';
import { WORDS } from './words';

const ctx = (seed = 1): GameContext => ({ random: createRandom(seed), elapsedMs: 0 });
const type = (s: WordState, word: string) => [...word].reduce((t, ch) => game.onKey(t, ch), s);
const guess = (s: WordState, word: string) => game.onKey(type(s, word), 'enter');
/** A known state: answers fixed so tests don't depend on the word list. */
const fixed = (answers: string[]): WordState => ({ ...game.init(ctx()), answers });

describe('word-guess', () => {
  it('word list: unique, lowercase five-letter words, none with a P', () => {
    expect(WORDS.length).toBeGreaterThan(300);
    expect(new Set(WORDS).size).toBe(WORDS.length);
    for (const w of WORDS) expect(w).toMatch(/^[a-oq-z]{5}$/);
  });

  it('starts on word 1 with no guesses and score 0', () => {
    const s = game.init(ctx());
    expect(s.answers).toHaveLength(ROUNDS);
    expect(new Set(s.answers).size).toBe(ROUNDS);
    expect(s.guesses).toEqual([]);
    expect(game.score(s)).toBe(0);
    expect(game.isOver(s)).toBe(false);
  });

  it('pickWords draws different words from the list', () => {
    const w = pickWords(50, ctx(3));
    expect(new Set(w).size).toBe(50);
    for (const x of w) expect(WORDS).toContain(x);
  });

  it('types letters up to five, backspace removes one, other keys ignored, input not mutated', () => {
    const s0 = fixed(['crane']);
    const s1 = type(s0, 'abcdefg');
    expect(s1.typed).toBe('abcde');
    expect(s0.typed).toBe('');
    expect(game.onKey(s1, 'backspace').typed).toBe('abcd');
    expect(game.onKey(s0, 'backspace')).toBe(s0);
    expect(game.onKey(s0, '1')).toBe(s0);
    expect(game.onKey(s0, 'up')).toBe(s0);
  });

  it('enter on a short word shows a note and does not use a try; the note fades', () => {
    const s = game.onKey(type(fixed(['crane']), 'cra'), 'enter');
    expect(s.guesses).toHaveLength(0);
    expect(s.note).toMatch(/5 letters/);
    let t = s;
    for (let i = 0; i < 20; i++) t = game.update(t, ctx());
    expect(t.note).toBe('');
  });

  it('marks hits, near misses and misses', () => {
    expect(markGuess('crate', 'crane')).toEqual(['hit', 'hit', 'hit', 'miss', 'hit']);
    expect(markGuess('nacre', 'crane')).toEqual(['near', 'near', 'near', 'near', 'hit']);
    expect(markGuess('ghost', 'crane')).toEqual(['miss', 'miss', 'miss', 'miss', 'miss']);
  });

  it('marks repeated letters only as often as the answer has them', () => {
    // two Es in the answer, both hit: the third E is a miss, not near
    expect(markGuess('geese', 'there')).toEqual(['miss', 'miss', 'hit', 'miss', 'hit']);
    expect(markGuess('eerie', 'crane')).toEqual(['miss', 'miss', 'near', 'miss', 'hit']);
    // two Ls in the answer, both hit: the first L is a miss
    expect(markGuess('lolly', 'hello')).toEqual(['miss', 'near', 'hit', 'hit', 'miss']);
    // one L in the answer, placed elsewhere: only the first extra L is near
    expect(markGuess('llama', 'world')).toEqual(['near', 'miss', 'miss', 'miss', 'miss']);
  });

  it('solving scores 600 for one guess, 100 less per extra guess', () => {
    expect(pointsFor(1)).toBe(600);
    expect(pointsFor(TRIES)).toBe(100);
    const one = guess(fixed(['crane', 'ghost']), 'crane');
    expect(one.phase).toBe('solved');
    expect(game.score(one)).toBe(600);
    const three = guess(guess(guess(fixed(['crane', 'ghost']), 'ghost'), 'trace'), 'crane');
    expect(game.score(three)).toBe(400);
    expect(three.solved).toBe(1);
  });

  it('six wrong guesses fail the word with no points', () => {
    let s = fixed(['crane', 'ghost']);
    for (let i = 0; i < TRIES; i++) s = guess(s, 'zzzzz');
    expect(s.phase).toBe('failed');
    expect(game.score(s)).toBe(0);
    expect(type(s, 'crane')).toBe(s); // typing is ignored until Enter moves on
  });

  it('enter moves to the next word; after the last word the run ends', () => {
    let s = guess(fixed(['crane', 'ghost']), 'crane');
    s = game.onKey(s, 'enter');
    expect(s.round).toBe(1);
    expect(s.guesses).toEqual([]);
    expect(s.phase).toBe('guessing');
    s = game.onKey(guess(s, 'ghost'), 'enter');
    expect(game.isOver(s)).toBe(true);
    expect(game.score(s)).toBe(1200);
    expect(game.onKey(s, 'a')).toBe(s);
  });

  it('a full run of five one-guess solves reaches maxScore', () => {
    let s = game.init(ctx(9));
    for (let r = 0; r < ROUNDS; r++) s = game.onKey(guess(s, s.answers[r]), 'enter');
    expect(game.isOver(s)).toBe(true);
    expect(game.score(s)).toBe(game.maxScore);
  });

  it('letterMarks keeps the best mark per letter', () => {
    const m = letterMarks([
      { word: 'trace', marks: markGuess('trace', 'crane') },
      { word: 'ghost', marks: markGuess('ghost', 'crane') },
    ]);
    expect(m).toMatchObject({ t: 'miss', r: 'hit', a: 'hit', c: 'near', e: 'hit', g: 'miss' });
  });

  it('draws inside the play area with single-width characters', () => {
    const screen = {
      width: 60, height: 20, clear() {},
      put(x: number, y: number, ch: string) {
        expect(ch).toHaveLength(1);
        expect(ch.charCodeAt(0)).toBeLessThan(0x2000);
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(60);
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(20);
      },
      text(x: number, y: number, s: string) {
        expect(x).toBeGreaterThanOrEqual(0); expect(x + s.length).toBeLessThanOrEqual(60);
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(20);
      },
    };
    let s = fixed(['crane', 'ghost']);
    game.draw(s, screen);
    s = guess(type(s, ''), 'trace');
    game.draw(type(s, 'cr'), screen);
    let f = s;
    for (let i = 0; i < TRIES; i++) f = guess(f, 'zzzzz');
    game.draw(f, screen);
    game.draw(guess(s, 'crane'), screen);
    expect(LEN).toBe(5);
  });
});
