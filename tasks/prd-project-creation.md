# PRD: Project Creation Wizard

## Introduction/Overview
The Project Creation Wizard provides a streamlined way for users to start new software projects. It handles the initial folder structure using remote templates, optionally creates a corresponding GitHub repository, and sets up local tool requirements using `mise`.

## Goals
1. Provide a user-friendly interface for project initialization.
2. Support dynamic fetching of project templates from remote registries.
3. Automate the creation of a GitHub repository for the new project.
4. Ensure the project is immediately ready for development with `mise` tool configuration.

## User Stories
1. As a developer, I want to choose from a list of remote templates so I don't have to set up boilerplate manually.
2. As a developer, I want the option to automatically create a GitHub repository for my new project during the wizard.
3. As a developer, I want the wizard to generate a `.mise.toml` file based on the template requirements.

## Functional Requirements
1. **Template Selection:**
   - The system must fetch a list of available templates from a remote registry/registry API.
   - The system must allow the user to select a template and provide a project name/path.
2. **GitHub Integration:**
   - The system must provide an optional toggle to "Create GitHub Repository".
   - If enabled, the system must use the GitHub API to create a new public/private repository.
3. **Mise Initialization:**
   - The system must detect tool requirements from the selected template.
   - The system must generate a `.mise.toml` file in the new project directory.
4. **Project Generation:**
   - The system must download and extract the template files into the target directory.
   - The system must perform basic variable substitution (e.g., project name) in template files.

## Non-Goals
- Complex CI/CD setup or GitHub Actions configuration.
- Initializing Git submodules or complex branch structures.
- Local tool installation (this is handled by the Tool Management module).

## Technical Considerations
- Integration with the existing `src/services/github.ts` for API calls.
- Use of `src-tauri/src/commands/project_wizard.rs` for filesystem operations.
- Templates should follow a standard format (e.g., cookiecutter or a custom JSON-based manifest).

## Success Metrics
- Average time to create a new project is under 30 seconds.
- 90% success rate for GitHub repository creation.

## Open Questions
- Which remote registry will be used for templates?
- Should we support custom template registry URLs?
