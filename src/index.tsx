/* @refresh reload */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { onCleanup, onMount, type ParentComponent } from "solid-js";
import { render } from "solid-js/web";
import App from "./App";
import { EventHubProvider } from "./lib/event-hub-context";
import { I18nProvider } from "./lib/i18n-context";
import { ShortcutProvider } from "./lib/shortcut-context";
import { useRealtimeProjects } from "./lib/use-realtime-projects";
import { LivePlaytimeProvider } from "./lib/live-playtime-context";
import { NotificationCenterProvider } from "./lib/notification-store";
import { PluginUpdatesNotificationHost } from "./components/PluginUpdatesNotificationHost";
import { PluginDiscoveriesHost } from "./components/PluginDiscoveriesHost";
import { getPluginLogStore, type BackendPluginLog } from "./lib/plugin/plugin-log-store";
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
      void queryClient.invalidateQueries({ queryKey: ["processes", "all"] });
    }).then((fn) => unlistens.push(fn));

    void listen("task-state-changed", () => {
      void queryClient.invalidateQueries({ queryKey: ["processes", "all"] });
    }).then((fn) => unlistens.push(fn));

    void listen<{ locationId: string }>("location:scan-completed", () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.locations });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    }).then((fn) => unlistens.push(fn));

    // Subscribe first so nothing emitted after this point is lost, then
    // backfill everything buffered before subscription (startup logs) and
    // from before a frontend reload. Hydrate merges, so no duplicates.
    void listen<BackendPluginLog>("plugin:log", (event) => {
      getPluginLogStore().append(event.payload);
    }).then((fn) => unlistens.push(fn));

    void invoke<BackendPluginLog[]>("get_plugin_logs")
      .then((entries) => getPluginLogStore().hydrate(entries))
      .catch(() => {
        // Web dev without the Tauri backend — console just stays live-only.
      });

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
              <NotificationCenterProvider>
                <LivePlaytimeProvider>
                  <PluginUpdatesNotificationHost />
                  <PluginDiscoveriesHost />
                  <App />
                </LivePlaytimeProvider>
              </NotificationCenterProvider>
            </I18nProvider>
          </ShortcutProvider>
        </EventHubProvider>
      </Root>
    </QueryClientProvider>
  ),
  document.getElementById("root") as HTMLElement,
);
