import { render } from "solid-js/web";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { Toaster } from "solid-sonner";
import { ClipboardHistoryOverlay } from "~/features/clipboard-history/ClipboardHistoryOverlay";
import { I18nProvider } from "~/lib/i18n-context";
import "./App.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 5,
      gcTime: 1000 * 60,
    },
  },
});

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ClipboardHistoryOverlay />
        <Toaster richColors position="top-center" />
      </I18nProvider>
    </QueryClientProvider>
  ),
  document.getElementById("root")!,
);
