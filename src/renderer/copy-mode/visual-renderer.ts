import type { Config, CopyModeState, CopyModePosition, Theme } from '../../shared/types';

export class VisualRenderer {
  private container: HTMLElement;
  private overlay: HTMLElement | null = null;
  private statusBar: HTMLElement | null = null;
  private statusText: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private lineElements: HTMLElement[] = [];
  private theme: Theme;
  private font: Config['font'];
  private lastBufferLines: string[] = [];

  constructor(container: HTMLElement, theme: Theme, font: Config['font']) {
    this.container = container;
    this.theme = theme;
    this.font = font;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  setFont(font: Config['font']): void {
    this.font = font;
    this.cachedCharWidth = null;
  }

  render(state: CopyModeState): void {
    if (!state.active) {
      this.clear();
      return;
    }

    if (!this.overlay) {
      this.createOverlay();
    }

    if (!this.overlay) return;

    this.overlay.style.fontFamily = this.font.family;
    this.overlay.style.fontSize = `${this.font.size}px`;
    this.overlay.style.lineHeight = `${this.font.lineHeight}`;

    const gutterWidth = this.getGutterWidth(state.bufferLines.length);
    const bufferChanged = this.lastBufferLines.length !== state.bufferLines.length ||
      this.lastBufferLines.some((text, i) => text !== state.bufferLines[i]);

    if (bufferChanged) {
      // Full rebuild: buffer content changed
      this.overlay.innerHTML = '';
      this.lineElements = [];

      for (let i = 0; i < state.bufferLines.length; i++) {
        const rowEl = document.createElement('div');
        rowEl.className = 'copy-mode-row';
        rowEl.style.display = 'flex';

        const numEl = document.createElement('span');
        numEl.className = 'copy-mode-linenr';
        rowEl.appendChild(numEl);

        const lineEl = document.createElement('span');
        lineEl.className = 'copy-mode-line';
        rowEl.appendChild(lineEl);

        this.overlay.appendChild(rowEl);
        this.lineElements.push(rowEl);
      }

      this.lastBufferLines = state.bufferLines.slice();
    }

    // Update line numbers and selection for all rows
    for (let i = 0; i < state.bufferLines.length; i++) {
      const rowEl = this.lineElements[i];
      if (!rowEl) continue;

      const numEl = rowEl.querySelector('.copy-mode-linenr') as HTMLElement | null;
      const lineEl = rowEl.querySelector('.copy-mode-line') as HTMLElement | null;
      if (!numEl || !lineEl) continue;

      const isCurrent = i === state.cursor.line;
      const relNum = isCurrent
        ? i + 1
        : Math.abs(i - state.cursor.line);
      const numText = String(relNum).padStart(gutterWidth, ' ');

      numEl.textContent = numText;
      numEl.className = 'copy-mode-linenr' + (isCurrent ? ' current' : '');

      const text = state.bufferLines[i] || '';
      lineEl.innerHTML = this.buildLineHtml(text, i, state);
    }

    // Remove old cursor and create new one
    const oldCursor = this.overlay.querySelector('.copy-mode-cursor');
    if (oldCursor) oldCursor.remove();

    const cursorEl = document.createElement('div');
    cursorEl.className = 'copy-mode-cursor';

    const targetLine = Math.min(state.cursor.line, this.lineElements.length - 1);
    const targetRow = this.lineElements[targetLine];
    const targetText = targetRow?.querySelector('.copy-mode-line') as HTMLElement | null;

    let cursorTop = 0;
    let cursorHeight = this.getLineHeight();
    let cursorLeft = 0;

    if (targetRow && targetText && this.overlay) {
      const charRect = this.getCharRect(targetText, state.cursor.col);
      if (charRect) {
        cursorLeft = charRect.left;
        cursorTop = charRect.top;
        cursorHeight = charRect.height;
      } else {
        // Empty line: place cursor at the start of the row.
        cursorLeft = targetText.offsetLeft;
        cursorTop = targetRow.offsetTop;
        cursorHeight = targetRow.offsetHeight || this.getLineHeight();
      }

      cursorEl.style.left = `${cursorLeft}px`;
      cursorEl.style.top = `${cursorTop}px`;
      cursorEl.style.height = `${cursorHeight}px`;
    } else {
      const charWidth = this.getCharWidth();
      const lineHeight = this.getLineHeight();
      const gutterPx = (gutterWidth + 1) * charWidth + 8;
      cursorLeft = gutterPx + state.cursor.col * charWidth;
      cursorTop = state.cursor.line * lineHeight;
      cursorHeight = lineHeight;
      cursorEl.style.left = `${cursorLeft}px`;
      cursorEl.style.top = `${cursorTop}px`;
      cursorEl.style.height = `${cursorHeight}px`;
    }

    this.overlay.appendChild(cursorEl);

    // Explicit scroll management: keep cursor in view
    // Account for the status bar that overlays the bottom of the container
    const statusBarHeight = this.statusBar?.offsetHeight ?? 24;
    const visibleTop = this.overlay.scrollTop;
    const visibleBottom = visibleTop + this.overlay.clientHeight - statusBarHeight;

    if (cursorTop < visibleTop) {
      this.overlay.scrollTop = cursorTop;
    } else if (cursorTop + cursorHeight > visibleBottom) {
      this.overlay.scrollTop = cursorTop + cursorHeight - (this.overlay.clientHeight - statusBarHeight);
    }

    this.updateStatusBar(state);
  }

  private createOverlay(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'copy-mode-overlay';
    this.overlay.style.fontFamily = this.font.family;
    this.overlay.style.fontSize = `${this.font.size}px`;
    this.overlay.style.lineHeight = `${this.font.lineHeight}`;
    this.container.appendChild(this.overlay);

    this.statusBar = document.createElement('div');
    this.statusBar.className = 'copy-mode-status-bar';
    this.container.appendChild(this.statusBar);

    this.statusText = document.createElement('span');
    this.statusText.className = 'copy-mode-status-text';
    this.statusBar.appendChild(this.statusText);

    this.searchInput = document.createElement('input');
    this.searchInput.className = 'copy-mode-search-input';
    this.searchInput.type = 'text';
    this.searchInput.spellcheck = false;
    this.statusBar.appendChild(this.searchInput);
  }

  private buildLineHtml(text: string, lineIdx: number, state: CopyModeState): string {
    if (!text) return ' ';

    // Determine which character positions are in the selection
    const inSelection = new Set<number>();
    if (state.anchor && state.subMode !== 'normal') {
      const startLine = Math.min(state.anchor.line, state.cursor.line);
      const endLine = Math.max(state.anchor.line, state.cursor.line);
      if (lineIdx >= startLine && lineIdx <= endLine) {
        const startCol = state.subMode === 'visualLine' ? 0 : Math.min(state.anchor.col, state.cursor.col);
        const endCol = state.subMode === 'visualLine' ? text.length - 1 : Math.max(state.anchor.col, state.cursor.col);
        for (let c = startCol; c <= endCol && c < text.length; c++) {
          inSelection.add(c);
        }
      }
    }

    // Determine which character positions are in search results
    const inSearch = new Set<number>();
    if (state.searchQuery && state.searchResults.length > 0) {
      const resultsOnLine = state.searchResults.filter((r) => r.line === lineIdx);
      for (const r of resultsOnLine) {
        for (let c = r.col; c < r.col + state.searchQuery.length && c < text.length; c++) {
          inSearch.add(c);
        }
      }
    }

    // No highlighting needed
    if (inSelection.size === 0 && inSearch.size === 0) {
      return this.escapeHtml(text);
    }

    // Build HTML by grouping consecutive characters with the same classes
    let result = '';
    let i = 0;
    while (i < text.length) {
      const sel = inSelection.has(i);
      const search = inSearch.has(i);

      let j = i + 1;
      while (j < text.length && inSelection.has(j) === sel && inSearch.has(j) === search) {
        j++;
      }

      const segment = this.escapeHtml(text.slice(i, j));
      if (sel && search) {
        result += `<span class="copy-mode-selection copy-mode-search-highlight">${segment}</span>`;
      } else if (sel) {
        result += `<span class="copy-mode-selection">${segment}</span>`;
      } else if (search) {
        result += `<span class="copy-mode-search-highlight">${segment}</span>`;
      } else {
        result += segment;
      }

      i = j;
    }

    return result;
  }

  private updateStatusBar(state: CopyModeState): void {
    if (!this.statusText) return;

    const mode = state.subMode === 'normal' ? 'NORMAL' : state.subMode === 'visual' ? 'VISUAL' : 'V-LINE';
    const alt = state.isAlternate ? ' ALT' : '';
    const pos = `${state.cursor.line + 1}:${state.cursor.col + 1}`;
    const search = state.searchQuery ? ` /${state.searchQuery}/` : '';
    this.statusText.textContent = `-- ${mode}${alt} -- ${pos}${search}`;
  }

  showSearchInput(initialValue = '', direction: 'forward' | 'backward' = 'forward'): void {
    if (!this.searchInput) return;
    this.searchInput.value = initialValue;
    this.searchInput.classList.add('active');
    this.searchInput.placeholder = direction === 'forward' ? '/' : '?';
    this.searchInput.focus();
  }

  hideSearchInput(): string {
    if (!this.searchInput) return '';
    const value = this.searchInput.value;
    this.searchInput.classList.remove('active');
    this.searchInput.blur();
    return value;
  }

  isSearchInputActive(): boolean {
    return this.searchInput?.classList.contains('active') ?? false;
  }

  getSearchInputValue(): string {
    return this.searchInput?.value ?? '';
  }

  clear(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    if (this.statusBar) {
      this.statusBar.remove();
      this.statusBar = null;
    }
    this.statusText = null;
    this.searchInput = null;
    this.lineElements = [];
    this.lastBufferLines = [];
  }

  focus(): void {
    this.overlay?.focus();
  }

  private getCharRect(lineEl: HTMLElement, col: number): { left: number; top: number; height: number } | null {
    if (!this.overlay) return null;

    const text = lineEl.textContent ?? '';
    const maxCol = Math.max(0, text.length - 1);
    const targetCol = Math.min(col, maxCol);

    const nodeAndOffset = this.getTextNodeAndOffset(lineEl, targetCol);
    if (!nodeAndOffset) return null;

    const [textNode, offset] = nodeAndOffset;
    try {
      const range = document.createRange();
      range.setStart(textNode, offset);
      range.setEnd(textNode, Math.min(offset + 1, textNode.length));
      const rect = range.getBoundingClientRect();
      const overlayRect = this.overlay.getBoundingClientRect();

      let left = rect.left - overlayRect.left;
      const top = rect.top - overlayRect.top;
      const height = rect.height;

      if (col > maxCol) {
        // Cursor is past the last character; place it after the last char.
        left += rect.width;
      }

      return { left, top, height };
    } catch {
      return null;
    }
  }

  private getTextNodeAndOffset(element: HTMLElement, offset: number): [Text, number] | null {
    let remaining = offset;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? '';
      if (remaining < text.length) {
        return [node as Text, remaining];
      }
      remaining -= text.length;
    }
    return null;
  }

  private getGutterWidth(totalLines: number): number {
    // Width needed for the largest relative number + padding
    // Max relative is about half the buffer length
    return Math.max(2, String(Math.floor(totalLines / 2)).length);
  }

  private getCharWidth(): number {
    return this.font.size; // rough monospace estimate
  }

  private getLineHeight(): number {
    return this.font.size * this.font.lineHeight;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
