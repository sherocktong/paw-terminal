import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Config, ServiceAccelerator } from '../../shared/types';
import { initializeTerminal, resizeTerminal } from '../terminal/terminal';
import { ThemeManager } from '../theme/theme-manager';
import { CopyMode } from '../copy-mode/copy-mode';
import { ShortcutsPanel } from '../shortcuts-panel/shortcuts-panel';
import { isWindowsPlatform } from '../platform';

// Inline icons for the Windows Terminal style tab strip
const TAB_ICON_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.6"/>' +
  '<path d="M4.4 6.2 6.6 8l-2.2 1.8"/><path d="M8.4 9.8h3.2"/></svg>';

const CLOSE_ICON_SVG =
  '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">' +
  '<path d="M2 2l6 6M8 2l-6 6"/></svg>';

const PLUS_ICON_SVG =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">' +
  '<path d="M6 1.5v9M1.5 6h9"/></svg>';

const CHEVRON_ICON_SVG =
  '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M1.8 3.6 5 6.8l3.2-3.2"/></svg>';

// AppKit function-key names used in the pbs registry vs DOM KeyboardEvent.key.
const KEY_NAME_ALIASES: Record<string, string> = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
};

interface Tab {
  id: string;
  pid: number;
  title: string;
  osc1Title: string | null; // OSC 1 icon name (tab title)
  osc2Title: string | null; // OSC 2 window title
  cwdName: string | null;   // CWD name from lsof/OSC 7
  hasRunningScript: boolean;
  // True once a foreground app (TUI) has owned the TTY since the shell was
  // last in the foreground. Used to clear OSC titles left behind by apps
  // that set a title (e.g. pi writes OSC 0 "pi - <cwd>") and never restore
  // it on exit.
  foregroundAppSeen: boolean;
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
  private tabMenu: HTMLElement | null = null;
  /** Windows gets the Windows Terminal style tab strip. */
  private readonly windows = isWindowsPlatform;
  private scriptPollInterval: NodeJS.Timeout | null = null;
  // macOS Services shortcuts mirrored from the pbs registry (mac only;
  // always empty elsewhere, which disables the matcher).
  private serviceAccelerators: ServiceAccelerator[] = [];
  // Debounce timers for event-driven OSC title cleanup, keyed by tab id.
  private fgTitleCheckTimeouts = new Map<string, NodeJS.Timeout>();

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
    this.setupServicesHotkeys();
    this.setupResizeObserver();
    this.startCwdPolling();
    this.startScriptPolling();
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
    // Open clicked links in the system default browser instead of
    // navigating the Electron window.
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault();
        window.puppy.app.openExternal(uri);
      }),
    );

    const copyMode = new CopyMode(term, container, this.config, this.themeManager);

    // Prevent xterm.js from sending keys to the PTY while copy mode is active,
    // so TUI apps (e.g. Claude Code) don't also receive hjkl/G/etc.
    // Also let system shortcuts (e.g. Option+F5) pass through without being
    // consumed by the PTY.
    // While the shortcuts panel is visible, return false too: xterm's keydown
    // handler would otherwise stopPropagation() the event, so it would never
    // bubble to `document` and the panel couldn't react to Esc / trap keys.
    term.attachCustomKeyEventHandler((e) => {
      if (this.shortcutsPanel?.isVisible()) return false;
      if (copyMode.isActive()) return false;
      if (e.altKey && e.key === 'F5') return false;
      // Ctrl+C copies the selection, otherwise it stays SIGINT for the shell
      if (this.handleTerminalClipboardKey(e, term)) return false;
      return true;
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
      hasRunningScript: false,
      foregroundAppSeen: false,
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
        this.scheduleForegroundTitleCheck(tab);
      }
    });

    // Listen for shell exit: show a message but keep the tab open
    tab.onExitUnsubscribe = window.puppy.shell.onExit(({ id: exitId, exitCode }) => {
      if (exitId !== id) return;

      const targetTab = this.tabs.find((t) => t.id === id);
      if (!targetTab) return;

      const pendingCheck = this.fgTitleCheckTimeouts.get(id);
      if (pendingCheck) clearTimeout(pendingCheck);
      this.fgTitleCheckTimeouts.delete(id);

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
    const insertIndex = this.activeIndex >= 0 ? this.activeIndex + 1 : this.tabs.length;
    this.tabs.splice(insertIndex, 0, tab);
    this.activateTab(insertIndex);

    // Ensure polling is running
    this.startCwdPolling();
    this.startScriptPolling();

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
    const pendingCheck = this.fgTitleCheckTimeouts.get(tab.id);
    if (pendingCheck) clearTimeout(pendingCheck);
    this.fgTitleCheckTimeouts.delete(tab.id);
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
      this.stopScriptPolling();
      this.activeIndex = -1;
      this.renderTabBar();
      // Close this window only; the app keeps running (macOS convention)
      window.puppy.window.close();
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
    this.stopScriptPolling();
    if (this.globalDataUnsubscribe) {
      this.globalDataUnsubscribe();
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    for (const tab of this.tabs) {
      const pendingCheck = this.fgTitleCheckTimeouts.get(tab.id);
      if (pendingCheck) clearTimeout(pendingCheck);
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
    this.closeTabMenu();
    this.tabBar.innerHTML = '';

    for (let i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i];
      const el = document.createElement('div');
      el.className = 'tab' + (i === this.activeIndex ? ' active' : '');
      el.title = tab.title;

      if (tab.hasRunningScript) {
        const spinner = document.createElement('span');
        spinner.className = 'tab-spinner';
        for (let s = 0; s < 8; s++) {
          spinner.appendChild(document.createElement('i'));
        }
        el.appendChild(spinner);
      } else if (this.windows) {
        const icon = document.createElement('span');
        icon.className = 'tab-icon';
        icon.innerHTML = TAB_ICON_SVG;
        el.appendChild(icon);
      }

      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = tab.title;
      el.appendChild(label);

      const closeBtn = document.createElement('span');
      closeBtn.className = 'tab-close';
      if (this.windows) {
        closeBtn.title = 'Close Tab';
        closeBtn.innerHTML = CLOSE_ICON_SVG;
      } else {
        closeBtn.textContent = '\u00d7';
      }
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(i);
      });
      el.appendChild(closeBtn);

      el.addEventListener('click', () => this.activateTab(i));

      if (this.windows) {
        // Middle click closes the tab, like Windows Terminal
        el.addEventListener('auxclick', (e) => {
          if (e.button === 1) {
            e.preventDefault();
            this.closeTab(i);
          }
        });
      }

      this.tabBar.appendChild(el);
    }

    const addBtn = document.createElement('div');
    addBtn.className = 'tab-add';
    if (this.windows) {
      addBtn.innerHTML = PLUS_ICON_SVG;
    } else {
      addBtn.textContent = '+';
    }
    addBtn.title = this.windows ? 'New Tab (Ctrl+T)' : 'New Tab';
    addBtn.addEventListener('click', () => this.addTab());
    this.tabBar.appendChild(addBtn);

    if (!this.windows) return;

    const divider = document.createElement('div');
    divider.className = 'tab-dropdown-divider';
    this.tabBar.appendChild(divider);

    const dropdownBtn = document.createElement('div');
    dropdownBtn.className = 'tab-dropdown';
    dropdownBtn.title = 'Tab Menu';
    dropdownBtn.innerHTML = CHEVRON_ICON_SVG;
    dropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleTabMenu(dropdownBtn);
    });
    this.tabBar.appendChild(dropdownBtn);
  }

  private setupGlobalDataListener(): void {
    // The per-tab listeners handle data routing, but we need at least
    // one global listener active so the IPC channel stays subscribed.
    // (Already handled by per-tab onData subscriptions.)
  }

  private setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.tabMenu) {
        this.closeTabMenu();
      }
      // Shortcuts panel takes precedence when visible. Escape closing is
      // handled by ShortcutsPanel itself.
      if (this.shortcutsPanel?.isVisible()) {
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

      // Clipboard shortcuts for focused text inputs (search, settings inputs)
      if (this.handleInputClipboardKey(e)) {
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

      // Cmd/Ctrl+W: Close tab (Shift distinguishes Cmd+Shift+W = close window)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'w') {
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

  // Keys paw claims itself at the renderer level (menu accelerators like
  // Cmd+T never reach here). Services shortcuts lose to these.
  private isPawRendererShortcut(e: KeyboardEvent): boolean {
    if (this.shouldEnterCopyMode(e)) return true;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === '/') return true;
    return false;
  }

  // macOS dispatches Services shortcuts above the front app, but Chromium
  // never validates services (see main/services-bridge.ts), so the shortcuts
  // arrive here as plain keydowns. Recognize them from the pbs registry
  // mirror and run the service through NSPerformService instead.
  private setupServicesHotkeys(): void {
    window.puppy.services.onRegistry((entries) => {
      this.serviceAccelerators = entries;
    });

    // Capture phase: runs before xterm's textarea listeners so matched keys
    // never leak escape sequences into the PTY.
    document.addEventListener(
      'keydown',
      (e) => {
        if (this.serviceAccelerators.length === 0) return;
        if (e.isComposing || e.repeat) return;
        if (this.shortcutsPanel?.isVisible()) return;
        if (this.activeIndex < 0 || this.activeIndex >= this.tabs.length) return;
        const activeTab = this.tabs[this.activeIndex];
        if (activeTab.copyMode.isActive()) return;
        if (this.isPawRendererShortcut(e)) return;

        const match = this.matchServiceAccelerator(e);
        if (!match) return;

        e.preventDefault();
        e.stopPropagation();
        window.puppy.services.perform(match.name, activeTab.term.getSelection());
      },
      true,
    );
  }

  private matchServiceAccelerator(e: KeyboardEvent): ServiceAccelerator | null {
    for (const acc of this.serviceAccelerators) {
      if (acc.cmd !== e.metaKey || acc.opt !== e.altKey ||
          acc.ctrl !== e.ctrlKey || acc.shift !== e.shiftKey) {
        continue;
      }
      // The registry uses AppKit names; KeyboardEvent uses DOM names.
      const expected = KEY_NAME_ALIASES[acc.key] ?? acc.key;
      if (expected.length === 1) {
        if (e.key.toLowerCase() === expected.toLowerCase()) return acc;
      } else if (e.key === expected) {
        return acc;
      }
    }
    return null;
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
    }, 5000);
  }

  private stopCwdPolling(): void {
    if (this.cwdPollInterval) {
      clearInterval(this.cwdPollInterval);
      this.cwdPollInterval = null;
    }
  }

  private startScriptPolling(): void {
    this.stopScriptPolling();
    this.scriptPollInterval = setInterval(() => {
      if (this.tabs.length === 0) return;
      Promise.all(
        this.tabs.map((tab) =>
          this.updateRunningScriptState(tab).catch(() => {})
        )
      );
    }, 2000);
  }

  private stopScriptPolling(): void {
    if (this.scriptPollInterval) {
      clearInterval(this.scriptPollInterval);
      this.scriptPollInterval = null;
    }
  }

  private async updateRunningScriptState(tab: Tab): Promise<void> {
    try {
      const hasRunningScript = await window.puppy.shell.hasRunningScript(tab.id);
      if (hasRunningScript !== tab.hasRunningScript) {
        tab.hasRunningScript = hasRunningScript;
        this.renderTabBar();
      }
    } catch {
      // Ignore errors (e.g., process exited)
    }
  }

  // Fullscreen TUI apps often set the terminal title (OSC 0/1/2) and never
  // restore it on exit (e.g. pi writes OSC 0 "pi - <cwd>"). The OS provides no
  // event for foreground-process-group changes, so detect the exit
  // event-driven instead: whenever output arrives on a tab that has a
  // latched OSC title, debounce a check of TTY foreground ownership. Once an
  // app has owned the foreground and the shell regains it, clear the latched
  // titles so the cwd-based title takes over. Shells that set their own title
  // via precmd hooks never lose foreground ownership, so their titles survive.
  private scheduleForegroundTitleCheck(tab: Tab): void {
    if (!tab.osc1Title && !tab.osc2Title) return;
    const existing = this.fgTitleCheckTimeouts.get(tab.id);
    if (existing) clearTimeout(existing);
    this.fgTitleCheckTimeouts.set(
      tab.id,
      setTimeout(() => {
        this.fgTitleCheckTimeouts.delete(tab.id);
        this.checkForegroundTitleOwnership(tab).catch(() => {});
      }, 500)
    );
  }

  private async checkForegroundTitleOwnership(tab: Tab): Promise<void> {
    const shellInForeground = await window.puppy.shell.isShellInForeground(tab.id);
    if (shellInForeground === false) {
      tab.foregroundAppSeen = true;
    } else if (shellInForeground === true && tab.foregroundAppSeen) {
      tab.foregroundAppSeen = false;
      if (tab.osc1Title !== null || tab.osc2Title !== null) {
        tab.osc1Title = null;
        tab.osc2Title = null;
        this.refreshTabTitle(tab);
      }
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
        this.scheduleForegroundTitleCheck(tab);
        return true;
      });
      (term.parser as any).registerOscHandler(1, (data: string) => {
        tab.osc1Title = data || null;
        this.refreshTabTitle(tab);
        this.scheduleForegroundTitleCheck(tab);
        return true;
      });
      (term.parser as any).registerOscHandler(2, (data: string) => {
        tab.osc2Title = data || null;
        this.refreshTabTitle(tab);
        this.scheduleForegroundTitleCheck(tab);
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

  // --- Clipboard ---------------------------------------------------------

  /** Copy the active terminal's selection (used by the Edit menu). */
  copySelection(): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    // Copy mode owns its own clipboard handling
    if (tab.copyMode.isActive()) return;
    if (!tab.term.hasSelection()) return;
    this.copyText(tab.term.getSelection());
  }

  /** Paste into the focused input, otherwise into the active terminal. */
  paste(): void {
    const input = this.getFocusedTextInput();
    if (input) {
      void window.puppy.clipboard.readText().then((text) => {
        if (text) this.insertIntoInput(input, text);
      });
      return;
    }
    const tab = this.getActiveTab();
    if (!tab) return;
    this.pasteIntoTerminal(tab.term);
  }

  /**
   * Ctrl/Cmd+C and Ctrl/Cmd+V inside xterm. Ctrl+C only copies when there is
   * a selection, so an unselected Ctrl+C still reaches the shell as SIGINT.
   */
  private handleTerminalClipboardKey(e: KeyboardEvent, term: Terminal): boolean {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
    const key = e.key.toLowerCase();

    if (key === 'c' && !e.shiftKey) {
      if (!term.hasSelection()) return false;
      e.preventDefault();
      this.copyText(term.getSelection());
      return true;
    }

    if (key === 'v') {
      e.preventDefault();
      this.pasteIntoTerminal(term);
      return true;
    }

    return false;
  }

  private copyText(text: string): void {
    if (!text) return;
    void window.puppy.clipboard.writeText(text);
  }

  private pasteIntoTerminal(term: Terminal): void {
    void window.puppy.clipboard.readText().then((text) => {
      if (!text) return;
      term.focus();
      term.paste(text);
    });
  }

  private getActiveTab(): Tab | null {
    if (this.activeIndex < 0 || this.activeIndex >= this.tabs.length) return null;
    return this.tabs[this.activeIndex];
  }

  /** Returns the focused DOM text input, ignoring xterm's hidden textarea. */
  private getFocusedTextInput(): HTMLInputElement | HTMLTextAreaElement | null {
    const el = document.activeElement;
    if (el instanceof HTMLTextAreaElement) return el;
    if (el instanceof HTMLInputElement) {
      const type = el.type.toLowerCase();
      const textTypes = ['text', 'search', 'url', 'tel', 'password', 'email', 'number'];
      return textTypes.includes(type) ? el : null;
    }
    return null;
  }

  /** Global Ctrl/Cmd+C/V handling for regular text inputs. */
  private handleInputClipboardKey(e: KeyboardEvent): boolean {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
    const input = this.getFocusedTextInput();
    if (!input) return false;
    const key = e.key.toLowerCase();

    if (key === 'v' && !e.shiftKey) {
      e.preventDefault();
      void window.puppy.clipboard.readText().then((text) => {
        if (text) this.insertIntoInput(input, text);
      });
      return true;
    }

    if (key === 'c' && !e.shiftKey) {
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;
      if (start === end) return false;
      e.preventDefault();
      this.copyText(input.value.slice(start, end));
      return true;
    }

    return false;
  }

  private insertIntoInput(input: HTMLInputElement | HTMLTextAreaElement, text: string): void {
    // <input> cannot contain newlines, mirror the browser behaviour
    const value = input instanceof HTMLInputElement ? text.replace(/[\r\n]+/g, ' ') : text;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + value + input.value.slice(end);
    const caret = start + value.length;
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // --- Tab dropdown menu (Windows) --------------------------------------

  private toggleTabMenu(anchor: HTMLElement): void {
    if (this.tabMenu) {
      this.closeTabMenu();
      return;
    }

    const menu = document.createElement('div');
    menu.className = 'tab-menu';

    const addItem = (label: string, shortcut: string, onClick: () => void, disabled = false) => {
      const item = document.createElement('div');
      item.className = 'tab-menu-item' + (disabled ? ' disabled' : '');
      const text = document.createElement('span');
      text.textContent = label;
      const keys = document.createElement('span');
      keys.className = 'tab-menu-shortcut';
      keys.textContent = shortcut;
      item.appendChild(text);
      item.appendChild(keys);
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTabMenu();
        onClick();
      });
      menu.appendChild(item);
    };

    const separator = () => {
      const sep = document.createElement('div');
      sep.className = 'tab-menu-separator';
      menu.appendChild(sep);
    };

    addItem('New Tab', 'Ctrl+T', () => this.addTab());
    addItem('Close Tab', 'Ctrl+W', () => this.closeTab(this.activeIndex), this.tabs.length === 0);
    separator();
    addItem('Previous Tab', 'Ctrl+Shift+Tab', () => {
      const count = this.tabs.length;
      if (count) this.activateTab((this.activeIndex - 1 + count) % count);
    });
    addItem('Next Tab', 'Ctrl+Tab', () => {
      const count = this.tabs.length;
      if (count) this.activateTab((this.activeIndex + 1) % count);
    });
    separator();
    addItem('Keyboard Shortcuts', 'Ctrl+/', () => this.shortcutsPanel?.toggle());

    document.body.appendChild(menu);
    this.tabMenu = menu;

    // Position under the anchor, clamped away from the native window controls
    const anchorRect = anchor.getBoundingClientRect();
    const barRect = this.tabBar.getBoundingClientRect();
    const paddingRight = parseFloat(getComputedStyle(this.tabBar).paddingRight) || 0;
    const safeRight = barRect.right - paddingRight;
    const menuRect = menu.getBoundingClientRect();
    const left = Math.min(anchorRect.left, safeRight - menuRect.width - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${anchorRect.bottom + 4}px`;
    anchor.classList.add('open');

    // Dismiss on outside click
    setTimeout(() => {
      const onDown = (ev: MouseEvent) => {
        if (this.tabMenu && !this.tabMenu.contains(ev.target as Node)) {
          this.closeTabMenu();
        }
      };
      document.addEventListener('mousedown', onDown, { once: true });
    }, 0);
  }

  private closeTabMenu(): void {
    if (this.tabMenu) {
      this.tabMenu.remove();
      this.tabMenu = null;
    }
    const open = this.tabBar.querySelector('.tab-dropdown.open');
    open?.classList.remove('open');
  }
}
