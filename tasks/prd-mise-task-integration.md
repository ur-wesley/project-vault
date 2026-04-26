# PRD: Mise Task Integration

## Introduction/Overview
This feature integrates `mise` tasks into the application's task system. It allows users to discover existing tasks defined in `.mise.toml` and provides a GUI to create or modify tasks.

## Goals
1. Automatically expose `mise` tasks as executable actions in the UI.
2. Provide a visual editor for defining new tasks without manually editing TOML files.
3. Centralize task management for a project.

## User Stories
1. As a developer, I want to see all tasks defined in my `mise.toml` in the app's task list.
2. As a developer, I want to create a new task (e.g., `build:prod`) using a form and have it saved to `mise.toml`.
3. As a developer, I want to run a `mise` task with a single click.

## Functional Requirements
1. **Task Discovery:**
   - The system must scan the project root for `.mise.toml` or `mise.toml`.
   - The system must parse the `[tasks]` section and display them in a list.
2. **Task Creation GUI:**
   - The system must provide a form to enter task name, command, description, and dependencies.
   - The system must write the new task into the project's `mise.toml` file.
3. **Task Execution:**
   - The system must allow triggering a `mise` task which will then be handled by the Task Runner.
4. **Task Editing:**
   - The system must allow modifying existing `mise` tasks via the UI.

## Non-Goals
- Supporting non-`mise` task runners (e.g., raw `Makefile`, `just`) unless they are invoked via `mise`.
- Complex task dependency visualization (graph views).

## Technical Considerations
- Use of a TOML parser in the frontend or backend to read/write `mise.toml`.
- Mapping `mise` task properties (run, depends, description) to the application's internal Task model.

## Success Metrics
- 100% parity between `mise tasks` CLI output and UI display.
- Users report higher satisfaction from using the GUI over manual TOML editing.

## Open Questions
- How to handle multi-line script tasks in a simple form?
- Should we support `mise` task aliases?
