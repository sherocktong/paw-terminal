import { spawn } from 'child_process';

const electron = spawn('npx', ['electron', 'scripts/verify-native.mjs'], {
  stdio: 'inherit',
});

electron.on('close', (code) => {
  if (code !== 0) {
    console.error('');
    console.error('ERROR: node-pty native module is not built for the current Electron version.');
    console.error('Run: npm run postinstall');
    console.error('Then retry packaging.');
  }
  process.exit(code ?? 1);
});
