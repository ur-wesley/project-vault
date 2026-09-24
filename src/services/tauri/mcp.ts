import type { McpServerStatusDto } from "~/types/dto";
import { tauriInvoke } from "./utils";

export function getMcpServerStatus() {
  return tauriInvoke<McpServerStatusDto>("get_mcp_server_status");
}

export function startMcpServer(options?: {
  port?: number;
  authEnabled?: boolean;
  authToken?: string;
}) {
  return tauriInvoke<McpServerStatusDto>("start_mcp_server", {
    port: options?.port,
    authEnabled: options?.authEnabled,
    authToken: options?.authToken,
  });
}

export function stopMcpServer() {
  return tauriInvoke<void>("stop_mcp_server");
}

export function generateMcpToken() {
  return tauriInvoke<string>("generate_mcp_token");
}

export function saveMcpSettings(payload: {
  enabled: boolean;
  port: number;
  authEnabled: boolean;
  authToken: string;
}) {
  return tauriInvoke<McpServerStatusDto>("save_mcp_settings", payload);
}

export type McpToolSummaryDto = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
};

export type McpResourceSummaryDto = {
  uri: string;
  name: string;
  description?: string | null;
};

export function listMcpTools() {
  return tauriInvoke<McpToolSummaryDto[]>("list_mcp_tools");
}

export function listMcpResources() {
  return tauriInvoke<McpResourceSummaryDto[]>("list_mcp_resources");
}
