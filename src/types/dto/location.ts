export type LocationDto = {
  id: string;
  path: string;
  name: string;
  sortIndex: number;
  enabled: boolean;
  isDefault: boolean;
};

export type PathDiskSpaceDto = {
  path: string;
  totalBytes: number;
  availableBytes: number;
};

export type AddLocationPayload = {
  path: string;
  name?: string | null;
};

export type UpdateLocationPayload = {
  id: string;
  path?: string | null;
  name?: string | null;
  sortIndex?: number | null;
  enabled?: boolean | null;
  isDefault?: boolean | null;
};

export type LocationOrderEntry = {
  id: string;
  sortIndex: number;
};

export type SetFavoritePayload = {
  id: string;
  favorite: boolean;
};

export type ScanResultDto = {
  projectsDiscovered: number;
  projectsUpserted: number;
  projectsPruned: number;
  dirsSkippedErrors: number;
  monoreposExpanded: number;
  workspaceWarnings: number;
};

