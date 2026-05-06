import { tauriInvoke } from "./utils";

export function pickLibraryFolder() {
  return tauriInvoke<string | null>("pick_library_folder");
}

export function pickProjectParentFolder() {
  return tauriInvoke<string | null>("pick_project_parent_folder");
}
