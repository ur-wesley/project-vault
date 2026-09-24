use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use sqlx::{Pool, Sqlite};
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex, RwLock};
use uuid::Uuid;

use crate::mcp::handlers;
use crate::mcp::protocol::{
    error_codes, InitializeResult, JsonRpcRequest, JsonRpcResponse, PromptsCapability,
    ResourcesCapability, ServerCapabilities, ServerInfo, ToolsCapability, MCP_PROTOCOL_VERSION,
};

#[derive(Clone)]
pub struct McpServerState(pub Arc<McpServerStateInner>);

pub struct McpServerStateInner {
    pub running: AtomicBool,
    pub current_port: AtomicU16,
    pub auth_enabled: AtomicBool,
    pub auth_token: Arc<RwLock<String>>,
    pub abort_handle: Arc<Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
    pub active_sessions: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<String>>>>,
}

impl Default for McpServerState {
    fn default() -> Self {
        Self(Arc::new(McpServerStateInner {
            running: AtomicBool::new(false),
            current_port: AtomicU16::new(1622),
            auth_enabled: AtomicBool::new(false),
            auth_token: Arc::new(RwLock::new(String::new())),
            abort_handle: Arc::new(Mutex::new(None)),
            active_sessions: Arc::new(Mutex::new(HashMap::new())),
        }))
    }
}

pub async fn start_mcp_server(
    state: McpServerState,
    port: u16,
    auth_enabled: bool,
    auth_token: String,
    pool: Pool<Sqlite>,
    app: AppHandle,
) -> Result<(), String> {
    // Stop if already running
    stop_mcp_server(&state).await;

    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind MCP server to {}: {}", addr, e))?;

    state.0.running.store(true, Ordering::SeqCst);
    state.0.current_port.store(port, Ordering::SeqCst);
    state.0.auth_enabled.store(auth_enabled, Ordering::SeqCst);
    {
        let mut token_guard = state.0.auth_token.write().await;
        *token_guard = auth_token;
    }

    let (abort_tx, mut abort_rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut abort_guard = state.0.abort_handle.lock().await;
        *abort_guard = Some(abort_tx);
    }

    let state_clone = state.clone();
    tokio::spawn(async move {
        println!("[mcp] MCP server listening on http://{}", addr);

        loop {
            tokio::select! {
                _ = &mut abort_rx => {
                    println!("[mcp] MCP server received shutdown signal");
                    break;
                }
                accepted = listener.accept() => {
                    match accepted {
                        Ok((stream, _peer_addr)) => {
                            let client_state = state_clone.clone();
                            let client_pool = pool.clone();
                            let client_app = app.clone();
                            tokio::spawn(async move {
                                handle_connection(stream, client_state, client_pool, client_app).await;
                            });
                        }
                        Err(e) => {
                            eprintln!("[mcp] Connection accept error: {}", e);
                        }
                    }
                }
            }
        }

        state_clone.0.running.store(false, Ordering::SeqCst);
        let mut sessions = state_clone.0.active_sessions.lock().await;
        sessions.clear();
        println!("[mcp] MCP server stopped");
    });

    Ok(())
}

pub async fn stop_mcp_server(state: &McpServerState) {
    let mut abort_guard = state.0.abort_handle.lock().await;
    if let Some(abort_tx) = abort_guard.take() {
        let _ = abort_tx.send(());
    }
    state.0.running.store(false, Ordering::SeqCst);
    let mut sessions = state.0.active_sessions.lock().await;
    sessions.clear();
}

