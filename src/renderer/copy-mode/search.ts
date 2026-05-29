import type { CopyModePosition } from '../../shared/types';

export interface SearchResult {
  positions: CopyModePosition[];
  currentIndex: number;
}

export function searchBuffer(
  lines: string[],
  pattern: string,
  direction: 'forward' | 'backward' = 'forward',
  startPos?: CopyModePosition
): SearchResult {
  if (!pattern) {
    return { positions: [], currentIndex: -1 };
  }

  // Parse Vim-style \c (ignore case) and \C (match case) flags
  let flags = 'g';
  if (pattern.includes('\\c')) {
    flags += 'i';
  } else if (pattern.includes('\\C')) {
    // case-sensitive: no 'i' flag
  } else {
    // Default: case-insensitive to preserve existing behavior
    flags += 'i';
  }

  const cleanPattern = pattern.replace(/\\[cC]/g, '');

  const positions: CopyModePosition[] = [];
  const regex = new RegExp(cleanPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let match: RegExpExecArray | null;
    // Reset regex for each line
    const lineRegex = new RegExp(regex.source, regex.flags);
    while ((match = lineRegex.exec(line)) !== null) {
      positions.push({ line: lineIdx, col: match.index });
    }
  }

  let currentIndex = -1;
  if (startPos && positions.length > 0) {
    if (direction === 'forward') {
      currentIndex = positions.findIndex(
        (p) => p.line > startPos.line || (p.line === startPos.line && p.col > startPos.col)
      );
      if (currentIndex === -1) currentIndex = 0;
    } else {
      for (let i = positions.length - 1; i >= 0; i--) {
        if (positions[i].line < startPos.line || (positions[i].line === startPos.line && positions[i].col < startPos.col)) {
          currentIndex = i;
          break;
        }
      }
      if (currentIndex === -1) currentIndex = positions.length - 1;
    }
  } else if (positions.length > 0) {
    currentIndex = 0;
  }

  return { positions, currentIndex };
}
