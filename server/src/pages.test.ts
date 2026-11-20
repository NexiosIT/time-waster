import { describe, expect, test } from 'vitest';
import { LEADER, fill } from '../../src/core/heckles';
import { escapeHtml, leaderQuote, renderBoard, renderIndex, renderPlay } from './pages';

const GAMES = [{ id: 'worm', title: 'Worm' }, { id: 'tank-duel', title: 'Tank Duel' }];

describe('pages', () => {
  test('escapeHtml escapes everything that matters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  test('the leader quote is one of the leader lines, filled in, and stable for the same leader and score', () => {
    const q = leaderQuote('Worm', 'octocat', 910);
    const options = LEADER.map((l) => fill(l, { score: 910, best: 910, game: 'Worm', time: '', leader: 'octocat' }));
    expect(options).toContain(q);
    expect(leaderQuote('Worm', 'octocat', 910)).toBe(q);
  });

  test('index lists every game with its leader and a link, sorted by title', () => {
    const html = renderIndex(GAMES, { worm: { login: 'octocat', score: 910 } });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html.indexOf('Tank Duel')).toBeLessThan(html.indexOf('Worm'));
    expect(html).toContain('href="/games/worm"');
    expect(html).toContain('href="/games/tank-duel"');
    expect(html).toContain('octocat');
    expect(html).toContain('910');
    expect(html).toContain('No scores yet');
  });

  test('a board shows ranks, logins and scores, with the passive-aggressive quote next to the leader', () => {
    const top = [
      { rank: 1, login: 'octocat', score: 910, at: '2026-11-20T10:00:00.000Z' },
      { rank: 2, login: 'rokeppen', score: 655, at: '2026-11-20T11:00:00.000Z' },
    ];
    const html = renderBoard(GAMES[0], top);
    expect(html).toContain('<title>Worm · Time-waster high scores</title>');
    expect(html).toMatch(/octocat[\s\S]*910[\s\S]*rokeppen[\s\S]*655/);
    expect(html).toContain(escapeHtml(leaderQuote('Worm', 'octocat', 910)));
    expect(html).toContain('href="/"');
  });

  test('an empty board says so instead of showing a leader', () => {
    const html = renderBoard(GAMES[0], []);
    expect(html).toContain('No scores yet');
    expect(html).not.toContain('class="quote"');
  });

  test('logins are escaped even if one ever slipped past validation', () => {
    const html = renderBoard(GAMES[0], [{ rank: 1, login: '<script>x</script>', score: 1, at: '2026-11-20T10:00:00.000Z' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('index has a play link per game', () => {
    const html = renderIndex(GAMES, {});
    expect(html).toContain('href="/play/worm"');
    expect(html).toContain('href="/play/tank-duel"');
  });

  test('a board has a play link and a web top 10 with escaped names', () => {
    const web = [{ rank: 1, name: '<b>Kim</b>', score: 77, at: '2026-11-20T10:00:00.000Z' }];
    const html = renderBoard(GAMES[0], [], web);
    expect(html).toContain('href="/play/worm"');
    expect(html).toContain('Web');
    expect(html).toContain('&lt;b&gt;Kim&lt;/b&gt;');
    expect(html).toContain('77');
    expect(html).not.toContain('<b>Kim</b>');
    expect(renderBoard(GAMES[0], [], [])).toContain('No web scores yet');
  });

  test('the play page loads the script by URL only, with the game id on the body', () => {
    const html = renderPlay(GAMES[0], []);
    expect(html).toContain('data-game="worm"');
    expect(html).toMatch(/<script src="\/assets\/play\.js\?v=[a-z0-9]+" defer><\/script>/);
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('id="grid"');
    expect(html).toContain('id="status"');
    expect(html).toContain('id="name"');
    expect(html).toContain('id="web-board"');
    expect(html).toContain('href="/games/worm"');
  });
});
