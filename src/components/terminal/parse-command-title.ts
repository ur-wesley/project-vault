const PROMPT_TERMINATORS = ["$ ", "# ", "> ", "% ", "❯ ", "➜ "];
const EMPTY_PROMPT_ENDINGS = ["$", "#", ">", "%", "❯", "➜"];

const TRAILING_DATETIME =
  /(?:^|\s+)(?:\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?|\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?|\d{2}\.\d{2}\.\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s*$/i;

export function parseCommandFromLine(text: string): string | null {
  let line = text.trim();
  if (!line) return null;

  let matched = false;
  for (const terminator of PROMPT_TERMINATORS) {
    const idx = line.lastIndexOf(terminator);
    if (idx !== -1) {
      line = line.slice(idx + terminator.length);
      matched = true;
      break;
    }
  }

  if (!matched) return null;

  line = line.trim().replace(TRAILING_DATETIME, "").trim();
  return line || null;
}

export function isEmptyShellPrompt(text: string): boolean {
  const trimmed = text.trim().replace(TRAILING_DATETIME, "").trim();
  if (!trimmed) return false;
  if (parseCommandFromLine(text) !== null) return false;
  return EMPTY_PROMPT_ENDINGS.some((ending) => trimmed.endsWith(ending));
}

export function formatCommandTitle(cmd: string, maxLen = 30): string {
  if (cmd.length <= maxLen) return cmd;
  return `${cmd.slice(0, maxLen)}…`;
}

/**
 * Resolves the next tab command title when Enter is pressed on `lineText`:
 * - Non-empty string: a command was entered at a shell prompt.
 * - `""`: Enter was pressed on an empty shell prompt (reset to default shell name).
 * - `null`: `lineText` is not a shell prompt (e.g. an interactive CLI prompt like `bumpp`),
 *   so the existing tab title must be preserved.
 */
export function resolveEnteredCommandTitle(lineText: string, maxLen = 30): string | null {
  const command = parseCommandFromLine(lineText);
  if (command) return formatCommandTitle(command, maxLen);
  if (isEmptyShellPrompt(lineText)) return "";
  return null;
}
