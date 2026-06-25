import type { Config, CopyModeState, Theme } from '../../shared/types';

export class StatusBar {
  private container: HTMLElement;
  private statusBar: HTMLElement | null = null;
  private statusText: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
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

  update(state: CopyModeState): void {
    if (!this.statusText) return;

    const mode = state.subMode === 'normal' ? 'NORMAL' : state.subMode === 'visual' ? 'VISUAL' : 'V-LINE';
    const pos = `${state.cursor.line + 1}:${state.cursor.col + 1}`;
    let search = '';
    if (state.searchQuery) {
      const current = state.currentSearchIndex >= 0 ? state.currentSearchIndex + 1 : 0;
      search = ` /${state.searchQuery}/ [${current}/${state.searchResults.length}]`;
    }
    this.statusText.textContent = `-- ${mode} -- ${pos}${search}`;
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

  clearSearchInput(): void {
    if (this.searchInput) this.searchInput.value = '';
  }

  focusSearchInput(): void {
    this.searchInput?.focus();
  }

  destroy(): void {
    if (this.statusBar) {
      this.statusBar.remove();
      this.statusBar = null;
    }
    this.statusText = null;
    this.searchInput = null;
  }

  private createElements(): void {
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

  private applyTheme(): void {
    if (!this.statusBar) return;
    this.statusBar.style.background = this.theme.colors.selectionBackground;
    this.statusBar.style.color = this.theme.colors.foreground;
    this.statusBar.style.fontFamily = this.font.family || 'monospace';
    this.statusBar.style.fontSize = `${this.font.size}px`;
  }
}
