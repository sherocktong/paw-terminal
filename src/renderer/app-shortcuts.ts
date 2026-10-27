import type { MenuActionId } from '../shared/types';

/**
 * Application menu shortcuts handled in the renderer.
 *
 * Why this exists (Windows/Linux): xterm.js calls `event.preventDefault()` on
 * the keydown events it handles. A key event consumed by the renderer is never
 * dispatched to the application menu, so Electron's menu accelerators
 * (CmdOrCtrl+T, CmdOrCtrl+W, ...) silently stop working — while on macOS the
 * same accelerators are consumed by the native menu bar before the page ever
 * sees them. To make the shortcuts work (and behave identically) on every
 * platform, we intercept them here in the capture phase — before xterm's
 * textarea listener — stop the event from reaching the terminal, and forward
 * the action to the main process, which runs the same code path as a menu
 * item click.
 *
 * The table mirrors the accelerators declared in src/main/menu-builder.ts.
 * `mod` matches either Ctrl or Cmd (CmdOrCtrl). Matching uses `e.key` (not
 * `e.code`) because some input paths (SendKeys, remote desktop, VMs) deliver
 * events with an empty `code`.
 */
interface ShortcutDef {
  action: MenuActionId;
  /** Normalized KeyboardEvent.key (lowercase). */
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

const SHORTCUTS: ShortcutDef[] = [
  { action: 'newTab', key: 't', mod: true, shift: false, alt: false },
  { action: 'closeTab', key: 'w', mod: true, shift: false, alt: false },
  { action: 'newWindow', key: 'n', mod: true, shift: false, alt: false },
  { action: 'showShortcuts', key: '/', mod: true, shift: false, alt: false },
  { action: 'prevTab', key: '[', mod: true, shift: true, alt: false },
  { action: 'nextTab', key: ']', mod: true, shift: true, alt: false },
  { action: 'zoomWindow', key: 'z', mod: true, shift: false, alt: true },
];

/** Undo the shift-modification of symbol keys so Shift+[ matches as '['. */
function unshiftSymbol(key: string): string {
  switch (key) {
    case '{':
      return '[';
    case '}':
      return ']';
    case '?':
      return '/';
    default:
      return key;
  }
}

function matchShortcut(e: KeyboardEvent): MenuActionId | null {
  const mod = e.ctrlKey || e.metaKey;
  const key = unshiftSymbol(e.key).toLowerCase();
  for (const s of SHORTCUTS) {
    if (s.key === key && s.mod === mod && s.shift === e.shiftKey && s.alt === e.altKey) {
      return s.action;
    }
  }
  return null;
}

/**
 * Installs a capture-phase keydown listener that intercepts the application
 * shortcuts before xterm.js can consume them. Must be called before the
 * terminal is created.
 */
export function installAppShortcutHandler(): void {
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.repeat) return;
      const action = matchShortcut(e);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      void window.puppy.menu.perform(action);
    },
    true, // capture: run before xterm's textarea keydown listener
  );
}
