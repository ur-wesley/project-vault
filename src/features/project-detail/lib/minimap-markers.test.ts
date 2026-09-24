import { describe, expect, it } from "vitest";

import { changedHunk, matchOffsetsToLines } from "./minimap-markers";

describe("changedHunk", () => {
  it("returns null for identical text", () => {
    expect(changedHunk("a\nb\n", "a\nb\n")).toBeNull();
  });

  it("returns null without a baseline", () => {
    expect(changedHunk(undefined, "a\n")).toBeNull();
  });

  it("locates a single-line edit", () => {
    expect(changedHunk("a\nb\nc\n", "a\nB\nc\n")).toEqual({
      fromLine: 2,
      toLine: 2,
      hasDeletions: false,
    });
  });

  it("flags deletions when the old hunk was longer", () => {
    const hunk = changedHunk("a\nb\nc\nd\n", "a\nd\n");
    expect(hunk).not.toBeNull();
    expect(hunk!.hasDeletions).toBe(true);
  });

  it("covers appended lines", () => {
    expect(changedHunk("a\n", "a\nb\nc\n")).toEqual({
      fromLine: 2,
      toLine: 3,
      hasDeletions: false,
    });
  });
});

describe("matchOffsetsToLines", () => {
  it("maps offsets to 1-based lines", () => {
    expect(matchOffsetsToLines("ab\ncd\nef\n", [0, 3, 6])).toEqual([1, 2, 3]);
  });

  it("maps mid-line offsets to their line", () => {
    expect(matchOffsetsToLines("ab\ncd\n", [1])).toEqual([1]);
  });

  it("respects the cap", () => {
    const offsets = Array.from({ length: 10 }, (_, i) => i);
    expect(matchOffsetsToLines("abcdefghij", offsets, 3)).toEqual([1, 1, 1]);
  });
});
