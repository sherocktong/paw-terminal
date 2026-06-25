import type { Config, Theme } from '../../shared/types';

interface BufferLineLike {
  isWrapped: boolean;
}

/** Returns undefined if the buffer line is out of range. */
type GetBufferLine = (index: number) => BufferLineLike | undefined;

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

  render(viewportY: number, rows: number, cursorLine: number, getLine?: GetBufferLine): void {
    this.ensureOverlay();
    if (!this.overlay) return;

    const containerRect = this.container.getBoundingClientRect();
    const rowsContainer = this.container.querySelector('.xterm-rows') as HTMLElement | null;

    // Align the gutter's top edge with the actual xterm rows container so the
    // first line number sits exactly on top of the first visible row.
    let overlayTop = 0;
    if (rowsContainer) {
      overlayTop = rowsContainer.getBoundingClientRect().top - containerRect.top;
    }
    this.overlay.style.top = `${overlayTop}px`;
    this.overlay.innerHTML = '';

    // Use xterm's actual font metrics so the numbers render with the same
    // baseline as the terminal text.
    const xtermFont = this.getXtermFont();

    // Pre-compute the logical line for every visible screen row.
    const logicalLines: number[] = [];
    let logicalLine = viewportY;
    for (let i = 0; i < rows; i++) {
      const line = viewportY + i;
      const bufferLine = getLine?.(line);
      const isWrapped = bufferLine?.isWrapped ?? false;
      if (!isWrapped) {
        logicalLine = line;
      }
      logicalLines.push(logicalLine);
    }

    for (let i = 0; i < rows; i++) {
      // Only render the line number on the first screen row of each logical
      // line. If the previous visible row belongs to the same logical line,
      // this row is a wrapped continuation and should not get its own number.
      if (i > 0 && logicalLines[i] === logicalLines[i - 1]) {
        continue;
      }

      const line = logicalLines[i];
      const isCurrent = line === cursorLine;
      const relNum = isCurrent ? line + 1 : Math.abs(line - cursorLine);
      const text = String(relNum).padStart(3, ' ');

      const el = document.createElement('div');
      el.className = 'copy-mode-linenr' + (isCurrent ? ' current' : '');
      // Render the number inside a span that mimics xterm.js's cell spans so the
      // text baseline and vertical metrics match the terminal text exactly.
      const span = document.createElement('span');
      span.textContent = text;
      span.style.display = 'inline-block';
      span.style.width = '100%';
      span.style.height = '100%';
      span.style.verticalAlign = 'top';
      span.style.lineHeight = 'inherit';
      span.style.textAlign = 'right';
      el.appendChild(span);
      el.style.fontFamily = xtermFont.family;
      el.style.fontSize = xtermFont.size;
      el.style.left = '0';
      el.style.right = '0';

      // Position each number at the exact bounding rect of the physical screen
      // row where this logical line starts (`i`). Because we iterate over
      // physical screen rows, `i` maps 1:1 to the xterm row index.
      const row = this.container.querySelector(`.xterm-rows > div:nth-child(${i + 1})`) as HTMLElement | null;
      if (row) {
        const rowRect = row.getBoundingClientRect();
        el.style.position = 'absolute';
        el.style.top = `${rowRect.top - containerRect.top - overlayTop}px`;
        el.style.height = `${rowRect.height}px`;
        el.style.lineHeight = `${rowRect.height}px`;
      } else {
        const metrics = this.measureXtermCell();
        el.style.position = 'absolute';
        el.style.top = `${i * metrics.lineHeight}px`;
        el.style.height = `${metrics.lineHeight}px`;
        el.style.lineHeight = `${metrics.lineHeight}px`;
      }

      this.overlay.appendChild(el);
    }
  }

  clear(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    // Defensive: remove any stray line-number overlays that may have been
    // re-created by a hot reload or stale reference.
    this.container.querySelectorAll('.copy-mode-linenr-overlay').forEach((el) => el.remove());
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

  /**
   * Measure xterm.js's actual rendered cell dimensions so the gutter rows line
   * up exactly with the terminal rows.
   */
  /**
   * Read xterm.js's actual computed font so the gutter numbers render with the
   * same face, size and baseline as the terminal text.
   */
  private getXtermFont(): { family: string; size: string } {
    const row = this.container.querySelector('.xterm-rows > div') as HTMLElement | null;
    if (row) {
      const style = getComputedStyle(row);
      return { family: style.fontFamily, size: style.fontSize };
    }
    return {
      family: this.font.family || 'monospace',
      size: `${this.font.size}px`,
    };
  }

  private measureXtermCell(): { lineHeight: number; charWidth: number } {
    const row = this.container.querySelector('.xterm-rows > div') as HTMLElement | null;
    if (row) {
      const rect = row.getBoundingClientRect();
      return {
        lineHeight: rect.height,
        charWidth: rect.width / Math.max(1, row.textContent?.length ?? 0),
      };
    }
    return this.fallbackMeasure();
  }

  private fallbackMeasure(): { lineHeight: number; charWidth: number } {
    const el = document.createElement('span');
    el.textContent = 'M';
    const font = this.getXtermFont();
    el.style.fontFamily = font.family;
    el.style.fontSize = font.size;
    el.style.lineHeight = `${this.font.lineHeight}`;
    el.style.position = 'absolute';
    el.style.visibility = 'hidden';
    this.container.appendChild(el);
    const charWidth = el.offsetWidth;
    const lineHeight = el.offsetHeight;
    el.remove();
    return { charWidth, lineHeight };
  }
}
