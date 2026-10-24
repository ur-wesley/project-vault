# Workspaces & Agent Automation Guide

## Architecture
Project Vault creates isolated git worktrees (`.vault/worktrees/<workspace-id>`) to execute coding agents (`opencode`, `cursor-agent`) in parallel without touching the main repository branch.

## End-to-End Workflow

```
1. Kanban Card (todo)
       │
       ▼
2. start_workspace (creates git worktree + branch, starts agent session, links card)
       │
       ▼ (card moves to 'doing')
3. get_execution / session_prompt (monitor output tail and send follow-ups)
       │
       ▼
4. workspace_push (pushes worktree branch to origin)
       │
       ▼
5. create_pr (opens GitHub Pull Request with card context)
       │
       ▼ (card moves to 'review')
6. merge_pr (merges PR, automatically moves card to 'done', archives workspace)
```

## Key Automations
1. **Prompt Inheritance**: When `start_workspace` is invoked with `board_id` and `card_id`, the prompt automatically defaults to the card's title and markdown body if omitted.
2. **Merge Automation**: When `merge_pr` succeeds:
   - Any linked kanban cards automatically transition to `"done"`.
   - The workspace status transitions to archived.
3. **Session Monitoring**: `get_execution` retrieves the exit code and the last 8000 characters of the PTY terminal buffer.
