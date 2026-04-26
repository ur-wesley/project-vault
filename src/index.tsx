/* @refresh reload */
import { listen } from "@tauri-apps/api/event";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { onCleanup, onMount, type ParentComponent } from "solid-js";
import { render } from "solid-js/web";
import App from "./App";
import { EventHubProvider } from "./lib/event-hub-context";
import { I18nProvider } from "./lib/i18n-context";
import { queryKeys } from "./services/query-keys";

const queryClient = new QueryClient();

const Root: ParentComponent = (props) => {
  onMount(() => {
    let unlisten: (() => void) | undefined;
    void listen("session:ended", () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    }).then((fn) => {
      unlisten = fn;
    });
    onCleanup(() => {
      unlisten?.();
    });
  });
  return <>{props.children}</>;
};

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <Root>
        <EventHubProvider>
          <I18nProvider>
            <App />
          </I18nProvider>
        </EventHubProvider>
      </Root>
    </QueryClientProvider>
  ),
  document.getElementById("root") as HTMLElement,
);
