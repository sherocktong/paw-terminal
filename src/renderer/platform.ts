/**
 * Platform detection for the renderer.
 *
 * The Windows Terminal style tab strip is a Windows-only look: macOS already
 * has its own chrome (traffic lights, flat tab bar) and must stay untouched.
 */
const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
const platform = (uaData?.platform ?? navigator.platform ?? '').toLowerCase();

export const isWindowsPlatform = platform.includes('win');
export const isMacPlatform = platform.includes('mac');