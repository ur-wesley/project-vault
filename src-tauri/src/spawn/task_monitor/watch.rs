use std::collections::BTreeSet;
use std::time::Duration;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

use crate::db;
use super::types::{
    TaskMonitors, TaskPortsEmit, TASK_STATE_CANCELLED, TASK_STATE_ERROR, TASK_STATE_RUNNING,
    TASK_STATE_STARTING, TASK_STATE_SUCCESS,
};
use super::actions::{finalize_task, snapshot_task};
use super::db_events::{persist_snapshot, task_state_emit, task_tree_emit};
use super::process::discover_task_tree;

pub async fn watch_task(app: AppHandle, monitors: TaskMonitors, session_id: String) {
    let mut sys = System::new_all();
    let mut interval = tokio::time::interval(Duration::from_millis(350));
    let mut last_tree: BTreeSet<u32> = BTreeSet::new();
    let mut last_ports: Vec<u16> = Vec::new();
    let mut tick_count = 0u32;

    loop {
        interval.tick().await;

        let snapshot = match snapshot_task(&monitors, &session_id) {
            Some(entry) => entry,
            None => break,
        };

        if snapshot.finished {
            break;
        }

        let Some(root_pid) = snapshot.root_pid else {
            if last_tree.is_empty() {
                let _ = persist_snapshot(&app, &monitors, &session_id).await;
            }
            continue;
        };

        sys.refresh_processes(ProcessesToUpdate::All, true);
        let tree = discover_task_tree(&sys, &snapshot.tree_pids, root_pid);
        let alive = tree.iter().any(|pid| sys.process(Pid::from(*pid as usize)).is_some());

        if !alive {
            let final_snapshot = match snapshot_task(&monitors, &session_id) {
                Some(entry) => entry,
                None => break,
            };
            if final_snapshot.finished {
                break;
            }
            let state = if final_snapshot.stop_requested {
                TASK_STATE_CANCELLED.to_string()
            } else if final_snapshot.state == TASK_STATE_SUCCESS
                || final_snapshot.state == TASK_STATE_ERROR
            {
                final_snapshot.state.clone()
            } else {
                TASK_STATE_SUCCESS.to_string()
            };
            let stop_reason = final_snapshot.stop_reason.clone();
            let app_finalize = app.clone();
            let monitors_finalize = monitors.clone();
            let session_id_finalize = session_id.clone();
            let _ = finalize_task(
                app_finalize,
                monitors_finalize,
                session_id_finalize,
                state,
                final_snapshot.exit_code,
                stop_reason,
            )
            .await;
            break;
        }

        let mut next_state = snapshot.state.clone();
        if next_state == TASK_STATE_STARTING && alive {
            next_state = TASK_STATE_RUNNING.to_string();
        }

        let tree_changed = tree != snapshot.tree_pids;
        let state_changed = next_state != snapshot.state;

        // Port detection: scan every ~2 seconds (6 ticks) or when state becomes running
        tick_count += 1;
        let should_scan_ports = (tick_count % 6 == 0) || (state_changed && next_state == TASK_STATE_RUNNING);

        if should_scan_ports && alive {
            let pids: Vec<u32> = tree.iter().copied().collect();
            let detected = discover_ports_for_pids(&pids);

            if detected != last_ports {
                last_ports = detected.clone();
                {
                    let mut guard = match monitors.0.lock() {
                        Ok(g) => g,
                        Err(_) => break,
                    };
                    if let Some(entry) = guard.get_mut(&session_id) {
                        entry.ports = detected.clone();
                        entry.last_event_at_ms = db::now_ms();
                    }
                }

                let _ = persist_snapshot(&app, &monitors, &session_id).await;
                let _ = app.emit(
                    "task-ports-changed",
                    TaskPortsEmit {
                        session_id: session_id.clone(),
                        project_id: snapshot.project_id.clone(),
                        ports: detected,
                        last_event_at_ms: db::now_ms(),
                    },
                );
            }
        }

        if tree_changed || state_changed {
            {
                let mut guard = match monitors.0.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                if let Some(entry) = guard.get_mut(&session_id) {
                    if tree_changed {
                        entry.tree_pids = tree.clone();
                    }
                    if state_changed {
                        entry.state = next_state.clone();
                    }
                    entry.last_event_at_ms = db::now_ms();
                }
            }

            if tree_changed || state_changed {
                let _ = persist_snapshot(&app, &monitors, &session_id).await;
            }

            if state_changed {
                if let Some(updated) = snapshot_task(&monitors, &session_id) {
                    let _ = app.emit("task-state-changed", task_state_emit(&updated));
                }
            }

            if tree_changed {
                if let Some(updated) = snapshot_task(&monitors, &session_id) {
                    let _ = app.emit("task-tree-changed", task_tree_emit(&updated));
                    last_tree = updated.tree_pids.clone();
                }
            }
        } else if last_tree.is_empty() {
            let _ = persist_snapshot(&app, &monitors, &session_id).await;
            last_tree = snapshot.tree_pids.clone();
        }
    }
}

pub fn discover_ports_for_pids(pids: &[u32]) -> Vec<u16> {
    let mut ports = Vec::new();
    if pids.is_empty() {
        return ports;
    }

    #[cfg(windows)]
    {
        let pids_set: std::collections::HashSet<u32> = pids.iter().copied().collect();
        let mut cmd = crate::process_util::hidden_command("netstat");
        cmd.args(["-ano"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        let output = cmd.output();
        match output {
            Ok(out) => {
                let text = String::from_utf8_lossy(&out.stdout);

                for line in text.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() < 4 {
                        continue;
                    }
                    let proto = parts[0];
                    if proto != "TCP" && proto != "UDP" {
                        continue;
                    }
                    let Some(pid_str) = parts.last() else { continue };
                    let Ok(pid) = pid_str.parse::<u32>() else { continue };
                    if !pids_set.contains(&pid) {
                        continue;
                    }
                    // Locale-independent listening detection:
                    // A bound socket has a wildcard foreign address.
                    let is_listening = if proto == "TCP" && parts.len() >= 5 {
                        let foreign = parts[2];
                        foreign == "*:*" || foreign == "0.0.0.0:0" || foreign == "[::]:0"
                    } else if proto == "UDP" && parts.len() >= 4 {
                        let foreign = parts[2];
                        foreign == "*:*"
                    } else {
                        false
                    };

                    if !is_listening {
                        continue;
                    }
                    // Parse port from local address "0.0.0.0:3000" or "[::]:3000"
                    if let Some(addr_part) = parts.get(1) {
                        if let Some(port_str) = addr_part.rsplit(':').next() {
                            if let Ok(port) = port_str.parse::<u16>() {
                                if !ports.contains(&port) {
                                    ports.push(port);
                                }
                            }
                        }
                    }
                }
            }
            Err(_e) => {
            }
        }
    }

    #[cfg(not(windows))]
    {
        let pid_list = pids.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(",");
        let output = std::process::Command::new("lsof")
            .args(["-P", "-n", "-iTCP", "-sTCP:LISTEN", "-p", &pid_list])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();
        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines().skip(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 9 {
                    // Format: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
                    // NAME is like "*:3000" or "0.0.0.0:3000" or "[::]:3000"
                    if let Some(name) = parts.get(8) {
                        if let Some(port_str) = name.rsplit(':').next() {
                            if let Ok(port) = port_str.parse::<u16>() {
                                if !ports.contains(&port) {
                                    ports.push(port);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    ports.sort_unstable();
    ports
}
