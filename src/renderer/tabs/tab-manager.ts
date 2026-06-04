import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Config } from '../../shared/types';
import { initializeTerminal, resizeTerminal } from '../terminal/terminal';
import { ThemeManager } from '../theme/theme-manager';
import { CopyMode } from '../copy-mode/copy-mode';
import { ShortcutsPanel } from '../shortcuts-panel/shortcuts-panel';

interface Tab {
  id: string;
  pid: number;
  title: string;
  osc1Title: string | null; // OSC 1 icon name (tab title)
  osc2Title: string | null; // OSC 2 window title
  cwdName: string | null;   // CWD name from lsof/OSC 7
  term: Terminal;
  fitAddon: FitAddon;
  copyMode: CopyMode;
  container: HTMLElement;
  onDataUnsubscribe: () => void;
  onInputUnsubscribe: () => void; // term.onData → shell.write
  onExitUnsubscribe: () => void;
}

export class TabManager {
  private tabs: Tab[] = [];
  private activeIndex = -1;
  private config: Config;
  private themeManager: ThemeManager;
  private terminalContainer: HTMLElement;
  private tabBar: HTMLElement;
  private globalDataUnsubscribe: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private cwdPollInterval: NodeJS.Timeout | null = null;
  private shortcutsPanel: ShortcutsPanel | null = null;

  constructor(
    terminalContainer: HTMLElement,
    tabBar: HTMLElement,
    config: Config,
    themeManager: ThemeManager
  ) {
    this.terminalContainer = terminalContainer;
    this.tabBar = tabBar;
    this.config = config;
    this.themeManager = themeManager;

    this.setupGlobalDataListener();
    this.setupKeyboardShortcuts();
    this.setupResizeObserver();
    this.startCwdPolling();
    this.setupGlobalDragOver();
  }

