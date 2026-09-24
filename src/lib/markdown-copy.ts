/**
 * Shared copy-button handler for rendered markdown (`pre > .markdown-copy-btn`).
 * Attach once per container: `el.addEventListener("click", onMarkdownCopyClick)`.
 * Returns true when the click was on a copy button (handled or attempted).
 */
export async function onMarkdownCopyClick(event: MouseEvent): Promise<boolean> {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const btn = target.closest(".markdown-copy-btn");
  if (!(btn instanceof HTMLButtonElement)) return false;

  const pre = btn.closest("pre");
  const code = pre?.querySelector("code");
  // textContent (not innerText): layout-free and excludes nothing — the button
  // itself holds no text, so no "Copy"-suffix trimming is needed.
  const text = code?.textContent ?? pre?.textContent ?? "";
  if (!text) return true;

  try {
    await navigator.clipboard.writeText(text);
    const icon = btn.querySelector(".iconify");
    if (icon) {
      const oldClass = icon.getAttribute("class") ?? "";
      icon.setAttribute("class", "iconify mdi--check text-green-500 h-3.5 w-3.5");
      setTimeout(() => {
        icon.setAttribute("class", oldClass);
      }, 2000);
    }
  } catch (err) {
    console.error("Failed to copy text: ", err);
  }
  return true;
}
