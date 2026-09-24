import { describe, expect, it } from "vitest";

import { chord, ctrlOrMeta } from "./use-scoped-shortcut";

function keyEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    key: "",
    ...init,
  } as KeyboardEvent;
}

describe("ctrlOrMeta", () => {
  it("accepts either modifier", () => {
    expect(ctrlOrMeta(keyEvent({ ctrlKey: true }))).toBe(true);
    expect(ctrlOrMeta(keyEvent({ metaKey: true }))).toBe(true);
    expect(ctrlOrMeta(keyEvent({}))).toBe(false);
  });
});

describe("chord", () => {
  it("matches ctrl+key case-insensitively", () => {
    expect(chord("w")(keyEvent({ ctrlKey: true, key: "w" }))).toBe(true);
    expect(chord("w")(keyEvent({ ctrlKey: true, key: "W" }))).toBe(true);
    expect(chord("w")(keyEvent({ metaKey: true, key: "w" }))).toBe(true);
  });

  it("rejects extra modifiers by default", () => {
    expect(chord("w")(keyEvent({ ctrlKey: true, shiftKey: true, key: "w" }))).toBe(false);
    expect(chord("w")(keyEvent({ key: "w" }))).toBe(false);
  });

  it("supports declared shift chords", () => {
    const match = chord("s", { shift: true });
    expect(match(keyEvent({ ctrlKey: true, shiftKey: true, key: "S" }))).toBe(true);
    expect(match(keyEvent({ ctrlKey: true, key: "s" }))).toBe(false);
  });
});
