import type { Config, CopyModePosition, CopyModeSubMode, Theme } from '../../shared/types';
import type { SearchMatch } from './search';

/**
 * Minimal transparent overlay used for:
 * - Multi-line visual (char-wise) selections (xterm.js cannot represent partial
 *   selections that span multiple rows).
 * - Search match highlights (hlsearch-style) because xterm.js cannot highlight
 *   arbitrary non-selection ranges.
 */
export class SelectionOverlay {
  private container: HTMLElement;
  private overlay: HTMLElement | null = null;
  private cachedCharWidth: number | null = null;
  private cachedLineHeight: number | null = null;

  constructor(container: HTMLElement) {
    // Attach to the outer tab container; the overlay is positioned over the
    // terminal content area (shifted right by the line-number gutter via CSS
    // when copy mode is active).
    this.container = container;
  }

  /**
   * Render a multi-line partial selection.
   * For single-line selections the caller should use term.select() instead.
   */
  showSelection(
    anchor: CopyModePosition,
    cursor: CopyModePosition,
    subMode: CopyModeSubMode,
    font: Config['font'],
    viewportY: number,
    getLineLength: (line: number) => number
  ): void {
    this.clear();

    const startLine = Math.min(anchor.line, cursor.line);
    const endLine = Math.max(anchor.line, cursor.line);
    const startCol = subMode === 'visualLine' ? 0 : Math.min(anchor.col, cursor.col);
    const endCol = subMode === 'visualLine' ? Infinity : Math.max(anchor.col, cursor.col);

    this.ensureOverlay();
    if (!this.overlay) return;

    const overlayTop = this.getOverlayTop();
    this.overlay.style.top = `${overlayTop}px`;

    const lineHeight = this.getLineHeight(font);
    const charWidth = this.getCharWidth(font);

    for (let line = startLine; line <= endLine; line++) {
      const lineLen = getLineLength(line);
      if (lineLen === 0) continue;

      let col: number;
      let length: number;

      if (subMode === 'visualLine') {
        col = 0;
        length = lineLen;
      } else if (startLine === endLine) {
        col = startCol;
        length = Math.max(1, endCol - startCol + 1);
      } else if (line === startLine) {
        col = startCol;
        length = Math.max(1, lineLen - startCol);
      } else if (line === endLine) {
        col = 0;
        length = Math.min(lineLen, endCol + 1);
      } else {
        col = 0;
        length = lineLen;
      }

      if (length <= 0) continue;

      const span = document.createElement('span');
      span.className = 'copy-mode-selection-span';
      span.style.position = 'absolute';
      span.style.left = `${col * charWidth}px`;
      this.positionSpanAtRow(span, line, viewportY, overlayTop, lineHeight);
      span.style.width = `${length * charWidth}px`;
      this.overlay.appendChild(span);
    }
  }

  /**
   * Highlight all visible search matches, with the current match styled
   * distinctly (like Vim's hlsearch + incsearch current match).
   */
  showSearchMatches(
    matches: SearchMatch[],
    currentIndex: number,
    viewportY: number,
    font: Config['font'],
    theme: Theme
  ): void {
    this.clear();
    this.ensureOverlay();
    if (!this.overlay || matches.length === 0) return;

    const overlayTop = this.getOverlayTop();
    this.overlay.style.top = `${overlayTop}px`;

    const lineHeight = this.getLineHeight(font);
    const charWidth = this.getCharWidth(font);

    const viewportEnd = viewportY + this.getVisibleRows();

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      if (match.line < viewportY || match.line >= viewportEnd) continue;

      const span = document.createElement('span');
      span.className = i === currentIndex
        ? 'copy-mode-search-match copy-mode-search-current'
        : 'copy-mode-search-match';
      span.style.position = 'absolute';
      span.style.left = `${match.col * charWidth}px`;
      this.positionSpanAtRow(span, match.line, viewportY, overlayTop, lineHeight);
      span.style.width = `${match.length * charWidth}px`;
      this.overlay.appendChild(span);
    }
  }

  clear(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    this.container.querySelectorAll('.copy-mode-selection-overlay').forEach((el) => el.remove());
    this.cachedCharWidth = null;
    this.cachedLineHeight = null;
  }

  private ensureOverlay(): void {
    if (this.overlay) return;
    this.overlay = document.createElement('div');
    this.overlay.className = 'copy-mode-selection-overlay';
    this.overlay.style.pointerEvents = 'none';
    this.container.appendChild(this.overlay);
  }

  private getOverlayTop(): number {
    const containerRect = this.container.getBoundingClientRect();
    const rowsContainer = this.container.querySelector('.xterm-rows') as HTMLElement | null;
    if (rowsContainer) {
      return rowsContainer.getBoundingClientRect().top - containerRect.top;
    }
    return 0;
  }

  private positionSpanAtRow(
    span: HTMLElement,
    line: number,
    viewportY: number,
    overlayTop: number,
    fallbackLineHeight: number
  ): void {
    const containerRect = this.container.getBoundingClientRect();
    const row = this.container.querySelector(`.xterm-rows > div:nth-child(${line - viewportY + 1})`) as HTMLElement | null;
    if (row) {
      const rowRect = row.getBoundingClientRect();
      span.style.top = `${rowRect.top - containerRect.top - overlayTop}px`;
      span.style.height = `${rowRect.height}px`;
    } else {
      span.style.top = `${(line - viewportY) * fallbackLineHeight}px`;
      span.style.height = `${fallbackLineHeight}px`;
    }
  }

  private getVisibleRows(): number {
    const rowsContainer = this.container.querySelector('.xterm-rows') as HTMLElement | null;
    if (rowsContainer) {
      return rowsContainer.childElementCount;
    }
    return Math.floor(this.container.clientHeight / this.getFallbackLineHeight());
  }

  private getCharWidth(font: Config['font']): number {
    if (this.cachedCharWidth !== null) return this.cachedCharWidth;
    const measured = this.measure(font);
    this.cachedCharWidth = measured.charWidth;
    this.cachedLineHeight = measured.lineHeight;
    return this.cachedCharWidth;
  }

  private getLineHeight(font: Config['font']): number {
    if (this.cachedLineHeight !== null) return this.cachedLineHeight;
    const measured = this.measure(font);
    this.cachedCharWidth = measured.charWidth;
    this.cachedLineHeight = measured.lineHeight;
    return this.cachedLineHeight;
  }

  private getFallbackLineHeight(): number {
    if (this.cachedLineHeight !== null) return this.cachedLineHeight;
    return 16;
  }

  private measure(font: Config['font']): { charWidth: number; lineHeight: number } {
    const row = this.container.querySelector('.xterm-rows > div') as HTMLElement | null;
    if (row) {
      const rect = row.getBoundingClientRect();
      const text = row.textContent || '';
      const nonEmptyLength = text.length || 1;
      return {
        charWidth: rect.width / nonEmptyLength,
        lineHeight: rect.height,
      };
    }

    const el = document.createElement('span');
    el.textContent = 'M';
    el.style.fontFamily = font.family || 'monospace';
    el.style.fontSize = `${font.size}px`;
    el.style.lineHeight = `${font.lineHeight}`;
    el.style.position = 'absolute';
    el.style.visibility = 'hidden';
    this.container.appendChild(el);
    const rect = el.getBoundingClientRect();
    const charWidth = rect.width;
    const lineHeight = rect.height;
    el.remove();
    return { charWidth, lineHeight };
  }
}
