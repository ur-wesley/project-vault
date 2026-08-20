import { describe, expect, it } from "vitest";

import { sortSidebarProjects } from "./sort-sidebar-projects";
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
    lastViewedAtMs: over.lastViewedAtMs ?? null,
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

describe("sortSidebarProjects", () => {
  it("pins favorites first, then sorts by last viewed desc", () => {
    const a = project({ name: "a", lastViewedAtMs: 100 });
    const b = project({ name: "b", lastViewedAtMs: 300 });
    const c = project({ name: "c", favorite: true, lastViewedAtMs: 50 });
    const d = project({ name: "d", favorite: true, lastViewedAtMs: 200 });

    expect(sortSidebarProjects([a, b, c, d]).map((p) => p.name)).toEqual(["d", "c", "b", "a"]);
  });

  it("sinks never-viewed below viewed within a group", () => {
    const viewed = project({ name: "viewed", lastViewedAtMs: 1 });
    const never = project({ name: "never" });

    expect(sortSidebarProjects([never, viewed]).map((p) => p.name)).toEqual(["viewed", "never"]);
  });

  it("uses name as tiebreak when last viewed matches", () => {
    const beta = project({ name: "beta", lastViewedAtMs: 100 });
    const alpha = project({ name: "alpha", lastViewedAtMs: 100 });

    expect(sortSidebarProjects([beta, alpha]).map((p) => p.name)).toEqual(["alpha", "beta"]);
  });
});
