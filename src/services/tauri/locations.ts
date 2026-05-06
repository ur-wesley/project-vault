import type { LocationDto, LocationOrderEntry, PathDiskSpaceDto, AddLocationPayload, UpdateLocationPayload } from "~/types/dto";
import type { StableError } from "~/types/error";
import { tauriInvoke } from "./utils";

export function listLocations() {
  return tauriInvoke<LocationDto[]>("list_locations");
}

export function diskSpaceForPaths(paths: string[]) {
  return tauriInvoke<PathDiskSpaceDto[]>("disk_space_for_paths", { paths });
}

export function addLocation(payload: AddLocationPayload) {
  return tauriInvoke<LocationDto>("add_location", { payload });
}

export function removeLocation(id: string) {
  return tauriInvoke<void>("remove_location", { id });
}

export function updateLocation(payload: UpdateLocationPayload) {
  return tauriInvoke<LocationDto>("update_location", { payload });
}

export function reorderLocations(order: LocationOrderEntry[]) {
  return tauriInvoke<void>("reorder_locations", { order });
}
