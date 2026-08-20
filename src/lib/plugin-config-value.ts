export function configDefaultToString(value: unknown): string {
  if (value === true) return "true";
  if (value === false) return "false";
  if (value == null) return "";
  return String(value);
}
