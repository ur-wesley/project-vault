# SolidJS UI Style Guide

Conventions for building scalable, type-safe, maintainable UI with SolidJS and Tailwind CSS v4.

## Core Principles

- Use shared UI primitives in `components/ui` (the `solid-ui` layer), composed from headless primitives and `solid-sonner`
- Use Tailwind CSS for styling with `@theme` design tokens
- Use MDI icons via Iconify Tailwind plugin (`i-mdi-<icon>` classes)
- Prefer maintained `solid-primitives` over ad hoc reimplementation
- Keep UI and business logic strictly separate
- Shared context stores must expose a readonly tuple: `readonly [state, actions]`
- Prefer strong typing, readonly types, and immutable APIs
- Prefer composition over configuration
- Centralize mutations
- Derive state instead of duplicating it
- Keep reusable UI domain-agnostic
- Accessibility is required
- Use `@ur-wesley/ts-prelude/<subpath>` for `neverthrow` / `ts-pattern` / `remeda` usage

## Tech Stack

### SolidJS

- Prefer fine-grained reactivity
- Use the simplest reactive primitive that solves the problem
- Avoid unnecessary effects
- Keep data flow explicit
- Use `splitProps` / `mergeProps` / `children(() => ...)` for prop forwarding and dynamic children

### Headless Primitives

Build `solid-ui` on top of these layers:

- `@kobalte/core` for accessible primitives (dialog, popover, select, combobox, switch, slider, tooltip, etc.)
- `@ark-ui/solid` for primitives not in Kobalte (date-picker, etc.)
- `@corvu/drawer` for the drawer primitive
- `solid-sonner` for toasts (mount `<Toaster>` once at the root, call `toast()` everywhere else)

Rules:

- `components/ui` wraps these primitives and exposes a stable app-specific API
- Never import from `features/*` inside `components/ui`
- Never reach for raw HTML when a primitive already covers the behavior

### Variants and Class Composition

- `class-variance-authority` (`cva`) for variant APIs in `components/ui/*`
- `clsx` + `tailwind-merge` composed in a single `cn(...)` helper in `lib/utils`
- Components call `cn(...)` only — never import `clsx` or `twMerge` directly

### TanStack

Use TanStack libraries where they improve correctness and structure:

- `@tanstack/solid-query` for server state, caching, loading and error states, invalidation, and mutations
- `@tanstack/solid-table` for complex data tables
- `@tanstack/solid-router` for typed, file-based routing and route-driven data loading
- `@tanstack/router-plugin/vite` for the file-based route tree

Rules:

- Prefer TanStack Query over ad hoc fetch state management for shared or server data
- Keep TanStack usage out of low-level shared UI components
- Query keys and query functions must be typed
- Normalize server data before passing it into presentational UI
- Keep mutations in feature actions and services, not in generic UI atoms

### solid-primitives

Use `solid-primitives` whenever they fit. Prefer them over hand-rolled equivalents.

Common ones:

- `event-listener` — typed DOM listeners
- `media` — media queries
- `i18n` — dictionary provider
- `geolocation` — browser geolocation
- `keyed`, `storage` — keyed signals and persistence
- `throttle` / `debounce` — rate limiting
- `mutation-observer`, `resize-observer`, `intersection-observer` — DOM observation

Rules:

- Prefer maintained primitives over ad hoc reimplementation
- Keep primitive usage explicit and typed
- If a primitive exists, do not reimplement it inline

### Styling

- Tailwind CSS v4 via `@tailwindcss/vite`
- Tokens declared in `src/index.css` via `@theme` (oklch palette, radii, fonts)
- Theme switching via `[data-theme="..."]` selectors and `color-scheme`
- Iconify plugin loaded with `prefix: "i"` (`@iconify/tailwind4` + `@iconify-json/mdi`)
- Prefer semantic utility names tied to tokens over arbitrary values
- Avoid arbitrary values unless justified

### Typing

- All public APIs must be explicitly typed
- Never use `any`
- Prefer `unknown` and narrow properly
- Props, context values, actions, and utility return types must be typed
- Import from `@ur-wesley/ts-prelude/<subpath>` — never from the package root

## Project Structure

- `components/ui`: the `solid-ui` layer — reusable, domain-agnostic UI built from primitives
- `features/*`: domain-specific logic and composed components
- `services`: API and side-effect integrations
- `utils`: pure helpers
- `routes`: file-based route components and route logic
- `lib`: cross-cutting helpers (e.g. `cn(...)`, `i18n`)

## Atomic Design

- Atoms: smallest reusable building blocks
- Molecules: small combinations of atoms
- Organisms: larger reusable UI sections
- Templates: layout structures without feature logic
- Pages: route-level composition

Rules:

