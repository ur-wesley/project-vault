import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, dirname } from "path";
import { consola } from "consola";
import { ok, err, Result } from "neverthrow";

interface TaskFile {
  filename: string;
  filepath: string;
  workspace: string;
  totalTasks: number;
  completedTasks: number;
  completionPercent: number;
  status: "Not Started" | "In Progress" | "Done";
  hasPrd: boolean;
}

interface PrdFile {
  filename: string;
  filepath: string;
  workspace: string;
  hasTaskFile: boolean;
}

/**
 * Find the project root by walking up the directory tree
 * Looks for package.json, .git, or tsconfig.json
 */
function findProjectRoot(startPath: string = process.cwd()): Result<string, Error> {
  let current = startPath;
  const maxAttempts = 20; // Prevent infinite loops
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const entries = readdirSync(current);

      // Check for project root indicators
      const hasPackageJson = entries.includes("package.json");
      const hasGit = entries.includes(".git");
      const hasTsConfig = entries.includes("tsconfig.json");

      if (hasPackageJson || hasGit || hasTsConfig) {
        return ok(current);
      }

      // Move up one directory
      const parent = dirname(current);
      if (parent === current) {
        // Reached filesystem root
        break;
      }

      current = parent;
      attempts++;
    } catch {
      break;
    }
  }

  return err(new Error(`Could not find project root starting from ${startPath}`));
}

/**
 * Parse workspace configuration from package.json
 * Supports pnpm, npm, and yarn workspace patterns
 */
function parseWorkspaces(projectRoot: string): Result<string[], Error> {
  try {
    const packageJsonPath = join(projectRoot, "package.json");
    const content = readFileSync(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content);

    const workspaces: string[] = [];

    // Handle both string array and object format
    if (Array.isArray(pkg.workspaces)) {
      workspaces.push(...pkg.workspaces);
    } else if (pkg.workspaces && typeof pkg.workspaces === "object") {
      if (Array.isArray(pkg.workspaces.packages)) {
        workspaces.push(...pkg.workspaces.packages);
      }
    }

    // Resolve glob patterns to actual directories
    const resolvedDirs: string[] = [];
    for (const pattern of workspaces) {
      // Simple glob expansion - just handle * wildcard
      if (pattern.includes("*")) {
        try {
          const baseDir = dirname(pattern);
          const glob = pattern.split("/").pop() || "";

          if (glob === "*" || glob.endsWith("/*")) {
            const parentDir = join(projectRoot, baseDir);
            const entries = readdirSync(parentDir);

            for (const entry of entries) {
              const fullPath = join(parentDir, entry);
              const stat = statSync(fullPath);
              if (stat.isDirectory() && !entry.startsWith(".")) {
                resolvedDirs.push(fullPath);
              }
            }
          }
        } catch {
          // Skip if we can't resolve this pattern
        }
      } else {
        // Direct path
        const fullPath = join(projectRoot, pattern);
        try {
          if (statSync(fullPath).isDirectory()) {
            resolvedDirs.push(fullPath);
          }
        } catch {
          // Skip if path doesn't exist
        }
      }
    }

    return ok(resolvedDirs.length > 0 ? resolvedDirs : [projectRoot]);
  } catch {
    // No workspaces configured or error parsing, use project root
    return ok([projectRoot]);
  }
}

