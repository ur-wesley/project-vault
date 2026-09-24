export type IndexMetaDto = {
  indexedFiles: number;
  indexSizeBytes: number;
  lastUpdatedMs: number | null;
};

export type SearchSnippetDto = {
  lineNumber: number;
  text: string;
  html: string;
};

export type SearchHitDto = {
  path: string;
  score: number;
  highlights: SearchSnippetDto[];
  lineNumbers: number[];
};

