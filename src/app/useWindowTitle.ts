import { createEffect, createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { getProject } from "~/services/tauri/projects";
import { queryKeys } from "~/services/query-keys";
import type { TFunction } from "./useSidebarData";

/**
 * Window/titlebar title domain: project query, header title, document title.
 * (Extracted verbatim from App.)
 */
export function useWindowTitle(opts: {
  t: TFunction;
  activeView: Accessor<string>;
  projectDetailId: Accessor<string | null>;
  pluginPageId: Accessor<string | null>;
  activePluginPageMeta: () => { title?: string } | undefined;
}) {
  const { t, activeView, projectDetailId, pluginPageId, activePluginPageMeta } = opts;

  const titleBarProjectQ = createQuery(() => {
    const id = projectDetailId();
    return {
      queryKey: queryKeys.project(id ?? "none"),
      queryFn: async () => {
        if (id == null) return null;
        const r = await getProject(id);
        if (r.isErr()) throw new Error(r.error.message);
        return r.value;
      },
      enabled: id != null,
    };
  });

  const windowHeaderTitle = createMemo(() => {
    if (activeView() === "settings") {
      return t("settings.title") as string;
    }
    if (activeView() === "processes") {
      return t("processes.title") as string;
    }
    if (activeView() === "plugin") {
      return activePluginPageMeta()?.title ?? pluginPageId() ?? (t("app.title") as string);
    }
    if (projectDetailId() == null) {
      return t("app.title") as string;
    }
    if (titleBarProjectQ.data != null) {
      return titleBarProjectQ.data.name;
    }
    return t("app.title") as string;
  });

  createEffect(() => {
    const appName = t("app.title") as string;
    const view = activeView();
    const id = projectDetailId();
    const projectName =
      id != null && titleBarProjectQ.data != null ? titleBarProjectQ.data.name : null;
    let s = appName;
    if (view === "processes") {
      s = `${t("processes.title") as string} \u2013 ${appName}`;
    } else if (view === "settings") {
      s = `${t("settings.title") as string} \u2013 ${appName}`;
    } else if (view === "plugin") {
      const pageTitle = activePluginPageMeta()?.title;
      s = pageTitle ? `${pageTitle} \u2013 ${appName}` : appName;
    } else if (projectName != null && projectName.length > 0 && projectName !== appName) {
      s = `${projectName} \u2013 ${appName}`;
    }
    document.title = s;
    if (isTauri()) {
      void getCurrentWindow().setTitle(s);
    }
  });

  return { titleBarProjectQ, windowHeaderTitle };
}
