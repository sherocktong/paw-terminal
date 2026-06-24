import { Terminal } from '@xterm/xterm';
import type { Config, CopyModeState, CopyModePosition, CopyModeSubMode } from '../../shared/types';
import { captureBuffer } from './buffer-capture';
import { KeyHandler, type ParsedCommand } from './key-handler';
import { searchBuffer } from './search';
import { StatusBar } from './status-bar';
import { SelectionOverlay } from './selection-overlay';
import { LineNumberOverlay } from './line-number-overlay';
import type { ThemeManager } from '../theme/theme-manager';

export class CopyMode {
  private term: Terminal;
  private container: HTMLElement;
  private config: Config;
  private themeManager: ThemeManager;
  private state: CopyModeState;
  private statusBar: StatusBar | null = null;
  private selectionOverlay: SelectionOverlay;
  private lineNumberOverlay: LineNumberOverlay;
  private keyHandlerInstance = new KeyHandler();
  private searchDirection: 'forward' | 'backward' = 'forward';
  private isSearching = false;
  private lastSearchQuery = '';
  private originalSelectionBg: string | undefined;
  private originalSelectionFg: string | undefined;

  constructor(term: Terminal, container: HTMLElement, config: Config, themeManager: ThemeManager) {
    this.term = term;
    this.container = container;
    this.config = config;
    this.themeManager = themeManager;
    this.selectionOverlay = new SelectionOverlay(container);
    this.lineNumberOverlay = new LineNumberOverlay(container, themeManager.getCurrentTheme(), config.font);
    this.state = this.createInitialState();
  }

