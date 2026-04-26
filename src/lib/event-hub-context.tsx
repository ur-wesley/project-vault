import { createEventBus, createEventHub } from "@solid-primitives/event-bus";
import { createContext, useContext, type ParentComponent } from "solid-js";

export type ScanCompletePayload = { projectCount: number; locationId?: string };

function createAppEventHub() {
  return createEventHub({
    "scan:complete": createEventBus<ScanCompletePayload>(),
    "project:opened": createEventBus<{ projectId: string }>(),
    "session:started": createEventBus<{ sessionId: string; projectId: string }>(),
    "session:ended": createEventBus<{ sessionId: string }>(),
  });
}

export type AppEventHub = ReturnType<typeof createAppEventHub>;

const EventHubCtx = createContext<AppEventHub>();

export const EventHubProvider: ParentComponent = (props) => {
  const hub = createAppEventHub();
  return <EventHubCtx.Provider value={hub}>{props.children}</EventHubCtx.Provider>;
};

export function useEventHub() {
  const h = useContext(EventHubCtx);
  if (!h) throw new Error("EventHubProvider missing");
  return h;
}
