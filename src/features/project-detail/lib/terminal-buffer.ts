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

export function hasTerminalContent(sessionId: string): boolean {
  const buf = buffers.get(sessionId);
  if (!buf || buf.length === 0) {
    return false;
  }
  // Match ANSI escape sequences
  const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  for (const chunk of buf) {
    try {
      const decoded = atob(chunk);
      // Remove ANSI escape sequences
      let clean = decoded.replace(ansiRegex, "");
      // Remove control characters (\x00-\x1F, \x7F-\x9F)
      clean = clean.replace(/[\x00-\x1F\x7F-\x9F]/g, "");
      // Trim whitespace
      clean = clean.trim();
      if (clean.length > 0) {
        return true;
      }
    } catch {
      return true; // Fallback to true if decoding fails to prevent accidental cleanup of useful data
    }
  }
  return false;
}

