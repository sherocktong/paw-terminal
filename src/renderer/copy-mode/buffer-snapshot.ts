import type { Terminal } from '@xterm/xterm';
import { captureBuffer } from './buffer-capture';

export interface BufferSnapshot {
  lines: string[];
  isAlternate: boolean;
}

/**
 * Maintains a rolling capture of alternate-buffer screens while a TUI is
 * active. When the terminal is in the alternate buffer (e.g. vim, tmux,
 * Claude Code), full-screen apps redraw the screen as the user scrolls, but
 * xterm.js does not keep scrollback. This manager snapshots the screen after
 * each parsed write, merges new screens with the existing history by detecting
 * overlapping lines, and discards the history when the terminal returns to the
 * normal buffer.
 */
export class BufferSnapshotManager {
  private term: Terminal;
  private maxLines: number;
  private alternateHistory: string[] = [];
  private lastCapture: string[] = [];
  private captureTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastWasAlternate = false;
  private unsubscribe: (() => void) | null = null;

  constructor(term: Terminal, maxLines = 10000) {
    this.term = term;
    this.maxLines = maxLines;
    this.start();
  }

  setMaxLines(maxLines: number): void {
    this.maxLines = maxLines;
    this.trimHistory();
  }

  private start(): void {
    const disposable = this.term.onWriteParsed(() => {
      this.scheduleCapture();
    });
    this.unsubscribe = () => disposable.dispose();
  }

  private scheduleCapture(): void {
    if (this.captureTimeout) return;
    this.captureTimeout = setTimeout(() => {
      this.captureTimeout = null;
      this.capture();
    }, 100);
  }

  private capture(): void {
    const isAlternate = this.term.buffer.active.type === 'alternate';

    if (!isAlternate) {
      if (this.lastWasAlternate) {
        this.alternateHistory = [];
        this.lastCapture = [];
      }
      this.lastWasAlternate = false;
      return;
    }

    this.lastWasAlternate = true;
    const lines = captureBuffer(this.term);

    if (this.arraysEqual(lines, this.lastCapture)) {
      return;
    }
    this.lastCapture = lines;

    // Ignore entirely blank screens (e.g. the initial clear before a TUI
    // starts drawing). They add nothing useful and create leading empty lines.
    if (lines.length === 0 || lines.every((line) => line === '')) {
      return;
    }

    this.mergeIntoHistory(lines);
  }

  private mergeIntoHistory(lines: string[]): void {
    // Drop leading blank lines from each incoming screen. Full-screen TUIs
    // often leave unused rows above the visible content; we only want to keep
    // the meaningful region.
    const firstNonEmpty = lines.findIndex((line) => line !== '');
    const trimmed = firstNonEmpty >= 0 ? lines.slice(firstNonEmpty) : lines;
    if (trimmed.length === 0) return;

    if (this.alternateHistory.length === 0) {
      this.alternateHistory = trimmed.slice();
      this.trimHistory();
      return;
    }

    // When the TUI scrolls, the new screen shares a suffix/prefix with the
    // previous capture. Detect that overlap and append only the new lines.
    const overlap = this.findOverlap(this.alternateHistory, trimmed);
    if (overlap > 0) {
      this.alternateHistory = this.alternateHistory.concat(trimmed.slice(overlap));
    } else {
      this.alternateHistory = this.alternateHistory.concat(trimmed);
    }
    this.trimHistory();
  }

  private findOverlap(history: string[], lines: string[]): number {
    const maxPossible = Math.min(history.length, lines.length);
    for (let len = maxPossible; len > 0; len--) {
      const historySuffix = history.slice(history.length - len);
      const linesPrefix = lines.slice(0, len);
      if (this.arraysEqual(historySuffix, linesPrefix)) {
        return len;
      }
    }
    return 0;
  }

  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  private trimHistory(): void {
    if (this.alternateHistory.length > this.maxLines) {
      this.alternateHistory = this.alternateHistory.slice(-this.maxLines);
    }
  }

  getSnapshot(): BufferSnapshot {
    const isAlternate = this.term.buffer.active.type === 'alternate';
    if (isAlternate) {
      const current = captureBuffer(this.term);
      const firstNonEmpty = current.findIndex((line) => line !== '');
      const trimmedCurrent = firstNonEmpty >= 0 ? current.slice(firstNonEmpty) : current;
      const overlap = this.findOverlap(this.alternateHistory, trimmedCurrent);
      const lines = this.alternateHistory.concat(trimmedCurrent.slice(overlap));
      return { lines, isAlternate: true };
    }
    return { lines: captureBuffer(this.term), isAlternate: false };
  }

  dispose(): void {
    if (this.captureTimeout) {
      clearTimeout(this.captureTimeout);
      this.captureTimeout = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
