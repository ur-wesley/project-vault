import { listLocations, scanLibraryLocation } from "~/services/tauri";

export async function rescanAllLibraryFolders(): Promise<number> {
  const locs = await listLocations();
  if (locs.isErr()) return 0;
  let upserted = 0;
  for (const loc of locs.value) {
    const scan = await scanLibraryLocation(loc.id);
    if (scan.isOk()) upserted += scan.value.projectsUpserted;
  }
  return upserted;
}
