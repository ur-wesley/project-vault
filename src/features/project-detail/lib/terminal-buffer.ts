// Global in-memory terminal output buffer keyed by sessionId.
// Each entry stores the last MAX_LINES base64-encoded chunks so that
// TerminalHost can replay missed output after remounting.

const MAX_LINES = 5000;

const buffers = new Map<string, string[]>();

export function appendTerminalChunk(sessionId: string, chunk: string): void {
  let buf = buffers.get(sessionId);
  if (!buf) {
    buf = [];
    buffers.set(sessionId, buf);
  }
  buf.push(chunk);
  if (buf.length > MAX_LINES) {
    buf.shift();
  }
}

export function getTerminalReplay(sessionId: string): readonly string[] {
  return buffers.get(sessionId) ?? [];
}

export function clearTerminalBuffer(sessionId: string): void {
  buffers.delete(sessionId);
}
