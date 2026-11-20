// Passive-aggressive "motivation" for the heckler. Placeholders: {score} {best} {game} {time}.
// House rules: about performance only, never the person; mild swears only (damn, hell,
// shit, crap), roughly 1 line in 4. Add your own: the tests check the rules.

/** You're behind where your best run would be by now. */
export const BEHIND = [
  "{time} in and you're at {score}. Your best is {best}. Just saying.",
  'Your best was {best}. This run is... a run.',
  "{score}? Bold strategy. Let's see if it pays off.",
  "At this pace you'll beat {best} sometime next year.",
  'Remember when you scored {best}? Me too. Good times.',
  'Damn. {score}. Is the keyboard upside down?',
  'Not to compare, but past you would be crushing this.',
  "{score} after {time}. I'm not mad, just disappointed.",
  'This is fine. Everything is fine. ({score} vs {best})',
  'Hell of a warm-up. When does the real run start?',
];

/** The score hasn't moved for a while. */
export const STUCK = [
  'Are you playing or just admiring the graphics?',
  '{time} without a single point. Impressive, in a way.',
  "Still {score}. The score won't go up by staring at it.",
  'Did Claude finish and you forgot to blink?',
  'Shit happens. So could points, any minute now.',
  'Fun fact: points are allowed. Encouraged, even.',
  'Take your time. Claude is only doing all your actual work.',
  "Crap, did it freeze? Oh no, that's just you.",
];

/** No best for this game yet. */
export const NO_BEST = [
  'First time? It shows.',
  '{game}: easy to learn, apparently hard to master.',
  'No pressure. Well, some pressure.',
  "You're doing great. For a beginner. At {game}.",
  'Hell, everyone starts somewhere. Here, apparently.',
  'Interesting technique. Very... unique.',
  'Keep going. Statistically you have to get better.',
  'Damn, {score} already. Wait, is that good? Who knows.',
];

/** Run over, below your best. */
export const RUN_WORSE = [
  '{score}. Your best is {best}. Cool cool cool.',
  '{score}. Bold of you to stop there.',
  'Well, that happened. {score}, for the record.',
  '{best} was your best. {score} was... also a number.',
  'Damn, so close to {best}. Not really, but still.',
  '{score}. Maybe Claude should play next time.',
  "Shit. Well. There's always another run.",
  "{score}. I'll pretend I didn't see that.",
];

/** Run over, new best. */
export const RUN_BEST = [
  'New best: {score}. Took you long enough.',
  "{score}! Don't let it go to your head.",
  'New best. Even a broken clock, you know.',
  'Finally. {score}. Was that so hard?',
  'Hell yes, {score}. Now do it again, I dare you.',
  "New best. Enjoy it, it won't last.",
];

export const ALL_LINES = [...BEHIND, ...STUCK, ...NO_BEST, ...RUN_WORSE, ...RUN_BEST];

export type HeckleVars = { score: number | string; best: number | string; game: string; time: string };

export function fill(template: string, vars: HeckleVars): string {
  return template.replace(/\{(score|best|game|time)\}/g, (_, k: keyof HeckleVars) => String(vars[k]));
}
