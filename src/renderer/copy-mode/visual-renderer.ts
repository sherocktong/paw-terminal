import type { Config, CopyModeState, CopyModePosition, Theme } from '../../shared/types';

export class VisualRenderer {
  private container: HTMLElement;
  private overlay: HTMLElement | null = null;
  private statusBar: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private lineElements: HTMLElement[] = [];
  private theme: Theme;
  private font: Config['font'];

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
  }

  render(state: CopyModeState): void {
    if (!state.active) {
      this.clear();
      return;
    }

    if (!this.overlay) {
      this.createOverlay();
    }

    if (this.overlay) {
      this.overlay.style.fontFamily = this.font.family;
      this.overlay.style.fontSize = `${this.font.size}px`;
      this.overlay.style.lineHeight = `${this.font.lineHeight}`;
      this.overlay.innerHTML = '';
      this.lineElements = [];

      const gutterWidth = this.getGutterWidth(state.bufferLines.length);

      for (let i = 0; i < state.bufferLines.length; i++) {
        const rowEl = document.createElement('div');
        rowEl.className = 'copy-mode-row';
        rowEl.style.display = 'flex';

        // Relative line number
        const isCurrent = i === state.cursor.line;
        const relNum = isCurrent
          ? i + 1  // absolute line number at cursor
          : Math.abs(i - state.cursor.line);
        const numText = String(relNum).padStart(gutterWidth, ' ');

        const numEl = document.createElement('span');
        numEl.className = 'copy-mode-linenr' + (isCurrent ? ' current' : '');
        numEl.textContent = numText;
        rowEl.appendChild(numEl);

        const lineEl = document.createElement('span');
        lineEl.className = 'copy-mode-line';
        const text = state.bufferLines[i] || '';
        lineEl.innerHTML = this.buildLineHtml(text, i, state);
        rowEl.appendChild(lineEl);
        this.overlay.appendChild(rowEl);
        this.lineElements.push(rowEl);
      }

      // Position cursor using actual DOM measurements for accuracy
      const cursorEl = document.createElement('div');
      cursorEl.className = 'copy-mode-cursor';

      const targetLine = Math.min(state.cursor.line, this.lineElements.length - 1);
      const targetRow = this.lineElements[targetLine];
      const targetText = targetRow?.querySelector('.copy-mode-line') as HTMLElement | null;

      if (targetRow && targetText && this.overlay) {
        const overlayRect = this.overlay.getBoundingClientRect();
        const textRect = targetText.getBoundingClientRect();
        const rowRect = targetRow.getBoundingClientRect();

        const textLeft = textRect.left - overlayRect.left;
        const rowTop = rowRect.top - overlayRect.top;
        const rowHeight = rowRect.height;

        // Measure char width from first row's text for consistency
        const firstText = this.lineElements[0]?.querySelector('.copy-mode-line') as HTMLElement | null;
        let charWidth = this.getCharWidth();
        if (firstText) {
          const firstRect = firstText.getBoundingClientRect();
          const firstContent = firstText.textContent || ' ';
          charWidth = firstRect.width / Math.max(1, firstContent.length);
        }

        cursorEl.style.left = `${textLeft + state.cursor.col * charWidth}px`;
        cursorEl.style.top = `${rowTop}px`;
        cursorEl.style.height = `${rowHeight}px`;
      } else {
        // Fallback to estimates
        const charWidth = this.getCharWidth();
        const lineHeight = this.getLineHeight();
        const gutterPx = (gutterWidth + 1) * charWidth + 8;
        cursorEl.style.left = `${gutterPx + state.cursor.col * charWidth}px`;
        cursorEl.style.top = `${state.cursor.line * lineHeight}px`;
      }
      this.overlay.appendChild(cursorEl);

      // Scroll cursor into view
      cursorEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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

    this.searchInput = document.createElement('input');
    this.searchInput.className = 'copy-mode-search-input';
    this.searchInput.type = 'text';
    this.searchInput.spellcheck = false;
    this.container.appendChild(this.searchInput);
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
    if (!this.statusBar) return;

    const mode = state.subMode === 'normal' ? 'NORMAL' : state.subMode === 'visual' ? 'VISUAL' : 'V-LINE';
    const pos = `${state.cursor.line + 1}:${state.cursor.col + 1}`;
    const search = state.searchQuery ? ` /${state.searchQuery}/` : '';
    this.statusBar.textContent = `-- ${mode} -- ${pos}${search}`;
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
    if (this.searchInput) {
      this.searchInput.remove();
      this.searchInput = null;
    }
    this.lineElements = [];
  }

  focus(): void {
    this.overlay?.focus();
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
