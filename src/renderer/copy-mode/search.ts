import type { CopyModePosition } from '../../shared/types';

export interface SearchMatch extends CopyModePosition {
  length: number;
}

export interface SearchResult {
  positions: SearchMatch[];
  currentIndex: number;
}

/**
 * Search a line buffer for a regex pattern.
 *
 * Supports Vim-style \c (ignore case) and \C (match case) flags anywhere in the
 * pattern. The default is case-sensitive to match Vim's default behavior.
 *
 * The pattern is compiled as a JavaScript regular expression (Vim's "very
 * magic" mode) so metacharacters such as . * + ^ $ work without escaping.
 * Invalid patterns fall back to a literal search.
 */
export function searchBuffer(
  lines: string[],
  pattern: string,
  direction: 'forward' | 'backward' = 'forward',
  startPos?: CopyModePosition
): SearchResult {
  if (!pattern) {
    return { positions: [], currentIndex: -1 };
  }

  // Parse Vim-style \c (ignore case) and \C (match case) flags.
  let ignoreCase: boolean | undefined;
  const cleanPattern = pattern.replace(/\\[cC]/g, (flag) => {
    if (flag === '\\c') ignoreCase = true;
    else if (flag === '\\C') ignoreCase = false;
    return '';
  });

  if (cleanPattern === '') {
    return { positions: [], currentIndex: -1 };
  }

  // Default to case-sensitive (Vim default). Note that `ignoreCase` is only
  // set when an explicit flag is present.
  const flags = ignoreCase === false ? 'g' : ignoreCase === true ? 'gi' : 'g';

  let regex: RegExp;
  try {
    regex = new RegExp(cleanPattern, flags);
  } catch {
    // Invalid regex: fall back to literal search.
    try {
      regex = new RegExp(
        cleanPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        flags.includes('i') ? 'gi' : 'g'
      );
    } catch {
      return { positions: [], currentIndex: -1 };
    }
  }

  const positions: SearchMatch[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    // Reset regex for each line by creating a new RegExp with the same source.
    const lineRegex = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;
    while ((match = lineRegex.exec(line)) !== null) {
      positions.push({
        line: lineIdx,
        col: match.index,
        length: match[0].length,
      });
      // Avoid infinite loop on zero-length matches.
      if (match[0].length === 0) {
        lineRegex.lastIndex = match.index + 1;
      }
    }
  }

  let currentIndex = -1;
  if (startPos && positions.length > 0) {
    if (direction === 'forward') {
      // Vim searches forward from the cursor, skipping a match at the cursor.
      currentIndex = positions.findIndex(
        (p) => p.line > startPos.line || (p.line === startPos.line && p.col > startPos.col)
      );
      if (currentIndex === -1) currentIndex = 0;
    } else {
      for (let i = positions.length - 1; i >= 0; i--) {
        if (
          positions[i].line < startPos.line ||
          (positions[i].line === startPos.line && positions[i].col < startPos.col)
        ) {
          currentIndex = i;
          break;
        }
      }
      if (currentIndex === -1) currentIndex = positions.length - 1;
    }
  } else if (positions.length > 0) {
    currentIndex = direction === 'forward' ? 0 : positions.length - 1;
  }

  return { positions, currentIndex };
}
