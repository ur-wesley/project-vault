const HIGHLIGHT_ATTR = "data-setting-highlight";
const HIGHLIGHT_MS = 2000;

export function jumpToSetting(id: string, maxAttempts = 24): void {
  const elementId = `setting-${id}`;
  let attempts = 0;

  const tryScroll = () => {
    const el = document.getElementById(elementId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.setAttribute(HIGHLIGHT_ATTR, "");
      window.setTimeout(() => el.removeAttribute(HIGHLIGHT_ATTR), HIGHLIGHT_MS);
      return;
    }

    attempts += 1;
    if (attempts < maxAttempts) {
      requestAnimationFrame(tryScroll);
    }
  };

  requestAnimationFrame(tryScroll);
}
