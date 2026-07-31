import { describe, expect, it } from "vitest";

import { filterProjectList } from "./filter-projects";
import type { ProjectDto } from "~/types/dto";

function project(over: Partial<ProjectDto> & { name: string }): ProjectDto {
  return {
    id: over.name,
    locationId: "loc1",
    name: over.name,
    path: `/tmp/${over.name}`,
    stack: "node",
    runtimeHint: null,
    favorite: over.favorite ?? false,
    lastOpenedAtMs: over.lastOpenedAtMs ?? null,
    totalPlaytimeMs: 0,
    tasks: [],
    tags: [],
    githubOwner: null,
    githubRepo: null,
    fileCount: 0,
    sizeBytes: 0,
    lastEditedAtMs: over.lastEditedAtMs ?? null,
    iconPath: over.iconPath ?? null,
  };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

describe("filterProjectList — touched-10d", () => {
  it("includes projects edited 5 days ago", () => {
    const result = filterProjectList(
      [project({ name: "fresh", lastEditedAtMs: NOW - 5 * DAY })],
      "touched-10d",
      "",
      null,
      NOW,
    );
    expect(result.map((p) => p.name)).toEqual(["fresh"]);
  });

  it("excludes projects edited 11 days ago", () => {
    const result = filterProjectList(
      [project({ name: "stale", lastEditedAtMs: NOW - 11 * DAY })],
      "touched-10d",
      "",
      null,
      NOW,
    );
    expect(result).toHaveLength(0);
  });

  it("includes projects edited exactly at the 10-day cutoff", () => {
    const result = filterProjectList(
      [project({ name: "edge", lastEditedAtMs: NOW - 10 * DAY })],
      "touched-10d",
      "",
      null,
      NOW,
    );
    expect(result.map((p) => p.name)).toEqual(["edge"]);
  });

  it("excludes projects with no recorded edit timestamp", () => {
    const result = filterProjectList(
      [project({ name: "untouched", lastEditedAtMs: null })],
      "touched-10d",
      "",
      null,
      NOW,
    );
    expect(result).toHaveLength(0);
  });

  it("sorts non-favorites by lastEditedAtMs descending, favorite pinned on top", () => {
    const a = project({ name: "a", lastEditedAtMs: NOW - 1 * DAY });
    const b = project({ name: "b", lastEditedAtMs: NOW - 8 * DAY, favorite: true });
    const c = project({ name: "c", lastEditedAtMs: NOW - 3 * DAY });
    const result = filterProjectList([a, b, c], "touched-10d", "", null, NOW);
    expect(result.map((p) => p.name)).toEqual(["b", "a", "c"]);
  });

  it("search box further filters the touched subset", () => {
    const result = filterProjectList(
      [
        project({ name: "alpha", lastEditedAtMs: NOW - 1 * DAY }),
        project({ name: "beta", lastEditedAtMs: NOW - 2 * DAY }),
      ],
      "touched-10d",
      "alp",
      null,
      NOW,
    );
    expect(result.map((p) => p.name)).toEqual(["alpha"]);
  });
});
