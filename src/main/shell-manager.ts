import * as pty from 'node-pty';
import os from 'os';
import fs from 'fs';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ShellInfo {
  shell: string;
  args: string[];
}

export function getDefaultShell(): string {
  const platform = os.platform();
  if (platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/zsh';
}

export function getShellArgs(shell?: string): string[] {
  const s = shell || getDefaultShell();
  if (s.includes('zsh') || s.includes('bash')) {
    return ['-l'];
  }
  if (s.includes('fish')) {
    return ['-l'];
  }
  return [];
}

function getUserEnv(): Record<string, string> | undefined {
  if (os.platform() !== 'darwin') return undefined;
  try {
    const shell = findValidShell();
    const envOutput = execSync(`${shell} -l -c 'env'`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    const env: Record<string, string> = {};
    for (const line of envOutput.trim().split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        env[line.slice(0, idx)] = line.slice(idx + 1);
      }
    }
    return env;
  } catch {
    return undefined;
  }
}

// Common interactive terminal/console applications that should not trigger
// the running-script spinner.
const INTERACTIVE_CONSOLE_NAMES = new Set([
  'claude',
  'vim', 'nvim', 'vi', 'view',
  'emacs', 'nano', 'pico', 'micro',
  'htop', 'top', 'btop', 'gotop', 'ytop', 'atop',
  'ranger', 'nnn', 'lf', 'vifm', 'xplr', 'joshuto',
  'lazygit', 'gitui', 'tig',
  'fzf', 'peco', 'sk',
  'tmux', 'screen',
  'irssi', 'weechat',
  'cmus', 'ncmpcpp', 'musikcube',
  'lazydocker',
]);

async function getProcessChildren(pid: number): Promise<number[]> {
  try {
    const { stdout } = await execAsync(`pgrep -P ${pid} 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 1000,
    });
    return stdout
      .trim()
      .split('\n')
      .map((line) => parseInt(line.trim(), 10))
      .filter((n) => !isNaN(n));
  } catch {
    // pgrep exits with code 1 when no children exist
  }
  return [];
}

async function collectDescendantPids(pid: number): Promise<number[]> {
  const children = await getProcessChildren(pid);
  const result: number[] = [];
  for (const childPid of children) {
    result.push(childPid);
    const descendants = await collectDescendantPids(childPid);
    result.push(...descendants);
  }
  return result;
}

async function getProcessNames(pids: number[]): Promise<string[]> {
  if (pids.length === 0) return [];
  try {
    const platform = os.platform();
    if (platform === 'darwin' || platform === 'linux') {
      const { stdout } = await execAsync(
        `ps -o comm= -p ${pids.join(',')}`,
        { encoding: 'utf-8', timeout: 1000 }
      );
      return stdout
        .trim()
        .split('\n')
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => name.replace(/\.exe$/i, ''));
    } else if (platform === 'win32') {
      const { stdout } = await execAsync(
        `powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ${pids.map((p) => `$_.ProcessId -eq ${p}`).join(' -or ')} } | Select-Object Name"`,
        { encoding: 'utf-8', timeout: 1000 }
      );
      return stdout
        .trim()
        .split('\n')
        .map((name) => name.replace(/\.exe$/i, '').trim())
        .filter(Boolean);
    }
  } catch {
    // Ignore errors (process may have exited)
  }
  return [];
}

export async function hasRunningScript(pid: number): Promise<boolean> {
  const descendants = await collectDescendantPids(pid);
  if (descendants.length === 0) return false;

  const names = await getProcessNames(descendants);
  // If any descendant is an interactive console/TUI app, do not show the spinner.
  if (names.some((name) => INTERACTIVE_CONSOLE_NAMES.has(name.toLowerCase()))) {
    return false;
  }
  return true;
}

export async function getShellCwd(pid: number): Promise<string | undefined> {
  try {
    const platform = os.platform();
    if (platform === 'darwin') {
      const { stdout } = await execAsync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | tail -1`, {
        encoding: 'utf-8',
        timeout: 1000,
      });
      const line = stdout.trim();
      if (line.startsWith('n')) {
        return line.slice(1);
      }
    } else if (platform === 'linux') {
      const fs = require('fs');
      return fs.readlinkSync(`/proc/${pid}/cwd`);
    } else if (platform === 'win32') {
      // Windows: use PowerShell to get the process's current directory
      const { stdout } = await execAsync(
        `powershell.exe -NoProfile -Command "(Get-Process -Id ${pid}).Path"`,
        { encoding: 'utf-8', timeout: 1000 }
      );
      return stdout.trim() || undefined;
    }
  } catch {
    // Ignore errors (process may have exited)
  }
  return undefined;
}

function findValidShell(): string {
  const candidates = [
    getDefaultShell(),
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ];
  for (const path of candidates) {
    if (fs.existsSync(path)) return path;
  }
  throw new Error('No valid shell found. Tried: ' + candidates.join(', '));
}

export function spawnShell(
  shell?: string,
  shellArgs?: string[],
  cwd?: string,
  cols = 80,
  rows = 30
): pty.IPty {
  let shellPath = shell || getDefaultShell();
  if (!fs.existsSync(shellPath)) {
    console.warn(`Configured shell "${shellPath}" not found, falling back to default.`);
    shellPath = findValidShell();
  }
  const args = shellArgs ?? getShellArgs(shellPath);

  // On macOS, GUI apps inherit a minimal environment from launchd.
  // Fetch the user's real environment from their login shell.
  const userEnv = os.platform() === 'darwin' ? getUserEnv() : undefined;
  const env = { ...(userEnv ?? process.env) } as { [key: string]: string };

  // Ensure proper locale on Unix systems
  if (os.platform() !== 'win32') {
    env.LANG = env.LANG || 'en_US.UTF-8';
    env.TERM = 'xterm-256color';
  }

  // On macOS, getUserEnv() captures PWD from a fresh login shell (usually the
  // home directory). The shell trusts the PWD env var over its actual working
  // directory, so tools reading $PWD (e.g. mvim --remote) get the wrong path.
  let resolvedCwd = cwd || os.homedir();
  if (!fs.existsSync(resolvedCwd)) {
    console.warn(`CWD "${resolvedCwd}" does not exist, falling back to home directory.`);
    resolvedCwd = os.homedir();
  }
  env.PWD = resolvedCwd;
  delete env.OLDPWD;

  return pty.spawn(shellPath, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: resolvedCwd,
    env,
  });
}
