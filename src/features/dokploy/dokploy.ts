import { z } from "zod";

import { tauriInvoke } from "~/services/tauri/utils";
import { isRecord } from "~/lib/guards";

export const DOKPLOY_URL_SETTING_KEY = "dokploy_url";
export const DOKPLOY_API_KEY_SETTING_KEY = "dokploy_api_key";
/** JSON list of `{ id, name, url, apiKey }` — the multi-server store. */
export const DOKPLOY_SERVERS_SETTING_KEY = "dokploy_servers";

/** Must match DOKPLOY_API_VERSION in src-tauri/src/commands/dokploy.rs. */
export const DOKPLOY_API_VERSION = 4;

export type DokployServer = Readonly<{
  id: string;
  name: string;
  url: string;
  apiKey: string;
}>;

export function dokployApiVersion() {
  return tauriInvoke<number>("dokploy_api_version");
}

export type DokployServiceKind = "application" | "compose";

export type DokployMatchKind = "exact" | "owner_repo" | "name_only";
export type DokployMatch = Readonly<{
  kind: string;
  id: string;
  name: string;
  projectName: string;
  status: string | null;
  domains: string[];
  repository: string | null;
  owner: string | null;
  branch: string | null;
  environment: string | null;
  serverId: string;
  serverName: string;
  matchKind: DokployMatchKind;
}>;

export type DokployDeployment = Readonly<{
  id: string;
  title: string | null;
  status: string;
  createdAt: string | null;
}>;

export type DokployServiceStatus = Readonly<{
  kind: string;
  id: string;
  name: string;
  projectName: string;
  status: string | null;
  domains: string[];
  repository: string | null;
  owner: string | null;
  branch: string | null;
  environment: string | null;
  serverId: string;
  serverName: string;
  dashboardUrl: string;
  deployments: DokployDeployment[];
}>;

export function dokployTestConnection(url: string, apiKey: string) {
  return tauriInvoke<number>("dokploy_test_connection", {
    url,
    apiKey,
  });
}

export type DokployDebugService = Readonly<{
  kind: string;
  name: string;
  sourceType: string | null;
  owner: string | null;
  repository: string | null;
  branch: string | null;
  environment: string | null;
  projectName: string;
  serverId: string;
  serverName: string;
}>;

export type DokployDebugScan = Readonly<{
  projectCount: number;
  serviceCount: number;
  localHost: string | null;
  localOwner: string | null;
  localRepo: string | null;
  services: DokployDebugService[];
  unreachableServers: string[];
}>;

export type GitTriple = Readonly<{
  host: string;
  owner: string;
  repo: string;
}>;

const EMPTY_TRIPLE: GitTriple = { host: "", owner: "", repo: "" };

function cleanRepoName(s: string): string {
  return s
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
}

/**
 * Parse anything from `"repo"` to `"owner/repo"` to full clone URLs.
 * Mirrors the Rust `parse_git_remote` in commands/dokploy.rs.
 */
export function parseGitRemote(raw: string | null | undefined): GitTriple {
  let s = (raw ?? "").trim();
  if (!s) return { ...EMPTY_TRIPLE };
  // Scheme URLs, possibly with credentials: "https://user:token@host/..." -> "host/..."
  const schemeIdx = s.indexOf("://");
  if (schemeIdx >= 0) {
    s = s.slice(schemeIdx + 3);
    const at = s.indexOf("@");
    if (at >= 0) s = s.slice(at + 1);
    const parts = s.split("/").filter((p) => p.length > 0);
    if (parts.length >= 3) {
      const repo = cleanRepoName(parts[parts.length - 1]!);
      if (repo) {
        return { host: parts[0]!.toLowerCase(), owner: parts[parts.length - 2]!, repo };
      }
    }
    return { ...EMPTY_TRIPLE };
  }
  // SCP-like SSH: "git@host:owner/repo.git".
  const colon = s.indexOf(":");
  if (colon >= 0) {
    const left = s.slice(0, colon);
    const right = s.slice(colon + 1);
    if (!right.startsWith("/") && !left.includes("/")) {
      const host = (
        left.includes("@") ? left.slice(left.lastIndexOf("@") + 1) : left
      ).toLowerCase();
      const cleanRight = right.replace(/^\/+/, "");
      const slash = cleanRight.indexOf("/");
      if (slash > 0) {
        const owner = cleanRight.slice(0, slash);
        const repo = cleanRepoName(cleanRight.slice(slash + 1));
        if (owner && repo && !repo.includes("/")) {
          return { host, owner, repo };
        }
      }
      return { ...EMPTY_TRIPLE };
    }
  }
  // "owner/repo" or bare "repo".
  const slash = s.indexOf("/");
  if (slash >= 0) {
    const owner = s.slice(0, slash).trim();
    const repo = cleanRepoName(s.slice(slash + 1));
    if (owner && repo && !repo.includes("/")) {
      return { host: "", owner, repo };
    }
    return { ...EMPTY_TRIPLE };
  }
  return { host: "", owner: "", repo: cleanRepoName(s) };
}

