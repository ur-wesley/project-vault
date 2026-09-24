use super::ModuleContext;
use mlua::{Lua, Result, Table};
use std::sync::{Mutex, OnceLock};

/// Cached `sysinfo::System` shared by all `vault.system` calls.
///
/// CPU utilization is a delta between two samples, so a fresh `System` per
/// call would always report 0%. The cached instance is warmed up once at
/// first use; every `stats()` call refreshes it, giving valid readings at
/// any polling interval the caller chooses.
static SYSTEM: OnceLock<Mutex<sysinfo::System>> = OnceLock::new();

fn shared_system() -> &'static Mutex<sysinfo::System> {
    SYSTEM.get_or_init(|| {
        let mut sys = sysinfo::System::new();
        sys.refresh_memory();
        // Warmup sample — the first `cpu_usage()` delta needs a baseline.
        sys.refresh_cpu_all();
        Mutex::new(sys)
    })
}

fn lock_system() -> std::sync::MutexGuard<'static, sysinfo::System> {
    shared_system().lock().unwrap_or_else(|poisoned| {
        // A panicking Lua worker must not wedge system stats forever.
        poisoned.into_inner()
    })
}

pub fn register(lua: &Lua, vault: &Table, _ctx: &ModuleContext) -> Result<()> {
    let system = lua.create_table()?;

    // vault.system.info() -> JSON { os, osVersion?, kernelVersion?, arch,
    //   hostname?, cpuCount }
    // Static host facts. No refresh — topology is read from the shared instance.
    system.set(
        "info",
        lua.create_function(|_, _: ()| {
            let sys = lock_system();
            let cpu_count = sys
                .physical_core_count()
                .unwrap_or_else(|| sys.cpus().len().max(1));
            let v = serde_json::json!({
                "os": sysinfo::System::name().unwrap_or_else(|| std::env::consts::OS.to_string()),
                "osVersion": sysinfo::System::long_os_version(),
                "kernelVersion": sysinfo::System::kernel_version(),
                "arch": std::env::consts::ARCH,
                "hostname": sysinfo::System::host_name(),
                "cpuCount": cpu_count,
            });
            Ok(serde_json::to_string(&v).unwrap_or_else(|_| "{}".to_string()))
        })?,
    )?;

    // vault.system.stats() -> JSON { cpuUsagePct, perCpuPct: number[],
    //   totalMemoryBytes, usedMemoryBytes, freeMemoryBytes,
    //   availableMemoryBytes }
    // Live snapshot. Refreshes the cached instance; safe to poll at 0.5-1 Hz.
    system.set(
        "stats",
        lua.create_function(|_, _: ()| {
            let mut sys = lock_system();
            sys.refresh_memory();
            sys.refresh_cpu_all();

            let per_cpu: Vec<f32> =
                sys.cpus().iter().map(|cpu| cpu.cpu_usage()).collect();
            let global = if per_cpu.is_empty() {
                0.0
            } else {
                per_cpu.iter().sum::<f32>() / per_cpu.len() as f32
            };

            let v = serde_json::json!({
                "cpuUsagePct": global,
                "perCpuPct": per_cpu,
                "totalMemoryBytes": sys.total_memory(),
                "usedMemoryBytes": sys.used_memory(),
                "freeMemoryBytes": sys.free_memory(),
                "availableMemoryBytes": sys.available_memory(),
            });
            Ok(serde_json::to_string(&v).unwrap_or_else(|_| "{}".to_string()))
        })?,
    )?;

    vault.set("system", system)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::lua::engine::LuaEngine;

    #[test]
    fn info_returns_expected_shape() {
        let lua = LuaEngine::create_instance().unwrap();
        let raw: String = lua.load("return vault.system.info()").eval().unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(v.get("os").and_then(|s| s.as_str()).is_some());
        assert_eq!(v.get("arch").and_then(|s| s.as_str()), Some(std::env::consts::ARCH));
        assert!(v.get("cpuCount").and_then(|n| n.as_u64()).unwrap_or(0) >= 1);
    }

    #[test]
    fn stats_returns_sane_memory_and_cpu() {
        let lua = LuaEngine::create_instance().unwrap();
        let raw: String = lua.load("return vault.system.stats()").eval().unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();

        let total = v.get("totalMemoryBytes").and_then(|n| n.as_u64()).unwrap_or(0);
        let used = v.get("usedMemoryBytes").and_then(|n| n.as_u64()).unwrap_or(u64::MAX);
        assert!(total > 0, "total memory must be positive");
        assert!(used <= total, "used memory must not exceed total");

        let cpu = v.get("cpuUsagePct").and_then(|n| n.as_f64()).unwrap_or(-1.0);
        assert!((0.0..=100.0).contains(&cpu), "cpu pct out of range: {cpu}");

        let per_cpu = v.get("perCpuPct").and_then(|a| a.as_array()).cloned().unwrap_or_default();
        let info_raw: String = lua.load("return vault.system.info()").eval().unwrap();
        let info_v: serde_json::Value = serde_json::from_str(&info_raw).unwrap();
        let cpu_count = info_v
            .get("cpuCount")
            .and_then(|n| n.as_u64())
            .unwrap_or(per_cpu.len() as u64) as usize;
        assert_eq!(per_cpu.len(), cpu_count, "per-cpu entries must match core count");
        for entry in &per_cpu {
            let pct = entry.as_f64().unwrap_or(-1.0);
            assert!((0.0..=100.0).contains(&pct), "per-cpu pct out of range: {pct}");
        }
    }
}
