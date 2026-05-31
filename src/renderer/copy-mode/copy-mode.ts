import { Terminal } from '@xterm/xterm';
import type { Config, CopyModeState, CopyModePosition, CopyModeSubMode, Theme } from '../../shared/types';
import { captureBuffer } from './buffer-capture';
import { KeyHandler, type ParsedCommand } from './key-handler';
import { searchBuffer, type SearchResult } from './search';
import { VisualRenderer } from './visual-renderer';
import type { ThemeManager } from '../theme/theme-manager';

export class CopyMode {
  private term: Terminal;
  private container: HTMLElement;
  private config: Config;
  private themeManager: ThemeManager;
  private state: CopyModeState;
  private renderer: VisualRenderer;
  private keyHandlerInstance = new KeyHandler();
  private searchDirection: 'forward' | 'backward' = 'forward';
  private isSearching = false;
  private lastSearchQuery = '';

  constructor(term: Terminal, container: HTMLElement, config: Config, themeManager: ThemeManager) {
    this.term = term;
    this.container = container;
    this.config = config;
    this.themeManager = themeManager;
    this.renderer = new VisualRenderer(container, themeManager.getCurrentTheme(), config.font);
    this.state = this.createInitialState();
  }

  updateConfig(config: Config): void {
    this.config = config;
    this.renderer.setTheme(this.themeManager.getCurrentTheme());
    this.renderer.setFont(config.font);
    if (this.state.active) {
      this.renderer.render(this.state);
    }
  }

  isActive(): boolean {
    return this.state.active;
  }

  private createInitialState(): CopyModeState {
    return {
      active: false,
      subMode: 'normal',
      cursor: { line: 0, col: 0 },
      searchQuery: '',
      searchDirection: 'forward',
      searchResults: [],
      currentSearchIndex: -1,
      bufferLines: [],
    };
  }

  enter(): void {
    if (this.state.active) return;

    const bufferLines = captureBuffer(this.term);
    const cursorLine = bufferLines.length > 0 ? bufferLines.length - 1 : 0;

    this.state = {
      active: true,
      subMode: 'normal',
      cursor: { line: cursorLine, col: 0 },
      searchQuery: '',
      searchDirection: 'forward',
      searchResults: [],
      currentSearchIndex: -1,
      bufferLines,
    };

    this.term.blur();
    this.term.element?.classList.add('copy-mode-active');
    this.renderer.render(this.state);
  }

  exit(): void {
    if (!this.state.active) return;

    this.state = this.createInitialState();
    this.renderer.clear();
    this.term.element?.classList.remove('copy-mode-active');
    this.term.focus();

    this.keyHandlerInstance.reset();
    this.isSearching = false;
  }

