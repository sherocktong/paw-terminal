import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME, DEFAULT_CONFIG, BUILTIN_THEMES } from '../shared/constants';
import type { Config } from '../shared/types';

function getConfigDir(): string {
  return path.join(app.getPath('home'), '.config', CONFIG_DIR_NAME);
}

function getDefaultShell(): string {
  const envShell = process.env.SHELL;
  if (envShell && fs.existsSync(envShell)) {
    return envShell;
  }
  for (const candidate of ['/bin/zsh', '/bin/bash', '/bin/sh']) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return '/bin/sh';
}

function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

function ensureConfigDir(): void {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadConfig(): Config {
  ensureConfigDir();
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    saveConfig(DEFAULT_CONFIG);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Config>;
    return mergeWithDefaults(parsed);
  } catch (err) {
    console.error('Failed to load config, using defaults:', err);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function watchConfig(callback: (config: Config) => void): () => void {
  const configPath = getConfigPath();
  let debounceTimer: NodeJS.Timeout | null = null;

  const handler = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        const config = loadConfig();
        callback(config);
      } catch (err) {
        console.error('Config watch callback error:', err);
      }
    }, 300);
  };

  try {
    fs.watchFile(configPath, { interval: 500 }, handler);
    return () => {
      fs.unwatchFile(configPath, handler);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  } catch (err) {
    console.error('Failed to watch config:', err);
    return () => {};
  }
}

function migrateOldCopyMode(partial: Partial<Config>): Partial<Config> {
  const cm = partial.copyMode;
  // Migrate original default (Ctrl+Shift+C without platform modifiers)
  const isOriginalDefault =
    cm?.enterKey === 'c' &&
    cm?.enterModifiers?.length === 2 &&
    cm.enterModifiers[0] === 'ctrl' &&
    cm.enterModifiers[1] === 'shift' &&
    !cm?.macModifiers &&
    !cm?.winModifiers;
  // Migrate broken Escape binding (never worked, caught by OS)
  const isBrokenEscBinding = cm?.enterKey === 'escape';

  if (isOriginalDefault || isBrokenEscBinding) {
    return {
      ...partial,
      copyMode: {
        enterKey: DEFAULT_CONFIG.copyMode.enterKey,
        enterModifiers: DEFAULT_CONFIG.copyMode.enterModifiers,
        macModifiers: DEFAULT_CONFIG.copyMode.macModifiers,
        winModifiers: DEFAULT_CONFIG.copyMode.winModifiers,
      },
    };
  }
  return partial;
}

function migrateOldThemeConfig(partial: Partial<Config>): Partial<Config> {
  if (!('theme' in partial) && !('autoAppearance' in partial)) {
    return partial;
  }

  const result = { ...partial };
  delete (result as any).theme;
  delete (result as any).autoAppearance;

  const oldTheme = partial.theme;
  if (oldTheme === 'auto' || oldTheme === 'system' || !oldTheme) {
    result.lightTheme = DEFAULT_CONFIG.lightTheme;
    result.darkTheme = DEFAULT_CONFIG.darkTheme;
    return result;
  }

  const builtin = BUILTIN_THEMES.find((t) => t.id === oldTheme);
  if (builtin) {
    if (builtin.type === 'light') {
      result.lightTheme = oldTheme;
      result.darkTheme = DEFAULT_CONFIG.darkTheme;
    } else {
      result.darkTheme = oldTheme;
      result.lightTheme = DEFAULT_CONFIG.lightTheme;
    }
    return result;
  }

  const custom = partial.customThemes?.find((t) => t.id === oldTheme);
  if (custom) {
    if (custom.type === 'light') {
      result.lightTheme = oldTheme;
      result.darkTheme = DEFAULT_CONFIG.darkTheme;
    } else {
      result.darkTheme = oldTheme;
      result.lightTheme = DEFAULT_CONFIG.lightTheme;
    }
    return result;
  }

  result.lightTheme = DEFAULT_CONFIG.lightTheme;
  result.darkTheme = DEFAULT_CONFIG.darkTheme;
  return result;
}

function mergeWithDefaults(partial: Partial<Config>): Config {
  const migrated = migrateOldCopyMode(partial);
  const migratedTheme = migrateOldThemeConfig(migrated);
  return {
    lightTheme: migratedTheme.lightTheme ?? DEFAULT_CONFIG.lightTheme,
    darkTheme: migratedTheme.darkTheme ?? DEFAULT_CONFIG.darkTheme,
    scrollback: migrated.scrollback ?? DEFAULT_CONFIG.scrollback,
    font: {
      family: migrated.font?.family ?? DEFAULT_CONFIG.font.family,
      size: migrated.font?.size ?? DEFAULT_CONFIG.font.size,
      lineHeight: migrated.font?.lineHeight ?? DEFAULT_CONFIG.font.lineHeight,
    },
    opacity: migrated.opacity ?? DEFAULT_CONFIG.opacity,
    cursorStyle: migrated.cursorStyle ?? DEFAULT_CONFIG.cursorStyle,
    cursorBlink: migrated.cursorBlink ?? DEFAULT_CONFIG.cursorBlink,
    copyMode: {
      enterKey: migrated.copyMode?.enterKey ?? DEFAULT_CONFIG.copyMode.enterKey,
      enterModifiers: migrated.copyMode?.enterModifiers ?? DEFAULT_CONFIG.copyMode.enterModifiers,
      macModifiers: migrated.copyMode?.macModifiers ?? DEFAULT_CONFIG.copyMode.macModifiers,
      winModifiers: migrated.copyMode?.winModifiers ?? DEFAULT_CONFIG.copyMode.winModifiers,
    },
    window: {
      width: migrated.window?.width ?? DEFAULT_CONFIG.window.width,
      height: migrated.window?.height ?? DEFAULT_CONFIG.window.height,
      x: migrated.window?.x,
      y: migrated.window?.y,
      maximized: migrated.window?.maximized,
    },
    shell: migrated.shell ?? getDefaultShell(),
    shellArgs: migrated.shellArgs ?? DEFAULT_CONFIG.shellArgs,
    customThemes: migrated.customThemes ?? DEFAULT_CONFIG.customThemes,
  };
}
