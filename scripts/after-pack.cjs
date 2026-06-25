// electron-builder afterPack hook.
//
// node-pty execs a `spawn-helper` binary by path on macOS to fork the shell.
// npm extracts node-pty's prebuilt binaries as mode 644, and electron-builder
// preserves that mode when copying them into app.asar.unpacked — so the shipped
// helper is not executable and posix_spawnp fails ("Failed to start shell").
// Restore +x on the unpacked helper after each pack.
const { chmodSync, existsSync } = require('fs');
const { join } = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const unpacked = join(
    context.appOutDir,
    `${appName}.app`,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'prebuilds'
  );

  for (const arch of ['darwin-arm64', 'darwin-x64']) {
    const helper = join(unpacked, arch, 'spawn-helper');
    if (existsSync(helper)) {
      chmodSync(helper, 0o755);
      console.log(`afterPack: fixed spawn-helper permissions (${arch})`);
    }
  }
};
