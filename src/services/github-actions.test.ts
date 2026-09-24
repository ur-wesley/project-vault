import { describe, expect, it } from "vitest";

import { latestRunStatus, type GitHubActionRun } from "./github-actions";

function run(overrides: Partial<GitHubActionRun>): GitHubActionRun {
  return {
    id: 1,
    name: "ci",
    displayTitle: "add feature",
    event: "push",
    status: "completed",
    conclusion: "success",
    branch: "main",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:01:00Z",
    htmlUrl: "https://github.com/o/r/actions/runs/1",
    ...overrides,
  };
}

describe("latestRunStatus", () => {
  it("maps success conclusion", () => {
    expect(latestRunStatus([run({ conclusion: "success" })])).toBe("success");
  });

  it("maps in-progress status to running", () => {
    expect(latestRunStatus([run({ status: "in_progress", conclusion: null })])).toBe("running");
  });

  it("maps failure conclusion", () => {
    expect(latestRunStatus([run({ conclusion: "failure" })])).toBe("failure");
  });

  it("returns unknown for empty input", () => {
    expect(latestRunStatus([])).toBe("unknown");
    expect(latestRunStatus(undefined)).toBe("unknown");
  });
});
