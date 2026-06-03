use std::collections::{BTreeSet, HashMap, VecDeque};
use sysinfo::{Pid, ProcessesToUpdate, System};

use super::types::TaskMonitors;
use super::actions::snapshot_task;

pub fn discover_task_tree(
    sys: &System,
    existing_tree: &BTreeSet<u32>,
    root_pid: u32,
) -> BTreeSet<u32> {
    let mut seeds = existing_tree.clone();
    if seeds.is_empty() {
        seeds.insert(root_pid);
    }

    let mut children_by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, process) in sys.processes() {
        if let Some(parent) = process.parent() {
            children_by_parent
                .entry(parent.as_u32())
                .or_default()
                .push(pid.as_u32());
        }
    }

    let mut tree = seeds.clone();
    let mut queue: VecDeque<u32> = seeds.into_iter().collect();
    while let Some(pid) = queue.pop_front() {
        if let Some(children) = children_by_parent.get(&pid) {
            for child_pid in children {
                if tree.insert(*child_pid) {
                    queue.push_back(*child_pid);
                }
            }
        }
    }

    tree
}

pub async fn kill_task_tree(monitors: &TaskMonitors, session_id: &str) {
    let snapshot = match snapshot_task(monitors, session_id) {
        Some(snapshot) => snapshot,
        None => return,
    };
    let mut pids = snapshot.tree_pids.iter().copied().collect::<Vec<_>>();
    if pids.is_empty() {
        if let Some(root) = snapshot.root_pid {
            pids.push(root);
        }
    }
    if pids.is_empty() {
        return;
    }

    let _ = tauri::async_runtime::spawn_blocking(move || {
        let mut sys = System::new_all();
        sys.refresh_processes(ProcessesToUpdate::All, true);
        let mut tree: Vec<(u32, usize)> = Vec::new();
        let seed_set: BTreeSet<u32> = pids.into_iter().collect();
        let mut children_by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
        for (pid, process) in sys.processes() {
            if let Some(parent) = process.parent() {
                children_by_parent
                    .entry(parent.as_u32())
                    .or_default()
                    .push(pid.as_u32());
            }
        }
        let mut queue: VecDeque<(u32, usize)> = seed_set.into_iter().map(|pid| (pid, 0)).collect();
        let mut seen = BTreeSet::new();
        while let Some((pid, depth)) = queue.pop_front() {
            if !seen.insert(pid) {
                continue;
            }
            tree.push((pid, depth));
            if let Some(children) = children_by_parent.get(&pid) {
                for child in children {
                    queue.push_back((*child, depth + 1));
                }
            }
        }
        tree.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(&a.0)));
        for (pid, _) in tree {
            let p = Pid::from(pid as usize);
            if let Some(process) = sys.process(p) {
                let _ = process.kill();
            }
        }
    })
    .await;
}
