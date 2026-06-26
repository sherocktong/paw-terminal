// electron-builder afterPack hook.
//
// node-pty execs a `spawn-helper` binary by path on macOS to fork the shell.
// npm extracts node-pty's prebuilt binaries as mode 644, and electron-builder
// preserves that mode when copying them into app.asar.unpacked — so the shipped
// helper is not executable and posix_spawnp fails ("Failed to start shell").
// Restore +x on the unpacked helper after each pack.
//
// Additionally, keep only the node-pty prebuild that matches the target macOS
// architecture. electron-builder copies every prebuild directory into every arch
// package, so an arm64 app would include Intel-only binaries and vice versa.
// macOS shows a "Support Ending for Intel-based Apps" warning when it scans
// those Intel binaries inside an Apple Silicon app, so we remove the mismatched
// prebuild folder before the DMG is created.
//
// We also copy the matching prebuild into build/Release so node-pty's first
// load path contains the right architecture.
const { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } = require('fs');
const { join } = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const { Arch } = require('electron-builder');
  const targetArchName = context.arch === Arch.x64 ? 'x64' : 'arm64';
  const keepArchDir = `darwin-${targetArchName}`;

  const appName = context.packager.appInfo.productFilename;
  const nodePtyRoot = join(
    context.appOutDir,
    `${appName}.app`,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    'node-pty'
  );

  if (!existsSync(nodePtyRoot)) {
    return;
  }

  const prebuilds = join(nodePtyRoot, 'prebuilds');

  for (const arch of ['darwin-arm64', 'darwin-x64']) {
    const helper = join(prebuilds, arch, 'spawn-helper');
    if (existsSync(helper)) {
      chmodSync(helper, 0o755);
      console.log(`afterPack: fixed spawn-helper permissions (${arch})`);
    }

    if (arch !== keepArchDir) {
      const prebuildDir = join(prebuilds, arch);
      if (existsSync(prebuildDir)) {
        rmSync(prebuildDir, { recursive: true, force: true });
        console.log(`afterPack: removed mismatched prebuild (${arch})`);
      }
    }
  }

  // Replace build/Release binaries with the matching prebuild so node-pty's
  // primary load path uses the correct architecture.
  const buildRelease = join(nodePtyRoot, 'build', 'Release');
  const matchedPrebuild = join(prebuilds, keepArchDir);
  if (existsSync(buildRelease) && existsSync(matchedPrebuild)) {
    for (const file of ['pty.node', 'spawn-helper']) {
      const src = join(matchedPrebuild, file);
      const dest = join(buildRelease, file);
      if (existsSync(src) && existsSync(dest)) {
        copyFileSync(src, dest);
        chmodSync(dest, file === 'spawn-helper' ? 0o755 : 0o644);
        console.log(`afterPack: copied ${file} to build/Release (${keepArchDir})`);
      }
    }
  }
};
