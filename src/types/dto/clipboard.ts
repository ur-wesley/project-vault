export type ClipboardEntryMetaDto = {
  filePaths: string[];
  width?: number;
  height?: number;
  byteSize?: number;
  mime?: string;
};

export type ClipboardEntryDto = {
  id: string;
  kind: string;
  preview: string;
  contentText?: string | null;
  contentHash: string;
  payloadPath?: string | null;
  meta: ClipboardEntryMetaDto;
  sourceApp?: string | null;
  pinned: boolean;
  createdAtMs: number;
};

export type ClipboardHistorySettingsDto = {
  enabled: boolean;
  maxEntries: number;
  maxImageBytes: number;
  dedupSeconds: number;
  showSource: boolean;
};

export type ClipboardOverlayPositionDto = {
  windowX: number;
  windowY: number;
  windowWidth: number;
  windowHeight: number;
};

