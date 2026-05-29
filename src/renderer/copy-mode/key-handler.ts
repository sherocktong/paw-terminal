import type { CopyModeCommand } from '../../shared/constants';

export interface ParsedCommand {
  command: CopyModeCommand;
  count?: number;
}

export class KeyHandler {
  private pendingCount = '';
  private pendingOperator = '';

  handle(event: KeyboardEvent): ParsedCommand | null {
    const key = event.key;
    const ctrl = event.ctrlKey;
    const shift = event.shiftKey;
    const alt = event.altKey;

    // Handle count prefix (digits)
    if (/^[0-9]$/.test(key) && !ctrl && !alt) {
      if (key === '0' && this.pendingCount === '') {
        // 0 alone means move to start of line
        return { command: 'moveLineStart' };
      }
      this.pendingCount += key;
      return { command: 'noop' };
    }

    const count = this.pendingCount ? parseInt(this.pendingCount, 10) : 1;
    this.pendingCount = '';

    // Movement keys
    if (key === 'h' || (key === 'ArrowLeft' && !ctrl)) {
      return { command: 'moveLeft', count };
    }
    if (key === 'j' || (key === 'ArrowDown' && !ctrl)) {
      return { command: 'moveDown', count };
    }
    if (key === 'k' || (key === 'ArrowUp' && !ctrl)) {
      return { command: 'moveUp', count };
    }
    if (key === 'l' || (key === 'ArrowRight' && !ctrl)) {
      return { command: 'moveRight', count };
    }

    if (key === 'w' && !shift) {
      return { command: 'moveWordForward', count };
    }
    if (key === 'W' && shift) {
      return { command: 'moveWordForwardBig', count };
    }
    if (key === 'b' && !shift) {
      return { command: 'moveWordBackward', count };
    }
    if (key === 'B' && shift) {
      return { command: 'moveWordBackwardBig', count };
    }
    if (key === 'e' && !shift) {
      return { command: 'moveWordForward', count }; // end of word - simplify for now
    }
    if (key === 'E' && shift) {
      return { command: 'moveWordForwardBig', count };
    }

    if (key === '0') {
      return { command: 'moveLineStart' };
    }
    if (key === '^') {
      return { command: 'moveLineStartNonBlank' };
    }
    if (key === '$') {
      return { command: 'moveLineEnd' };
    }
    if (key === 'g' && !shift && !ctrl) {
      if (this.pendingOperator === 'g') {
        this.pendingOperator = '';
        return { command: 'moveFirstLine', count };
      }
      this.pendingOperator = 'g';
      return { command: 'noop' };
    }
    if (key === 'G' && shift) {
      return { command: 'moveLastLine', count };
    }
    if (key === 'H' && shift) {
      return { command: 'moveScreenTop' };
    }
    if (key === 'M' && shift) {
      return { command: 'moveScreenMiddle' };
    }
    if (key === 'L' && shift) {
      return { command: 'moveScreenBottom' };
    }

    // Scroll
    if (key === 'd' && ctrl) {
      return { command: 'scrollHalfPageDown', count };
    }
    if (key === 'u' && ctrl) {
      return { command: 'scrollHalfPageUp', count };
    }
    if (key === 'f' && ctrl) {
      return { command: 'scrollPageDown', count };
    }
    if (key === 'b' && ctrl) {
      return { command: 'scrollPageUp', count };
    }

    // Visual mode
    if (key === 'v' && !shift && !ctrl) {
      return { command: 'enterVisual' };
    }
    if (key === 'V' && shift) {
      return { command: 'enterVisualLine' };
    }

    // Yank
    if (key === 'y' && !shift && !ctrl) {
      return { command: 'yank' };
    }

    // Search
    if (key === '/' && !shift) {
      return { command: 'searchForward' };
    }
    if (key === '?' && shift) {
      return { command: 'searchBackward' };
    }
    if (key === 'n' && !shift) {
      return { command: 'nextSearch', count };
    }
    if (key === 'N' && shift) {
      return { command: 'prevSearch', count };
    }

    // Exit
    if (key === 'Escape' || key === 'q' || (key === 'c' && ctrl)) {
      return { command: 'exit' };
    }

    // If pending operator didn't match, clear it
    if (this.pendingOperator) {
      this.pendingOperator = '';
      return { command: 'noop' };
    }

    return null;
  }

  reset(): void {
    this.pendingCount = '';
    this.pendingOperator = '';
  }
}
