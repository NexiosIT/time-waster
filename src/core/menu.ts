import { formatMinutes } from './length';
import type { Expected } from './length';
import type { TaskView } from './task';
import type { Color } from './types';

export type Suggestion = { title: string; expected: Expected };

export interface MenuRow {
  selected: boolean;
  title: string;
  expected: Expected | null;
  suggested: boolean;
  best: string;
  /** World best when online scores are on (otherwise undefined: the row keeps its offline layout). */
  world?: string;
}

export interface Segment {
  x: number;
  text: string;
  color: Color;
}

/** Columns inside the 60-wide play area; each segment is clipped to its own slot. */
const TITLE_X = 2, TITLE_W = 25;
const LEN_X = 28, LEN_W = 14;
const NEW_X = 43;
const STAR_X = 47;
const BEST_X = 49, BEST_W = 11;
/** Online: numbers under a `Best` / `World` header row instead of `Best <n>`. */
const ONLINE_BEST_X = 49, ONLINE_WORLD_X = 55, NUM_W = 5;

export function taskLine(view: TaskView, sugg: Suggestion | null): string {
  switch (view.state) {
    case 'none':
      return '';
    case 'estimating':
      return 'Claude: estimating…';
    case 'overdue':
      return 'Claude is running over';
    case 'running': {
      const left = `Claude ${formatMinutes(view.leftMs)} left`;
      if (!sugg) return left;
      const len = formatMinutes(sugg.expected.ms) + (sugg.expected.isNew ? ', new' : '');
      return `${left} · suggested: ${sugg.title} (${len})`;
    }
  }
}

export function lengthLabel(e: Expected | null): string {
  if (!e) return '';
  if (e.basis === 'timed') return formatMinutes(e.ms).slice(1);
  return `${formatMinutes(e.ms)} (${e.basis === 'you' ? 'you' : 'est.'})`;
}

export function rowSegments(r: MenuRow): Segment[] {
  const segs: Segment[] = [
    { x: TITLE_X, text: clip(`${r.selected ? '> ' : '  '}${r.title}`, TITLE_W), color: r.selected ? 'brightWhite' : 'white' },
  ];
  const len = lengthLabel(r.expected);
  if (len) segs.push({ x: LEN_X, text: clip(len, LEN_W), color: 'gray' });
  if (r.expected?.isNew) segs.push({ x: NEW_X, text: 'NEW', color: 'brightGreen' });
  if (r.suggested) segs.push({ x: STAR_X, text: '★', color: 'brightYellow' });
  if (r.world === undefined) {
    segs.push({ x: BEST_X, text: clip(`Best ${r.best}`, BEST_W), color: 'gray' });
  } else {
    segs.push({ x: ONLINE_BEST_X, text: shortNumber(r.best), color: 'gray' });
    segs.push({ x: ONLINE_WORLD_X, text: shortNumber(r.world), color: 'gray' });
  }
  return segs;
}

/** Fits a score into NUM_W columns without cutting digits: 99999, then 125k, then 1.0M. */
export function shortNumber(s: string): string {
  const n = Number(s);
  if (!/^\d+$/.test(s) || s.length <= NUM_W) return clip(s, NUM_W);
  if (n < 1_000_000) return `${Math.floor(n / 1000)}k`;
  return clip(`${(Math.floor(n / 100_000) / 10).toFixed(1)}M`, NUM_W);
}

/** Column headings above the rows when online scores are on. */
export function onlineHeader(): Segment[] {
  return [
    { x: ONLINE_BEST_X, text: 'Best', color: 'gray' },
    { x: ONLINE_WORLD_X, text: 'World', color: 'gray' },
  ];
}

export function clip(s: string, n: number): string {
  return n <= 0 ? '' : s.length > n ? s.slice(0, n) : s;
}
