import { render } from "solid-js/web";
import { Show, createSignal } from "solid-js";
import { QueryClient, QueryClientProvider, createQuery } from "@tanstack/solid-query";
import { Toaster } from "solid-sonner";
import { I18nProvider } from "~/lib/i18n-context";
import { getProject } from "~/services/tauri/projects";
import { queryKeys } from "~/services/query-keys";
import { CanvasView, onActiveProjectBroadcast } from "~/features/canvas";
import "./App.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 5,
      gcTime: 1000 * 60,
    },
  },
});

function CanvasWindowApp() {
  const urlParams = new URLSearchParams(window.location.search);
  const initialProjectId = urlParams.get("projectId") || "";
  const initialFollow = urlParams.get("follow") === "true";

  const [projectId, setProjectId] = createSignal(initialProjectId);
  const [follow, setFollow] = createSignal(initialFollow);

  // Listen to cross-window active project changes when follow is ON
  onActiveProjectBroadcast((newProjectId) => {
    if (follow() && newProjectId) {
      setProjectId(newProjectId);
    }
  });

  const projectQ = createQuery(() => ({
    queryKey: queryKeys.project(projectId()),
    queryFn: async () => {
      if (!projectId()) return null;
      const res = await getProject(projectId());
      return res.isOk() ? res.value : null;
    },
    enabled: !!projectId(),
  }));

  return (
    <div class="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground select-none">
      <Show
        when={projectQ.data}
        fallback={
          <div class="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
            Loading project context canvas...
          </div>
        }
      >
        <CanvasView
          project={() => projectQ.data!}
          isFlyout={true}
          followActive={follow()}
          onToggleFollowActive={() => setFollow(!follow())}
        />
      </Show>
      <Toaster richColors position="bottom-right" />
    </div>
  );
}

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <CanvasWindowApp />
      </I18nProvider>
    </QueryClientProvider>
  ),
  document.getElementById("root")!,
);
