# Project Vault MCP Connection & Configuration Guide

## Architecture
Project Vault includes an embedded HTTP/SSE MCP server implemented in Rust (via Tauri). It allows external agents and IDEs to query vault projects, manipulate markdown kanban boards, and control isolated git worktree coding sessions.

## Endpoints

| Protocol / Path | Purpose | Example URL |
| --- | --- | --- |
| `GET /sse` | Server-Sent Events stream | `http://127.0.0.1:1622/sse` |
| `POST /message?sessionId=...` | Client RPC dispatch in SSE mode | `http://127.0.0.1:1622/message?sessionId=<uuid>` |
| `POST /mcp` or `POST /` | Direct stateless JSON-RPC | `http://127.0.0.1:1622/mcp` |
| `GET /health` or `GET /status` | Server status and metadata | `http://127.0.0.1:1622/health` |

## Authentication
Authentication is optional and configurable in Project Vault under **Settings -> MCP Server**.
- If enabled, requests require Bearer token authentication:
  - Header: `Authorization: Bearer <TOKEN>`
  - Or query param: `?token=<TOKEN>`

## Client Configuration Examples

### Claude Desktop / Claude Code (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "project-vault": {
      "url": "http://127.0.0.1:1622/sse",
      "headers": {
        "Authorization": "Bearer <OPTIONAL_TOKEN>"
      }
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "project-vault": {
      "url": "http://127.0.0.1:1622/sse",
      "headers": {
        "Authorization": "Bearer <OPTIONAL_TOKEN>"
      }
    }
  }
}
```

### Direct JSON-RPC Call Example (cURL / PowerShell)
```bash
curl -X POST http://127.0.0.1:1622/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "list_projects",
      "arguments": { "favorite_only": true }
    }
  }'
```
