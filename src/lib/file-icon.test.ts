import { describe, expect, it } from "vitest";

import { FOLDER_SENTINEL, fileIconifyName } from "./file-icon";

describe("fileIconifyName", () => {
  it("uses neutral folder sentinel for generic directories", () => {
    expect(fileIconifyName("src", true)).toBe(FOLDER_SENTINEL);
    expect(fileIconifyName("components", true)).toBe(FOLDER_SENTINEL);
  });

  it("resolves special directory names", () => {
    expect(fileIconifyName("node_modules", true)).toBe("nodemon");
    expect(fileIconifyName(".git", true)).toBe("magit");
    expect(fileIconifyName(".github", true)).toBe("gitlab");
  });

  it("resolves luau via extension rule when atom is generic", () => {
    expect(fileIconifyName("init.luau", false)).toBe("lua");
    expect(fileIconifyName("src/foo.luau", false)).toBe("lua");
  });

  it("resolves markdown and json files", () => {
    expect(fileIconifyName("README.md", false)).toBe("rmarkdown");
    expect(fileIconifyName("foo.json", false)).toBe("json-1");
  });

  it("resolves git dotfiles and package manifests", () => {
    expect(fileIconifyName(".gitignore", false)).toBe("magit");
    expect(fileIconifyName("package.json", false)).toBe("npm");
    expect(fileIconifyName("tsconfig.json", false)).toBe("config-typescript");
  });

  it("resolves C# and .NET project files", () => {
    expect(fileIconifyName("Program.cs", false)).toBe("csharp");
    expect(fileIconifyName("App.csx", false)).toBe("csharp");
    expect(fileIconifyName("Foo.fs", false)).toBe("fsharp");
    expect(fileIconifyName("MyApp.csproj", false)).toBe("vscode");
    expect(fileIconifyName("Solution.sln", false)).toBe("vscode");
  });
});