function findTaskFiles(dir: string, basePath: string = dir): Result<string[], Error> {
  try {
    const taskFiles: string[] = [];
    const entries = readdirSync(dir);

    for (const entry of entries) {
      // Skip node_modules and hidden directories
      if (entry.startsWith(".") || entry === "node_modules") continue;

      try {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          const subResult = findTaskFiles(fullPath, basePath);
          if (subResult.isOk()) {
            taskFiles.push(...subResult.value);
          }
        } else if (entry.startsWith("tasks-") && entry.endsWith(".md")) {
          taskFiles.push(fullPath);
        }
      } catch {
        // Skip entries we can't stat
        continue;
      }
    }

    return ok(taskFiles);
  } catch (error) {
    return err(
      new Error(
        `Failed to read directory ${dir}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
}

function findPrdFiles(dir: string, basePath: string = dir): Result<string[], Error> {
  try {
    const prdFiles: string[] = [];
    const entries = readdirSync(dir);

    for (const entry of entries) {
      // Skip node_modules and hidden directories
      if (entry.startsWith(".") || entry === "node_modules") continue;

      try {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          const subResult = findPrdFiles(fullPath, basePath);
          if (subResult.isOk()) {
            prdFiles.push(...subResult.value);
          }
        } else if (entry.startsWith("prd-") && entry.endsWith(".md")) {
          prdFiles.push(fullPath);
        }
      } catch {
        // Skip entries we can't stat
        continue;
      }
    }

    return ok(prdFiles);
  } catch (error) {
    return err(
      new Error(
        `Failed to read directory ${dir}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
}

function getTaskFiles(projectRoot: string, workspaceDirs: string[], prdFilenames: Set<string>): Result<TaskFile[], Error> {
  const allTasks: TaskFile[] = [];

  for (const workspaceDir of workspaceDirs) {
    const findResult = findTaskFiles(workspaceDir);

    if (findResult.isErr()) {
      // Skip workspaces we can't read
      continue;
    }

    const taskFilePaths = findResult.value;

    try {
      for (const filepath of taskFilePaths) {
        const content = readFileSync(filepath, "utf-8");
        const filename = filepath.split(/[\\/]/).pop() || "";
        const featureName = filename.replace("tasks-", "").replace(".md", "");

        // Count all checkboxes
        const allCheckboxes = content.match(/- \[.\]/g) || [];
        const completedCheckboxes = content.match(/- \[x\]/gi) || [];

        const totalTasks = allCheckboxes.length;
        const completedTasks = completedCheckboxes.length;
        const completionPercent =
          totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

        let status: "Not Started" | "In Progress" | "Done" = "Not Started";
        if (completionPercent === 100 && totalTasks > 0) {
          status = "Done";
        } else if (completionPercent > 0) {
          status = "In Progress";
        }

        // Check if corresponding PRD exists
        const prdFilename = `prd-${featureName}.md`;
        const hasPrd = prdFilenames.has(prdFilename);

        // Determine workspace name
        const workspaceName =
          workspaceDirs.length > 1 ? relative(projectRoot, workspaceDir) : "root";

        allTasks.push({
          filename: featureName,
          filepath: relative(projectRoot, filepath),
          workspace: workspaceName,
          totalTasks,
          completedTasks,
          completionPercent,
          status,
          hasPrd,
        });
      }
    } catch {
      // Continue with next workspace
      continue;
    }
  }

  if (allTasks.length === 0) {
    return err(new Error("No task files found in any workspace"));
  }

  return ok(allTasks);
}

function getPrdFiles(projectRoot: string, workspaceDirs: string[], taskFilenames: Set<string>): Result<PrdFile[], Error> {
  const allPrds: PrdFile[] = [];

  for (const workspaceDir of workspaceDirs) {
    const findResult = findPrdFiles(workspaceDir);

    if (findResult.isErr()) {
      // Skip workspaces we can't read
      continue;
    }

    const prdFilePaths = findResult.value;

    try {
      for (const filepath of prdFilePaths) {
        const filename = filepath.split(/[\\/]/).pop() || "";
        const featureName = filename.replace("prd-", "").replace(".md", "");

        // Check if corresponding task file exists
        const taskFilename = `tasks-${featureName}.md`;
        const hasTaskFile = taskFilenames.has(taskFilename);

        // Determine workspace name
        const workspaceName =
          workspaceDirs.length > 1 ? relative(projectRoot, workspaceDir) : "root";

        allPrds.push({
          filename: featureName,
          filepath: relative(projectRoot, filepath),
          workspace: workspaceName,
          hasTaskFile,
        });
      }
    } catch {
      // Continue with next workspace
      continue;
    }
  }

  return ok(allPrds);
}

async function main() {
  // Detect project root
  const projectRootResult = findProjectRoot();

  if (projectRootResult.isErr()) {
    consola.error(`Failed to detect project: ${projectRootResult.error.message}`);
    process.exit(1);
  }

  const projectRoot = projectRootResult.value;
  consola.info(`📂 Detected project: ${projectRoot}`);

  // Parse workspace configuration
  const workspacesResult = parseWorkspaces(projectRoot);

  if (workspacesResult.isErr()) {
    consola.error(`Failed to parse workspaces: ${workspacesResult.error.message}`);
    process.exit(1);
  }

  const workspaceDirs = workspacesResult.value;
  if (workspaceDirs.length > 1) {
    consola.info(`📦 Found ${workspaceDirs.length} workspace(s)`);
  }
  console.log("");

  // Find all PRD files first
  let allPrdFilenames = new Set<string>();
  let allTaskFilenames = new Set<string>();

  for (const workspaceDir of workspaceDirs) {
    const prdResult = findPrdFiles(workspaceDir);
    if (prdResult.isOk()) {
      for (const filepath of prdResult.value) {
        const filename = filepath.split(/[\\/]/).pop() || "";
        allPrdFilenames.add(filename);
      }
    }

    const tasksResult = findTaskFiles(workspaceDir);
    if (tasksResult.isOk()) {
      for (const filepath of tasksResult.value) {
        const filename = filepath.split(/[\\/]/).pop() || "";
        allTaskFilenames.add(filename);
      }
    }
  }

  const tasksResult = getTaskFiles(projectRoot, workspaceDirs, allPrdFilenames);

  if (tasksResult.isErr()) {
    consola.warn(tasksResult.error.message);
    return;
  }

  const tasks = tasksResult.value;

  if (tasks.length === 0) {
    consola.warn("No task files found matching pattern 'tasks-*.md'");
    return;
  }

  // Sort by status (Done first, then In Progress, then Not Started) and then by workspace and filename
  const sorted = tasks.sort((a, b) => {
    const statusOrder = { Done: 0, "In Progress": 1, "Not Started": 2 };
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    if (a.workspace !== b.workspace) {
      return a.workspace.localeCompare(b.workspace);
    }
    return a.filename.localeCompare(b.filename);
  });

  // Create table data
  const tableData = sorted.map((task) => ({
    Workspace: task.workspace,
    Feature: task.filename,
    Status: task.status,
    Progress: `${task.completedTasks}/${task.totalTasks}`,
    Percent: `${task.completionPercent}%`,
    Bar: getProgressBar(task.completionPercent),
    PRD: task.hasPrd ? "✓" : "✗",
    Path: task.filepath,
  }));

  consola.box({
    title: "📋 Task Status Overview",
    message: `${tasks.length} task file(s) found`,
  });

  console.table(tableData);

  // Now show PRD analysis
  const prdResult = getPrdFiles(projectRoot, workspaceDirs, allTaskFilenames);

  if (prdResult.isOk()) {
    const prds = prdResult.value;
    const prdsMissingTasks = prds.filter((p) => !p.hasTaskFile);

    if (prdsMissingTasks.length > 0) {
      console.log("");
      consola.box({
        title: "📑 PRDs Without Task Files",
        message: `${prdsMissingTasks.length} PRD file(s) need task breakdowns`,
      });

      const prdTableData = prdsMissingTasks
        .sort((a, b) => {
          if (a.workspace !== b.workspace) {
            return a.workspace.localeCompare(b.workspace);
          }
          return a.filename.localeCompare(b.filename);
        })
        .map((prd) => ({
          Workspace: prd.workspace,
          Feature: prd.filename,
          Path: prd.filepath,
        }));

      console.table(prdTableData);
    }
  }

  // Summary
  const totalTasks = tasks.reduce((sum, t) => sum + t.totalTasks, 0);
  const totalCompleted = tasks.reduce((sum, t) => sum + t.completedTasks, 0);
  const overallPercent = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0;

  const doneCount = tasks.filter((t) => t.status === "Done").length;
  const inProgressCount = tasks.filter((t) => t.status === "In Progress").length;
  const notStartedCount = tasks.filter((t) => t.status === "Not Started").length;

  console.log("");
  consola.info(`Overall Progress: ${totalCompleted}/${totalTasks} tasks (${overallPercent}%)`);
  consola.success(`Done: ${doneCount} file(s)`);
  consola.info(`In Progress: ${inProgressCount} file(s)`);
  consola.info(`Not Started: ${notStartedCount} file(s)`);
}

function getProgressBar(percent: number): string {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

main().catch((error) => {
  consola.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
