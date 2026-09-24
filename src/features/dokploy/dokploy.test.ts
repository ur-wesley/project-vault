import { describe, expect, it } from "vitest";

import {
  dokployStatusTone,
  envRank,
  findAutoLinkTarget,
  migrateLegacyServers,
  parseGitRemote,
  parseServersSetting,
  pickBestDokployMatch,
  rankDokployMatches,
  serializeServersSetting,
  type DokployGitProvider,
  type DokployMatch,
  type DokployServiceCandidate,
} from "./dokploy";

describe("dokployStatusTone", () => {
  it("maps healthy states to nominal", () => {
    expect(dokployStatusTone("done")).toBe("nominal");
    expect(dokployStatusTone("running")).toBe("nominal");
    expect(dokployStatusTone("idle")).toBe("nominal");
  });

  it("maps failure states to red", () => {
    expect(dokployStatusTone("error")).toBe("red");
    expect(dokployStatusTone("failed")).toBe("red");
  });

  it("maps unknown and missing states to amber", () => {
    expect(dokployStatusTone("pending")).toBe("amber");
    expect(dokployStatusTone(null)).toBe("amber");
    expect(dokployStatusTone(undefined)).toBe("amber");
    expect(dokployStatusTone("")).toBe("amber");
  });

  it("is case-insensitive", () => {
    expect(dokployStatusTone("Done")).toBe("nominal");
    expect(dokployStatusTone("ERROR")).toBe("red");
  });
});

describe("parseGitRemote", () => {
  it("parses SSH remotes", () => {
    expect(parseGitRemote("git@github.com:Acme/Web.git")).toEqual({
      host: "github.com",
      owner: "Acme",
      repo: "Web",
    });
  });

  it("parses HTTPS remotes with credentials", () => {
    expect(parseGitRemote("https://oauth2:token@gitlab.com/group/sub/repo.git")).toEqual({
      host: "gitlab.com",
      owner: "sub",
      repo: "repo",
    });
  });

  it("parses owner/repo and bare names", () => {
    expect(parseGitRemote("acme/web")).toEqual({ host: "", owner: "acme", repo: "web" });
    expect(parseGitRemote("  web  ")).toEqual({ host: "", owner: "", repo: "web" });
  });

  it("returns empty triple for blank input", () => {
    expect(parseGitRemote(null).repo).toBe("");
    expect(parseGitRemote("").repo).toBe("");
  });
});

describe("findAutoLinkTarget", () => {
  const provider = (overrides: Partial<DokployGitProvider> = {}): DokployGitProvider => ({
    id: "gh_1",
    name: "Dokploy-vps-netcup",
    providerType: "github",
    gitProviderId: "gp_1",
    configured: true,
    serverId: "",
    serverName: "",
    ...overrides,
  });
  const candidate = (
    overrides: Partial<DokployServiceCandidate> = {},
  ): DokployServiceCandidate => ({
    kind: "application",
    id: "app_1",
    name: "cairn",
    projectName: "wesley.fyi",
    sourceType: "github",
    linked: false,
    repository: null,
    owner: null,
    branch: null,
    environment: null,
    serverId: "",
    serverName: "",
    ...overrides,
  });

  it("links when exactly one unlinked name match and one provider exist", () => {
    const target = findAutoLinkTarget([candidate()], [provider()], "cairn");
    expect(target?.candidate.id).toBe("app_1");
    expect(target?.provider.id).toBe("gh_1");
  });

  it("matches service names case-insensitively", () => {
    expect(
      findAutoLinkTarget([candidate({ name: "Cairn" })], [provider()], "cairn"),
    ).not.toBeNull();
  });

  it("refuses when several services share the name", () => {
    const list = [candidate({ id: "a" }), candidate({ id: "b" })];
    expect(findAutoLinkTarget(list, [provider()], "cairn")).toBeNull();
  });

  it("never hijacks an already-linked service", () => {
    expect(findAutoLinkTarget([candidate({ linked: true })], [provider()], "cairn")).toBeNull();
  });

  it("refuses without exactly one configured provider", () => {
    expect(findAutoLinkTarget([candidate()], [], "cairn")).toBeNull();
    expect(
      findAutoLinkTarget([candidate()], [provider(), provider({ id: "gh_2" })], "cairn"),
    ).toBeNull();
    expect(
      findAutoLinkTarget([candidate()], [provider({ configured: false })], "cairn"),
    ).toBeNull();
  });

  it("refuses when no name matches", () => {
    expect(findAutoLinkTarget([candidate({ name: "other" })], [provider()], "cairn")).toBeNull();
  });

  it("ranked mode picks the branch-matching service across servers", () => {
    const list = [
      candidate({
        id: "a",
        branch: "develop",
        environment: "production",
        serverId: "s1",
        serverName: "A",
      }),
      candidate({
        id: "b",
        branch: "main",
        environment: "staging",
        serverId: "s2",
        serverName: "B",
      }),
    ];
    const providers = [
      provider({ id: "gh_1", serverId: "s1", serverName: "A" }),
      provider({ id: "gh_2", serverId: "s2", serverName: "B" }),
    ];
    const target = findAutoLinkTarget(list, providers, "cairn", { branch: "main" });
    expect(target?.candidate.id).toBe("b");
    expect(target?.provider.id).toBe("gh_2");
  });

  it("ranked mode prefers production over staging on branch tie", () => {
    const list = [
      candidate({
        id: "a",
        branch: "main",
        environment: "staging",
        serverId: "s1",
        serverName: "A",
      }),
      candidate({
        id: "b",
        branch: "main",
        environment: "production",
        serverId: "s2",
        serverName: "B",
      }),
    ];
    const providers = [
      provider({ id: "gh_1", serverId: "s1", serverName: "A" }),
      provider({ id: "gh_2", serverId: "s2", serverName: "B" }),
    ];
    expect(findAutoLinkTarget(list, providers, "cairn", { branch: "main" })?.candidate.id).toBe(
      "b",
    );
  });
});

