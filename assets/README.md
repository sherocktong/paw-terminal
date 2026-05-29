# Assets

Place application icons here before packaging:

- `icon.png` — 1024×1024 PNG (source icon)
- `icon.icns` — macOS icon bundle
- `icon.ico` — Windows icon

You can generate these from the PNG using:

```bash
# macOS: convert PNG to ICNS (requires iconutil or sips)
# Windows: convert PNG to ICO (requires ImageMagick or online converter)
```

The `electron-builder` config in `package.json` references these files automatically.