- Shared UI in `components/ui` must stay domain-agnostic
- Do not place feature or business logic in shared UI
- Prefer small, composable components

## Import Boundaries

- `components/ui` must not import from `features/*`
- Features may import from `components/ui`, `utils`, and `lib`
- Routes may compose features and shared UI
- Avoid circular dependencies

## Component Rules

- One component, one responsibility
- Keep props minimal and explicit
- Export every component prop type
- Mark props readonly
- Prefer `cva` for variants — avoid boolean prop explosion
- Use `children` intentionally
- Prefer composition over overly generic slot APIs
- Use `splitProps` / `mergeProps` for prop forwarding

## UI vs Logic

UI components render state.
Logic decides state.

Do:

- keep business logic in feature services, context actions, TanStack query hooks, or route-level orchestration

Do not:

- fetch data inside reusable UI atoms or molecules
- perform navigation in low-level shared components
- access storage directly in presentational shared UI
- embed business rules into generic UI components

## Reactivity Conventions

- `createSignal`: simple local state
- `createMemo`: derived or computed values
- `createStore`: grouped or nested state
- `createResource`: async loading tied to reactive sources
- `createEffect`: imperative side effects only

Rules:

- Use the simplest primitive possible
- Avoid effects for derivable state
- Do not use memos by default

## Context Store Pattern

All shared context stores must return:

```ts
readonly [state, actions];
```

Rules:

- State is readonly to consumers
- Actions are the only mutation path
- Context helpers must throw if used outside their provider
- Actions should express intent

Naming:

- `createXContext`
- `XProvider`
- `useXContext`

## State Ownership

- Local visual state stays local
- Shared feature state belongs in feature context
- App-wide state belongs in top-level providers
- Server state should usually live in TanStack Query, not duplicated in context
- Derive display state instead of storing duplicate flags
- SSE / streamed responses must be wrapped in `ResultAsync` and surface loading / empty / error / success states; never throw across the boundary

## TypeScript Rules

- Strong typing is mandatory
- All exported functions must have explicit return types
- All props, context values, actions, and utilities must be typed
- Use readonly by default
- Always import through `@ur-wesley/ts-prelude/<subpath>` — never from `neverthrow`, `ts-pattern`, or `remeda` directly
- Prefer:
  - `Readonly<T>`
  - `readonly T[]`
  - readonly tuples
- Avoid:
  - `any`
  - broad `object`
  - broad `Function`

## Styling Rules

- Use Tailwind CSS utilities in JSX
- Keep spacing, radii, colors, and typography aligned to `@theme` tokens
- Extract repeated patterns into reusable component APIs (cva variants, named molecules)
- Interactive components should define:
  - default
  - hover
  - `focus-visible`
  - active
  - disabled
  - `aria-invalid` if applicable
  - `data-[state=...]` for stateful primitives (open, checked, etc.)

## Icons

- Use MDI icons via the Iconify Tailwind plugin: `i-mdi-<icon>`
- Configure the plugin with `prefix: "i"`
- Color and size with `text-*` and `size-*` utilities
- Decorative icons must use `aria-hidden="true"`
- Icon-only controls must have an accessible label
- Prefer standard MDI icons over ad hoc custom SVGs when possible

## Accessibility

Required:

- Use semantic HTML first
- Every interactive element must be keyboard accessible
- Visible focus styles are mandatory
- Use ARIA only when native semantics are insufficient
- Icon-only controls must have labels
- Form controls must have labels
- Error messages must be associated correctly
- Support reduced motion where relevant

Do not:

- use clickable `div`s
- remove focus styles without replacement
- rely only on color to communicate state

## Forms

Every form field pattern should support:

- label
- control
- helper text
- error text

Rules:

- Validation logic stays outside low-level UI
- Normalize field states across input-like components
- Define whether a component is controlled, uncontrolled, or both

## Async Data

- Prefer `@tanstack/solid-query` for server state
- Keep fetching out of low-level shared UI
- Normalize API data before passing to presentational components
- Handle loading, empty, error, and success states explicitly
- Wrap streamed / SSE responses in `ResultAsync`; never throw past the boundary

## Helpers and Error Modeling

Always import through `@ur-wesley/ts-prelude/<subpath>`. The package root exports only `VERSION` — never import from it for application logic.

### Subpaths in scope

