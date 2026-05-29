import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { Config } from '../../shared/types';

export function initializeTerminal(container: HTMLElement, config: Config): Terminal {
  const term = new Terminal({
    fontFamily: config.font.family,
    fontSize: config.font.size,
    lineHeight: config.font.lineHeight,
    cursorStyle: config.cursorStyle,
    cursorBlink: config.cursorBlink,
    scrollback: config.scrollback,
    allowProposedApi: true,
  });

  term.open(container);
  return term;
}

export function attachToPty(term: Terminal, id: string, fitAddon: FitAddon): void {
  // Receive data from pty
  const unsubscribe = window.puppy.shell.onData(({ id: dataId, data }) => {
    if (dataId === id) {
      term.write(data);
    }
  });

  // Send data to pty
  term.onData((data) => {
    window.puppy.shell.write(id, data);
  });

  // Handle resize
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    const dims = fitAddon.proposeDimensions();
    if (dims) {
      resizeTerminal(term, id, dims.cols, dims.rows);
    }
  });

  if (term.element) {
    resizeObserver.observe(term.element);
  }
}

export function resizeTerminal(term: Terminal, id: string, cols: number, rows: number): void {
  term.resize(cols, rows);
  window.puppy.shell.resize(id, cols, rows);
}
