# SolidJS UI Style Guide

Conventions for building scalable, type-safe, maintainable UI with SolidJS.

## Core Principles

- Use shared UI primitives from `components/ui`, composed from `solid-ui` where appropriate
- Use Tailwind CSS for styling
- Use MDI icons via `i-mdi-<icon>` classes
- Keep UI and business logic strictly separate
- Shared context stores must expose a readonly tuple: `readonly [state, actions]`
- Prefer strong typing, readonly types, and immutable APIs
- Prefer composition over configuration
- Centralize mutations
- Derive state instead of duplicating it
- Keep reusable UI domain-agnostic
- Accessibility is required

## Tech Stack

### SolidJS

- Prefer fine-grained reactivity
- Use the simplest reactive primitive that solves the problem
- Avoid unnecessary effects
- Keep data flow explicit

### TanStack

Use TanStack libraries where they improve correctness and structure:

- `@tanstack/solid-query` for server state, caching, loading and error states, invalidation, and mutations
- `@tanstack/solid-table` for complex data tables
- `@tanstack/solid-router` if the app uses TanStack Router for typed routing and route-driven data loading

Rules:

- Prefer TanStack Query over ad hoc fetch state management for shared or server data
- Keep TanStack usage out of low-level shared UI components
- Query keys and query functions must be typed
- Normalize server data before passing it into presentational UI
- Keep mutations in feature actions and services, not in generic UI atoms

### UI Components

- Shared UI must live in `components/ui`
- Prefer `solid-ui` components and patterns as the baseline for shared primitives
- Wrap or compose `solid-ui` components locally to keep app-specific APIs stable
- Shared UI must be domain-agnostic
- Feature-specific components should compose shared UI primitives

### Styling

- Use Tailwind CSS utility classes directly in JSX
- Prefer design tokens and semantic conventions
- Avoid arbitrary values unless justified
- Use Tailwind utilities to size, color, and align `i-mdi-<icon>` icons

### Typing

- All public APIs must be explicitly typed
- Never use `any`
- Prefer `unknown` and narrow properly
- Props, context values, actions, and utility return types must be typed

## Project Structure

- `components/ui`: reusable, domain-agnostic UI built from local primitives and `solid-ui` compositions
- `features/*`: domain-specific logic and composed components
- `services`: API and side-effect integrations
- `types`: shared types
- `utils`: pure helpers
- `pages`: route-level assembly
- `routes`: route components and route logic

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
- Features may import from `components/ui`, `types`, and `utils`
- Pages may compose features and shared UI
- Avoid circular dependencies

## Component Rules

- One component, one responsibility
- Keep props minimal and explicit
- Export every component prop type
- Mark props readonly
- Prefer explicit unions for variants
- Avoid boolean prop explosion
- Use `children` intentionally
- Prefer composition over overly generic slot APIs

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
readonly[(state, actions)];
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

## TypeScript Rules

- Strong typing is mandatory
- All exported functions must have explicit return types
- All props, context values, actions, and utilities must be typed
- Use readonly by default
- Prefer `neverthrow` for helpers and services with recoverable failure paths
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
- Keep spacing, radii, colors, and typography aligned to design tokens
- Extract repeated patterns into reusable component APIs
- Interactive components should define:
  - default
  - hover
  - focus-visible
  - active
  - disabled
  - error if applicable

## Icons

- Use MDI icons via `i-mdi-<icon>` classes
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

## Helpers and Error Modeling

- Prefer `neverthrow` for helpers and services with recoverable failure paths
- Use `Result<T, E>` or `ResultAsync<T, E>` for explicit error handling
- Keep error types narrow, typed, and domain-specific
- Convert unknown or external errors into typed errors at module boundaries
- Reserve thrown errors for exceptional cases, framework boundaries, or fatal failures

Use `neverthrow` especially for:

- parsing and validation helpers
- API response normalization
- mapping DTOs to domain models
- feature services with recoverable failures

Avoid using it in:

- simple UI event handlers
- trivial synchronous helpers that cannot fail
- places where framework APIs already require thrown errors

## Error Handling

- Use error boundaries at route and major feature boundaries
- Provide graceful fallbacks
- Distinguish recoverable UI errors from fatal app errors

## Performance

- Use `For` for keyed list rendering
- Use `Index` when identity is stable and index optimization helps
- Avoid unnecessary memos
- Avoid broad reactive reads in large components
- Lazy-load heavy route sections when useful
- Avoid premature optimization that harms clarity

## solid-primitives

Use `solid-primitives` when they improve correctness or ergonomics.

Examples:

- **`@solid-primitives/i18n`**: locale dictionaries, reactive `t()` usage; no hardcoded user-facing strings in feature modules.
- **`@solid-primitives/event-bus`**: typed publish/subscribe between features (e.g. scan finished, session started); avoid importing feature internals across boundaries.
- **`@solid-primitives/keyboard`**: global and scoped shortcuts; register in one place and clean up on scope teardown.
- click outside, media queries, event listeners, resize observers, persisted signals, element bounds (other packages as needed)

Rules:

- Prefer maintained primitives over ad hoc reimplementation
- Keep primitive usage explicit and typed

### Command palette

- Use Solid UI **`command`** (`~/components/ui/command`, **cmdk-solid**) for palette UX; compose in `features/*`, not inside generic `components/ui` wrappers that know domain.

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

- build shared UI in `components/ui`
- compose shared primitives from `solid-ui` where it reduces custom boilerplate
- keep business logic out of presentational components
- use readonly tuple context stores
- use Tailwind CSS consistently
- use `i-mdi-<icon>` for icons
- use TanStack Query for server state
- use strong typing everywhere
- derive state where possible
- prioritize accessibility

### Don't

- fetch data inside atoms
- mutate shared state outside actions
- place feature logic in generic UI components
- use `any`
- create giant configurable components by default
- duplicate the same state in multiple places
- bypass shared UI primitives without reason
