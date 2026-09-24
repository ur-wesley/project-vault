export type TextFileDto = {
  text: string;
  sizeBytes: number;
  mtimeMs: number;
  /** True when the file exceeded the editor read cap and was clipped. */
  truncated: boolean;
};

export type FileStatDto = {
  sizeBytes: number;
  mtimeMs: number;
  isDir: boolean;
};

