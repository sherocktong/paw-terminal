import '@xterm/xterm/css/xterm.css';
import type { Config } from '../shared/types';
import { ThemeManager } from './theme/theme-manager';
import { TabManager } from './tabs/tab-manager';
import { ShortcutsPanel } from './shortcuts-panel/shortcuts-panel';
import { installAppShortcutHandler } from './app-shortcuts';
import { isMacPlatform, isWindowsPlatform } from './platform';

async function main(): Promise<void> {
  // Install before any terminal exists so the app shortcuts (Ctrl+T, ...) are
  // intercepted in the capture phase before xterm.js consumes them (needed on
  // Windows/Linux where Electron does not dispatch menu accelerators for key
  // events the renderer has handled).
  installAppShortcutHandler();

  // Mark the platform so CSS can apply platform-specific chrome:
  // macOS keeps its traffic lights / flat tab bar, Windows gets the
  // Windows Terminal style tab strip.
  if (isWindowsPlatform) {
    document.body.classList.add('platform-win');
  } else if (isMacPlatform) {
    document.body.classList.add('platform-mac');
  }

  const terminalContainer = document.getElementById('terminal-container');
  const tabBar = document.getElementById('tab-bar');
  if (!terminalContainer || !tabBar) {
    throw new Error('Required DOM elements not found');
  }

  const config: Config = await window.puppy.config.get();

  const themeManager = new ThemeManager(config);
  const tabManager = new TabManager(terminalContainer, tabBar, config, themeManager);
  const shortcutsPanel = new ShortcutsPanel(document.body, config);
  tabManager.setShortcutsPanel(shortcutsPanel);

  // Create initial tab
  try {
    await tabManager.addTab();
  } catch (err) {
    console.error('Failed to create initial tab:', err);
    const errorMsg = document.createElement('div');
    errorMsg.style.cssText =
      'padding:20px;color:#ff5555;font-family:monospace;white-space:pre-wrap;';
    errorMsg.textContent =
      'Failed to start shell.\n\n' +
      (err instanceof Error ? err.message : String(err)) +
      '\n\nPlease check your shell configuration in ~/.config/paw/config.json';
    terminalContainer.appendChild(errorMsg);
    return;
  }

  // Listen for config changes
  window.puppy.config.onChange((newConfig) => {
    themeManager.updateConfig(newConfig);
    tabManager.updateConfig(newConfig);
    shortcutsPanel.updateConfig(newConfig);
  });

  // Listen for menu events
  window.puppy.menu.onNewTab(() => tabManager.addTab());
  window.puppy.menu.onCloseTab(() => tabManager.closeActiveTab());
  window.puppy.menu.onPrevTab(() => tabManager.prevTab());
  window.puppy.menu.onNextTab(() => tabManager.nextTab());
  window.puppy.menu.onShowShortcuts(() => shortcutsPanel.toggle());
  window.puppy.menu.onCopy(() => tabManager.copySelection());
  window.puppy.menu.onPaste(() => tabManager.paste());
}

main().catch(console.error);