  updateConfig(config: Config): void {
    this.config = config;
    if (this.state.active) {
      this.statusBar?.setTheme(this.themeManager.getCurrentTheme());
      this.statusBar?.setFont(config.font);
      this.lineNumberOverlay.setTheme(this.themeManager.getCurrentTheme());
      this.lineNumberOverlay.setFont(config.font);
      this.updateSelection();
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
    const viewportY = this.term.buffer.active.viewportY;
    const cursorLine = bufferLines.length > 0 ? Math.min(viewportY, bufferLines.length - 1) : 0;

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
    this.container.classList.add('copy-mode-active');
    this.applyCursorTheme();
    this.statusBar = new StatusBar(this.container, this.themeManager.getCurrentTheme(), this.config.font);
    this.ensureCursorInView();
    this.updateLineNumbers();
    this.updateSelection();
    this.statusBar.update(this.state);
  }

  exit(): void {
    if (!this.state.active) return;

    this.state = this.createInitialState();
    this.term.clearSelection();
    this.restoreNormalTheme();
    this.selectionOverlay.clear();
    this.lineNumberOverlay.clear();
    this.statusBar?.destroy();
    this.statusBar = null;
    this.container.classList.remove('copy-mode-active');
    this.term.focus();

    // Defensive: ensure overlays are removed after any pending render frame.
    requestAnimationFrame(() => {
      this.selectionOverlay.clear();
      this.lineNumberOverlay.clear();
    });

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
      this.updateSelection();
      this.updateLineNumbers();
      this.statusBar?.update(this.state);
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
      case 'moveWordEndForward':
        this.moveWordEndForward(count, false);
        break;
      case 'moveWordEndForwardBig':
        this.moveWordEndForward(count, true);
        break;
      case 'moveWordEndBackward':
        this.moveWordEndBackward(count, false);
        break;
      case 'moveWordEndBackwardBig':
        this.moveWordEndBackward(count, true);
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
        this.state.cursor.line = this.term.buffer.active.viewportY;
        break;
      case 'moveScreenMiddle': {
        const viewportY = this.term.buffer.active.viewportY;
        const rows = this.term.rows;
        this.state.cursor.line = viewportY + Math.floor(rows / 2);
        break;
      }
      case 'moveScreenBottom': {
        const viewportY = this.term.buffer.active.viewportY;
        const rows = this.term.rows;
        this.state.cursor.line = Math.min(this.state.bufferLines.length - 1, viewportY + rows - 1);
        break;
      }
      case 'scrollHalfPageDown':
        this.scrollBy(Math.floor(this.term.rows / 2) * count);
        break;
      case 'scrollHalfPageUp':
        this.scrollBy(-Math.floor(this.term.rows / 2) * count);
        break;
      case 'scrollPageDown':
        this.scrollBy(this.term.rows * count);
        break;
      case 'scrollPageUp':
        this.scrollBy(-this.term.rows * count);
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

    // Commands such as yank leave copy mode; skip further UI updates if we are
    // no longer active.
    if (!this.state.active) return;

    this.clampCursor();
    this.ensureCursorInView();
    this.updateSelection();
    this.updateLineNumbers();
    this.statusBar?.update(this.state);
  }

  private moveCursor(dLine: number, dCol: number): void {
    this.state.cursor.line += dLine;
    this.state.cursor.col += dCol;
    this.clampCursor();
  }

  private scrollBy(lines: number): void {
    const viewportY = this.term.buffer.active.viewportY;
    const maxY = Math.max(0, this.state.bufferLines.length - this.term.rows);
    const targetY = Math.max(0, Math.min(viewportY + lines, maxY));
    this.term.scrollToLine(targetY);
    // Keep cursor on screen by moving it with the viewport
    const rows = this.term.rows;
    if (this.state.cursor.line < targetY) {
      this.state.cursor.line = targetY;
    } else if (this.state.cursor.line >= targetY + rows) {
      this.state.cursor.line = Math.min(this.state.bufferLines.length - 1, targetY + rows - 1);
    }
    this.clampCursor();
  }

  private clampCursor(): void {
    const maxLine = Math.max(0, this.state.bufferLines.length - 1);
    this.state.cursor.line = Math.max(0, Math.min(this.state.cursor.line, maxLine));
    const maxCol = Math.max(0, this.getLineLength(this.state.cursor.line) - 1);
    this.state.cursor.col = Math.max(0, Math.min(this.state.cursor.col, maxCol));
  }

  private ensureCursorInView(): void {
    const viewportY = this.term.buffer.active.viewportY;
    const rows = this.term.rows;
    const cursorLine = this.state.cursor.line;

    if (cursorLine < viewportY) {
      this.term.scrollToLine(cursorLine);
    } else if (cursorLine >= viewportY + rows) {
      this.term.scrollToLine(Math.max(0, cursorLine - rows + 1));
    }
  }

  private updateSelection(): void {
    this.selectionOverlay.clear();
    this.term.clearSelection();

    if (this.state.subMode === 'normal') {
      const line = this.state.cursor.line;
      const col = this.state.cursor.col;
      const lineText = this.state.bufferLines[line] || '';
      const safeCol = Math.min(col, Math.max(0, lineText.length - 1));
      if (lineText.length > 0) {
        this.term.select(safeCol, line, 1);
      }
      return;
    }

    if (!this.state.anchor) return;

    if (this.state.subMode === 'visualLine') {
      const start = Math.min(this.state.anchor.line, this.state.cursor.line);
      const end = Math.max(this.state.anchor.line, this.state.cursor.line);
      this.term.selectLines(start, end);
      return;
    }

    // visual (char-wise)
    const anchor = this.state.anchor;
    const startLine = Math.min(anchor.line, this.state.cursor.line);
    const endLine = Math.max(anchor.line, this.state.cursor.line);
    const startCol = Math.min(anchor.col, this.state.cursor.col);
    const endCol = Math.max(anchor.col, this.state.cursor.col);

    if (startLine === endLine) {
      const lineText = this.state.bufferLines[startLine] || '';
      const length = Math.min(endCol - startCol + 1, lineText.length - startCol);
      if (length > 0) {
        this.term.select(startCol, startLine, length);
      }
    } else {
      // xterm.js cannot represent multi-line partial selections; use overlay
      this.selectionOverlay.showSelection(
        anchor,
        this.state.cursor,
        'visual',
        this.config.font,
        this.term.buffer.active.viewportY,
        (line) => this.state.bufferLines[line]?.length ?? 0
      );
    }
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

  private getCharType(char: string, bigWord: boolean): 'word' | 'nonword' | 'space' {
    if (char === ' ' || char === '\t') return 'space';
    if (bigWord) return 'nonword';
    return /[a-zA-Z0-9_]/.test(char) ? 'word' : 'nonword';
  }

  private moveWordForward(count: number, bigWord: boolean): void {
    for (let i = 0; i < count; i++) {
      let line = this.state.cursor.line;
      let col = this.state.cursor.col;

      while (true) {
        const text = this.state.bufferLines[line] || '';
        const len = text.length;

        if (len === 0) {
          line++;
          if (line >= this.state.bufferLines.length) {
            this.state.cursor.line = Math.max(0, this.state.bufferLines.length - 1);
            this.state.cursor.col = 0;
            break;
          }
          col = 0;
          continue;
        }

        col++;

        while (true) {
          if (col >= len) {
            line++;
            if (line >= this.state.bufferLines.length) {
              this.state.cursor.line = Math.max(0, this.state.bufferLines.length - 1);
              this.state.cursor.col = Math.max(0, this.getLineLength(this.state.cursor.line) - 1);
              break;
            }
            col = 0;
            break;
          }

          const type = this.getCharType(text[col], bigWord);
          if (type !== 'space') {
            const prevType = col > 0 ? this.getCharType(text[col - 1], bigWord) : 'space';
            if (prevType === 'space' || prevType !== type) {
              this.state.cursor.line = line;
              this.state.cursor.col = col;
              break;
            }
          }
          col++;
        }

        if (this.state.cursor.line === line && this.state.cursor.col === col) {
          break;
        }
      }
    }
  }

  private moveWordBackward(count: number, bigWord: boolean): void {
    for (let i = 0; i < count; i++) {
      let line = this.state.cursor.line;
      let col = this.state.cursor.col;

      while (true) {
        const text = this.state.bufferLines[line] || '';
        const len = text.length;

        if (len === 0 || col <= 0) {
          line--;
          if (line < 0) {
            this.state.cursor.line = 0;
            this.state.cursor.col = 0;
            break;
          }
          col = Math.max(0, this.getLineLength(line) - 1);
          continue;
        }

        col--;

        while (col >= 0 && this.getCharType(text[col], bigWord) === 'space') {
          col--;
        }

        if (col < 0) {
          line--;
          if (line < 0) {
            this.state.cursor.line = 0;
            this.state.cursor.col = 0;
            break;
          }
          col = Math.max(0, this.getLineLength(line) - 1);
          continue;
        }

        const type = this.getCharType(text[col], bigWord);
        while (col > 0 && this.getCharType(text[col - 1], bigWord) === type) {
          col--;
        }

        this.state.cursor.line = line;
        this.state.cursor.col = col;
        break;
      }
    }
  }

  private moveWordEndForward(count: number, bigWord: boolean): void {
    for (let i = 0; i < count; i++) {
      let line = this.state.cursor.line;
      let col = this.state.cursor.col;

      while (true) {
        const text = this.state.bufferLines[line] || '';
        const len = text.length;

        if (len === 0) {
          line++;
          if (line >= this.state.bufferLines.length) {
            this.state.cursor.line = Math.max(0, this.state.bufferLines.length - 1);
            this.state.cursor.col = 0;
            break;
          }
          col = 0;
          continue;
        }

        const atEndOfWord = col >= len - 1 ||
          this.getCharType(text[col + 1], bigWord) === 'space' ||
          this.getCharType(text[col], bigWord) !== this.getCharType(text[col + 1], bigWord);

        if (atEndOfWord) {
          let scanCol = col + 1;
          while (scanCol < len && this.getCharType(text[scanCol], bigWord) === 'space') {
            scanCol++;
          }

          if (scanCol < len) {
            const type = this.getCharType(text[scanCol], bigWord);
            col = scanCol;
            while (col < len && this.getCharType(text[col], bigWord) === type) {
              col++;
            }
            this.state.cursor.line = line;
            this.state.cursor.col = col - 1;
            break;
          }

          line++;
          if (line >= this.state.bufferLines.length) {
            this.state.cursor.line = Math.max(0, this.state.bufferLines.length - 1);
            this.state.cursor.col = Math.max(0, this.getLineLength(this.state.cursor.line) - 1);
            break;
          }
          col = 0;
          continue;
        } else {
          const type = this.getCharType(text[col], bigWord);
          while (col < len && this.getCharType(text[col], bigWord) === type) {
            col++;
          }
          this.state.cursor.line = line;
          this.state.cursor.col = col - 1;
          break;
        }
      }
    }
  }

  private moveWordEndBackward(count: number, bigWord: boolean): void {
    for (let i = 0; i < count; i++) {
      let line = this.state.cursor.line;
      let col = this.state.cursor.col;

      while (true) {
        const text = this.state.bufferLines[line] || '';
        const len = text.length;

        if (len === 0 || col <= 0) {
          line--;
          if (line < 0) {
            this.state.cursor.line = 0;
            this.state.cursor.col = 0;
            break;
          }
          col = Math.max(0, this.getLineLength(line) - 1);
          continue;
        }

        col--;

        while (col >= 0 && this.getCharType(text[col], bigWord) === 'space') {
          col--;
        }

        if (col < 0) {
          line--;
          if (line < 0) {
            this.state.cursor.line = 0;
            this.state.cursor.col = 0;
            break;
          }
          col = Math.max(0, this.getLineLength(line) - 1);
          continue;
        }

        const type = this.getCharType(text[col], bigWord);
        const nextType = col < len - 1 ? this.getCharType(text[col + 1], bigWord) : 'space';
        if (nextType === 'space' || nextType !== type) {
          this.state.cursor.line = line;
          this.state.cursor.col = col;
          break;
        }

        while (col > 0 && this.getCharType(text[col - 1], bigWord) === type) {
          col--;
        }

        col--;
      }
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
    } else if (this.state.subMode === 'visualLine') {
      const text = this.term.getSelection();
      window.puppy.clipboard.writeText(text);
    } else {
      // visual char-wise
      const anchor = this.state.anchor;
      const startLine = Math.min(anchor.line, this.state.cursor.line);
      const endLine = Math.max(anchor.line, this.state.cursor.line);

      if (startLine === endLine) {
        // xterm.js can give us the single-line selection directly
        const text = this.term.getSelection();
        window.puppy.clipboard.writeText(text);
      } else {
        // Multi-line partial: compute from buffer lines because xterm.js
        // selection API cannot represent it.
        const startCol = Math.min(anchor.col, this.state.cursor.col);
        const endCol = Math.max(anchor.col, this.state.cursor.col);
        const lines: string[] = [];
        for (let i = startLine; i <= endLine; i++) {
          const lineText = this.state.bufferLines[i] || '';
          if (i === startLine && i === endLine) {
            lines.push(lineText.slice(startCol, endCol + 1));
          } else if (i === startLine) {
            lines.push(lineText.slice(startCol));
          } else if (i === endLine) {
            // If the cursor is at column 0 of the last line, treat the
            // selection as including the whole last line (common terminal
            // copy-mode behavior); otherwise respect the exact column.
            lines.push(endCol === 0 ? lineText : lineText.slice(0, endCol + 1));
          } else {
            lines.push(lineText);
          }
        }
        window.puppy.clipboard.writeText(lines.join('\n'));
      }
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

    // Find start of word (first char of word at or before cursor)
    let startCol = col;
    const startType = this.getCharType(text[startCol], false);
    if (startType === 'space') {
      // If on whitespace, scan forward to find word start
      while (startCol < text.length && this.getCharType(text[startCol], false) === 'space') {
        startCol++;
      }
    } else {
      while (startCol > 0 && this.getCharType(text[startCol - 1], false) === startType) {
        startCol--;
      }
    }

    // Find end of word (last char of same type at or after start)
    const wordType = this.getCharType(text[startCol], false);
    let endCol = startCol;
    while (endCol < text.length && this.getCharType(text[endCol], false) === wordType) {
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
        lines.push(end.col === 0 ? lineText : lineText.slice(0, end.col + 1));
      } else {
        lines.push(lineText);
      }
    }

    return lines.join('\n');
  }

  private startSearch(direction: 'forward' | 'backward'): void {
    this.isSearching = true;
    this.searchDirection = direction;
    this.statusBar?.showSearchInput(this.lastSearchQuery, direction);
  }

  private cancelSearch(): void {
    this.isSearching = false;
    this.statusBar?.hideSearchInput();
    this.updateSelection();
    this.statusBar?.update(this.state);
  }

  private executeSearch(): void {
    const query = this.statusBar?.hideSearchInput() ?? '';
    this.isSearching = false;
    this.lastSearchQuery = query;

    if (!query) {
      this.updateSelection();
      this.statusBar?.update(this.state);
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
      this.clampCursor();
      this.ensureCursorInView();
    }

    this.updateSelection();
    this.updateLineNumbers();
    this.statusBar?.update(this.state);
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
    this.clampCursor();
    this.ensureCursorInView();
    this.updateSelection();
    this.statusBar?.update(this.state);
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
    this.clampCursor();
    this.ensureCursorInView();
    this.updateSelection();
    this.updateLineNumbers();
    this.statusBar?.update(this.state);
  }

  private updateLineNumbers(): void {
    if (!this.state.active) {
      this.lineNumberOverlay.clear();
      return;
    }
    this.lineNumberOverlay.render(
      this.term.buffer.active.viewportY,
      this.term.rows,
      this.state.cursor.line,
      (index) => this.term.buffer.active.getLine(index) ?? undefined
    );
  }

  private applyCursorTheme(): void {
    const theme = this.term.options.theme || {};
    this.originalSelectionBg = theme.selectionBackground;
    this.originalSelectionFg = theme.selectionForeground;
    const currentTheme = this.themeManager.getCurrentTheme().colors;
    this.term.options.theme = {
      ...theme,
      selectionBackground: currentTheme.foreground,
      selectionForeground: currentTheme.background,
    };
  }

  private restoreNormalTheme(): void {
    const theme = this.term.options.theme || {};
    this.term.options.theme = { ...theme, selectionBackground: this.originalSelectionBg, selectionForeground: this.originalSelectionFg };
  }
}
