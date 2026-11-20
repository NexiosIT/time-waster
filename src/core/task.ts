import type { ClaudeEvent } from './events';

export const TASK_MAX_AGE_MS = 30 * 60_000;

export type TaskView =
  | { state: 'none' }
  | { state: 'estimating' }
  | { state: 'running'; leftMs: number }
  | { state: 'overdue' };

type Task = { project: string; startMs: number; estimateMs: number | null };

export class TaskClock {
  private task: Task | null = null;
  // `at` of the newest start ever seen, so a later `done` cannot let an older start resurrect a task
  private lastStartMs = -Infinity;

  apply(ev: ClaudeEvent): void {
    const t = Date.parse(ev.at);
    if (Number.isNaN(t)) return;
    if (ev.type === 'start') {
      if (t > this.lastStartMs) {
        this.lastStartMs = t;
        this.task = { project: ev.project, startMs: t, estimateMs: null };
      }
    } else if (ev.type === 'estimate') {
      if (this.task && ev.project === this.task.project && t >= this.task.startMs) {
        this.task.estimateMs = ev.minutes * 60_000;
      }
    } else if (ev.type === 'done') {
      if (this.task && ev.project === this.task.project && t >= this.task.startMs) this.task = null;
    }
  }

  view(nowMs: number): TaskView {
    const k = this.task;
    if (!k) return { state: 'none' };
    if (k.estimateMs === null) return nowMs - k.startMs > TASK_MAX_AGE_MS ? { state: 'none' } : { state: 'estimating' };
    const leftMs = k.startMs + k.estimateMs - nowMs;
    return leftMs > 0 ? { state: 'running', leftMs } : { state: 'overdue' };
  }
}
