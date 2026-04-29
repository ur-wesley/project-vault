use std::path::Path;
use std::sync::Arc;

use crate::discovery::detectors::{
    CMakeDetector, CargoTomlDetector, ComposerDetector, CsProjDetector, DenoDetector,
    GemfileDetector, GitDetector, GoModDetector, GoWorkDetector, GradleDetector, JustfileDetector,
    MavenDetector, MixExsDetector, PackageJsonDetector, PnpmWorkspaceDetector, PythonDetector,
    SolutionDetector, SwiftPackageDetector, MiseDetector,
};
use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;

pub struct DetectorRegistry {
    detectors: Vec<Arc<dyn ProjectDetector>>,
}

impl DetectorRegistry {
    pub fn standard() -> Self {
        let mut detectors: Vec<Arc<dyn ProjectDetector>> = vec![
            Arc::new(GitDetector),
            Arc::new(MiseDetector),
            Arc::new(JustfileDetector),
            Arc::new(DenoDetector),
            Arc::new(PackageJsonDetector),
            Arc::new(PnpmWorkspaceDetector),
            Arc::new(GoWorkDetector),
            Arc::new(GoModDetector),
            Arc::new(CargoTomlDetector),
            Arc::new(ComposerDetector),
            Arc::new(GemfileDetector),
            Arc::new(MixExsDetector),
            Arc::new(GradleDetector),
            Arc::new(MavenDetector),
            Arc::new(SwiftPackageDetector),
            Arc::new(SolutionDetector),
            Arc::new(CsProjDetector),
            Arc::new(PythonDetector),
            Arc::new(CMakeDetector),
        ];
        detectors.sort_by(|a, b| b.priority().cmp(&a.priority()));
        Self { detectors }
    }

    pub fn detect(&self, dir: &Path) -> Option<ProjectDraft> {
        let mut drafts = Vec::new();
        for det in &self.detectors {
            if let Some(draft) = det.detect(dir) {
                drafts.push(draft);
            }
        }

        if drafts.is_empty() {
            return None;
        }

        // Merge drafts. The detectors were already sorted by priority in standard().
        // We'll take the first draft's basic info (name, stack, etc.) as it's the highest priority.
        let mut merged = drafts.remove(0);
        for other in drafts {
            // Append tasks
            for t in other.tasks {
                if !merged
                    .tasks
                    .iter()
                    .any(|existing| existing.label == t.label)
                {
                    merged.tasks.push(t);
                }
            }
            // Append tags
            for tag in other.tags {
                if !merged.tags.contains(&tag) {
                    merged.tags.push(tag);
                }
            }
            // Runtime hint merge: keep the primary one if exists
            if merged.runtime_hint.is_none() {
                merged.runtime_hint = other.runtime_hint;
            }
            // GitHub info merge
            if merged.github_owner.is_none() {
                merged.github_owner = other.github_owner;
            }
            if merged.github_repo.is_none() {
                merged.github_repo = other.github_repo;
            }
        }

        Some(merged)
    }
}
