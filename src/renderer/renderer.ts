import '@xterm/xterm/css/xterm.css';
import type { Config } from '../shared/types';
import { ThemeManager } from './theme/theme-manager';
import { TabManager } from './tabs/tab-manager';
import { ShortcutsPanel } from './shortcuts-panel/shortcuts-panel';

async function main(): Promise<void> {
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
  await tabManager.addTab();

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
}

main().catch(console.error);
