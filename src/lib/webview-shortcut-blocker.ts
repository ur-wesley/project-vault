function isCtrlFEvent(e: KeyboardEvent): boolean {
  if (e.altKey || e.shiftKey) return false;
  if (!(e.ctrlKey || e.metaKey)) return false;
  return e.key.toLowerCase() === "f";
}

export function installWebviewShortcutBlocker(): () => void {
  const handler = (e: KeyboardEvent) => {
    if (!isCtrlFEvent(e)) return;
    if (typeof document !== "undefined" && !document.hasFocus()) return;
    e.preventDefault();
  };
  window.addEventListener("keydown", handler, { capture: true });
  return () => window.removeEventListener("keydown", handler, { capture: true });
}
