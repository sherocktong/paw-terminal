import { Terminal } from '@xterm/xterm';
import { BUILTIN_THEMES } from '../../shared/constants';
import type { Config, Theme, AppearanceMode } from '../../shared/types';

export class ThemeManager {
  private terms = new Set<Terminal>();
  private config: Config;
  private currentTheme: Theme;
  private systemMode: AppearanceMode = 'dark';
  private unsubscribeSystem: (() => void) | null = null;

  constructor(config: Config) {
    this.config = config;
    this.currentTheme = this.resolveTheme(config.theme);
    this.applyGlobalStyles(this.currentTheme);
    this.setupSystemAppearance();
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
    const newTheme = this.resolveTheme(config.theme);
    if (newTheme.id !== this.currentTheme.id) {
      this.currentTheme = newTheme;
      this.applyTheme(this.currentTheme);
    }
  }

  getCurrentTheme(): Theme {
    return this.currentTheme;
  }

  private resolveTheme(themeId: string): Theme {
    // Auto theme: pick a built-in theme matching the current system appearance
    if (themeId === 'auto' || (themeId === 'system' && this.config.autoAppearance)) {
      const fallback = BUILTIN_THEMES.find((t) => t.type === this.systemMode);
      if (fallback) return fallback as Theme;
      return BUILTIN_THEMES[0] as Theme;
    }

    const custom = this.config.customThemes.find((t) => t.id === themeId);
    if (custom) return custom;
    const builtin = BUILTIN_THEMES.find((t) => t.id === themeId);
    if (builtin) return builtin as Theme;

    // Fallback: auto-select based on system appearance
    if (this.config.autoAppearance) {
      const fallback = BUILTIN_THEMES.find(
        (t) => t.type === this.systemMode
      );
      if (fallback) return fallback as Theme;
    }

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

    document.body.style.background = theme.colors.background;
  }

  private async setupSystemAppearance(): Promise<void> {
    this.systemMode = await window.puppy.theme.getSystem();
    this.unsubscribeSystem = window.puppy.theme.onSystemChange((mode) => {
      this.systemMode = mode;
      if (this.config.autoAppearance) {
        const autoTheme = BUILTIN_THEMES.find((t) => t.type === mode);
        if (autoTheme) {
          this.currentTheme = autoTheme as Theme;
          this.applyTheme(this.currentTheme);
        }
      }
    });
  }

  dispose(): void {
    if (this.unsubscribeSystem) {
      this.unsubscribeSystem();
    }
    this.terms.clear();
  }
}
