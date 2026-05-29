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

  return lines;
}