  async addTab(): Promise<void> {
    let cwd: string | undefined;
    if (this.activeIndex >= 0) {
      const activeTab = this.tabs[this.activeIndex];
      try {
        cwd = await window.puppy.shell.getCwd(activeTab.id);
      } catch {
        // Ignore errors (e.g., process exited)
      }
    }

    const { id, pid } = await window.puppy.shell.spawn(cwd);

    const container = document.createElement('div');
    container.className = 'tab-terminal-container';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.display = 'none';
    this.terminalContainer.appendChild(container);
    this.setupDragAndDrop(container);

    const term = initializeTerminal(container, this.config);
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    const copyMode = new CopyMode(term, container, this.config, this.themeManager);

    // Prevent xterm.js from sending keys to the PTY while copy mode is active,
    // so TUI apps (e.g. Claude Code) don't also receive hjkl/G/etc.
    term.attachCustomKeyEventHandler(() => {
      return !copyMode.isActive();
    });

    // Send input to pty (keyboard / drop / paste → shell)
    const inputDisposable = term.onData((data) => {
      window.puppy.shell.write(id, data);
    });

    const tab: Tab = {
      id,
      pid,
      title: 'Shell',
      osc1Title: null,
      osc2Title: null,
      cwdName: null,
      term,
      fitAddon,
      copyMode,
      container,
      onDataUnsubscribe: () => {},
      onInputUnsubscribe: () => inputDisposable.dispose(),
      onExitUnsubscribe: () => {},
    };

    // Listen for data specifically for this tab
    tab.onDataUnsubscribe = window.puppy.shell.onData(({ id: dataId, data }) => {
      if (dataId === id) {
        term.write(data);
      }
    });

    // Listen for shell exit: show a message but keep the tab open
    tab.onExitUnsubscribe = window.puppy.shell.onExit(({ id: exitId, exitCode }) => {
      if (exitId !== id) return;

      const targetTab = this.tabs.find((t) => t.id === id);
      if (!targetTab) return;

      // Stop keyboard input from reaching the dead PTY
      targetTab.onInputUnsubscribe();

      const msg = exitCode != null
        ? `\r\n[Process exited with code ${exitCode}]\r\n`
        : `\r\n[Process exited]\r\n`;
      targetTab.term.write(msg);
    });

    // Register OSC handlers for title (0/1/2) and CWD (7)
    this.registerOscTitleHandlers(term, tab);
    this.registerOsc7Handler(term, tab);

    this.themeManager.addTerminal(term);
    this.tabs.push(tab);
    this.activateTab(this.tabs.length - 1);

    // Ensure CWD polling is running
    this.startCwdPolling();

    // Fetch initial working directory for tab title
    this.updateTabTitleFromCwd(tab);

    // Initial fit
    setTimeout(() => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        resizeTerminal(term, id, dims.cols, dims.rows);
      }
    }, 100);
  }

  closeTab(index: number): void {
    if (index < 0 || index >= this.tabs.length) return;

    const tab = this.tabs[index];
    tab.onDataUnsubscribe();
    tab.onInputUnsubscribe();
    tab.onExitUnsubscribe();
    tab.copyMode.exit();
    this.themeManager.removeTerminal(tab.term);
    tab.term.dispose();
    tab.container.remove();
    window.puppy.shell.kill(tab.id);

    this.tabs.splice(index, 1);

    if (this.tabs.length === 0) {
      this.stopCwdPolling();
      this.activeIndex = -1;
      this.renderTabBar();
      window.puppy.window.quit();
      return;
    }

    if (index <= this.activeIndex) {
      this.activeIndex = Math.max(0, this.activeIndex - 1);
    }
    this.activateTab(this.activeIndex);
  }

  closeActiveTab(): void {
    if (this.activeIndex >= 0) {
      this.closeTab(this.activeIndex);
    }
  }

  prevTab(): void {
    if (this.tabs.length > 1) {
      const idx = this.activeIndex <= 0 ? this.tabs.length - 1 : this.activeIndex - 1;
      this.activateTab(idx);
    }
  }

  nextTab(): void {
    if (this.tabs.length > 1) {
      const idx = this.activeIndex >= this.tabs.length - 1 ? 0 : this.activeIndex + 1;
      this.activateTab(idx);
    }
  }

  activateTab(index: number): void {
    if (index < 0 || index >= this.tabs.length) return;

    // Hide current
    if (this.activeIndex >= 0 && this.activeIndex < this.tabs.length) {
      const current = this.tabs[this.activeIndex];
      current.container.style.display = 'none';
      current.term.blur();
    }

    this.activeIndex = index;
    const tab = this.tabs[index];
    tab.container.style.display = 'block';
    if (!tab.copyMode.isActive()) {
      tab.term.focus();
    }

    // Fit after showing
    setTimeout(() => {
      tab.fitAddon.fit();
      const dims = tab.fitAddon.proposeDimensions();
      if (dims) {
        resizeTerminal(tab.term, tab.id, dims.cols, dims.rows);
      }
    }, 10);

    this.renderTabBar();
  }

  updateConfig(config: Config): void {
    this.config = config;
    for (const tab of this.tabs) {
      tab.copyMode.updateConfig(config);
      tab.term.options.scrollback = config.scrollback;
      tab.term.options.fontFamily = config.font.family;
      tab.term.options.fontSize = config.font.size;
      tab.term.options.cursorStyle = config.cursorStyle;
      tab.term.options.cursorBlink = config.cursorBlink;
    }
  }

  setShortcutsPanel(panel: ShortcutsPanel): void {
    this.shortcutsPanel = panel;
  }

  dispose(): void {
    this.stopCwdPolling();
    if (this.globalDataUnsubscribe) {
      this.globalDataUnsubscribe();
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    for (const tab of this.tabs) {
      tab.onDataUnsubscribe();
      tab.onExitUnsubscribe();
      tab.copyMode.exit();
      this.themeManager.removeTerminal(tab.term);
      tab.term.dispose();
      window.puppy.shell.kill(tab.id);
    }
    this.tabs = [];
  }

  private renderTabBar(): void {
    this.tabBar.innerHTML = '';

    for (let i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i];
      const el = document.createElement('div');
      el.className = 'tab' + (i === this.activeIndex ? ' active' : '');
      el.title = tab.title;

      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = tab.title;
      el.appendChild(label);

      const closeBtn = document.createElement('span');
      closeBtn.className = 'tab-close';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(i);
      });
      el.appendChild(closeBtn);

      el.addEventListener('click', () => this.activateTab(i));
      this.tabBar.appendChild(el);
    }

    const addBtn = document.createElement('div');
    addBtn.className = 'tab-add';
    addBtn.textContent = '+';
    addBtn.title = 'New Tab';
    addBtn.addEventListener('click', () => this.addTab());
    this.tabBar.appendChild(addBtn);
  }

  private setupGlobalDataListener(): void {
    // The per-tab listeners handle data routing, but we need at least
    // one global listener active so the IPC channel stays subscribed.
    // (Already handled by per-tab onData subscriptions.)
  }

  private setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e) => {
      // Shortcuts panel takes precedence when visible
      if (this.shortcutsPanel?.isVisible()) {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.shortcutsPanel.hide();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === '/') {
          e.preventDefault();
          this.shortcutsPanel.toggle();
          return;
        }
        // Block all other keys while panel is open
        return;
      }

      // Cmd/Ctrl+/: Toggle shortcuts panel
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        this.shortcutsPanel?.toggle();
        return;
      }

      // Route copy mode keys for the active tab
      if (this.activeIndex >= 0 && this.activeIndex < this.tabs.length) {
        const activeTab = this.tabs[this.activeIndex];

        // If active tab is in copy mode, let it consume the key
        if (activeTab.copyMode.isActive()) {
          if (activeTab.copyMode.handleKey(e)) {
            return;
          }
        }

        // Enter copy mode shortcut (only when not already in copy mode)
        if (this.shouldEnterCopyMode(e)) {
          e.preventDefault();
          activeTab.copyMode.enter();
          return;
        }
      }

      // Cmd/Ctrl+T: New tab
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        this.addTab();
        return;
      }

      // Cmd/Ctrl+W: Close tab
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (this.activeIndex >= 0) {
          this.closeTab(this.activeIndex);
        }
        return;
      }

      // Cmd/Ctrl+Shift+{ or [: Previous tab
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '{' || e.key === '[')) {
        e.preventDefault();
        if (this.tabs.length > 1) {
          const idx = this.activeIndex <= 0 ? this.tabs.length - 1 : this.activeIndex - 1;
          this.activateTab(idx);
        }
        return;
      }

      // Cmd/Ctrl+Shift+} or ]: Next tab
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '}' || e.key === ']')) {
        e.preventDefault();
        if (this.tabs.length > 1) {
          const idx = this.activeIndex >= this.tabs.length - 1 ? 0 : this.activeIndex + 1;
          this.activateTab(idx);
        }
        return;
      }

      // Cmd+1..9: Switch to tab
      if (e.metaKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        if (idx < this.tabs.length) {
          this.activateTab(idx);
        }
        return;
      }

      // Cmd/Ctrl+Option/Alt+Z: Toggle window maximize (zoom)
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        window.puppy.window.toggleMaximize();
        return;
      }
    });
  }

  private shouldEnterCopyMode(e: KeyboardEvent): boolean {
    const { enterKey, enterModifiers, macModifiers, winModifiers } = this.config.copyMode;
    const keyMatch = e.key.toLowerCase() === enterKey.toLowerCase();

    const isMac = navigator.platform.toLowerCase().includes('mac');
    const effectiveModifiers = isMac
      ? (macModifiers ?? enterModifiers)
      : (winModifiers ?? enterModifiers);

    const modifiersMatch = effectiveModifiers.every((m) => {
      switch (m) {
        case 'ctrl': return e.ctrlKey;
        case 'shift': return e.shiftKey;
        case 'alt': return e.altKey;
        case 'meta': return e.metaKey;
      }
    });

    return keyMatch && modifiersMatch && effectiveModifiers.length === [
      e.ctrlKey, e.shiftKey, e.altKey, e.metaKey,
    ].filter(Boolean).length;
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      if (this.activeIndex >= 0 && this.activeIndex < this.tabs.length) {
        const tab = this.tabs[this.activeIndex];
        tab.fitAddon.fit();
        const dims = tab.fitAddon.proposeDimensions();
        if (dims) {
          resizeTerminal(tab.term, tab.id, dims.cols, dims.rows);
        }
      }
    });
    this.resizeObserver.observe(this.terminalContainer);
  }

  private setupGlobalDragOver(): void {
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
    });
  }

  private setupDragAndDrop(container: HTMLElement): void {
    let dragCounter = 0;

    container.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      if (dragCounter === 1) {
        container.classList.add('drag-over');
      }
    });

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer!.dropEffect = 'copy';
    });

    container.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      if (dragCounter === 0) {
        container.classList.remove('drag-over');
      }
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      container.classList.remove('drag-over');

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const tab = this.tabs.find((t) => t.container === container);
      if (!tab) return;

      if (tab.copyMode.isActive()) {
        tab.copyMode.exit();
      }

      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const path = window.puppy.webUtils.getPathForFile(file);
          if (path) {
            paths.push(path.replace(/ /g, '\\ '));
          }
        } catch {
          // Ignore files without a path
        }
      }

      if (paths.length === 0) return;

      const text = paths.join(' ');
      // Wrap in bracketed-paste sequences so Claude Code treats the drop
      // exactly like a paste, triggering image-path detection.
      const bracketed = '\x1b[200~' + text + '\x1b[201~ ';

      // Temporarily disconnect xterm.js → shell so any browser-native drop text
      // that xterm.js injects into its textarea doesn't leak to the pty.
      tab.onInputUnsubscribe();

      window.puppy.shell.write(tab.id, bracketed);

      // Reconnect after a tick; any native input events fired during drop are now ignored.
      requestAnimationFrame(() => {
        const disposable = tab.term.onData((data) => {
          window.puppy.shell.write(tab.id, data);
        });
        tab.onInputUnsubscribe = () => disposable.dispose();
        // Restore focus in case the drag caused the window to blur
        tab.term.focus();
      });
    });
  }

  private startCwdPolling(): void {
    this.stopCwdPolling();
    this.cwdPollInterval = setInterval(() => {
      if (this.tabs.length === 0) return;
      // Fire all CWD checks concurrently; ignore errors
      Promise.all(
        this.tabs.map((tab) =>
          this.updateTabTitleFromCwd(tab).catch(() => {})
        )
      );
    }, 30000);
  }

  private stopCwdPolling(): void {
    if (this.cwdPollInterval) {
      clearInterval(this.cwdPollInterval);
      this.cwdPollInterval = null;
    }
  }

  private registerOscTitleHandlers(term: Terminal, tab: Tab): void {
    // OSC 0: Set icon name and window title (clears icon name, sets window title)
    // OSC 1: Set icon name (used as tab title)
    // OSC 2: Set window title (fallback for tab title)
    // Precedence: OSC 1 > OSC 2 > CWD > 'Shell'
    try {
      (term.parser as any).registerOscHandler(0, (data: string) => {
        // OSC 0 clears icon name and sets window title
        tab.osc1Title = null;
        tab.osc2Title = data || null;
        this.refreshTabTitle(tab);
        return true;
      });
      (term.parser as any).registerOscHandler(1, (data: string) => {
        tab.osc1Title = data || null;
        this.refreshTabTitle(tab);
        return true;
      });
      (term.parser as any).registerOscHandler(2, (data: string) => {
        tab.osc2Title = data || null;
        this.refreshTabTitle(tab);
        return true;
      });
    } catch {
      // Parser API may not be available in this xterm version
    }
  }

  private registerOsc7Handler(term: Terminal, tab: Tab): void {
    // OSC 7 is emitted by shells to report the current working directory.
    // Format: OSC 7 ; file://hostname/path BEL
    // xterm.js parser API requires allowProposedApi: true (already set).
    try {
      (term.parser as any).registerOscHandler(7, (data: string) => {
        try {
          const path = this.extractPathFromOsc7(data);
          if (path) {
            const name = path.split('/').pop() || path;
            if (name) {
              tab.cwdName = name;
              this.refreshTabTitle(tab);
            }
          }
        } catch {
          // Ignore malformed OSC 7
        }
        return true; // Mark as handled so xterm doesn't print it
      });
    } catch {
      // Parser API may not be available in this xterm version
    }
  }

  private refreshTabTitle(tab: Tab): void {
    const newTitle = tab.osc1Title || tab.osc2Title || tab.cwdName || 'Shell';
    if (newTitle !== tab.title) {
      tab.title = newTitle;
      this.renderTabBar();
    }
  }

  private async updateTabTitleFromCwd(tab: Tab): Promise<void> {
    try {
      const cwd = await window.puppy.shell.getCwd(tab.id);
      if (cwd) {
        const name = cwd.split('/').pop() || cwd;
        if (name) {
          tab.cwdName = name;
          this.refreshTabTitle(tab);
        }
      }
    } catch {
      // Ignore errors (process may have exited)
    }
  }

  private extractPathFromOsc7(data: string): string | null {
    // Handle formats:
    // file://hostname/path
    // file:///path
    if (data.startsWith('file://')) {
      const withoutScheme = data.slice(7); // remove 'file://'
      const pathStart = withoutScheme.indexOf('/');
      if (pathStart >= 0) {
        let path = decodeURIComponent(withoutScheme.slice(pathStart));
        // Clean up trailing slashes
        path = path.replace(/\/$/, '') || '/';
        return path;
      }
    }
    return null;
  }
}
