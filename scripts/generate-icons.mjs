#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const assetsDir = path.join(root, 'assets');
const svgPath = path.join(assetsDir, 'icon.svg');

async function generate() {
  if (!fs.existsSync(svgPath)) {
    console.error('SVG not found:', svgPath);
    process.exit(1);
  }

  // Generate high-res PNG source
  const png1024 = path.join(assetsDir, 'icon.png');
  await sharp(svgPath)
    .resize(1024, 1024)
    .png()
    .toFile(png1024);
  console.log('Generated', png1024);

  // Generate macOS .icns via iconset
  const iconsetDir = path.join(assetsDir, 'icon.iconset');
  if (!fs.existsSync(iconsetDir)) {
    fs.mkdirSync(iconsetDir, { recursive: true });
  }

  const sizes = [16, 32, 64, 128, 256, 512];
  for (const size of sizes) {
    const out = path.join(iconsetDir, `icon_${size}x${size}.png`);
    await sharp(svgPath).resize(size, size).png().toFile(out);
    console.log('Generated', out);

    // Retina (@2x)
    const out2x = path.join(iconsetDir, `icon_${size}x${size}@2x.png`);
    await sharp(svgPath).resize(size * 2, size * 2).png().toFile(out2x);
    console.log('Generated', out2x);
  }

  const icnsPath = path.join(assetsDir, 'icon.icns');
  try {
    execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`);
    console.log('Generated', icnsPath);
  } catch (err) {
    console.error('Failed to generate .icns (iconutil not available?):', err.message);
  }

  // Generate Windows .ico
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoPngs = [];
  for (const size of icoSizes) {
    const out = path.join(iconsetDir, `icon_${size}.png`);
    await sharp(svgPath).resize(size, size).png().toFile(out);
    icoPngs.push(out);
  }

  const icoPath = path.join(assetsDir, 'icon.ico');
  try {
    const buf = await pngToIco(icoPngs);
    fs.writeFileSync(icoPath, buf);
    console.log('Generated', icoPath);
  } catch (err) {
    console.error('Failed to generate .ico:', err.message);
  }

  // Clean up iconset dir
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  console.log('Cleaned up iconset directory');
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
