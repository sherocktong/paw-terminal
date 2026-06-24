import { Terminal } from '@xterm/xterm';

export interface BufferLine {
  text: string;
  wrapped: boolean;
}

export function captureBuffer(term: Terminal): string[] {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  const totalLines = buffer.length;

  for (let i = 0; i < totalLines; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;
    const text = line.translateToString(true);
    lines.push(text);
  }

  // Trim trailing empty lines so the cursor starts at the last row with actual
  // content instead of an unused terminal row at the bottom of the buffer.
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines;
}
