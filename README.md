# Puppy Terminal

A modern, themeable terminal emulator built with Electron and TypeScript. Features vim-like copy mode, automatic dark/light mode switching, and cross-platform packaging.

## Features

- **Full Terminal Emulator** — Spawns real shells (bash, zsh, fish) via `node-pty` with `xterm.js` rendering
- **Vim-like Copy Mode** — Navigate scrollback with `hjkl`, search with `/`, visually select with `v`, and yank to clipboard
- **Auto Appearance** — Automatically switches between dark and light themes based on system preference
- **Customizable Themes** — Built-in themes (Dracula, One Dark, Solarized, Gruvbox) plus custom theme support
- **JSON Configuration** — All settings managed via `~/.config/paw/config.json`
- **Cross-Platform** — Packaged for macOS (DMG), Windows (NSIS installer), and Linux (AppImage)

## Development

### Prerequisites

- Node.js 22+
- npm

### Setup

```bash
npm install
```

### Dev Mode

```bash
npm run dev
```

This starts the Vite dev server and launches Electron with HMR support.

### Build

```bash
npm run build
```

### Package for Distribution

```bash
# All platforms
npm run dist

# Platform-specific
npm run dist:mac
npm run dist:win
npm run dist:linux
```

## Configuration

Settings are stored in `~/.config/paw/config.json`. The file is created automatically with defaults on first launch.

### Default Config

```json
{
  "theme": "dracula",
  "autoAppearance": true,
  "scrollback": 10000,
  "font": {
    "family": "Menlo, Monaco, \"Courier New\", monospace",
    "size": 14,
    "lineHeight": 1.2
  },
  "opacity": 1.0,
  "cursorStyle": "block",
  "cursorBlink": true,
  "copyMode": {
    "enterKey": "c",
    "enterModifiers": ["ctrl", "shift"]
  },
  "window": {
    "width": 900,
    "height": 600
  },
  "customThemes": []
}
```

### Copy Mode Keybindings

Enter copy mode with **Ctrl+Shift+C** (customizable in config).

| Key | Action |
|---|---|
| `h` `j` `k` `l` | Move left/down/up/right |
| `w` `W` | Next word / WORD |
| `b` `B` | Previous word / WORD |
| `0` `^` `$` | Start of line / first non-blank / end of line |
| `gg` `G` | First line / last line |
| `H` `M` `L` | Screen top / middle / bottom |
| `Ctrl+d` `Ctrl+u` | Half page down / up |
| `Ctrl+f` `Ctrl+b` | Page down / up |
| `v` `V` | Visual character / visual line mode |
| `y` | Yank selection to clipboard |
| `/` `?` | Search forward / backward |
| `n` `N` | Next / previous search result |
| `q` `Esc` | Exit copy mode |

## License

MIT