async fn handle_connection(
    mut stream: TcpStream,
    state: McpServerState,
    pool: Pool<Sqlite>,
    app: AppHandle,
) {
    let mut buf = vec![0u8; 8192];
    let mut total_read = 0;

    // Read HTTP headers
    let header_end = loop {
        match stream.read(&mut buf[total_read..]).await {
            Ok(0) => return, // Client disconnected
            Ok(n) => {
                total_read += n;
                if let Some(pos) = find_header_end(&buf[..total_read]) {
                    break pos;
                }
                if total_read == buf.len() {
                    buf.resize(buf.len() * 2, 0);
                }
                if total_read > 65536 {
                    return; // Headers too large
                }
            }
            Err(_) => return,
        }
    };

    let header_str = match std::str::from_utf8(&buf[..header_end]) {
        Ok(s) => s,
        Err(_) => return,
    };

    let mut lines = header_str.lines();
    let request_line = match lines.next() {
        Some(l) => l,
        None => return,
    };

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_uppercase();
    let full_path = parts.next().unwrap_or("/").to_string();

    // Parse headers
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_lowercase(), v.trim().to_string());
        }
    }

    // CORS preflight
    if method == "OPTIONS" {
        let resp = "HTTP/1.1 204 No Content\r\n\
                    Access-Control-Allow-Origin: *\r\n\
                    Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
                    Access-Control-Allow-Headers: Authorization, Content-Type, Accept\r\n\
                    Access-Control-Max-Age: 86400\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes()).await;
        return;
    }

    // Check Authentication if enabled
    let auth_enabled = state.0.auth_enabled.load(Ordering::SeqCst);
    if auth_enabled {
        let expected_token = state.0.auth_token.read().await.clone();
        if !expected_token.is_empty() {
            let mut authorized = false;

            // 1. Authorization: Bearer <token>
            if let Some(auth_hdr) = headers.get("authorization") {
                if let Some(token) = auth_hdr.strip_prefix("Bearer ") {
                    if token.trim() == expected_token {
                        authorized = true;
                    }
                }
            }

            // 2. Query parameter token=<token>
            if !authorized {
                if let Some(query) = full_path.split_once('?').map(|x| x.1) {
                    for param in query.split('&') {
                        if let Some((k, v)) = param.split_once('=') {
                            if k == "token" && v == expected_token {
                                authorized = true;
                                break;
                            }
                        }
                    }
                }
            }

            if !authorized {
                let resp_body = json!({
                    "jsonrpc": "2.0",
                    "error": {
                        "code": error_codes::UNAUTHORIZED,
                        "message": "Unauthorized. Please provide a valid Bearer token."
                    }
                })
                .to_string();

                let resp = format!(
                    "HTTP/1.1 401 Unauthorized\r\n\
                     Content-Type: application/json\r\n\
                     Access-Control-Allow-Origin: *\r\n\
                     Content-Length: {}\r\n\r\n{}",
                    resp_body.len(),
                    resp_body
                );
                let _ = stream.write_all(resp.as_bytes()).await;
                return;
            }
        }
    }

    // Extract path without query
    let path = full_path.split('?').next().unwrap_or("/");

    // Route endpoints
    match (method.as_str(), path) {
        ("GET", "/sse") => {
            handle_sse(stream, state).await;
        }

        ("POST", "/message") => {
            let session_id = extract_query_param(&full_path, "sessionId");
            let body = read_body(&mut stream, &buf, header_end, total_read, &headers).await;
            handle_message_post(stream, session_id, body, state, pool, app).await;
        }

        ("POST", "/mcp") | ("POST", "/") => {
            let body = read_body(&mut stream, &buf, header_end, total_read, &headers).await;
            handle_direct_jsonrpc(stream, body, pool, app).await;
        }

        ("GET", "/") | ("GET", "/health") | ("GET", "/status") => {
            let port = state.0.current_port.load(Ordering::SeqCst);
            let auth = state.0.auth_enabled.load(Ordering::SeqCst);
            let status_json = json!({
                "name": "project-vault-mcp",
                "version": "0.10.6",
                "status": "running",
                "port": port,
                "authEnabled": auth,
                "endpoints": {
                    "sse": format!("http://127.0.0.1:{}/sse", port),
                    "message": format!("http://127.0.0.1:{}/message", port),
                    "direct": format!("http://127.0.0.1:{}/mcp", port)
                }
            })
            .to_string();

            let resp = format!(
                "HTTP/1.1 200 OK\r\n\
                 Content-Type: application/json\r\n\
                 Access-Control-Allow-Origin: *\r\n\
                 Content-Length: {}\r\n\r\n{}",
                status_json.len(),
                status_json
            );
            let _ = stream.write_all(resp.as_bytes()).await;
        }

        _ => {
            let body = "Not Found";
            let resp = format!(
                "HTTP/1.1 404 Not Found\r\n\
                 Content-Type: text/plain\r\n\
                 Access-Control-Allow-Origin: *\r\n\
                 Content-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes()).await;
        }
    }
}

