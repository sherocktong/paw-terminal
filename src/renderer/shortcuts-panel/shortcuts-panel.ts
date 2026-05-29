import type { Config } from '../../shared/types';

interface ShortcutEntry {
  keys: string;
  description: string;
}

interface ShortcutCategory {
  name: string;
  entries: ShortcutEntry[];
}

export class ShortcutsPanel {
  private container: HTMLElement;
  private config: Config;
  private overlay: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private visible = false;

  constructor(container: HTMLElement, config: Config) {
    this.container = container;
    this.config = config;
  }

  updateConfig(config: Config): void {
    this.config = config;
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;

    if (!this.overlay) {
      this.createOverlay();
    }

    if (this.overlay) {
      this.overlay.style.display = 'flex';
      this.renderContent();
    }
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    if (this.overlay) {
      this.overlay.style.display = 'none';
    }
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  private createOverlay(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'shortcuts-panel';
    this.overlay.style.display = 'none';

    // Backdrop click to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });

    this.content = document.createElement('div');
    this.content.className = 'shortcuts-panel-content';
    this.overlay.appendChild(this.content);

    this.container.appendChild(this.overlay);
  }

  private renderContent(): void {
    if (!this.content) return;
    this.content.innerHTML = '';

    const isMac = navigator.platform.toLowerCase().includes('mac');
    const mod = isMac ? 'Cmd' : 'Ctrl';
    const shiftMod = isMac ? 'Cmd+Shift' : 'Ctrl+Shift';
    const altMod = isMac ? 'Option' : 'Alt';

    // Build copy mode enter shortcut from config
    const copyModeModifiers = isMac
      ? (this.config.copyMode.macModifiers ?? this.config.copyMode.enterModifiers)
      : (this.config.copyMode.winModifiers ?? this.config.copyMode.enterModifiers);
    const copyModeEnter = copyModeModifiers
      .map((m) => {
        switch (m) {
          case 'ctrl':
            return 'Ctrl';
          case 'shift':
            return 'Shift';
          case 'alt':
            return altMod;
          case 'meta':
            return 'Cmd';
        }
      })
      .concat(this.config.copyMode.enterKey.toUpperCase())
      .join('+');

    const categories: ShortcutCategory[] = [
      {
        name: 'General',
        entries: [
          { keys: `${mod}+T`, description: 'New Tab' },
          { keys: `${mod}+W`, description: 'Close Tab' },
          { keys: `${shiftMod}+N`, description: 'New Window' },
        ],
      },
      {
        name: 'Tab Navigation',
        entries: [
          { keys: `${shiftMod}+[`, description: 'Previous Tab' },
          { keys: `${shiftMod}+]`, description: 'Next Tab' },
          ...(isMac ? [{ keys: `Cmd+1..9`, description: 'Switch to Tab' }] : []),
        ],
      },
      {
        name: 'Copy Mode',
        entries: [
          { keys: copyModeEnter, description: 'Enter Copy Mode' },
          { keys: 'h j k l', description: 'Move left / down / up / right' },
          { keys: 'w / W', description: 'Next word / WORD' },
          { keys: 'b / B', description: 'Previous word / WORD' },
          { keys: 'e / E', description: 'End of word / WORD' },
          { keys: '0 ^ $', description: 'Start / first non-blank / end of line' },
          { keys: 'gg G', description: 'First line / last line' },
          { keys: 'H M L', description: 'Screen top / middle / bottom' },
          { keys: 'Ctrl+d / Ctrl+u', description: 'Half page down / up' },
          { keys: 'Ctrl+f / Ctrl+b', description: 'Page down / up' },
          { keys: 'v / V', description: 'Visual character / line mode' },
          { keys: 'y', description: 'Yank selection to clipboard' },
          { keys: '/ / ?', description: 'Search forward / backward' },
          { keys: 'n / N', description: 'Next / previous search result' },
          { keys: 'q / Esc', description: 'Exit copy mode' },
        ],
      },
      {
        name: 'Window',
        entries: [
          { keys: `${shiftMod}+Z`, description: 'Zoom Window (maximize)' },
          { keys: `${mod}+/`, description: 'Show / hide Keyboard Shortcuts' },
        ],
      },
    ];

    const title = document.createElement('div');
    title.className = 'shortcuts-panel-title';
    title.textContent = 'Keyboard Shortcuts';
    this.content.appendChild(title);

    for (const category of categories) {
      const catEl = document.createElement('div');
      catEl.className = 'shortcuts-category';

      const catName = document.createElement('div');
      catName.className = 'shortcuts-category-name';
      catName.textContent = category.name;
      catEl.appendChild(catName);

      for (const entry of category.entries) {
        const row = document.createElement('div');
        row.className = 'shortcuts-row';

        const keys = document.createElement('span');
        keys.className = 'shortcuts-key';
        keys.textContent = entry.keys;

        const desc = document.createElement('span');
        desc.className = 'shortcuts-desc';
        desc.textContent = entry.description;

        row.appendChild(keys);
        row.appendChild(desc);
        catEl.appendChild(row);
      }

      this.content.appendChild(catEl);
    }
  }
}
