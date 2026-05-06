import type { GitHubDeviceStartDto, GitHubDeviceTokenDto, GitHubDeviceWaitPayload } from "~/types/dto";
import { tauriInvoke } from "./utils";

export function isGithubDeviceConfigured(clientId?: string) {
  return tauriInvoke<boolean>("is_github_device_configured", { clientId: clientId ?? null });
}

export function startGithubDeviceFlow(clientId?: string) {
  return tauriInvoke<GitHubDeviceStartDto>("start_github_device_flow", { clientId: clientId ?? null });
}

export function waitGithubDeviceFlow(payload: GitHubDeviceWaitPayload, clientId?: string) {
  return tauriInvoke<GitHubDeviceTokenDto>("wait_github_device_flow", {
    payload,
    clientId: clientId ?? null,
  });
}
