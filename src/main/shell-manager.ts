import * as pty from 'node-pty';
import os from 'os';
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
    const shell = getDefaultShell();
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

export function spawnShell(
  shell?: string,
  shellArgs?: string[],
  cwd?: string,
  cols = 80,
  rows = 30
): pty.IPty {
  const shellPath = shell || getDefaultShell();
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
  const resolvedCwd = cwd || os.homedir();
  env.PWD = resolvedCwd;
  delete env.OLDPWD;

  return pty.spawn(shellPath, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: cwd || os.homedir(),
    env,
  });
}
