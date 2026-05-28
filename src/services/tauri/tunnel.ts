import { tauriInvoke } from "./utils";

export interface TunnelRoute {
  hostname: string;
  port: number;
  sessionId: string;
  url: string;
}

export interface TunnelStatus {
  available: boolean;
  proxyRunning: boolean;
  routes: TunnelRoute[];
}

export interface EnableTunnelInput {
  sessionId: string;
  projectId: string;
  port: number;
  subdomain: string;
}

export function checkTunnelAvailable(): ReturnType<typeof tauriInvoke<boolean>> {
  return tauriInvoke<boolean>("check_tunnel_available");
}

export function trustPortlessCa(): ReturnType<typeof tauriInvoke<void>> {
  return tauriInvoke<void>("trust_portless_ca");
}

export function startTunnelProxy(): ReturnType<typeof tauriInvoke<void>> {
  return tauriInvoke<void>("start_tunnel_proxy");
}

export function stopTunnelProxy(): ReturnType<typeof tauriInvoke<void>> {
  return tauriInvoke<void>("stop_tunnel_proxy");
}

export function enableTunnel(input: EnableTunnelInput): ReturnType<typeof tauriInvoke<string>> {
  return tauriInvoke<string>("enable_tunnel", { input });
}

export function disableTunnel(
  sessionId: string,
  projectId: string,
): ReturnType<typeof tauriInvoke<void>> {
  return tauriInvoke<void>("disable_tunnel", { sessionId, projectId });
}

export function getTunnelStatus(): ReturnType<typeof tauriInvoke<TunnelStatus>> {
  return tauriInvoke<TunnelStatus>("get_tunnel_status");
}
