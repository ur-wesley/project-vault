import { describe, it, expect } from "vitest";
import {
  parseWhiteboardData,
  encodeWhiteboardData,
  sanitizeElements,
  MAX_ELEMENTS,
} from "./serialize";
import type { WhiteboardData } from "./types";
import { baseElement } from "./types";

describe("parseWhiteboardData", () => {
  it("returns empty v5 board for missing/corrupt payloads", () => {
    expect(parseWhiteboardData(null)).toEqual({ version: 5, elements: [] });
    expect(parseWhiteboardData(undefined)).toEqual({ version: 5, elements: [] });
    expect(parseWhiteboardData("not json")).toEqual({ version: 5, elements: [] });
    expect(parseWhiteboardData('"just a string"')).toEqual({ version: 5, elements: [] });
  });

  it("rejects unknown schema versions instead of migrating", () => {
    expect(parseWhiteboardData(JSON.stringify({ version: 99, elements: [] }))).toEqual({
      version: 5,
      elements: [],
    });
  });

  it("migrates v1 boards, defaulting new fields", () => {
    const raw = JSON.stringify({
      version: 1,
      elements: [
        {
          id: "a",
          kind: "rectangle",
          color: "#ef4444",
          strokeWidth: 4,
          start: { x: 0, y: 0 },
          end: { x: 10, y: 10 },
        },
        {
          id: "b",
          kind: "arrow",
          color: "#e5e5e5",
          strokeWidth: 2,
          start: { x: 0, y: 0 },
          end: { x: 20, y: 20 },
        },
        {
          id: "c",
          kind: "text",
          color: "#e5e5e5",
          strokeWidth: 2,
          position: { x: 1, y: 2 },
          text: "hi",
          fontSize: 14,
        },
      ],
    });
    const parsed = parseWhiteboardData(raw);
    expect(parsed.version).toBe(5);
    expect(parsed.elements).toHaveLength(3);
    for (const el of parsed.elements) {
      expect(el.groupIds).toEqual([]);
      expect(el.boundElements).toEqual([]);
    }
    const arrow = parsed.elements.find((e) => e.id === "b");
    expect(arrow).toMatchObject({ startBinding: null, endBinding: null });
    const text = parsed.elements.find((e) => e.id === "c");
    expect(text).toMatchObject({ containerId: null, labelGroupId: null, offset: { x: 0, y: 0 } });
  });

  it("parses v2 bindings and links", () => {
    const raw = JSON.stringify({
      version: 2,
      elements: [
        {
          id: "a",
          kind: "arrow",
          color: "#e5e5e5",
          strokeWidth: 2,
          groupIds: [],
          boundElements: [],
          start: { x: 0, y: 0 },
          end: { x: 20, y: 20 },
          startBinding: { elementId: "s", gap: 4 },
          endBinding: null,
        },
      ],
    });
    const [arrow] = parseWhiteboardData(raw).elements;
    expect(arrow).toMatchObject({ startBinding: { elementId: "s", gap: 4 }, endBinding: null });
  });

  it("drops malformed elements but keeps valid ones", () => {
    const raw = JSON.stringify({
      version: 2,
      elements: [
        { id: "bad", kind: "rectangle" },
        { id: "nope", kind: "spaceship" },
        {
          id: "ok",
          kind: "line",
          color: "#e5e5e5",
          strokeWidth: 2,
          start: { x: 0, y: 0 },
          end: { x: 5, y: 5 },
        },
      ],
    });
    const parsed = parseWhiteboardData(raw);
    expect(parsed.elements.map((e) => e.id)).toEqual(["ok"]);
  });
});

describe("sanitizeElements", () => {
  it("caps at MAX_ELEMENTS", () => {
    const raw = Array.from({ length: MAX_ELEMENTS + 50 }, (_, i) => ({
      id: `e${i}`,
      kind: "line",
      color: "#e5e5e5",
      strokeWidth: 2,
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
    }));
    expect(sanitizeElements(raw)).toHaveLength(MAX_ELEMENTS);
  });

  it("clamps stroke widths and text sizes", () => {
    const [t] = sanitizeElements([
      {
        id: "t",
        kind: "text",
        color: "not-a-color",
        strokeWidth: 999,
        position: { x: 0, y: 0 },
        text: "hi",
        fontSize: 999,
      },
    ]);
    expect(t.color).toBe("#e5e5e5");
    expect(t.strokeWidth).toBe(32);
    if (t.kind === "text") expect(t.fontSize).toBe(96);
    else throw new Error("expected text element");
  });

  it("flattens legacy groupId and nested groupIds to single-level", () => {
    const [a, b] = sanitizeElements([
      { id: "a", kind: "line", start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, groupId: "g1" },
      {
        id: "b",
        kind: "line",
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        groupIds: ["g1", "g2"],
      },
    ]);
    expect(a.groupIds).toEqual(["g1"]);
    expect(b.groupIds).toEqual(["g1"]);
  });
});

describe("encodeWhiteboardData", () => {
  it("round-trips through parse", () => {
    const data: WhiteboardData = {
      version: 5,
      elements: [
        {
          ...baseElement("a", "#3b82f6", 2),
          kind: "ellipse",
          start: { x: 1, y: 2 },
          end: { x: 30, y: 40 },
        },
      ],
    };
    const json = encodeWhiteboardData(data);
    expect(json).not.toBeNull();
    expect(parseWhiteboardData(json)).toEqual(data);
  });

  it("round-trips waypoints, migrates legacy elbows, defaults missing to []", () => {
    const [bent] = sanitizeElements([
      {
        id: "a",
        kind: "arrow",
        color: "#e5e5e5",
        strokeWidth: 2,
        start: { x: 0, y: 0 },
        end: { x: 10, y: 10 },
        waypoints: [
          { x: 5, y: 0 },
          { x: 7, y: 2 },
        ],
      },
    ]);
    expect(bent).toMatchObject({
      waypoints: [
        { x: 5, y: 0 },
        { x: 7, y: 2 },
      ],
    });
    const [legacy] = sanitizeElements([
      {
        id: "legacy",
        kind: "arrow",
        color: "#e5e5e5",
        strokeWidth: 2,
        start: { x: 0, y: 0 },
        end: { x: 10, y: 10 },
        elbow: { x: 5, y: 0 },
      },
    ]);
    expect(legacy).toMatchObject({ waypoints: [{ x: 5, y: 0 }] });
    const [straight] = sanitizeElements([
      {
        id: "b",
        kind: "line",
        color: "#e5e5e5",
        strokeWidth: 2,
        start: { x: 0, y: 0 },
        end: { x: 10, y: 10 },
      },
    ]);
    expect(straight).toMatchObject({ waypoints: [] });
    const [invalid] = sanitizeElements([
      {
        id: "c",
        kind: "line",
        color: "#e5e5e5",
        strokeWidth: 2,
        start: { x: 0, y: 0 },
        end: { x: 10, y: 10 },
        elbow: "nope",
      },
    ]);
    expect(invalid).toMatchObject({ waypoints: [] });
  });
});
