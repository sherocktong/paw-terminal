import type { Theme } from './types';

/**
 * Colors for the Windows-Terminal-style tab strip.
 *
 * The active tab must use the exact terminal background so it visually merges
 * with the terminal content below it; everything else is derived from the theme
 * so any theme (dark or light) keeps working.
 */
export interface TabColors {
  /** Tab strip background. */
  barBg: string;
  /** Active tab background (same as the terminal background). */
  activeBg: string;
  /** Inactive tab background while hovered. */
  hoverBg: string;
  /** Hairline used for the +/chevron split and menu separators. */
  divider: string;
  /** Window control glyph color (Windows title bar overlay). */
  symbolColor: string;
}

type Rgb = [number, number, number];

function parseColor(color: string): Rgb | null {
  const value = color.trim();
  const hex = value.replace(/^#/, '');

  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const [r, g, b] = hex.split('');
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }

  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }

  const rgb = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }

  return null;
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
}

/** Mix `other` into `base` by `ratio` (0 = base, 1 = other). */
export function mixHex(base: string, other: string, ratio: number): string {
  const a = parseColor(base);
  const b = parseColor(other);
  if (!a || !b) return base;

  const t = Math.max(0, Math.min(1, ratio));
  const [r, g, bl] = a.map((channel, index) => toHex(channel + (b[index] - channel) * t));
  return `#${r}${g}${bl}`;
}

/** Convert a hex color to an `rgba()` string with the given alpha. */
export function withAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color);
  if (!rgb) return color;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export function computeTabColors(theme: Theme): TabColors {
  const { background, foreground } = theme.colors;
  const isLight = theme.type === 'light';

  return {
    activeBg: background,
    // Windows Terminal uses a ~13% lighter strip in dark mode; mirror that
    // relationship instead of hard-coding grays so themes stay coherent.
    barBg: mixHex(background, foreground, isLight ? 0.1 : 0.13),
    hoverBg: mixHex(background, foreground, isLight ? 0.06 : 0.07),
    divider: withAlpha(foreground, 0.16),
    symbolColor: foreground,
  };
}