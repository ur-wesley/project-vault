# Whiteboard

Canvas-node whiteboard on the **native Excalidraw v2 scene format**.
Boards persist `dataJson` as `{ type: "excalidraw", version: 2, … }` and
round-trip with [excalidraw.com](https://excalidraw.com): copy from there
pastes here, files downloaded here open there pixel-identical.

## Format

Canonical types: `excalidrawTypes.ts` (Zod schemas + inferred types),
factories in `excalidrawDefaults.ts` (`newElement`, `emptyScene`).
Elements carry `x/y/width/height/angle`, `strokeColor/backgroundColor`,
`fillStyle`, `strokeWidth/strokeStyle`, `roughness` (0 Architect /
1 Artist / 2 Cartoonist), `opacity` 0..100, `groupIds[]`, `frameId`,
`roundness` (`{ type: 0 }` sharp, `{ type: 3 }` round rectangles,
`{ type: 2 }` round ellipses/diamonds/connectors), `boundElements`,
`link`, `locked`, `seed/version/versionNonce`.

- Connectors (`arrow`/`line`) and `freedraw` store `points` **relative**
  to the `x/y` origin; every geometry entry point works in absolute
  board coords (`connectorAbsolutePoints`, `arrowPath`).
- `fontFamily` is `1` hand / `2` normal / `3` code. There is no
  bold/italic — the panel doesn't offer them.
- `startBinding`/`endBinding` are `{ elementId, focus, gap, side? }`.
  `side`+`focus` is our sticky-anchor extension; excalidraw.com ignores
  unknown keys, so files stay interoperable. Bindings without `side`
  (imports) resolve by ray-cast.
- Bound labels render **centered on their anchor** (container center,
  connector arc-length midpoint). The stored `x/y` is derived —
  `syncBoundTextOrigins` normalizes it on every commit/live update so
  persist == paint == export. Dragging a label moves its container.

## Dev-mode wipe (no migration, no schema freeze)

Old boards may be deleted and `dataJson` may break until ready.
`parseWhiteboardData` loads full scenes and bare `elements[]`; anything
else — legacy custom boards, garbage, unknown versions — loads as an
**empty scene**. There is intentionally no migration path.

## Import / export

Toolbar file row (`WhiteboardFileRow`) + board shell (`WhiteboardNode`):

- **Export `.excalidraw`** — canonical JSON download (opens on
  excalidraw.com). **Copy JSON** — clipboard, paste on excalidraw.com.
  **PNG/SVG** — canvas paint / standalone serializer.
- **Import** — file picker, file drop, or paste: full scenes, bare
  `elements[]`, `excalidrawlib` libraries, clipboard
  `{ elements, appState?, files? }` wrappers. Elements are Zod-validated
  one by one (unknown types drop with a skipped-type report), minted
  fresh `versionNonce`s, appended with id-collision remap; opening onto
  an empty board adopts the file's canvas settings.
- Images ride the `files` map (`fileId → { mimeType, dataURL }`), capped
  at 5 MB with a downscale warning. Files are **session-local**: they
  export but are not persisted to `dataJson`.

## Unsupported (out of scope)

Realtime collaboration, AI/mermaid/magicframe embeds, mobile touch
beyond basic pointer, image drops (import `.excalidraw` files instead),
image persistence across reloads, frame/image/embed draw tools (import
them), rotation rendering (the drag writes `angle`; paint stays
axis-aligned).

## Modules

| File | Responsibility |
| --- | --- |
| `excalidrawTypes` / `excalidrawDefaults` | schema, ids, empty scene, element factory |
| `serialize` | parse/encode the persisted scene (+ byte budget) |
| `geometry` / `geometryEdit` | bounds, hit-test, paths / move, resize, waypoints, handles |
| `bindings` | sticky side+focus anchors, endpoint resolution, back-refs |
| `boundText` | container links, label anchors, cascade delete, origin sync |
| `groups` | nestable `groupIds`, frames, union-scale |
| `paint` / `render` | element painters / board orchestration + selection chrome |
| `whiteboardStyle` | single-vocabulary style patch, apply, selection merge |
| `elementOps` | drafts, duplicate, reorder, nudge, lock/link |
| `useWhiteboardStore` | board state, history, persist, derived memos |
| `useWhiteboardStyle` | style signals, per-tool memory, live gestures |
| `useWhiteboardPointer` | redraw loop + gesture state machine |
| `pointerDraw` / `pointerTransform` | draw math / select+transform math |
| `useWhiteboardLabels` | label overlay state, placement, commit |
| `useWhiteboardInterop` | import/export wiring (`nativeScene`, `importText`) |
| `interop` / `interopExport` | payload parsing + merge / JSON-SVG-PNG exporters |
| `viewport` / `colors` / `rough` / `textMeasure` | zoom math / tint derivation / seeded jitter / text metrics |
| `history` | bounded undo/redo snapshots |
