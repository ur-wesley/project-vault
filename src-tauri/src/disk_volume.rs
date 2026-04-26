use std::path::Path;

use sysinfo::{Disk, Disks};

use crate::models::PathDiskSpaceDto;

fn best_disk_for_path<'a>(path: &Path, disks: &'a Disks) -> Option<&'a Disk> {
    let mut best: Option<(usize, &'a Disk)> = None;
    for disk in disks.list() {
        let mp = disk.mount_point();
        if path.starts_with(mp) {
            let mlen = mp.as_os_str().len();
            if best.map_or(true, |(b, _)| mlen > b) {
                best = Some((mlen, disk));
            }
        }
    }
    best.map(|(_, d)| d)
}

pub fn path_disk_space_rows(paths: &[String]) -> Vec<PathDiskSpaceDto> {
    let disks = Disks::new_with_refreshed_list();
    paths
        .iter()
        .map(|s| {
            let p = Path::new(s);
            let resolved = dunce::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
            if let Some(d) = best_disk_for_path(&resolved, &disks) {
                PathDiskSpaceDto {
                    path: s.clone(),
                    total_bytes: d.total_space(),
                    available_bytes: d.available_space(),
                }
            } else {
                PathDiskSpaceDto {
                    path: s.clone(),
                    total_bytes: 0,
                    available_bytes: 0,
                }
            }
        })
        .collect()
}