| Subpath | Used for | Replaces |
| --- | --- | --- |
| `/result` | `Result`, `ResultAsync`, `ok`, `err`, `matchResult`, `runCatching`, `traverse`, `combineWithAllErrors` | direct `neverthrow` |
| `/option` | `Option<T>` for nullable values, `fromNullable`, `map`, `andThen`, `getOrElse`, `zip` | `T \| null` chains |
| `/match` | `match` + `R` / `O` / `P` for exhaustive branching on `Result` / `Option` / tagged unions | direct `ts-pattern` |
| `/pipe` | `pipe` / `flow` / `tap` / `dbg` for left-to-right composition | direct `remeda` |
| `/scope` | `let_`, `run`, `apply`, `also`, `with_`, `ifSome`, `ifOk`, `ifErr`, `require` | inline IIFEs |
| `/interop` | `fromNullable`, `toOption`, `toResult` at API boundaries | manual narrowing |
| `/types` | `brand`, `tag`, `assertNever`, `refine`, `head` for ADTs and branded types | hand-rolled brands |
| `/record` | `copy`, `update`, `updatePath` for immutable updates | spread-mutation smell |
| `/async` | `retry`, `withTimeout`, `race`, `parallel`, `asyncTraverse` for `ResultAsync` | hand-rolled retry / timeout |
| `/data/<fn>` | one remeda function per file when only one helper is needed (`filter`, `groupBy`, `sortBy`, `uniqueBy`, `find`, `chunk`, `partition`, `omit`, `pick`, …) | `import * as R from "remeda"` |
| `/log` | structured logging via consola — `logger.info`, `logger.withTag(...)` | `console.*` |

### Out of scope (mentioned briefly)

- `/config` — typesafe env config; useful in services and tooling, not in components
- `/wire` — composition-root only; not a service locator
- `/resource` — `defer` / `usingResource` / `using` / `usingAsync` for `Disposable`
- `/lazy` — `lazy` / `once` memoization
- `/iter` — lazy iterator combinators (`fromArray`, `flatMap`, `take`, `skip`, `enumerate`)

### When to use which module

- nullable value → `fromNullable` / `toOption` (`/option`, `/interop`)
- fallible operation → `ok` / `err` / `runCatching` (`/result`)
- exhaustive branching → `match` + `R` / `O` / `P` + `.exhaustive()` (`/match`)
- transform in place → `let_` or `pipe(value, fn1, fn2)` (`/scope`, `/pipe`)
- side-effect logging → `logger` from `/log`, or `tap` / `dbg` in pipes (`/pipe`)
- single array helper → `data/<name>` (`/data/<fn>`)
- branded / ADT types → `brand` / `tag` / `assertNever` (`/types`)
- retries / timeouts → `retry` / `withTimeout` (`/async`)

### Use `@ur-wesley/ts-prelude` especially for

- parsing and validation helpers
- API response normalization
- mapping DTOs to domain models
- feature services with recoverable failures

### Avoid it in

- simple UI event handlers
- trivial synchronous helpers that cannot fail
- places where framework APIs already require thrown errors

## Error Handling

- Use error boundaries at route and major feature boundaries
- Provide graceful fallbacks
- Distinguish recoverable UI errors from fatal app errors
- Pair route-level `<ErrorBoundary>` with `@ur-wesley/ts-prelude/result` errors; never `throw` a `Result.err` upstream

## Performance

- Use `For` for keyed list rendering
- Use `Index` when identity is stable and index optimization helps
- Avoid unnecessary memos
- Avoid broad reactive reads in large components
- Lazy-load heavy route sections when useful
- Avoid premature optimization that harms clarity

## Naming

### Components

- `PascalCase`

### Functions and helpers

- `camelCase`

### Factories or hooks or context helpers

- `createX`
- `useX`
- `getX`

### Actions

Use verb-based names:

- `toggle`
- `open`
- `close`
- `setItems`
- `submit`

## Documentation

Reusable UI components should document:

- purpose
- props
- variants
- accessibility notes
- example usage

## SSR and Hydration

- Guard browser-only APIs
- Avoid non-deterministic SSR output
- Do not read `window`, `document`, or storage during server render
- Isolate client-only behavior explicitly

## Do / Don't

### Do

- build shared UI in `components/ui` as the `solid-ui` layer
- compose shared primitives from Kobalte / Ark UI / Corvu / `solid-sonner` / `cva`
- use `solid-primitives` when they fit
- use `@ur-wesley/ts-prelude/<subpath>` for `neverthrow` / `ts-pattern` / `remeda` usage
- keep business logic out of presentational components
- use readonly tuple context stores
- use Tailwind v4 with `@theme` tokens consistently
- use `i-mdi-<icon>` for icons via the Iconify plugin
- use TanStack Query for server state
- use strong typing everywhere
- derive state where possible
- prioritize accessibility

### Don't

- import from `@ur-wesley/ts-prelude` (root export is `VERSION` only)
- import from `neverthrow`, `ts-pattern`, or `remeda` directly
- fetch data inside atoms
- mutate shared state outside actions
- place feature logic in generic UI components
- use `any`
- create giant configurable components by default
- duplicate the same state in multiple places
- bypass shared UI primitives without reason
- reimplement what `solid-primitives` already provides
- `throw` across a recoverable boundary
