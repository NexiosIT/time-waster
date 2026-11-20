export type Color = 'black'|'red'|'green'|'yellow'|'blue'|'magenta'|'cyan'|'white'
  |'gray'|'brightRed'|'brightGreen'|'brightYellow'|'brightBlue'|'brightMagenta'|'brightCyan'|'brightWhite';
export type Key = 'up'|'down'|'left'|'right'|'space'|'enter'|'escape'|'backspace'|'tab'|'ctrl-c'|string; // string = single lowercase letter/digit/symbol
export interface Screen {
  width: number;
  height: number;
  put(x: number, y: number, ch: string, color?: Color): void;
  text(x: number, y: number, s: string, color?: Color): void;
  clear(): void;
}
export interface GameContext { random(): number; elapsedMs: number; }
export interface Game<S> {
  id: string;
  title: string;
  description: string;
  tickMs: number;
  controls: string;
  init(ctx: GameContext): S;
  onKey(state: S, key: Key): S;
  update(state: S, ctx: GameContext): S;
  draw(state: S, screen: Screen): void;
  score(state: S): number;
  isOver(state: S): boolean;
}
export const GAME_WIDTH = 60, GAME_HEIGHT = 20, MIN_COLS = 62, MIN_ROWS = 23;
