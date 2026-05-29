import type { CopyModeState, CopyModePosition, Theme } from '../../shared/types';
import { BUILTIN_THEMES } from '../../shared/constants';

export class VisualRenderer {
  private container: HTMLElement;
  private overlay: HTMLElement | null = null;
  private statusBar: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private lineElements: HTMLElement[] = [];
  private theme: Theme;

  constructor(container: HTMLElement, themeId: string) {
    this.container = container;
    this.theme = BUILTIN_THEMES.find((t) => t.id === themeId) as Theme || BUILTIN_THEMES[0] as Theme;
  }

  setTheme(themeId: string): void {
    const t = BUILTIN_THEMES.find((th) => th.id === themeId) as Theme;
    if (t) this.theme = t;
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
        let text = state.bufferLines[i] || '';

        text = this.applySearchHighlights(text, i, state);
        text = this.applySelection(text, i, state);

        lineEl.innerHTML = text || ' ';
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
    this.overlay.style.fontFamily = this.theme.font?.family || 'monospace';
    this.overlay.style.fontSize = `${this.theme.font?.size || 14}px`;
    this.overlay.style.lineHeight = `${this.theme.font?.lineHeight || 1.2}`;
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

  private applySearchHighlights(text: string, lineIdx: number, state: CopyModeState): string {
    if (!state.searchQuery || state.searchResults.length === 0) return this.escapeHtml(text);

    const resultsOnLine = state.searchResults.filter((r) => r.line === lineIdx);
    if (resultsOnLine.length === 0) return this.escapeHtml(text);

    // Sort by column descending so we can build from the end
    resultsOnLine.sort((a, b) => b.col - a.col);

    let result = this.escapeHtml(text);
    for (const r of resultsOnLine) {
      const before = result.slice(0, r.col);
      const match = result.slice(r.col, r.col + state.searchQuery.length);
      const after = result.slice(r.col + state.searchQuery.length);
      const isCurrent = state.searchResults[state.currentSearchIndex]?.line === lineIdx &&
        state.searchResults[state.currentSearchIndex]?.col === r.col;
      const cls = isCurrent ? 'copy-mode-search-highlight' : 'copy-mode-search-highlight';
      result = `${before}<span class="${cls}">${match}</span>${after}`;
    }

    return result;
  }

  private applySelection(text: string, lineIdx: number, state: CopyModeState): string {
    if (!state.anchor || state.subMode === 'normal') return this.escapeHtml(text);

    const start: CopyModePosition = {
      line: Math.min(state.anchor.line, state.cursor.line),
      col: state.subMode === 'visualLine' ? 0 : Math.min(state.anchor.col, state.cursor.col),
    };
    const end: CopyModePosition = {
      line: Math.max(state.anchor.line, state.cursor.line),
      col: state.subMode === 'visualLine' ? text.length : Math.max(state.anchor.col, state.cursor.col),
    };

    if (lineIdx < start.line || lineIdx > end.line) return this.escapeHtml(text);

    const escaped = this.escapeHtml(text);
    if (state.subMode === 'visualLine') {
      return `<span class="copy-mode-selection">${escaped}</span>`;
    }

    const selStart = lineIdx === start.line ? start.col : 0;
    const selEnd = lineIdx === end.line ? end.col : text.length;

    const before = escaped.slice(0, selStart);
    const selected = escaped.slice(selStart, selEnd);
    const after = escaped.slice(selEnd);

    return `${before}<span class="copy-mode-selection">${selected}</span>${after}`;
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
    const size = this.theme.font?.size || 14;
    return size * 0.6; // rough monospace estimate
  }

  private getLineHeight(): number {
    const size = this.theme.font?.size || 14;
    const lh = this.theme.font?.lineHeight || 1.2;
    return size * lh;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