describe("rankDokployMatches", () => {
  const match = (overrides: Partial<DokployMatch> = {}): DokployMatch => ({
    kind: "application",
    id: "app_1",
    name: "cairn",
    projectName: "wesley.fyi",
    status: "done",
    domains: [],
    repository: "cairn",
    owner: "ur-wesley",
    branch: "main",
    environment: null,
    serverId: "s1",
    serverName: "Main",
    matchKind: "owner_repo",
    ...overrides,
  });

  it("prefers the local branch, then production", () => {
    const list = [
      match({
        id: "a",
        branch: "develop",
        environment: "production",
        serverName: "A",
        serverId: "a",
      }),
      match({ id: "b", branch: "main", environment: "staging", serverName: "B", serverId: "b" }),
      match({ id: "c", branch: "main", environment: "production", serverName: "C", serverId: "c" }),
    ];
    const ranked = rankDokployMatches(list, { branch: "main", projectName: "cairn" });
    expect(ranked.map((m) => m.id)).toEqual(["c", "b", "a"]);
    expect(pickBestDokployMatch(list, { branch: "main" })?.id).toBe("c");
  });

  it("does not mutate the input", () => {
    const list = [match({ id: "a" }), match({ id: "b" })];
    rankDokployMatches(list, { branch: "main" });
    expect(list[0]!.id).toBe("a");
  });

  it("ranks production first", () => {
    expect(envRank("production")).toBe(0);
    expect(envRank("staging")).toBe(1);
    expect(envRank("custom")).toBe(2);
    expect(envRank(null)).toBe(3);
  });
});

describe("dokploy servers settings", () => {
  it("migrates the legacy pair and skips empties", () => {
    expect(migrateLegacyServers("", "")).toEqual([]);
    const [s] = migrateLegacyServers("https://dokploy.example.com/", " k ");
    expect(s!.id).toBe("legacy");
    expect(s!.url).toBe("https://dokploy.example.com");
    expect(s!.apiKey).toBe("k");
    expect(s!.name).toBe("dokploy.example.com");
  });

  it("parses and serializes the server list, skipping bad rows", () => {
    const raw = JSON.stringify([
      { id: "a", name: "A", url: "https://a.example.com/", apiKey: "k1" },
      { id: "b", url: "https://b.example.com", api_key: "k2" },
      { id: "bad", url: "", apiKey: "k3" },
    ]);
    const parsed = parseServersSetting(raw);
    expect(parsed.length).toBe(2);
    expect(parsed[1]!.name).toBe("b.example.com");
    expect(parseServersSetting("garbage")).toEqual([]);
    const roundtrip = parseServersSetting(serializeServersSetting(parsed));
    expect(roundtrip.length).toBe(2);
  });
});