  /** Process a key event while in copy mode. Returns true if consumed. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.state.active) return false;

    // Handle search input mode
    if (this.isSearching) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelSearch();
        return true;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        this.executeSearch();
        return true;
      }
      if (e.key === 'Backspace') {
        // Let default behavior handle backspace in input
        return true;
      }
      // Let other keys pass through to the search input
      return true;
    }

    // In visual mode, 'y' yanks the selection immediately (vim behavior)
    if (this.state.subMode !== 'normal' && e.key === 'y' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      this.executeCommand({ command: 'yank', count: 1 });
      return true;
    }

    const parsed = this.keyHandlerInstance.handle(e);
    if (!parsed) return false;

    e.preventDefault();

    if (parsed.command === 'noop') {
      this.renderer.render(this.state);
      return true;
    }

    this.executeCommand(parsed);
    return true;
  }

  private executeCommand(cmd: ParsedCommand): void {
    const count = cmd.count ?? 1;

    switch (cmd.command) {
      case 'moveLeft':
        this.moveCursor(0, -count);
        break;
      case 'moveRight':
        this.moveCursor(0, count);
        break;
      case 'moveUp':
        this.moveCursor(-count, 0);
        break;
      case 'moveDown':
        this.moveCursor(count, 0);
        break;
      case 'moveWordForward':
        this.moveWordForward(count, false);
        break;
      case 'moveWordForwardBig':
        this.moveWordForward(count, true);
        break;
      case 'moveWordBackward':
        this.moveWordBackward(count, false);
        break;
      case 'moveWordBackwardBig':
        this.moveWordBackward(count, true);
        break;
      case 'moveLineStart':
        this.state.cursor.col = 0;
        break;
      case 'moveLineStartNonBlank':
        this.state.cursor.col = this.getFirstNonBlank(this.state.cursor.line);
        break;
      case 'moveLineEnd':
        this.state.cursor.col = Math.max(0, this.getLineLength(this.state.cursor.line) - 1);
        break;
      case 'moveFirstLine':
        this.state.cursor.line = Math.max(0, Math.min(count - 1, this.state.bufferLines.length - 1));
        this.state.cursor.col = 0;
        break;
      case 'moveLastLine':
        // G without count → last line; 5G → line 5 (1-indexed)
        this.state.cursor.line = count === 1
          ? Math.max(0, this.state.bufferLines.length - 1)
          : Math.max(0, Math.min(count - 1, this.state.bufferLines.length - 1));
        break;
      case 'moveScreenTop':
        this.state.cursor.line = 0;
        break;
      case 'moveScreenMiddle': {
        const mid = Math.floor(this.state.bufferLines.length / 2);
        this.state.cursor.line = mid;
        break;
      }
      case 'moveScreenBottom':
        this.state.cursor.line = Math.max(0, this.state.bufferLines.length - 1);
        break;
      case 'scrollHalfPageDown':
        this.moveCursor(Math.floor(this.state.bufferLines.length / 2) * count, 0);
        break;
      case 'scrollHalfPageUp':
        this.moveCursor(-Math.floor(this.state.bufferLines.length / 2) * count, 0);
        break;
      case 'scrollPageDown':
        this.moveCursor(20 * count, 0);
        break;
      case 'scrollPageUp':
        this.moveCursor(-20 * count, 0);
        break;
      case 'enterVisual':
        this.enterSubMode('visual');
        break;
      case 'enterVisualLine':
        this.enterSubMode('visualLine');
        break;
      case 'yank':
        this.yankSelection();
        break;
      case 'yankLine':
        this.yankLines(count);
        break;
      case 'yankTextObject':
        this.yankTextObject((cmd as any).textObject as string);
        break;
      case 'searchForward':
        this.startSearch('forward');
        break;
      case 'searchBackward':
        this.startSearch('backward');
        break;
      case 'nextSearch':
        this.nextSearch(count);
        break;
      case 'prevSearch':
        this.prevSearch(count);
        break;
      case 'exit':
        this.exit();
        return;
    }

    this.clampCursor();
    this.renderer.render(this.state);
  }

  private moveCursor(dLine: number, dCol: number): void {
    this.state.cursor.line += dLine;
    this.state.cursor.col += dCol;
    this.clampCursor();
  }

  private clampCursor(): void {
    const maxLine = Math.max(0, this.state.bufferLines.length - 1);
    this.state.cursor.line = Math.max(0, Math.min(this.state.cursor.line, maxLine));
    const maxCol = Math.max(0, this.getLineLength(this.state.cursor.line) - 1);
    this.state.cursor.col = Math.max(0, Math.min(this.state.cursor.col, maxCol));
  }

  private getLineLength(line: number): number {
    return this.state.bufferLines[line]?.length ?? 0;
  }

  private getFirstNonBlank(line: number): number {
    const text = this.state.bufferLines[line] || '';
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== ' ' && text[i] !== '\t') return i;
    }
    return 0;
  }

  private moveWordForward(count: number, bigWord: boolean): void {
    for (let i = 0; i < count; i++) {
      const text = this.state.bufferLines[this.state.cursor.line] || '';
      let col = this.state.cursor.col;

      if (col >= text.length - 1) {
        if (this.state.cursor.line < this.state.bufferLines.length - 1) {
          this.state.cursor.line++;
          this.state.cursor.col = 0;
        }
        continue;
      }

      col++;
      const wordChars = bigWord ? /\S/ : /[a-zA-Z0-9_]/;

      // Skip current word
      while (col < text.length && wordChars.test(text[col])) {
        col++;
      }
      // Skip whitespace/non-word
      while (col < text.length && !wordChars.test(text[col])) {
        col++;
      }

      this.state.cursor.col = col;
    }
  }

  private moveWordBackward(count: number, bigWord: boolean): void {
    for (let i = 0; i < count; i++) {
      const text = this.state.bufferLines[this.state.cursor.line] || '';
      let col = this.state.cursor.col;

      if (col <= 0) {
        if (this.state.cursor.line > 0) {
          this.state.cursor.line--;
          this.state.cursor.col = Math.max(0, this.getLineLength(this.state.cursor.line) - 1);
        }
        continue;
      }

      col--;
      const wordChars = bigWord ? /\S/ : /[a-zA-Z0-9_]/;

      // Skip whitespace/non-word
      while (col > 0 && !wordChars.test(text[col])) {
        col--;
      }
      // Skip current word
      while (col > 0 && wordChars.test(text[col - 1])) {
        col--;
      }

      this.state.cursor.col = col;
    }
  }

  private enterSubMode(mode: CopyModeSubMode): void {
    this.state.subMode = mode;
    this.state.anchor = { ...this.state.cursor };
  }

  private yankSelection(): void {
    if (!this.state.anchor || this.state.subMode === 'normal') {
      // Yank current line
      const text = this.state.bufferLines[this.state.cursor.line] || '';
      window.puppy.clipboard.writeText(text + '\n');
    } else {
      const text = this.getSelectionText();
      window.puppy.clipboard.writeText(text);
    }
    this.exit();
  }

  private yankLines(count: number): void {
    const lines: string[] = [];
    for (let i = 0; i < count; i++) {
      const lineIndex = this.state.cursor.line + i;
      if (lineIndex < this.state.bufferLines.length) {
        lines.push(this.state.bufferLines[lineIndex]);
      }
    }
    window.puppy.clipboard.writeText(lines.join('\n') + '\n');
    this.exit();
  }

  private yankTextObject(textObject: string): void {
    const { start, end } = this.findTextObjectBounds(textObject);
    this.state.anchor = start;
    this.state.cursor = end;
    this.state.subMode = 'visual';
    const text = this.getSelectionText();
    window.puppy.clipboard.writeText(text);
    this.exit();
  }

  private findTextObjectBounds(textObject: string): { start: CopyModePosition; end: CopyModePosition } {
    const line = this.state.cursor.line;
    const text = this.state.bufferLines[line] || '';
    const col = Math.min(this.state.cursor.col, text.length - 1);

    const wordChars = /[a-zA-Z0-9_]/;

    // Find start of word (first word char at or before cursor)
    let startCol = col;
    while (startCol > 0 && wordChars.test(text[startCol - 1])) {
      startCol--;
    }
    // If cursor is on non-word char, scan forward to find word start
    if (!wordChars.test(text[startCol])) {
      while (startCol < text.length && !wordChars.test(text[startCol])) {
        startCol++;
      }
    }

    // Find end of word (last word char at or after cursor)
    let endCol = startCol;
    while (endCol < text.length && wordChars.test(text[endCol])) {
      endCol++;
    }
    endCol = Math.max(0, endCol - 1);

    const start: CopyModePosition = { line, col: startCol };
    const end: CopyModePosition = { line, col: endCol };

    if (textObject === 'aw') {
      // Include trailing whitespace
      let trailing = endCol + 1;
      while (trailing < text.length && (text[trailing] === ' ' || text[trailing] === '\t')) {
        trailing++;
      }
      if (trailing > endCol + 1) {
        return { start, end: { line, col: trailing - 1 } };
      }
      // No trailing space — include leading whitespace instead
      let leading = startCol - 1;
      while (leading >= 0 && (text[leading] === ' ' || text[leading] === '\t')) {
        leading--;
      }
      if (leading < startCol - 1) {
        return { start: { line, col: leading + 1 }, end };
      }
    }

    return { start, end };
  }

  private getSelectionText(): string {
    if (!this.state.anchor || this.state.subMode === 'normal') return '';

    const start: CopyModePosition = {
      line: Math.min(this.state.anchor.line, this.state.cursor.line),
      col: this.state.subMode === 'visualLine' ? 0 : Math.min(this.state.anchor.col, this.state.cursor.col),
    };
    const end: CopyModePosition = {
      line: Math.max(this.state.anchor.line, this.state.cursor.line),
      col: this.state.subMode === 'visualLine'
        ? this.getLineLength(Math.max(this.state.anchor.line, this.state.cursor.line))
        : Math.max(this.state.anchor.col, this.state.cursor.col),
    };

    const lines: string[] = [];
    for (let i = start.line; i <= end.line; i++) {
      const lineText = this.state.bufferLines[i] || '';
      if (this.state.subMode === 'visualLine') {
        lines.push(lineText);
      } else if (i === start.line && i === end.line) {
        lines.push(lineText.slice(start.col, end.col + 1));
      } else if (i === start.line) {
        lines.push(lineText.slice(start.col));
      } else if (i === end.line) {
        lines.push(lineText.slice(0, end.col + 1));
      } else {
        lines.push(lineText);
      }
    }

    return lines.join('\n');
  }

  private startSearch(direction: 'forward' | 'backward'): void {
    this.isSearching = true;
    this.searchDirection = direction;
    this.renderer.showSearchInput(this.lastSearchQuery, direction);
  }

  private cancelSearch(): void {
    this.isSearching = false;
    this.renderer.hideSearchInput();
    this.renderer.render(this.state);
  }

  private executeSearch(): void {
    const query = this.renderer.hideSearchInput();
    this.isSearching = false;
    this.lastSearchQuery = query;

    if (!query) {
      this.renderer.render(this.state);
      return;
    }

    this.state.searchQuery = query;
    this.state.searchDirection = this.searchDirection;

    const result = searchBuffer(
      this.state.bufferLines,
      query,
      this.searchDirection,
      this.state.cursor
    );

    this.state.searchResults = result.positions;
    this.state.currentSearchIndex = result.currentIndex;

    if (result.currentIndex >= 0 && result.positions.length > 0) {
      const pos = result.positions[result.currentIndex];
      this.state.cursor = { ...pos };
    }

    this.renderer.render(this.state);
  }

  private nextSearch(count: number): void {
    if (this.state.searchResults.length === 0) {
      if (this.lastSearchQuery) {
        this.state.searchQuery = this.lastSearchQuery;
        const result = searchBuffer(
          this.state.bufferLines,
          this.lastSearchQuery,
          'forward',
          this.state.cursor
        );
        this.state.searchResults = result.positions;
        this.state.currentSearchIndex = result.currentIndex;
      } else {
        return;
      }
    }

    if (this.state.searchResults.length === 0) return;

    let idx = this.state.currentSearchIndex + count;
    if (idx >= this.state.searchResults.length) {
      idx = 0;
    }
    this.state.currentSearchIndex = idx;
    this.state.cursor = { ...this.state.searchResults[idx] };
    this.renderer.render(this.state);
  }

  private prevSearch(count: number): void {
    if (this.state.searchResults.length === 0) {
      if (this.lastSearchQuery) {
        this.state.searchQuery = this.lastSearchQuery;
        const result = searchBuffer(
          this.state.bufferLines,
          this.lastSearchQuery,
          'backward',
          this.state.cursor
        );
        this.state.searchResults = result.positions;
        this.state.currentSearchIndex = result.currentIndex;
      } else {
        return;
      }
    }

    if (this.state.searchResults.length === 0) return;

    let idx = this.state.currentSearchIndex - count;
    if (idx < 0) {
      idx = this.state.searchResults.length - 1;
    }
    this.state.currentSearchIndex = idx;
    this.state.cursor = { ...this.state.searchResults[idx] };
    this.renderer.render(this.state);
  }
}
