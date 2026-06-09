export const PREVIEW_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "svg",
  "avif",
]);

const PDF_EXTENSIONS = new Set(["pdf"]);

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  avif: "image/avif",
  pdf: "application/pdf",
};

export function getFileExtension(filename: string): string {
  const lower = filename.toLowerCase();
  const match = lower.match(/\.([^.]+)$/);
  return match ? match[1]! : "";
}

export function getPreviewMediaKind(filename: string): "image" | "pdf" | null {
  const ext = getFileExtension(filename);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (PDF_EXTENSIONS.has(ext)) return "pdf";
  return null;
}

export function getPreviewMimeType(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? "application/octet-stream";
}