async fn handle_sse(mut stream: TcpStream, state: McpServerState) {
    let session_id = Uuid::new_v4().to_string();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    {
        let mut sessions = state.0.active_sessions.lock().await;
        sessions.insert(session_id.clone(), tx);
    }

    // Send HTTP headers for SSE
    let init_headers = "HTTP/1.1 200 OK\r\n\
                        Content-Type: text/event-stream\r\n\
                        Cache-Control: no-cache\r\n\
                        Connection: keep-alive\r\n\
                        Access-Control-Allow-Origin: *\r\n\r\n";
    if stream.write_all(init_headers.as_bytes()).await.is_err() {
        let mut sessions = state.0.active_sessions.lock().await;
        sessions.remove(&session_id);
        return;
    }

    // Emit initial endpoint event per MCP SSE spec
    let endpoint_event = format!(
        "event: endpoint\r\ndata: /message?sessionId={}\r\n\r\n",
        session_id
    );
    if stream.write_all(endpoint_event.as_bytes()).await.is_err() {
        let mut sessions = state.0.active_sessions.lock().await;
        sessions.remove(&session_id);
        return;
    }

    let mut keep_alive_interval = tokio::time::interval(Duration::from_secs(15));
    // Skip immediate first tick
    keep_alive_interval.tick().await;

    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Some(data) => {
                        let event = format!("event: message\r\ndata: {}\r\n\r\n", data);
                        if stream.write_all(event.as_bytes()).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
            _ = keep_alive_interval.tick() => {
                if stream.write_all(b": ping\r\n\r\n").await.is_err() {
                    break;
                }
            }
        }
    }

    let mut sessions = state.0.active_sessions.lock().await;
    sessions.remove(&session_id);
}

async fn handle_message_post(
    mut stream: TcpStream,
    session_id: Option<String>,
    body: Vec<u8>,
    state: McpServerState,
    pool: Pool<Sqlite>,
    app: AppHandle,
) {
    let session_id = match session_id {
        Some(s) => s,
        None => {
            let resp = "HTTP/1.1 400 Bad Request\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 26\r\n\r\nMissing sessionId parameter";
            let _ = stream.write_all(resp.as_bytes()).await;
            return;
        }
    };

    let req: JsonRpcRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(e) => {
            let resp_body = json!({
                "jsonrpc": "2.0",
                "error": {
                    "code": error_codes::PARSE_ERROR,
                    "message": format!("Invalid JSON: {}", e)
                }
            })
            .to_string();
            let resp = format!(
                "HTTP/1.1 400 Bad Request\r\n\
                 Content-Type: application/json\r\n\
                 Access-Control-Allow-Origin: *\r\n\
                 Content-Length: {}\r\n\r\n{}",
                resp_body.len(),
                resp_body
            );
            let _ = stream.write_all(resp.as_bytes()).await;
            return;
        }
    };

    // Acknowledge receipt with 202 Accepted
    let ack = "HTTP/1.1 202 Accepted\r\n\
               Access-Control-Allow-Origin: *\r\n\
               Content-Length: 0\r\n\r\n";
    let _ = stream.write_all(ack.as_bytes()).await;

    // Process request and send response back through active SSE session
    let maybe_response = process_mcp_request(req, &pool, &app).await;
    if let Some(resp) = maybe_response {
        let resp_str = serde_json::to_string(&resp).unwrap_or_default();
        let sessions = state.0.active_sessions.lock().await;
        if let Some(tx) = sessions.get(&session_id) {
            let _ = tx.send(resp_str);
        }
    }
}

async fn handle_direct_jsonrpc(
    mut stream: TcpStream,
    body: Vec<u8>,
    pool: Pool<Sqlite>,
    app: AppHandle,
) {
    let req: JsonRpcRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(e) => {
            let resp = JsonRpcResponse::error(
                None,
                error_codes::PARSE_ERROR,
                format!("Parse error: {}", e),
            );
            send_json_response(&mut stream, &resp).await;
            return;
        }
    };

    let resp = match process_mcp_request(req, &pool, &app).await {
        Some(r) => r,
        None => JsonRpcResponse::success(None, json!({})),
    };

    send_json_response(&mut stream, &resp).await;
}

async fn send_json_response(stream: &mut TcpStream, resp: &JsonRpcResponse) {
    let body_str = serde_json::to_string(resp).unwrap_or_default();
    let http_resp = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: application/json\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Content-Length: {}\r\n\r\n{}",
        body_str.len(),
        body_str
    );
    let _ = stream.write_all(http_resp.as_bytes()).await;
}

