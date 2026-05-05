/* @refresh reload */
import { listen } from "@tauri-apps/api/event";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { onCleanup, onMount, type ParentComponent } from "solid-js";
import { render } from "solid-js/web";
import App from "./App";
import { EventHubProvider } from "./lib/event-hub-context";
import { I18nProvider } from "./lib/i18n-context";
import { ShortcutProvider } from "./lib/shortcut-context";
import { useRealtimeProjects } from "./lib/use-realtime-projects";
import { queryKeys } from "./services/query-keys";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      gcTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

const Root: ParentComponent = (props) => {
  useRealtimeProjects();

  onMount(() => {
    const unlistens: (() => void)[] = [];

    void listen("session:ended", () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    }).then((fn) => unlistens.push(fn));

    void listen<{ locationId: string }>("location:scan-completed", () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.locations });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    }).then((fn) => unlistens.push(fn));

    onCleanup(() => {
      for (const fn of unlistens) fn();
    });
  });
  return <>{props.children}</>;
};

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <Root>
        <EventHubProvider>
          <ShortcutProvider>
            <I18nProvider>
              <App />
            </I18nProvider>
          </ShortcutProvider>
        </EventHubProvider>
      </Root>
    </QueryClientProvider>
  ),
  document.getElementById("root") as HTMLElement,
);
