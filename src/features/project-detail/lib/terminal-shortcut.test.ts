import { describe, expect, it } from "vitest";

import { isEditableElement, shouldOpenTerminalOnKeyDown } from "./terminal-shortcut";

describe("isEditableElement", () => {
  it("returns false for null or undefined", () => {
    expect(isEditableElement(null)).toBe(false);
    expect(isEditableElement(undefined as any)).toBe(false);
  });

  it("returns false for non-editable elements like div, span, button", () => {
    expect(isEditableElement({ tagName: "DIV" } as any)).toBe(false);
    expect(isEditableElement({ tagName: "SPAN" } as any)).toBe(false);
    expect(isEditableElement({ tagName: "BUTTON" } as any)).toBe(false);
  });

  it("returns true for input, textarea, and select elements", () => {
    expect(isEditableElement({ tagName: "INPUT" } as any)).toBe(true);
    expect(isEditableElement({ tagName: "input" } as any)).toBe(true);
    expect(isEditableElement({ tagName: "TEXTAREA" } as any)).toBe(true);
    expect(isEditableElement({ tagName: "SELECT" } as any)).toBe(true);
  });

  it("returns true for contenteditable elements", () => {
    expect(isEditableElement({ isContentEditable: true } as any)).toBe(true);
  });

  it("returns true for elements within contenteditable parent", () => {
    const mockChild = {
      tagName: "SPAN",
      closest: (sel: string) => (sel === '[contenteditable="true"]' ? {} : null),
    };
    expect(isEditableElement(mockChild as any)).toBe(true);
  });
});

describe("shouldOpenTerminalOnKeyDown", () => {
  const baseEvent = {
    key: "n",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    target: null,
  };

  it("returns true when pressing 'n' with 0 instances", () => {
    expect(shouldOpenTerminalOnKeyDown(baseEvent, 0)).toBe(true);
  });

  it("returns true when pressing 'N' (uppercase/Shift) with 0 instances", () => {
    expect(shouldOpenTerminalOnKeyDown({ ...baseEvent, key: "N" }, 0)).toBe(true);
  });

  it("returns false when there is already an open terminal", () => {
    expect(shouldOpenTerminalOnKeyDown(baseEvent, 1)).toBe(false);
    expect(shouldOpenTerminalOnKeyDown(baseEvent, 2)).toBe(false);
  });

  it("returns false when Ctrl, Meta, or Alt is pressed", () => {
    expect(shouldOpenTerminalOnKeyDown({ ...baseEvent, ctrlKey: true }, 0)).toBe(false);
    expect(shouldOpenTerminalOnKeyDown({ ...baseEvent, metaKey: true }, 0)).toBe(false);
    expect(shouldOpenTerminalOnKeyDown({ ...baseEvent, altKey: true }, 0)).toBe(false);
  });

  it("returns false for other keys", () => {
    expect(shouldOpenTerminalOnKeyDown({ ...baseEvent, key: "t" }, 0)).toBe(false);
    expect(shouldOpenTerminalOnKeyDown({ ...baseEvent, key: "Enter" }, 0)).toBe(false);
    expect(shouldOpenTerminalOnKeyDown({ ...baseEvent, key: "Escape" }, 0)).toBe(false);
  });

  it("returns false when IME is composing", () => {
    expect(shouldOpenTerminalOnKeyDown({ ...baseEvent, isComposing: true }, 0)).toBe(false);
  });

  it("returns false when event target is an editable element", () => {
    const inputTarget = { tagName: "INPUT" } as any;
    expect(shouldOpenTerminalOnKeyDown({ ...baseEvent, target: inputTarget }, 0)).toBe(false);
  });

  it("returns false when activeElement is an editable element", () => {
    const activeInput = { tagName: "TEXTAREA" } as any;
    expect(
      shouldOpenTerminalOnKeyDown(baseEvent, 0, {
        activeElement: activeInput,
      }),
    ).toBe(false);
  });

  it("returns false when a modal dialog is open", () => {
    expect(
      shouldOpenTerminalOnKeyDown(baseEvent, 0, {
        isModalOpen: true,
      }),
    ).toBe(false);
  });
});
