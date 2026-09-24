export function isEditableElement(element: EventTarget | Element | null): boolean {
  if (element == null || typeof element !== "object") return false;
  const el = element as Partial<HTMLElement>;
  if (el.isContentEditable) return true;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (typeof el.closest === "function") {
    return Boolean(el.closest('[contenteditable="true"]'));
  }
  return false;
}

export function shouldOpenTerminalOnKeyDown(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "isComposing" | "target">,
  instancesCount: number,
  options?: {
    activeElement?: EventTarget | Element | null;
    isModalOpen?: boolean;
  },
): boolean {
  if (instancesCount > 0) return false;
  if (e.isComposing) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key.toLowerCase() !== "n") return false;

  if (isEditableElement(e.target)) return false;

  let activeEl: EventTarget | Element | null = null;
  if (options?.activeElement !== undefined) {
    activeEl = options.activeElement;
  } else if (typeof document !== "undefined") {
    activeEl = document.activeElement;
  }

  if (isEditableElement(activeEl)) return false;

  let modalOpen = false;
  if (options?.isModalOpen !== undefined) {
    modalOpen = options.isModalOpen;
  } else if (typeof document !== "undefined") {
    modalOpen = Boolean(
      document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]'),
    );
  }

  if (modalOpen) return false;

  return true;
}
