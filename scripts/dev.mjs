import { createServer } from 'vite';
import { spawn } from 'child_process';

const server = await createServer({
  configFile: 'vite.renderer.config.ts',
});

await server.listen();

const url = `http://localhost:${server.config.server.port}`;

const electron = spawn('npx', ['electron', '.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

electron.on('close', (code) => {
  server.close();
  process.exit(code ?? 0);
});