export function dokployListMatches(owner: string, repo: string, remoteUrl?: string | null) {
  return tauriInvoke<DokployMatch[]>("dokploy_list_matches", {
    owner,
    repo,
    remoteUrl: remoteUrl ?? null,
  });
}

export function dokployDebugScan(owner: string, repo: string, remoteUrl?: string | null) {
  return tauriInvoke<DokployDebugScan>("dokploy_debug_scan", {
    owner,
    repo,
    remoteUrl: remoteUrl ?? null,
  });
}

export function dokployServiceStatus(kind: string, id: string, serverId?: string | null) {
  return tauriInvoke<DokployServiceStatus>("dokploy_service_status", {
    kind,
    id,
    serverId: serverId ?? null,
  });
}

export function dokployRedeploy(kind: string, id: string, serverId?: string | null) {
  return tauriInvoke<void>("dokploy_redeploy", { kind, id, serverId: serverId ?? null });
}

export type DokployGitProvider = Readonly<{
  id: string;
  name: string;
  providerType: string | null;
  gitProviderId: string | null;
  configured: boolean;
  serverId: string;
  serverName: string;
}>;

export type DokployServiceCandidate = Readonly<{
  kind: string;
  id: string;
  name: string;
  projectName: string;
  sourceType: string | null;
  linked: boolean;
  repository: string | null;
  owner: string | null;
  branch: string | null;
  environment: string | null;
  serverId: string;
  serverName: string;
}>;

export function dokployGitProviders() {
  return tauriInvoke<DokployGitProvider[]>("dokploy_git_providers");
}

export function dokployListServices(query: string) {
  return tauriInvoke<DokployServiceCandidate[]>("dokploy_list_services", { query });
}

export function dokployLinkGithub(args: {
  kind: string;
  id: string;
  githubId: string;
  owner: string;
  repository: string;
  branch: string;
  serverId?: string | null;
}) {
  return tauriInvoke<void>("dokploy_link_github", {
    kind: args.kind,
    id: args.id,
    githubId: args.githubId,
    owner: args.owner,
    repository: args.repository,
    branch: args.branch,
    serverId: args.serverId ?? null,
  });
}

export function dokployStatusTone(status: string | null | undefined): "nominal" | "amber" | "red" {
  const s = (status ?? "").toLowerCase();
  if (s === "done" || s === "running" || s === "idle" || s === "success") return "nominal";
  if (s === "error" || s === "failed" || s === "offline") return "red";
  return "amber";
}

export type DokployAutoLinkTarget = Readonly<{
  candidate: DokployServiceCandidate;
  provider: DokployGitProvider;
}>;

/**
 * Decide whether the repo can be linked with zero manual work.
 *
 * Legacy strict mode (no `opts.branch`): exactly one candidate whose
 * service name equals the local project name (case-insensitive), that
 * candidate must be UNLINKED (never hijack someone else's deployment),
 * and exactly one configured GitHub provider must exist. Anything else
 * returns null → manual picker UI.
 *
 * Ranked mode (`opts.branch` provided): same name/unlinked guards, but
 * providers are matched on the candidate's own server and the best pair
 * wins by branch match → production environment → name order. This is
 * what powers automatic selection across multiple Dokploy servers.
 */
export function findAutoLinkTarget(
  candidates: readonly DokployServiceCandidate[],
  providers: readonly DokployGitProvider[],
  projectName: string,
  opts?: { branch?: string | null },
): DokployAutoLinkTarget | null {
  const want = projectName.trim().toLowerCase();
  if (!want) return null;
  const named = candidates.filter((c) => !c.linked && c.name.trim().toLowerCase() === want);
  if (named.length === 0) return null;
  const branch = (opts?.branch ?? "").trim().toLowerCase();

  if (!branch) {
    // Legacy strict path (keeps single-server behaviour + old tests).
    if (providers.length !== 1) return null;
    const provider = providers[0]!;
    if (!provider.configured) return null;
    if (named.length !== 1) return null;
    const candidate = named[0]!;
    if (candidate.linked) return null;
    return { candidate, provider };
  }

  // Ranked path: pair each candidate with a configured provider from the
  // same server (entries without server identity match any provider).
  const configured = providers.filter((p) => p.configured);
  if (configured.length === 0) return null;
  const pairs: DokployAutoLinkTarget[] = [];
  for (const candidate of named) {
    const provider =
      configured.find(
        (p) => p.serverId && candidate.serverId && p.serverId === candidate.serverId,
      ) ?? (configured.length === 1 ? configured[0]! : null);
    if (provider) pairs.push({ candidate, provider });
  }
  if (pairs.length === 0) return null;
  pairs.sort((a, b) => {
    const ab = (a.candidate.branch ?? "").trim().toLowerCase() === branch ? 0 : 1;
    const bb = (b.candidate.branch ?? "").trim().toLowerCase() === branch ? 0 : 1;
    if (ab !== bb) return ab - bb;
    const ae = envRank(a.candidate.environment);
    const be = envRank(b.candidate.environment);
    if (ae !== be) return ae - be;
    return (
      a.candidate.serverName.localeCompare(b.candidate.serverName) ||
      a.candidate.projectName.localeCompare(b.candidate.projectName) ||
      a.candidate.name.localeCompare(b.candidate.name)
    );
  });
  return pairs[0]!;
}

