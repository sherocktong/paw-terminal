// Build the PawServiceRunner helper (macOS only; no-op elsewhere so the
// Windows/Linux builds are unaffected).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform !== 'darwin') {
  console.log('PawServiceRunner: skipping (non-Darwin host)');
  process.exit(0);
}

const outDir = join(root, 'assets', 'bin');
mkdirSync(outDir, { recursive: true });

const result = spawnSync(
  'swiftc',
  ['-O', join(root, 'scripts', 'service-runner', 'main.swift'), '-o', join(outDir, 'PawServiceRunner')],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error('PawServiceRunner: swiftc failed to run:', result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
console.log(`Built ${join(outDir, 'PawServiceRunner')}`);
