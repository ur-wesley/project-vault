import { describe, expect, it } from "vitest";
import { dirSizeNodeToNanovisInput } from "./dir-size-tree";
import type { DirSizeNode } from "~/services/tauri/projects";

describe("dirSizeNodeToNanovisInput", () => {
  it("maps nested nodes with stable path ids and formatted subtext", () => {
    const input: DirSizeNode = {
      name: "proj",
      path: "/tmp/proj",
      sizeBytes: 115,
      isDir: true,
      isSkip: false,
      children: [
        {
          name: "node_modules",
          path: "/tmp/proj/node_modules",
          sizeBytes: 100,
          isDir: true,
          isSkip: true,
          children: [],
        },
        {
          name: "readme.txt",
          path: "/tmp/proj/readme.txt",
          sizeBytes: 15,
          isDir: false,
          isSkip: false,
          children: [],
        },
      ],
    };

    const out = dirSizeNodeToNanovisInput(input);

    expect(out.id).toBe("/tmp/proj");
    expect(out.text).toBe("proj");
    expect(out.children).toHaveLength(2);
    expect(out.children![0]!.id).toBe("/tmp/proj/node_modules");
    expect(out.children![0]!.meta).toEqual({
      path: "/tmp/proj/node_modules",
      isDir: true,
      isSkip: true,
    });
    // leaf carries its own size, parent size is aggregated by normalizeTreeNode
    expect(out.children![1]!.sizeSelf).toBe(15);
    expect(out.sizeSelf).toBe(0);
  });
});
