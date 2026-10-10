import { describe, expect, it } from "vitest";

import type { BeadIssueDto, BeadsStatusDto } from "~/types/dto/beads";
import { BEADS_STATUS_COLUMNS, PRIORITY_MAP, TYPE_BADGE_STYLE } from "~/features/beads/types";

describe("Beads Types and Constants", () => {
  it("defines standard Kanban status columns for beads", () => {
    expect(BEADS_STATUS_COLUMNS).toContain("open");
    expect(BEADS_STATUS_COLUMNS).toContain("in_progress");
    expect(BEADS_STATUS_COLUMNS).toContain("blocked");
    expect(BEADS_STATUS_COLUMNS).toContain("deferred");
    expect(BEADS_STATUS_COLUMNS).toContain("closed");
  });

  it("maps numeric priorities 0-4 to labels P0-P4", () => {
    expect(PRIORITY_MAP[0]?.label).toBe("P0");
    expect(PRIORITY_MAP[1]?.label).toBe("P1");
    expect(PRIORITY_MAP[2]?.label).toBe("P2");
    expect(PRIORITY_MAP[3]?.label).toBe("P3");
    expect(PRIORITY_MAP[4]?.label).toBe("P4");
  });

  it("provides type badge styling for common bead issue types", () => {
    expect(TYPE_BADGE_STYLE.epic).toBeDefined();
    expect(TYPE_BADGE_STYLE.task).toBeDefined();
    expect(TYPE_BADGE_STYLE.bug).toBeDefined();
    expect(TYPE_BADGE_STYLE.feature).toBeDefined();
  });

  it("supports BeadIssueDto structure", () => {
    const issue: BeadIssueDto = {
      id: "docstool-app-4db",
      title: "DocsTool rewrite",
      description: "Description here",
      status: "open",
      priority: 1,
      issueType: "epic",
      commentCount: 4,
      dependencies: [
        {
          issueId: "docstool-app-4db",
          dependsOnId: "docstool-app-root",
          type: "parent-child",
        },
      ],
    };

    expect(issue.id).toBe("docstool-app-4db");
    expect(issue.priority).toBe(1);
    expect(issue.dependencies?.length).toBe(1);
    expect(issue.dependencies?.[0]?.dependsOnId).toBe("docstool-app-root");
  });

  it("supports BeadsStatusDto structure", () => {
    const status: BeadsStatusDto = {
      installed: true,
      initialized: true,
      version: "1.3.0",
      issueCount: 15,
    };

    expect(status.installed).toBe(true);
    expect(status.initialized).toBe(true);
    expect(status.issueCount).toBe(15);
  });
});
