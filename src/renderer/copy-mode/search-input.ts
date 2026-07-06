import type { Config, Theme } from '../../shared/types';

/**
 * A transient search input that appears at the bottom of the terminal only
 * while the user is typing a search query (/ or ?).
 */
export class SearchInput {
  private container: HTMLElement;
  private box: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private theme: Theme;
  private font: Config['font'];

  constructor(container: HTMLElement, theme: Theme, font: Config['font']) {
    this.container = container;
    this.theme = theme;
    this.font = font;
    this.createElements();
    this.applyTheme();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.applyTheme();
  }

  setFont(font: Config['font']): void {
    this.font = font;
    this.applyTheme();
  }

  show(initialValue = '', direction: 'forward' | 'backward' = 'forward'): void {
    if (!this.input || !this.box) return;
    this.input.value = initialValue;
    this.input.placeholder = direction === 'forward' ? '/' : '?';
    this.box.classList.add('active');
    this.input.focus();
  }

  hide(): string {
    if (!this.input || !this.box) return '';
    const value = this.input.value;
    this.box.classList.remove('active');
    this.input.blur();
    return value;
  }

  clear(): void {
    if (this.input) this.input.value = '';
  }

  destroy(): void {
    if (this.box) {
      this.box.remove();
      this.box = null;
    }
    this.input = null;
  }

  private createElements(): void {
    this.box = document.createElement('div');
    this.box.className = 'copy-mode-search-box';
    this.container.appendChild(this.box);

    this.input = document.createElement('input');
    this.input.className = 'copy-mode-search-input';
    this.input.type = 'text';
    this.input.spellcheck = false;
    this.box.appendChild(this.input);
  }

  private applyTheme(): void {
    if (!this.box) return;
    this.box.style.background = this.theme.colors.selectionBackground;
    this.box.style.color = this.theme.colors.foreground;
    this.box.style.fontFamily = this.font.family || 'monospace';
    this.box.style.fontSize = `${this.font.size}px`;
  }
}
