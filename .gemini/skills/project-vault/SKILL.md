---
name: project-vault
description: "Trigger: managing projects, kanban cards, or agent worktrees in Project Vault. Operates the Project Vault MCP server for workspace and board automation."
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
3. **Card-Prompt Inheritance**: When creating a workspace for a card via `start_workspace`, supply `board_id` and `card_id`; do NOT duplicate card content in `prompt` unless augmenting instructions.
4. **Non-Destructive Deletions**: Do not call `delete_workspace` with `delete_branch: true` or `delete_board` without explicit user confirmation.
5. **Session Monitoring**: To inspect running agent progress, call `get_execution` to read the live PTY terminal buffer tail instead of polling processes directly.
6. **PR Merge Automation**: Use `merge_pr` to finalize workspace tasks; it automatically transitions linked kanban cards to `done` and archives the workspace.

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
| Transition card column | `move_card` | `project: "...", board_id: "...", card_id: "...", to: "<column>"` |
| List agent worktrees | `list_workspaces` | `project: "<project>"` |
| Launch agent in worktree | `start_workspace` | `project: "...", name: "...", board_id: "...", card_id: "..."` |
| Read agent live output | `get_execution` | `session_id: "<session_id>"` |
| Send prompt to agent | `session_prompt` | `session_id: "...", prompt: "..."` |
| Push worktree branch | `workspace_push` | `workspace_id: "<workspace_id>"` |
| Open GitHub PR | `create_pr` | `workspace_id: "<workspace_id>"` |
| Merge PR & complete card | `merge_pr` | `workspace_id: "...", owner: "...", repo: "...", number: <num>` |

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
- **Agent Workspaces**: State workspace ID, worktree path, branch name, and latest terminal output tail when reporting session progress.

## References

- [Tools Reference](references/tools-reference.md) — Parameter schemas for all 35 Project Vault tools.
- [Connection Guide](references/connection-guide.md) — Server endpoints (`/sse`, `/mcp`), client configuration, and authentication.
- [Kanban Workflow](references/kanban-workflow.md) — Markdown card format, column lifecycles, and card links.
- [Workspaces Workflow](references/workspaces-workflow.md) — Git worktrees, executor sessions, and PR merge automation.
