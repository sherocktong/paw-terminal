import { createRequire } from 'module';

const require = createRequire(import.meta.url);

try {
  require('node-pty');
  process.exit(0);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
