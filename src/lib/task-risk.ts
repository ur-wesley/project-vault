export function argvNeedsUserConfirmation(argv: string[]): boolean {
  const j = argv.join(" ").toLowerCase();
  return (
    j.includes("rm -rf") ||
    j.includes("rmdir /s") ||
    j.includes("format ") ||
    (j.includes("curl ") && j.includes("| sh")) ||
    j.includes("invoke-expression") ||
    j.includes("iex ")
  );
}