async fn process_mcp_request(
    req: JsonRpcRequest,
    pool: &Pool<Sqlite>,
    app: &AppHandle,
) -> Option<JsonRpcResponse> {
    let id = req.id.clone();

    // If it's a notification with no ID and initialized method, no response needed
    if req.method == "notifications/initialized" {
        return None;
    }

    match req.method.as_str() {
        "initialize" => {
            let result = InitializeResult {
                protocol_version: MCP_PROTOCOL_VERSION.to_string(),
                capabilities: ServerCapabilities {
                    tools: ToolsCapability { list_changed: false },
                    resources: ResourcesCapability { subscribe: false, list_changed: false },
                    prompts: PromptsCapability { list_changed: false },
                },
                server_info: ServerInfo {
                    name: "project-vault-mcp".to_string(),
                    version: "0.10.6".to_string(),
                },
                instructions: Some(
                    "Project Vault MCP Server allows you to explore projects, inspect git status, read project tasks, and manage issues.".to_string(),
                ),
            };
            Some(JsonRpcResponse::success(
                id,
                serde_json::to_value(result).unwrap_or_default(),
            ))
        }

        "ping" => Some(JsonRpcResponse::success(id, json!({}))),

        "tools/list" => {
            let tools = handlers::list_tools();
            Some(JsonRpcResponse::success(id, json!({ "tools": tools })))
        }

        "tools/call" => {
            let params = req.params.unwrap_or(json!({}));
            let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let tool_args = params.get("arguments").cloned().unwrap_or(json!({}));

            let result = handlers::call_tool(tool_name, &tool_args, pool, app).await;
            Some(JsonRpcResponse::success(
                id,
                serde_json::to_value(result).unwrap_or_default(),
            ))
        }

        "resources/list" => {
            let resources = handlers::list_resources();
            Some(JsonRpcResponse::success(
                id,
                json!({ "resources": resources }),
            ))
        }

        "resources/read" => {
            let params = req.params.unwrap_or(json!({}));
            let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");
            match handlers::read_resource(uri, pool).await {
                Some(content) => Some(JsonRpcResponse::success(
                    id,
                    json!({ "contents": [content] }),
                )),
                None => Some(JsonRpcResponse::error(
                    id,
                    error_codes::INVALID_PARAMS,
                    format!("Resource not found: {}", uri),
                )),
            }
        }

        "prompts/list" => {
            let prompts = handlers::list_prompts();
            Some(JsonRpcResponse::success(id, json!({ "prompts": prompts })))
        }

        "prompts/get" => {
            let params = req.params.unwrap_or(json!({}));
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if name == "vault_overview" {
                Some(JsonRpcResponse::success(
                    id,
                    json!({
                        "description": "Summarize all projects in Project Vault",
                        "messages": [
                            {
                                "role": "user",
                                "content": {
                                    "type": "text",
                                    "text": "Please use the list_projects and list_locations tools to provide an overview of my development vault."
                                }
                            }
                        ]
                    }),
                ))
            } else {
                Some(JsonRpcResponse::error(
                    id,
                    error_codes::INVALID_PARAMS,
                    format!("Prompt not found: {}", name),
                ))
            }
        }

        _ => Some(JsonRpcResponse::error(
            id,
            error_codes::METHOD_NOT_FOUND,
            format!("Method not found: {}", req.method),
        )),
    }
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    for i in 0..buf.len().saturating_sub(3) {
        if buf[i] == b'\r' && buf[i + 1] == b'\n' && buf[i + 2] == b'\r' && buf[i + 3] == b'\n' {
            return Some(i + 4);
        }
    }
    None
}

fn extract_query_param(path: &str, param_name: &str) -> Option<String> {
    let query = path.split_once('?')?.1;
    for part in query.split('&') {
        if let Some((k, v)) = part.split_once('=') {
            if k == param_name {
                return Some(v.to_string());
            }
        }
    }
    None
}

async fn read_body(
    stream: &mut TcpStream,
    buf: &[u8],
    header_end: usize,
    total_read: usize,
    headers: &HashMap<String, String>,
) -> Vec<u8> {
    let content_len: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let already_read = total_read - header_end;
    let mut body = Vec::with_capacity(content_len);
    if already_read > 0 {
        let to_copy = already_read.min(content_len);
        body.extend_from_slice(&buf[header_end..header_end + to_copy]);
    }

    while body.len() < content_len {
        let mut temp = vec![0u8; (content_len - body.len()).min(8192)];
        match stream.read(&mut temp).await {
            Ok(0) => break,
            Ok(n) => body.extend_from_slice(&temp[..n]),
            Err(_) => break,
        }
    }

    body
}
