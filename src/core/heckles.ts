// Passive-aggressive "motivation" for the heckler. Placeholders: {score} {best} {game} {time} {leader}.
// House rules: about how you play, never insults at the person, no slurs. Swearing is
// welcome (about half the lines). In-game lines must fit 62 columns. Tests check all this.

/** A few seconds into every run. */
export const START = [
  "Oh good, {game} again. Let's see how you fuck this one up.",
  'New run. Same hands, I assume.',
  "Go on then. Impress me. I'll wait.",
  "Another run? Hell, why not. Claude's doing your job anyway.",
  'Here we go again. Try not to embarrass us both.',
  "Damn, you're really doing this. Okay.",
  "Fresh start. Don't piss it away like the last one.",
  "Let's go. Or, you know, let's sort of go.",
];

/** You're behind where your best run would be by now. */
export const BEHIND = [
  '{time} in and at {score}? Best is {best}. What the fuck?',
  'Your best was {best}. This run is... a run.',
  "{score}? Bold strategy. Let's see if it pays off.",
  "At this pace you'll beat {best} next fucking year.",
  'Remember when you scored {best}? Me too. Good times.',
  'Damn. {score}. Is the keyboard upside down?',
  'Not to compare, but past you is kicking your ass.',
  "{score} after {time}. I'm not mad, just disappointed.",
  'This is fine. Everything is fine. Holy shit.',
  'Hell of a warm-up. When does the real run start?',
];

/** You're ahead of your best pace: still no peace. */
export const AHEAD = [
  "Ahead of your best. Don't fuck it up now.",
  '{score} already? Who are you and where is the usual you?',
  "Okay, that's actually decent. Shit, I'm not used to this.",
  'Look at you, beating {best} pace. Enjoy it while it lasts.',
  'Ahead of schedule. Statistically, the choke is coming.',
  "Damn, okay. Keep this up and I'll need new material.",
  'On pace for a record. No pressure. Well, all the pressure.',
  'Holy crap, you can actually play. Too bad about your job.',
];

/** The score hasn't moved for a while. */
export const STUCK = [
  'Are you playing or just admiring the graphics?',
  '{time} without a point. Fucked up, but impressive.',
  "Still {score}. The score won't go up by staring at it.",
  'Did Claude finish and you forgot to blink?',
  'Shit happens. So could points, any minute now.',
  'Fun fact: points are allowed. Encouraged, even.',
  'Take your damn time. Claude does the real work anyway.',
  "Crap, did it freeze? Oh no, that's just you.",
];

/** No best for this game yet. */
export const NO_BEST = [
  'First time? It fucking shows.',
  '{game}: easy to learn, hard as hell to master.',
  'No pressure. Well, some pressure.',
  "You're doing great. For a beginner. At {game}.",
  'Hell, everyone starts somewhere. Here, apparently.',
  'Interesting technique. Very... unique.',
  'Keep going. Statistically you have to get better.',
  'Damn, {score} already. Is that good? Who the fuck knows.',
];

/** Run over, below your best. */
export const RUN_WORSE = [
  '{score}. Your best is {best}. Cool cool cool.',
  '{score}. Bold of you to stop there.',
  'Well, that was a pile of shit. {score}, for the record.',
  '{best} was your best. {score} was... also a number.',
  'Damn, so close to {best}. Not really, but still.',
  '{score}. Maybe Claude should play next time.',
  "Shit. Well. There's always another run.",
  '{score}. What the hell was that?',
];

/** Run over, new best. */
export const RUN_BEST = [
  'New best: {score}. Took you long enough.',
  "{score}! Don't let it go to your head.",
  'New best. Even a broken clock, you know.',
  'Finally. {score}. Was that so fucking hard?',
  'Hell yes, {score}. Now do it again, I dare you.',
  "Holy shit, a new best. Screenshot it, it won't happen again.",
];

/** Next to the current leader on the web leaderboard ({leader}, {score}, {game}). */
export const LEADER = [
  '{leader} holds the record with {score}. Must be nice having that much free time.',
  '{score} in {game}. {leader}, does your manager know about this shit?',
  'Congrats {leader}. Truly the best at the thing nobody asked you to do.',
  '{leader} is on top. For now. Enjoy it while it lasts.',
  '{score}? Damn, {leader}. Maybe go outside sometime.',
  '{leader}: living proof that Claude does all the actual work.',
  "Bow down to {leader}. Or don't. Honestly, it's {game}.",
  'Hell of a score, {leader}. Shame about your fucking productivity.',
];

/** Lines shown on the top row during play; they must fit a 62-column window. */
export const IN_GAME = [...START, ...BEHIND, ...AHEAD, ...STUCK, ...NO_BEST];

export const ALL_LINES = [...IN_GAME, ...RUN_WORSE, ...RUN_BEST, ...LEADER];

export type HeckleVars = { score: number | string; best: number | string; game: string; time: string; leader?: string };

export function fill(template: string, vars: HeckleVars): string {
  return template.replace(/\{(score|best|game|time|leader)\}/g, (_, k: keyof HeckleVars) => String(vars[k] ?? ''));
}
