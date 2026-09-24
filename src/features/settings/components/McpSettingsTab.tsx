import { createEffect, createMemo, createSignal, For, Show, type Component } from "solid-js";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { toast } from "solid-sonner";

import { useI18n } from "~/lib/i18n-context";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import { Switch, SwitchControl, SwitchThumb } from "~/components/ui/switch";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import {
  generateMcpToken,
  getMcpServerStatus,
  listMcpResources,
  listMcpTools,
  saveMcpSettings,
  startMcpServer,
  stopMcpServer,
} from "~/services/tauri/mcp";
import { settingElementId } from "../lib/settings-index";

export const McpSettingsTab: Component = () => {
  const { t } = useI18n();
  const qc = useQueryClient();

  const [enabled, setEnabled] = createSignal(false);
  const [port, setPort] = createSignal("1622");
  const [authEnabled, setAuthEnabled] = createSignal(false);
  const [authToken, setAuthToken] = createSignal("");
  const [showToken, setShowToken] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [activeConfigTab, setActiveConfigTab] = createSignal<"claude" | "cursor">("claude");

  const statusQ = createQuery(() => ({
    queryKey: ["mcp", "status"] as const,
    queryFn: async () => {
      const res = await getMcpServerStatus();
      if (res.isErr()) throw new Error(res.error.message);
      return res.value;
    },
  }));

  const toolsQ = createQuery(() => ({
    queryKey: ["mcp", "tools"] as const,
    queryFn: async () => {
      const res = await listMcpTools();
      if (res.isErr()) return [];
      return res.value;
    },
  }));

  const resourcesQ = createQuery(() => ({
    queryKey: ["mcp", "resources"] as const,
    queryFn: async () => {
      const res = await listMcpResources();
      if (res.isErr()) return [];
      return res.value;
    },
  }));

  const [expandedTool, setExpandedTool] = createSignal<string | null>(null);

  createEffect(() => {
    const data = statusQ.data;
    if (data) {
      setEnabled(data.running);
      setPort(String(data.port || 1622));
      setAuthEnabled(data.authEnabled);
      setAuthToken(data.authToken || "");
    }
  });

  const isRunning = () => statusQ.data?.running ?? enabled();
  const currentPort = () => port() || "1622";
  const sseUrl = () => `http://127.0.0.1:${currentPort()}/sse`;
  const directUrl = () => `http://127.0.0.1:${currentPort()}/mcp`;

  const claudeConfigSnippet = createMemo(() => {
    const p = currentPort();
    const isAuth = authEnabled();
    const token = authToken().trim();

    if (isAuth && token) {
      return JSON.stringify(
        {
          mcpServers: {
            "project-vault": {
              url: `http://127.0.0.1:${p}/sse`,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          },
        },
        null,
        2,
      );
    }

    return JSON.stringify(
      {
        mcpServers: {
          "project-vault": {
            url: `http://127.0.0.1:${p}/sse`,
          },
        },
      },
      null,
      2,
    );
  });

  const cursorConfigSnippet = createMemo(() => {
    const p = currentPort();
    const isAuth = authEnabled();
    const token = authToken().trim();

    if (isAuth && token) {
      return JSON.stringify(
        {
          mcpServers: {
            "project-vault": {
              url: `http://127.0.0.1:${p}/sse`,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          },
        },
        null,
        2,
      );
    }

    return JSON.stringify(
      {
        mcpServers: {
          "project-vault": {
            url: `http://127.0.0.1:${p}/sse`,
          },
        },
      },
      null,
      2,
    );
  });

  const handleToggleServer = async (checked: boolean) => {
    setEnabled(checked);
    setBusy(true);
    try {
      if (checked) {
        let token = authToken().trim();
        if (authEnabled() && !token) {
          const genRes = await generateMcpToken();
          if (genRes.isOk()) {
            token = genRes.value;
            setAuthToken(token);
          }
        }
        const p = parseInt(port(), 10) || 1622;
        const res = await startMcpServer({
          port: p,
          authEnabled: authEnabled(),
          authToken: token,
        });
        if (res.isErr()) {
          toast.error(`Failed to start MCP server: ${res.error.message}`);
          setEnabled(false);
        } else {
          toast.success("MCP server started!");
          await qc.invalidateQueries({ queryKey: ["mcp", "status"] });
        }
      } else {
        const res = await stopMcpServer();
        if (res.isErr()) {
          toast.error(`Failed to stop MCP server: ${res.error.message}`);
        } else {
          toast.info("MCP server stopped.");
          await qc.invalidateQueries({ queryKey: ["mcp", "status"] });
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateToken = async () => {
    setBusy(true);
    try {
      const res = await generateMcpToken();
      if (res.isOk()) {
        setAuthToken(res.value);
        setAuthEnabled(true);
        toast.success("New auth token generated!");
      } else {
        toast.error(`Could not generate token: ${res.error.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCopyText = async (text: string, successMsg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMsg);
    } catch {
      toast.error("Failed to copy to clipboard.");
    }
  };

  const handleSaveSettings = async () => {
    setBusy(true);
    try {
      const p = parseInt(port(), 10) || 1622;
      const res = await saveMcpSettings({
        enabled: enabled(),
        port: p,
        authEnabled: authEnabled(),
        authToken: authToken().trim(),
      });
      if (res.isOk()) {
        toast.success(t("settings.mcpSavedSuccess") as string);
        await qc.invalidateQueries({ queryKey: ["mcp", "status"] });
      } else {
        toast.error(`Failed to save MCP settings: ${res.error.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="flex flex-col gap-6 pb-8">
      {/* 1. Server Status & Main Switch */}
      <Card id={settingElementId("mcp-server")}>
        <CardHeader>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="iconify mdi--server-network size-5 text-primary" />
              <CardTitle>{t("settings.mcpTitle") as string}</CardTitle>
            </div>
            <Show
              when={isRunning()}
              fallback={
                <Badge
                  variant="secondary"
                  class="gap-1.5 py-1 px-2.5 text-xs font-semibold text-muted-foreground"
                >
                  <span class="size-2 rounded-full bg-muted-foreground/50" />
                  {t("settings.mcpStopped") as string}
                </Badge>
              }
            >
              <Badge
                variant="default"
                class="gap-1.5 py-1 px-2.5 text-xs font-semibold bg-emerald-500/15 text-emerald-500 border-emerald-500/20"
              >
                <span class="size-2 rounded-full bg-emerald-500 animate-pulse" />
                {t("settings.mcpRunning") as string}
              </Badge>
            </Show>
          </div>
          <CardDescription>{t("settings.mcpDescription") as string}</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          <Separator />
          <div class="flex items-center justify-between gap-4 py-1">
            <div class="flex flex-col gap-0.5">
              <span class="text-sm font-medium">{t("settings.mcpEnableServer") as string}</span>
              <span class="text-xs text-muted-foreground">
                {t("settings.mcpEnableServerDescription") as string}
              </span>
            </div>
            <Switch
              checked={enabled()}
              onChange={handleToggleServer}
              disabled={busy()}
              aria-label={t("settings.mcpEnableServer") as string}
            >
              <SwitchControl>
                <SwitchThumb />
              </SwitchControl>
            </Switch>
          </div>

          <Separator />

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center py-1">
            <div class="flex flex-col gap-0.5">
              <span class="text-sm font-medium">{t("settings.mcpPort") as string}</span>
              <span class="text-xs text-muted-foreground">
                {t("settings.mcpPortDescription") as string}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <TextField value={port()} onChange={setPort} class="w-full">
                <TextFieldInput
                  type="number"
                  placeholder="1622"
                  disabled={busy()}
                  class="h-9 font-mono text-xs"
                />
              </TextField>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. Optional Authentication */}
      <Card id={settingElementId("mcp-auth")}>
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            <span class="iconify mdi--shield-key-outline size-4 text-primary" />
            {t("settings.mcpAuthTitle") as string}
          </CardTitle>
          <CardDescription>{t("settings.mcpAuthDescription") as string}</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          <Separator />
          <div class="flex items-center justify-between gap-4 py-1">
            <div class="flex flex-col gap-0.5">
              <span class="text-sm font-medium">{t("settings.mcpRequireAuth") as string}</span>
              <span class="text-xs text-muted-foreground">
                {t("settings.mcpRequireAuthDescription") as string}
              </span>
            </div>
            <Switch
              checked={authEnabled()}
              onChange={setAuthEnabled}
              disabled={busy()}
              aria-label={t("settings.mcpRequireAuth") as string}
            >
              <SwitchControl>
                <SwitchThumb />
              </SwitchControl>
            </Switch>
          </div>

          <Show when={authEnabled()}>
            <div class="flex flex-col gap-2 rounded-lg bg-muted/30 p-3 border border-border/50">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("settings.mcpAuthToken") as string}
                </span>
                <div class="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="h-7 text-xs gap-1"
                    onClick={handleGenerateToken}
                    disabled={busy()}
                  >
                    <span class="iconify mdi--refresh size-3.5" />
                    {t("settings.mcpGenerateToken") as string}
                  </Button>
                  <Show when={authToken()}>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      class="h-7 text-xs gap-1"
                      onClick={() =>
                        handleCopyText(authToken(), t("settings.mcpTokenCopied") as string)
                      }
                    >
                      <span class="iconify mdi--content-copy size-3.5" />
                      {t("settings.mcpCopyToken") as string}
                    </Button>
                  </Show>
                </div>
              </div>

              <div class="relative flex items-center">
                <TextField value={authToken()} onChange={setAuthToken} class="w-full">
                  <TextFieldInput
                    type={showToken() ? "text" : "password"}
                    placeholder="Click 'Generate Token' or type custom secret"
                    disabled={busy()}
                    class="h-9 font-mono text-xs pr-10"
                  />
                </TextField>
                <button
                  type="button"
                  class="absolute right-2 text-muted-foreground hover:text-foreground transition-colors p-1"
                  onClick={() => setShowToken(!showToken())}
                  title={showToken() ? "Hide token" : "Show token"}
                >
                  <span
                    class={`iconify ${showToken() ? "mdi--eye-off-outline" : "mdi--eye-outline"} size-4`}
                  />
                </button>
              </div>
            </div>
          </Show>
        </CardContent>
      </Card>

      {/* 3. Endpoints & Client Config */}
      <Card>
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            <span class="iconify mdi--code-json size-4 text-primary" />
            {t("settings.mcpConfigTitle") as string}
          </CardTitle>
          <CardDescription>{t("settings.mcpConfigDescription") as string}</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          {/* Endpoint quick copy rows */}
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="flex flex-col gap-1 p-2.5 rounded-md bg-muted/40 border border-border/40">
              <span class="text-[11px] font-semibold text-muted-foreground">
                {t("settings.mcpSseEndpoint") as string}
              </span>
              <div class="flex items-center justify-between gap-2">
                <code class="text-xs font-mono text-foreground select-all truncate">
                  {sseUrl()}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6 shrink-0"
                  onClick={() => handleCopyText(sseUrl(), "SSE URL copied!")}
                >
                  <span class="iconify mdi--content-copy size-3.5" />
                </Button>
              </div>
            </div>

            <div class="flex flex-col gap-1 p-2.5 rounded-md bg-muted/40 border border-border/40">
              <span class="text-[11px] font-semibold text-muted-foreground">
                {t("settings.mcpDirectEndpoint") as string}
              </span>
              <div class="flex items-center justify-between gap-2">
                <code class="text-xs font-mono text-foreground select-all truncate">
                  {directUrl()}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6 shrink-0"
                  onClick={() => handleCopyText(directUrl(), "Direct URL copied!")}
                >
                  <span class="iconify mdi--content-copy size-3.5" />
                </Button>
              </div>
            </div>
          </div>

          <Separator />

          {/* Config Snippet Box */}
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1 bg-muted/50 p-0.5 rounded-lg border border-border/50">
                <button
                  type="button"
                  class={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                    activeConfigTab() === "claude"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setActiveConfigTab("claude")}
                >
                  Claude Desktop
                </button>
                <button
                  type="button"
                  class={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                    activeConfigTab() === "cursor"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setActiveConfigTab("cursor")}
                >
                  Cursor / Zed
                </button>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                class="h-7 text-xs gap-1.5"
                onClick={() =>
                  handleCopyText(
                    activeConfigTab() === "claude" ? claudeConfigSnippet() : cursorConfigSnippet(),
                    t("settings.mcpConfigCopied") as string,
                  )
                }
              >
                <span class="iconify mdi--content-copy size-3.5" />
                {t("settings.mcpCopyConfig") as string}
              </Button>
            </div>

            <pre class="overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs font-mono text-zinc-100 border border-zinc-800 leading-relaxed max-h-56">
              <code>
                {activeConfigTab() === "claude" ? claudeConfigSnippet() : cursorConfigSnippet()}
              </code>
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* 4. Exposed Tools & Resources list */}
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="iconify mdi--tools size-4 text-primary" />
              <CardTitle>{t("settings.mcpToolsTitle") as string}</CardTitle>
            </div>
            <Badge variant="outline" class="text-[11px] font-mono">
              {toolsQ.data?.length ?? 0} Tools &bull; {resourcesQ.data?.length ?? 0} Resources
            </Badge>
          </div>
          <CardDescription>{t("settings.mcpToolsDescription") as string}</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <For each={toolsQ.data ?? []}>
              {(tool) => (
                <div
                  class="flex flex-col gap-1 p-2.5 rounded-md bg-muted/30 border border-border/40 hover:border-primary/40 transition-colors cursor-pointer"
                  onClick={() => setExpandedTool(expandedTool() === tool.name ? null : tool.name)}
                >
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-1.5">
                      <span class="iconify mdi--cube-outline size-3.5 text-primary" />
                      <code class="text-xs font-semibold text-foreground">{tool.name}</code>
                    </div>
                    <span
                      class={`iconify ${expandedTool() === tool.name ? "mdi--chevron-up" : "mdi--chevron-down"} size-3.5 text-muted-foreground`}
                    />
                  </div>
                  <span class="text-[11px] text-muted-foreground line-clamp-1">
                    {tool.description}
                  </span>
                  <Show when={expandedTool() === tool.name}>
                    <pre class="mt-2 p-2 rounded bg-zinc-950 text-[10px] font-mono text-zinc-300 overflow-x-auto border border-zinc-800">
                      <code>{JSON.stringify(tool.schema, null, 2)}</code>
                    </pre>
                  </Show>
                </div>
              )}
            </For>
          </div>

          <div class="pt-2 flex flex-col gap-2">
            <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Resources
            </span>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <For each={resourcesQ.data ?? []}>
                {(res) => (
                  <div class="flex flex-col gap-0.5 p-2.5 rounded-md bg-muted/30 border border-border/40">
                    <div class="flex items-center gap-1.5">
                      <span class="iconify mdi--file-document-outline size-3.5 text-secondary-foreground" />
                      <code class="text-xs font-semibold text-foreground">{res.uri}</code>
                    </div>
                    <span class="text-[11px] text-muted-foreground line-clamp-1">
                      {res.description || res.name}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 5. Save Button */}
      <div class="flex justify-end pt-2">
        <Button
          type="button"
          class="font-bold h-9 shadow-sm hover:shadow-md transition-all gap-2"
          disabled={busy()}
          onClick={handleSaveSettings}
        >
          <span class="iconify mdi--content-save size-4" />
          {t("settings.mcpSaveSettings") as string}
        </Button>
      </div>
    </div>
  );
};
