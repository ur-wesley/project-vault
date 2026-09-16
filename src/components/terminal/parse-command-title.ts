const PROMPT_TERMINATORS = ["$ ", "# ", "> ", "% "];

const TRAILING_DATETIME =
  /\s+(?:\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?|\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?)\s*$/i;

export function parseCommandFromLine(text: string): string | null {
  let line = text.trim();
  if (!line) return null;

  for (const terminator of PROMPT_TERMINATORS) {
    const idx = line.lastIndexOf(terminator);
    if (idx !== -1) {
      line = line.slice(idx + terminator.length);
      break;
    }
  }

  line = line.trim().replace(TRAILING_DATETIME, "").trim();
  return line || null;
}

export function formatCommandTitle(cmd: string, maxLen = 30): string {
  if (cmd.length <= maxLen) return cmd;
  return `${cmd.slice(0, maxLen)}…`;
}
