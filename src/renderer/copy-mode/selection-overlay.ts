import type { Config, CopyModePosition, CopyModeSubMode } from '../../shared/types';

/**
 * Minimal transparent overlay used only for multi-line visual (char-wise)
 * selections. xterm.js's public selection API cannot represent partial
 * selections that span multiple rows, so we render highlight spans directly
 * over the real terminal cells. Normal-mode cursor and single-line/visualLine
 * selections are handled by xterm.js itself.
 */
export class SelectionOverlay {
  private container: HTMLElement;
  private overlay: HTMLElement | null = null;
  private cachedCharWidth: number | null = null;
  private cachedLineHeight: number | null = null;

  constructor(container: HTMLElement) {
    // Attach to the outer tab container; the selection overlay is positioned
    // over the terminal content area (which is shifted right by the line-number
    // gutter via CSS when copy mode is active).
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
      span.style.top = `${(line - viewportY) * lineHeight}px`;
      span.style.width = `${length * charWidth}px`;
      span.style.height = `${lineHeight}px`;
      this.overlay.appendChild(span);
    }
  }

  clear(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
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

  private measure(font: Config['font']): { charWidth: number; lineHeight: number } {
    const el = document.createElement('span');
    el.textContent = 'M';
    el.style.fontFamily = font.family || 'monospace';
    el.style.fontSize = `${font.size}px`;
    el.style.lineHeight = `${font.lineHeight}`;
    el.style.position = 'absolute';
    el.style.visibility = 'hidden';
    this.container.appendChild(el);
    const charWidth = el.offsetWidth;
    const lineHeight = el.offsetHeight;
    el.remove();
    return { charWidth, lineHeight };
  }
}
