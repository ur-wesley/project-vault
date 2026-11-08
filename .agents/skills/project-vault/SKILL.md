---
name: project-vault
description: "Trigger: managing projects or kanban cards in Project Vault. Operates the Project Vault MCP server for board automation."
license: MIT
metadata:
  author: project-vault
  version: "1.0"
---

# Project Vault MCP Server Operations

Provides runtime instructions for interacting with the Project Vault embedded MCP server (`http://127.0.0.1:1622/sse` or `/mcp`) to manage projects, markdown kanban boards, and isolated agent worktrees.

## Activation Contract

Activate this skill when:
- Querying vault projects, runtimes, stacks, locations, or git status.
- Creating, updating, querying, or moving markdown kanban cards (`.vault/kanban/`).
- Managing isolated git worktrees or launching coding-agent sessions (`opencode`, `cursor-agent`).
- Tracking agent session execution tails, pushing branches, or orchestrating PR creation and merge flows.

## Hard Rules

1. **Project Root Resolution**: When calling kanban tools, provide the project name, ID, or absolute root directory in `project`.
2. **Card State Validity**: Card column transitions (`status` or `move_card.to`) MUST use valid columns: `backlog`, `todo`, `doing`, `review`, `done`, or `cancelled`.
5. **Session Monitoring**: To inspect running agent progress, call `get_execution` to read the live PTY terminal buffer tail instead of polling processes directly.

## Decision Gates

| Action / Goal | Primary MCP Tool | Key Arguments |
| --- | --- | --- |
| Find project by name/tag | `search_projects` | `query: "<term>"` |
| Inspect project details & tasks | `get_project` | `id_or_name: "<id_or_name>"` |
| Check repo branch / dirty status | `get_git_status` | `project_id_or_path: "<path_or_id>"` |
| List kanban boards | `list_boards` | `project: "<project>"` |
| Read board cards & layout | `get_board` | `project: "<project>", board_id: "<board>"` |
| Filter / search cards | `list_cards` | `project: "...", board_id: "...", status: "...", search: "..."` |
| Create kanban card | `create_card` | `project: "...", board_id: "...", title: "...", body: "..."` |
| Update card fields | `update_card` | `project: "...", board_id: "...", card_id: "...", <fields>` |
| Close issue | `close_issue` | `project_id: "...", issue_number: <num_or_id>, reason: "..."` |
| Transition card column | `move_card` | `project: "...", board_id: "...", card_id: "...", to: "<column>"` |
| Read agent live output | `get_execution` | `session_id: "<session_id>"` |
| Send prompt to agent | `session_prompt` | `session_id: "...", prompt: "..."` |

## Execution Steps

### 1. Board & Card Management
1. Discover project and board: call `list_projects` -> `list_boards(project)`.
2. Inspect cards: call `list_cards` or `get_board`.
3. Create task: call `create_card(project, board_id, title, body, status="todo")`.
4. Transition state: call `move_card` as work begins (`doing`) or enters verification (`review`).

### 2. Isolated Workspace Automation
1. Identify target card and project.
2. Call `start_workspace(project, name, board_id, card_id)` to spin up isolated git worktree branch and coding agent.
3. Check agent progress via `get_execution(session_id)`. Send guidance via `session_prompt` if required.
4. Once tests pass, call `workspace_push(workspace_id)`.
5. Call `create_pr(workspace_id)` to open the pull request.
6. Upon approval, call `merge_pr(workspace_id, owner, repo, number)` to merge, close the workspace, and advance the card to `done`.

## Output Contract

- **Query Responses**: Present project names, IDs, paths, stacks, and git status concisely.
- **Card Updates**: Report card ID, board ID, and new status column upon card creation or move.

## References

- [Tools Reference](references/tools-reference.md) — Parameter schemas for all 35 Project Vault tools.
- [Connection Guide](references/connection-guide.md) — Server endpoints (`/sse`, `/mcp`), client configuration, and authentication.
- [Kanban Workflow](references/kanban-workflow.md) — Markdown card format, column lifecycles, and card links.
