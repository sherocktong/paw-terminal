import type { Config, Theme } from '../../shared/types';

/**
 * A narrow overlay that renders relative line numbers on the left side of the
 * terminal. The actual buffer content is rendered by xterm.js; this overlay
 * only draws the gutter numbers.
 */
export class LineNumberOverlay {
  private container: HTMLElement;
  private overlay: HTMLElement | null = null;
  private theme: Theme;
  private font: Config['font'];

  constructor(container: HTMLElement, theme: Theme, font: Config['font']) {
    // Attach to the outer tab container; xterm.js will be shifted right via CSS
    // when copy mode is active to make room for this gutter.
    this.container = container;
    this.theme = theme;
    this.font = font;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.applyTheme();
  }

  setFont(font: Config['font']): void {
    this.font = font;
    this.applyTheme();
  }

  render(viewportY: number, rows: number, cursorLine: number): void {
    this.ensureOverlay();
    if (!this.overlay) return;

    this.overlay.innerHTML = '';

    for (let i = 0; i < rows; i++) {
      const line = viewportY + i;
      const isCurrent = line === cursorLine;
      const relNum = isCurrent ? line + 1 : Math.abs(line - cursorLine);
      const text = String(relNum).padStart(3, ' ');

      const el = document.createElement('div');
      el.className = 'copy-mode-linenr' + (isCurrent ? ' current' : '');
      el.textContent = text;
      this.overlay.appendChild(el);
    }
  }

  clear(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  private ensureOverlay(): void {
    if (this.overlay) return;
    this.overlay = document.createElement('div');
    this.overlay.className = 'copy-mode-linenr-overlay';
    this.applyTheme();
    this.container.appendChild(this.overlay);
  }

  private applyTheme(): void {
    if (!this.overlay) return;
    this.overlay.style.fontFamily = this.font.family || 'monospace';
    this.overlay.style.fontSize = `${this.font.size}px`;
    this.overlay.style.lineHeight = `${this.font.lineHeight}`;
  }
}