/** Rank environments for automatic selection: production first. */
export function envRank(environment: string | null | undefined): number {
  const e = (environment ?? "").trim().toLowerCase();
  if (e === "production" || e === "prod" || e === "main" || e === "live") return 0;
  if (e === "staging" || e === "stage" || e === "preview") return 1;
  if (e === "") return 3;
  return 2;
}

export type RankDokployMatchesCtx = Readonly<{
  branch?: string | null;
  projectName?: string | null;
}>;

function matchRankKey(
  m: { branch?: string | null; environment?: string | null; name?: string },
  ctx: RankDokployMatchesCtx,
): [number, number, number] {
  const wantBranch = (ctx.branch ?? "").trim().toLowerCase();
  const hasBranch = (m.branch ?? "").trim().toLowerCase();
  let branchRank = 2;
  if (wantBranch && hasBranch) {
    branchRank = hasBranch === wantBranch ? 0 : 1;
  }
  const wantName = (ctx.projectName ?? "").trim().toLowerCase();
  const nameRank = wantName && (m.name ?? "").trim().toLowerCase() === wantName ? 0 : 1;
  return [branchRank, envRank(m.environment), nameRank];
}

/**
 * Sort matches best-first: same branch as local git → production
 * environment → service name equals project name → stable server/project
 * order. Returns a new array; the input is never mutated.
 */
export function rankDokployMatches<T extends DokployMatch>(
  matches: readonly T[],
  ctx: RankDokployMatchesCtx = {},
): T[] {
  return [...matches].sort((a, b) => {
    const [ab, ae, an] = matchRankKey(a, ctx);
    const [bb, be, bn] = matchRankKey(b, ctx);
    return (
      ab - bb ||
      ae - be ||
      an - bn ||
      a.serverName.localeCompare(b.serverName) ||
      a.projectName.localeCompare(b.projectName) ||
      a.name.localeCompare(b.name)
    );
  });
}

/** Best-first pick, or null when there is nothing to pick. */
export function pickBestDokployMatch<T extends DokployMatch>(
  matches: readonly T[],
  ctx: RankDokployMatchesCtx = {},
): T | null {
  if (matches.length === 0) return null;
  return rankDokployMatches(matches, ctx)[0]!;
}

/** Composite key identifying a match across servers. */
export function dokployMatchKey(m: Pick<DokployMatch, "serverId" | "kind" | "id">): string {
  return `${m.serverId}::${m.kind}::${m.id}`;
}

/** Find a match by its composite key (falls back to plain id for legacy). */
export function findDokployMatchByKey<T extends DokployMatch>(
  matches: readonly T[],
  key: string | null | undefined,
): T | null {
  if (!key) return null;
  return (
    matches.find((m) => dokployMatchKey(m) === key) ?? matches.find((m) => m.id === key) ?? null
  );
}

// --- Multi-server settings helpers ---------------------------------------

export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function defaultServerName(url: string): string {
  const clean = normalizeServerUrl(url);
  const withoutScheme = clean.includes("://") ? clean.slice(clean.indexOf("://") + 3) : clean;
  const host = withoutScheme.split("/")[0] ?? "";
  return host || clean;
}

export function newServerId(): string {
  return `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function blankDokployServer(): DokployServer {
  return { id: newServerId(), name: "", url: "", apiKey: "" };
}

/** Migrate the legacy single url/key pair into the server list. */
export function migrateLegacyServers(url: string, apiKey: string): DokployServer[] {
  const cleanUrl = normalizeServerUrl(url);
  if (!cleanUrl || !apiKey.trim()) return [];
  return [
    {
      id: "legacy",
      name: defaultServerName(cleanUrl),
      url: cleanUrl,
      apiKey: apiKey.trim(),
    },
  ];
}

const ServerRowSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().optional(),
  url: z.string().min(1),
  apiKey: z.string().optional(),
  api_key: z.string().optional(),
});

/** Parse the `dokploy_servers` setting; invalid rows are skipped. */
export function parseServersSetting(raw: string | null | undefined): DokployServer[] {
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: DokployServer[] = [];
    for (const entry of parsed) {
      if (!isRecord(entry)) continue;
      const row = ServerRowSchema.safeParse(entry);
      if (!row.success) continue;
      const url = normalizeServerUrl(row.data.url);
      const apiKey = (row.data.apiKey ?? row.data.api_key ?? "").trim();
      if (!url || !apiKey) continue;
      const id = row.data.id ?? newServerId();
      const rawName = row.data.name?.trim() ?? "";
      out.push({ id, name: rawName || defaultServerName(url), url, apiKey });
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeServersSetting(servers: readonly DokployServer[]): string {
  return JSON.stringify(
    servers.map((s) => ({
      id: s.id,
      name: s.name.trim() || defaultServerName(s.url),
      url: normalizeServerUrl(s.url),
      apiKey: s.apiKey.trim(),
    })),
  );
}
