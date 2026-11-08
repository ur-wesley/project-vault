# Pinned Project Tabbar — square, separators, scroll

## 1. Goal
Update the pinned project tabbar (`ProjectTabsBar` in row-2 of `WindowTitleBar`) to square tabs with no rounded corners, clear separators between tabs, and reliable horizontal scrolling when the bar overflows, keeping pin order, DnD reorder, active tracking, and Tauri drag regions intact.

## 2. Files
- `src/components/ProjectTabsBar.tsx` — main change (tab shape L53/99, strip container L68-72, scroll affordance, DnD ghost)
- `src/components/WindowTitleBar.tsx` — row-2 container L203-206 (`border-t`, height `h-9`) only if separator/height needs alignment
- Reference only (no touch): `src/components/EditorTabStrip.tsx:23` (square `border-r` pattern), `src/App.css` (`scrollbar-none` source), `src/lib/project-pins.ts`, `src/app/useSidebarData.ts:136-170`

## 3. Steps
1. Square tabs: remove `rounded-t-lg` + `rounded-b-none` from tab node (`L99`) and drag ghost (`L53`); change active top indicator (`L109-113` `rounded-full` → square `h-0.5 bg-primary`); keep running dot (`rounded-full size-1.5`) and close button (`rounded-full size-5`) round — they are not corners.
2. Separators: keep `gap-0` + `divide-x divide-border/40` on strip, switch per-tab `border border-b-0` to borderless or `border-r`-only so dividers stay single-line at overflow; verify no double-border with active `border-border/60` override.
3. Scrolling when full: keep `overflow-x-auto overflow-y-hidden shrink-0` single row, confirm `scrollbar-none` stays (clean look) and add overflow affordance — wheel-to-horizontal + fade masks and/or chevron buttons + keep existing `scrollIntoView` active-tab effect (`L36-43`).
4. Verify: pinned order, DnD reorder (`DndSortableRoot` horizontal), active select, unpin close, empty `tabsEmpty` state, `data-tauri-drag-region="false"` on strip intact, `--titlebar-height` offset unaffected.

## 4. Proposed Fabrik issues
- Title: `Square pinned tabs with separators and overflow scroll`
- Description: Square off `ProjectTabsBar` tabs, fix separators to single dividers, make overflow scroll discoverable and working with many pins.
- Acceptance:
  - No `rounded-t-lg`/`rounded-b-none`/`rounded-full` on tab frames or active indicator; tabs are square.
  - Visible single-line separator between every tab, including overflow and active/inactive mix.
  - With many pins bar stays one row, scrolls horizontally (wheel/touch/drag), active tab auto-scrolls into view, no wrap, no layout shift in titlebar.
  - Pin/unpin/reorder/select/empty-state unchanged.
- Deps: none (single-issue fast path — skip land on APPROVE, go straight to build).

## 5. Risks / non-goals
- Risks: `divide-x` + per-tab `border` double-line at overflow (needs browser check); `scrollbar-none` utility source not in repo (Tailwind/plugin-provided — confirm before restyling); `fixed` titlebar + `--titlebar-height` (App.tsx:340-346) breaks if tab `h-8`/`h-9` changes.
- Non-goals: no change to pin storage (`project-pins.ts`), `pinnedTabs()` building, favorites, sidebar sort, keyboard arrow-nav, overflow menu / max-visible-count, file `EditorTabStrip` styling, markdown CSS.

## 6. CTA
APPROVE → switch to build (single-issue fast path). REVIEW <note> → I amend spec. STOP → pause.
