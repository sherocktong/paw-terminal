import { Terminal } from '@xterm/xterm';
import { BUILTIN_THEMES } from '../../shared/constants';
import type { Config, Theme, AppearanceMode } from '../../shared/types';

export class ThemeManager {
  private terms = new Set<Terminal>();
  private config: Config;
  private currentTheme: Theme;
  private systemMode: AppearanceMode = 'light';
  private unsubscribeSystem: (() => void) | null = null;

  constructor(config: Config) {
    this.config = config;
    // Default to light until async setup resolves the real system mode
    this.currentTheme = this.resolveThemeForMode(this.systemMode);
    this.applyGlobalStyles(this.currentTheme);
    this.setupSystemAppearance();
    this.setupViewportObserver();
  }

  addTerminal(term: Terminal): void {
    this.terms.add(term);
    this.applyThemeToTerminal(term, this.currentTheme);
  }

  removeTerminal(term: Terminal): void {
    this.terms.delete(term);
  }

  updateConfig(config: Config): void {
    this.config = config;
    const newTheme = this.resolveThemeForMode(this.systemMode);
    if (newTheme.id !== this.currentTheme.id) {
      this.currentTheme = newTheme;
      this.applyTheme(this.currentTheme);
    }
  }

  getCurrentTheme(): Theme {
    return this.currentTheme;
  }

  private resolveThemeForMode(mode: AppearanceMode): Theme {
    const themeId = mode === 'dark' ? this.config.darkTheme : this.config.lightTheme;

    const custom = this.config.customThemes.find((t) => t.id === themeId);
    if (custom) return custom;

    const builtin = BUILTIN_THEMES.find((t) => t.id === themeId);
    if (builtin) return builtin as Theme;

    return BUILTIN_THEMES[0] as Theme;
  }

  private applyTheme(theme: Theme): void {
    this.applyGlobalStyles(theme);
    for (const term of this.terms) {
      this.applyThemeToTerminal(term, theme);
    }
  }

  private applyThemeToTerminal(term: Terminal, theme: Theme): void {
    term.options.theme = {
      background: theme.colors.background,
      foreground: theme.colors.foreground,
      cursor: theme.colors.cursor,
      cursorAccent: theme.colors.cursorAccent,
      selectionBackground: theme.colors.selectionBackground,
      selectionForeground: theme.colors.selectionForeground,
      black: theme.colors.black,
      red: theme.colors.red,
      green: theme.colors.green,
      yellow: theme.colors.yellow,
      blue: theme.colors.blue,
      magenta: theme.colors.magenta,
      cyan: theme.colors.cyan,
      white: theme.colors.white,
      brightBlack: theme.colors.brightBlack,
      brightRed: theme.colors.brightRed,
      brightGreen: theme.colors.brightGreen,
      brightYellow: theme.colors.brightYellow,
      brightBlue: theme.colors.brightBlue,
      brightMagenta: theme.colors.brightMagenta,
      brightCyan: theme.colors.brightCyan,
      brightWhite: theme.colors.brightWhite,
    };

    if (theme.font?.family) {
      term.options.fontFamily = theme.font.family;
    }
    if (theme.font?.size) {
      term.options.fontSize = theme.font.size;
    }
  }

  private applyGlobalStyles(theme: Theme): void {
    // Apply CSS variables for copy mode and UI chrome
    const root = document.documentElement;
    root.style.setProperty('--copy-mode-bg', theme.colors.background);
    root.style.setProperty('--copy-mode-fg', theme.colors.foreground);
    root.style.setProperty('--copy-mode-cursor', theme.colors.cursor);
    root.style.setProperty('--copy-mode-selection', theme.colors.selectionBackground);
    root.style.setProperty('--copy-mode-selection-fg', theme.colors.selectionForeground || theme.colors.foreground);
    root.style.setProperty('--copy-mode-search', theme.colors.yellow);
    root.style.setProperty('--copy-mode-search-fg', theme.colors.background);
    root.style.setProperty('--copy-mode-status-bg', theme.colors.selectionBackground);
    root.style.setProperty('--copy-mode-status-fg', theme.colors.foreground);
    root.style.setProperty('--copy-mode-linenr', theme.colors.brightBlack);
    root.style.setProperty('--copy-mode-linenr-current', theme.colors.foreground);

    // Tab bar colors based on theme type
    const isLight = theme.type === 'light';
    root.style.setProperty('--tab-bar-bg', isLight ? '#e8e8e8' : '#1e1f29');
    root.style.setProperty('--tab-bar-border', isLight ? '#d0d0d0' : '#44475a');
    root.style.setProperty('--tab-bg', isLight ? '#f0f0f0' : '#282a36');
    root.style.setProperty('--tab-fg', isLight ? '#888888' : '#6272a4');
    root.style.setProperty('--tab-hover-bg', isLight ? '#d8d8d8' : '#44475a');
    root.style.setProperty('--tab-hover-fg', isLight ? '#333333' : '#f8f8f2');
    root.style.setProperty('--tab-active-bg', isLight ? '#d8d8d8' : '#44475a');
    root.style.setProperty('--tab-active-fg', isLight ? '#333333' : '#f8f8f2');

    document.documentElement.style.background = theme.colors.background;
    document.body.style.background = theme.colors.background;

    // Fix xterm viewport background: xterm sets it to #000 via JS, overriding CSS
    document.querySelectorAll('.xterm-viewport').forEach((el) => {
      (el as HTMLElement).style.setProperty('background-color', 'transparent', 'important');
    });
  }

  private async setupSystemAppearance(): Promise<void> {
    const initialMode = await window.puppy.theme.getSystem();
    this.systemMode = initialMode;
    const initialTheme = this.resolveThemeForMode(initialMode);
    if (initialTheme.id !== this.currentTheme.id) {
      this.currentTheme = initialTheme;
      this.applyTheme(this.currentTheme);
    }

    this.unsubscribeSystem = window.puppy.theme.onSystemChange((mode) => {
      this.systemMode = mode;
      const newTheme = this.resolveThemeForMode(mode);
      if (newTheme.id !== this.currentTheme.id) {
        this.currentTheme = newTheme;
        this.applyTheme(this.currentTheme);
      }
    });
  }

  private setupViewportObserver(): void {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            if (node.classList.contains('xterm-viewport')) {
              node.style.setProperty('background-color', 'transparent', 'important');
            }
            node.querySelectorAll('.xterm-viewport').forEach((el) => {
              (el as HTMLElement).style.setProperty('background-color', 'transparent', 'important');
            });
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  dispose(): void {
    if (this.unsubscribeSystem) {
      this.unsubscribeSystem();
    }
    this.terms.clear();
  }
}
