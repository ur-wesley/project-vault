export type LiveSessionState = "running" | "starting";

export function isLiveSessionState(state: string): state is LiveSessionState {
  return state === "running" || state === "starting";
}
