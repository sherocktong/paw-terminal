import { Terminal } from '@xterm/xterm';

export function captureBuffer(term: Terminal): string[] {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  const totalLines = buffer.length;

  let currentLine = '';
  for (let i = 0; i < totalLines; i++) {
    const line = buffer.getLine(i);
    if (!line) {
      // Missing line breaks any wrapped line in progress.
      if (currentLine !== '') {
        lines.push(currentLine);
        currentLine = '';
      }
      continue;
    }

    currentLine += line.translateToString(true);

    // A wrapped line continues on the next physical row, so keep accumulating
    // until we reach a non-wrapped row or the end of the buffer.
    if (!line.isWrapped) {
      lines.push(currentLine);
      currentLine = '';
    }
  }

  // Push any remaining content (e.g., buffer ending mid-wrap).
  if (currentLine !== '') {
    lines.push(currentLine);
  }

  // Trim trailing empty logical lines so the cursor starts at the last row
  // with actual content instead of unused terminal rows at the bottom.
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines;
}
