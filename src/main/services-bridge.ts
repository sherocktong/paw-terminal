// Bridge between paw-terminal and the macOS Services system.
//
// macOS dispatches Services keyboard shortcuts above the front app, gated by
// responder-chain validation (validRequestorForSendType:returnType:).
// Chromium overrides that validation and never accepts no-input services
// (nil send/return types), so Services shortcuts never fire in Electron apps
// and the key event arrives as an ordinary keydown — there is nothing left
// to "pass through" at that point.
//
// This module mirrors the user's Services shortcut bindings from macOS's own
// registry (pbs NSServicesStatus) so the renderer can recognize them, and
// executes the matched service through NSPerformService (via the bundled
// PawServiceRunner helper) — the same entry point AppKit uses for a Services
// menu click. paw's own hotkeys take precedence; only unclaimed keys reach
// the services matcher.

import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { IPC_CHANNELS } from '../shared/constants';
import type { ServiceAccelerator } from '../shared/types';

const F_KEY_BASE = 0xf704; // NSF1FunctionKey; F-keys are consecutive
const FUNCTION_KEY_NAMES: Record<number, string> = {
  0xf700: 'Up',
  0xf701: 'Down',
  0xf702: 'Left',
  0xf703: 'Right',
};

let debounceTimer: NodeJS.Timeout | null = null;
let lastRegistryJson = '';
let warnedMissingHelper = false;

function getHelperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'PawServiceRunner')
    : path.join(app.getAppPath(), 'assets', 'bin', 'PawServiceRunner');
}

// Decode an NSUserKeyEquivalents-style string ("~\\Uf708" -> Option+F5)
// into a normalized accelerator. Returns null for unsupported encodings.
function decodeKeyEquivalent(equivalent: string): Omit<ServiceAccelerator, 'name'> | null {
  let cmd = false;
  let opt = false;
  let ctrl = false;
  let shift = false;
  let i = 0;
  while (i < equivalent.length) {
    const ch = equivalent[i];
    if (ch === '@') cmd = true;
    else if (ch === '~') opt = true;
    else if (ch === '^') ctrl = true;
    else if (ch === '$') shift = true;
    else break;
    i++;
  }
  const token = equivalent.slice(i);
  if (!token) return null;

  let key: string | null = null;
  // plutil -convert json turns function-key characters into \uXXXX escapes,
  // so by the time we see the string it may contain the literal U+F700-range
  // character instead of AppKit's textual "\Uxxxx" escape. Accept both forms.
  const unicodeMatch = token.match(/^\\U([0-9a-fA-F]{4,8})$/);
  const octalMatch = token.match(/^\\([0-7]{3})$/);
  if (unicodeMatch) {
    const code = parseInt(unicodeMatch[1], 16);
    if (code >= F_KEY_BASE && code <= F_KEY_BASE + 23) {
      key = `F${code - F_KEY_BASE + 1}`;
    } else if (FUNCTION_KEY_NAMES[code]) {
      key = FUNCTION_KEY_NAMES[code];
    } else if (code === 0x001b) {
      key = 'Escape';
    } else {
      return null;
    }
  } else if (octalMatch) {
    const code = parseInt(octalMatch[1], 8);
    if (code === 0x1b) {
      key = 'Escape';
    } else {
      return null;
    }
  } else if (token.length === 1) {
    const code = token.charCodeAt(0);
    if (code >= F_KEY_BASE && code <= F_KEY_BASE + 23) {
      key = `F${code - F_KEY_BASE + 1}`;
    } else if (FUNCTION_KEY_NAMES[code]) {
      key = FUNCTION_KEY_NAMES[code];
    } else if (code === 0x001b) {
      key = 'Escape';
    } else if (token >= 'A' && token <= 'Z' && !shift) {
      // Uppercase letters encode implied Shift.
      shift = true;
      key = token.toLowerCase();
    } else {
      key = token;
    }
  } else {
    return null;
  }

  return { key, cmd, opt, ctrl, shift };
}

// macOS stores per-service shortcut bindings in the pbs (pasteboard server)
// domain under NSServicesStatus. Keys look like
// "(null) - mute-microphone - runWorkflowAsService"; the middle segment is
// the service name NSPerformService expects.
function readServiceAccelerators(): ServiceAccelerator[] {
  if (process.platform !== 'darwin') return [];

  const exported = spawnSync('sh', [
    '-c',
    'defaults export pbs - | plutil -convert json -o - -',
  ]);
  if (exported.status !== 0) {
    console.error('services-bridge: failed to read pbs defaults:', exported.stderr.toString());
    return [];
  }

  let parsed: { NSServicesStatus?: Record<string, Record<string, unknown> & { key_equivalent?: string }> };
  try {
    parsed = JSON.parse(exported.stdout.toString());
  } catch (err) {
    console.error('services-bridge: failed to parse pbs plist:', err);
    return [];
  }

  const entries: ServiceAccelerator[] = [];
  const status = parsed.NSServicesStatus ?? {};
  for (const [entryKey, value] of Object.entries(status)) {
    if (value.enabled === false || value.enabled === 0) continue;
    const equivalent = value.key_equivalent;
    if (typeof equivalent !== 'string' || !equivalent) continue;

    const segments = entryKey.split(' - ');
    if (segments.length < 3) continue;
    const name = segments.slice(1, -1).join(' - ');

    const decoded = decodeKeyEquivalent(equivalent);
    if (!decoded) continue;
    entries.push({ name, ...decoded });
  }
  return entries;
}

function broadcastRegistry(): void {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length === 0) return; // nothing can receive yet
  const entries = readServiceAccelerators();
  const json = JSON.stringify(entries);
  if (json === lastRegistryJson) return; // nothing changed
  lastRegistryJson = json;
  for (const win of wins) {
    win.webContents.send(IPC_CHANNELS.SERVICES_REGISTRY, entries);
  }
}

function performService(name: string, selection?: string): void {
  const helperPath = getHelperPath();
  if (!fs.existsSync(helperPath)) {
    if (!warnedMissingHelper) {
      warnedMissingHelper = true;
      console.error(`services-bridge: helper not found at ${helperPath} (run: npm run build:helper)`);
    }
    return;
  }

  const child = spawn(helperPath, [name], {
    stdio: ['pipe', 'ignore', 'ignore'],
    detached: true,
  });
  child.unref();
  if (selection) {
    child.stdin.write(selection);
  }
  child.stdin.end();
  child.on('error', (err) => {
    console.error(`services-bridge: failed to run service "${name}":`, err);
  });
}

export function initServicesBridge(): void {
  if (process.platform !== 'darwin') return;

  ipcMain.on(
    IPC_CHANNELS.SERVICES_PERFORM,
    (_event, name: string, selection?: string) => {
      if (typeof name === 'string' && name) {
        performService(name, typeof selection === 'string' ? selection : undefined);
      }
    },
  );

  // Re-read when paw becomes active so newly bound shortcuts are picked up
  // without restarting.
  app.on('browser-window-focus', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(broadcastRegistry, 300);
  });

  // The initial broadcast in initServicesBridge() can run before any window
  // exists; deliver the registry to each window once its page has loaded.
  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', () => broadcastRegistry());
  });

  broadcastRegistry();
}
