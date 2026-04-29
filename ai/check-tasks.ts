import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, dirname } from "path";
import { consola } from "consola";
import { ok, err, Result } from "neverthrow";
import { select, text, confirm, isCancel } from "@clack/prompts";
import { $ } from "bun";

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

interface AiState {
  lastPrdPath?: string;
  lastTasksPath?: string;
}

interface TableColumn {
  key: string;
  header: string;
  width: number;
}

interface TableCell {
  lines: string[];
  height: number;
}

interface ParsedArgs {
  command: string | null;
  value: string | null;
  skipQuestions: boolean;
}

const STATE_FILE = ".ai-state.json";
const TASKS_DIR = "tasks";
const AI_DIR = "ai";

/* ==================================================================
   CLI ARGUMENT PARSING
   ================================================================== */

function parseArgs(): ParsedArgs {
  const args = Bun.argv.slice(2);
  let command: string | null = null;
  let value: string | null = null;
  let skipQuestions = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === "--create-prd" || arg === "--prd") {
      command = "create-prd";
      if (next && !next.startsWith("-")) {
        value = next;
        i++;
      }
    } else if (arg === "--generate-tasks" || arg === "--tasks") {
      command = "generate-tasks";
      if (next && !next.startsWith("-")) {
        value = next;
        i++;
      }
    } else if (arg === "--continue-tasks" || arg === "--go") {
      command = "continue-tasks";
      if (next && !next.startsWith("-")) {
        value = next;
        i++;
      }
    } else if (arg === "--skip-questions") {
      skipQuestions = true;
    } else if (arg.startsWith("--create-prd=")) {
      command = "create-prd";
      value = arg.slice("--create-prd=".length);
    } else if (arg.startsWith("--prd=")) {
      command = "create-prd";
      value = arg.slice("--prd=".length);
    } else if (!command && !arg.startsWith("-")) {
      // Positional arg treated as value for whatever command comes next
      value = arg;
    }
  }

  return { command, value, skipQuestions };
}

/* ==================================================================
   PROJECT UTILITIES
   ================================================================== */

function findProjectRoot(startPath: string = process.cwd()): Result<string, Error> {
  let current = startPath;
  const maxAttempts = 20;
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const entries = readdirSync(current);
      const hasPackageJson = entries.includes("package.json");
      const hasGit = entries.includes(".git");
      const hasTsConfig = entries.includes("tsconfig.json");

      if (hasPackageJson || hasGit || hasTsConfig) {
        return ok(current);
      }

      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
      attempts++;
    } catch {
      break;
    }
  }

  return err(new Error(`Could not find project root starting from ${startPath}`));
}

function parseWorkspaces(projectRoot: string): Result<string[], Error> {
  try {
    const packageJsonPath = join(projectRoot, "package.json");
    const content = readFileSync(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content);

    const workspaces: string[] = [];

    if (Array.isArray(pkg.workspaces)) {
      workspaces.push(...pkg.workspaces);
    } else if (pkg.workspaces && typeof pkg.workspaces === "object") {
      if (Array.isArray(pkg.workspaces.packages)) {
        workspaces.push(...pkg.workspaces.packages);
      }
    }

    const resolvedDirs: string[] = [];
    for (const pattern of workspaces) {
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
    return ok([projectRoot]);
  }
}

/* ==================================================================
   STRING / TABLE UTILITIES
   ================================================================== */

function wrapWords(str: string, maxWidth: number): string[] {
  if (str.length <= maxWidth) return [str];

  const tokens = str.split(/([\s\-_./\\]+)/);
  const lines: string[] = [];
  let currentLine = "";

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.length > maxWidth) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = "";
      }
      for (let j = 0; j < token.length; j += maxWidth) {
        lines.push(token.slice(j, j + maxWidth));
      }
      continue;
    }

    if (!currentLine) {
      currentLine = token;
    } else if (currentLine.length + token.length <= maxWidth) {
      currentLine += token;
    } else {
      lines.push(currentLine);
      currentLine = token;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function renderTable(data: Record<string, string>[], columns: TableColumn[]): void {
  if (data.length === 0) return;

  const colWidths: number[] = columns.map((col) => {
    let max = col.header.length;
    for (const row of data) {
      const value = row[col.key] || "";
      const lines = value.split("\n");
      for (const line of lines) {
        max = Math.max(max, line.length);
      }
    }
    return Math.min(max, col.width);
  });

  const horizontalLine = "+" + colWidths.map((w) => "-".repeat(w + 2)).join("+") + "+";

  console.log(horizontalLine);
  const headerRow =
    "|" + columns.map((col, i) => " " + col.header.padEnd(colWidths[i]) + " ").join("|") + "|";
  console.log(headerRow);
  console.log(horizontalLine);

  for (const row of data) {
    const cells: TableCell[] = columns.map((col) => {
      const value = row[col.key] || "";
      const lines = value.split("\n");
      return { lines, height: lines.length };
    });

    const maxHeight = Math.max(...cells.map((c) => c.height));

    for (let lineIdx = 0; lineIdx < maxHeight; lineIdx++) {
      const lineParts = cells.map((cell, colIdx) => {
        const line = cell.lines[lineIdx] || "";
        return " " + line.padEnd(colWidths[colIdx]) + " ";
      });
      console.log("|" + lineParts.join("|") + "|");
    }

    console.log(horizontalLine);
  }
}

/* ==================================================================
   FILE DISCOVERY
   ================================================================== */

function findTaskFiles(dir: string): Result<string[], Error> {
  try {
    const taskFiles: string[] = [];
    const entries = readdirSync(dir);

    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules") continue;

      try {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          const subResult = findTaskFiles(fullPath);
          if (subResult.isOk()) {
            taskFiles.push(...subResult.value);
          }
        } else if (entry.startsWith("tasks-") && entry.endsWith(".md")) {
          taskFiles.push(fullPath);
        }
      } catch {
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

function findPrdFiles(dir: string): Result<string[], Error> {
  try {
    const prdFiles: string[] = [];
    const entries = readdirSync(dir);

    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules") continue;

      try {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          const subResult = findPrdFiles(fullPath);
          if (subResult.isOk()) {
            prdFiles.push(...subResult.value);
          }
        } else if (entry.startsWith("prd-") && entry.endsWith(".md")) {
          prdFiles.push(fullPath);
        }
      } catch {
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

function getTaskFiles(
  projectRoot: string,
  workspaceDirs: string[],
  prdFilenames: Set<string>,
): Result<TaskFile[], Error> {
  const allTasks: TaskFile[] = [];

  for (const workspaceDir of workspaceDirs) {
    const findResult = findTaskFiles(workspaceDir);
    if (findResult.isErr()) continue;

    const taskFilePaths = findResult.value;

    try {
      for (const filepath of taskFilePaths) {
        const content = readFileSync(filepath, "utf-8");
        const filename = filepath.split(/[\\/]/).pop() || "";
        const featureName = filename.replace("tasks-", "").replace(".md", "");

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

        const prdFilename = `prd-${featureName}.md`;
        const hasPrd = prdFilenames.has(prdFilename);
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
      continue;
    }
  }

  if (allTasks.length === 0) {
    return err(new Error("No task files found in any workspace"));
  }

  return ok(allTasks);
}

function getPrdFiles(
  projectRoot: string,
  workspaceDirs: string[],
  taskFilenames: Set<string>,
): Result<PrdFile[], Error> {
  const allPrds: PrdFile[] = [];

  for (const workspaceDir of workspaceDirs) {
    const findResult = findPrdFiles(workspaceDir);
    if (findResult.isErr()) continue;

    const prdFilePaths = findResult.value;

    try {
      for (const filepath of prdFilePaths) {
        const filename = filepath.split(/[\\/]/).pop() || "";
        const featureName = filename.replace("prd-", "").replace(".md", "");

        const taskFilename = `tasks-${featureName}.md`;
        const hasTaskFile = taskFilenames.has(taskFilename);
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
      continue;
    }
  }

  return ok(allPrds);
}

/* ==================================================================
   STATE MANAGEMENT
   ================================================================== */

async function loadState(projectRoot: string): Promise<AiState> {
  const statePath = join(projectRoot, STATE_FILE);
  try {
    const file = Bun.file(statePath);
    const text = await file.text();
    return JSON.parse(text) as AiState;
  } catch {
    return {};
  }
}

async function saveState(projectRoot: string, state: AiState): Promise<void> {
  const statePath = join(projectRoot, STATE_FILE);
  await Bun.write(statePath, JSON.stringify(state, null, 2));
}

/* ==================================================================
   CLIPBOARD
   ================================================================== */

async function copyToClipboard(content: string): Promise<boolean> {
  const platform = process.platform;

  try {
    if (platform === "win32") {
      const proc = Bun.spawn(["clip"], { stdin: "pipe" });
      proc.stdin.write(content);
      proc.stdin.end();
      await proc.exited;
      return true;
    }

    if (platform === "darwin") {
      const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" });
      proc.stdin.write(content);
      proc.stdin.end();
      await proc.exited;
      return true;
    }

    // Linux — try wl-copy first, then xclip
    try {
      const proc = Bun.spawn(["wl-copy"], { stdin: "pipe" });
      proc.stdin.write(content);
      proc.stdin.end();
      await proc.exited;
      return true;
    } catch {
      const proc = Bun.spawn(["xclip", "-selection", "clipboard"], { stdin: "pipe" });
      proc.stdin.write(content);
      proc.stdin.end();
      await proc.exited;
      return true;
    }
  } catch {
    return false;
  }
}

/* ==================================================================
   AUTO-DETECT FILES
   ================================================================== */

function findNewestFile(dir: string, pattern: RegExp): string | null {
  try {
    const entries = readdirSync(dir);
    let newest: { path: string; mtime: number } | null = null;

    for (const entry of entries) {
      if (!pattern.test(entry)) continue;
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (!newest || stat.mtimeMs > newest.mtime) {
          newest = { path: fullPath, mtime: stat.mtimeMs };
        }
      } catch {
        continue;
      }
    }

    return newest?.path || null;
  } catch {
    return null;
  }
}

/* ==================================================================
   PROMPT BUILDERS
   ================================================================== */

async function buildPrdPrompt(
  projectRoot: string,
  description: string,
  skipQuestions: boolean,
): Promise<string> {
  const createPrdPath = join(projectRoot, AI_DIR, "create-prd.md");
  let prdRules: string;

  try {
    prdRules = await Bun.file(createPrdPath).text();
  } catch {
    throw new Error(`Could not read ${createPrdPath}. Make sure ai/create-prd.md exists.`);
  }

  let prompt = `${prdRules}\n\n---\n\n`;
  prompt += `USER FEATURE REQUEST:\n${description}\n`;

  if (skipQuestions) {
    prompt += `\nDo not ask clarifying questions. Generate the PRD immediately based on the description above.\n`;
  }

  return prompt;
}

async function buildGenerateTasksPrompt(projectRoot: string, prdPath: string): Promise<string> {
  const generateTasksPath = join(projectRoot, AI_DIR, "generate-tasks.md");
  let tasksRules: string;

  try {
    tasksRules = await Bun.file(generateTasksPath).text();
  } catch {
    throw new Error(`Could not read ${generateTasksPath}. Make sure ai/generate-tasks.md exists.`);
  }

  let prdContent: string;
  try {
    prdContent = await Bun.file(prdPath).text();
  } catch {
    throw new Error(`Could not read PRD file: ${prdPath}`);
  }

  let prompt = `${tasksRules}\n\n---\n\n`;
  prompt += `EXISTING PRD:\n\n${prdContent}\n\n---\n\n`;
  prompt += `Please generate Phase 1 (parent tasks) based on this PRD. Present the parent tasks to me, then pause and wait for my "Go" before generating sub-tasks.\n`;

  return prompt;
}

async function buildContinueTasksPrompt(projectRoot: string, tasksPath: string): Promise<string> {
  const generateTasksPath = join(projectRoot, AI_DIR, "generate-tasks.md");
  let tasksRules: string;

  try {
    tasksRules = await Bun.file(generateTasksPath).text();
  } catch {
    throw new Error(`Could not read ${generateTasksPath}. Make sure ai/generate-tasks.md exists.`);
  }

  let tasksContent: string;
  try {
    tasksContent = await Bun.file(tasksPath).text();
  } catch {
    throw new Error(`Could not read tasks file: ${tasksPath}`);
  }

  let prompt = `${tasksRules}\n\n---\n\n`;
  prompt += `EXISTING TASKS FILE (Phase 1 - parent tasks already generated):\n\n${tasksContent}\n\n---\n\n`;
  prompt += `I have confirmed with "Go". Please now generate Phase 2 (sub-tasks) for each parent task. Do not modify existing parent tasks — only add sub-tasks under them.\n`;

  return prompt;
}

/* ==================================================================
   FLOW HANDLERS
   ================================================================== */

async function handleCreatePrd(
  projectRoot: string,
  description: string | null,
  skipQuestions: boolean,
): Promise<void> {
  let desc = description;

  if (!desc) {
    const input = await text({
      message: "Describe the feature or idea:",
      placeholder: "e.g., Auto-detect project types from package.json",
      validate: (value) => (value && value.length > 0 ? undefined : "Description is required"),
    });

    if (isCancel(input)) {
      consola.info("Cancelled.");
      return;
    }
    desc = input;
  }

  if (!skipQuestions) {
    const skip = await confirm({
      message: "Skip clarifying questions and generate PRD immediately?",
      initialValue: false,
    });
    if (isCancel(skip)) {
      consola.info("Cancelled.");
      return;
    }
    skipQuestions = skip;
  }

  const prompt = await buildPrdPrompt(projectRoot, desc!, skipQuestions);
  const copied = await copyToClipboard(prompt);

  if (copied) {
    consola.success("✅ PRD prompt copied to clipboard! Paste into your opencode terminal.");
  } else {
    consola.warn("Could not copy to clipboard automatically. Prompt printed below:\n");
    console.log(prompt);
  }

  // Derive expected feature slug for state tracking
  const slug = desc!
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (slug) {
    const state = await loadState(projectRoot);
    state.lastPrdPath = join(projectRoot, TASKS_DIR, `prd-${slug}.md`);
    await saveState(projectRoot, state);
  }
}

async function handleGenerateTasks(projectRoot: string, prdPathArg: string | null): Promise<void> {
  let prdPath = prdPathArg;
  const tasksDirPath = join(projectRoot, TASKS_DIR);

  if (!prdPath) {
    const state = await loadState(projectRoot);
    if (state.lastPrdPath && statSync(state.lastPrdPath, { throwIfNoEntry: false })) {
      const useState = await confirm({
        message: `Use last PRD: ${relative(projectRoot, state.lastPrdPath)}?`,
        initialValue: true,
      });
      if (!isCancel(useState) && useState) {
        prdPath = state.lastPrdPath;
      }
    }

    if (!prdPath) {
      const detected = findNewestFile(tasksDirPath, /^prd-.*\.md$/);
      if (detected) {
        const useDetected = await confirm({
          message: `Use detected PRD: ${relative(projectRoot, detected)}?`,
          initialValue: true,
        });
        if (!isCancel(useDetected) && useDetected) {
          prdPath = detected;
        }
      }
    }

    if (!prdPath) {
      const input = await text({
        message: "Enter path to PRD file:",
        placeholder: "tasks/prd-my-feature.md",
        validate: (value) => (value && value.length > 0 ? undefined : "Path is required"),
      });
      if (isCancel(input)) {
        consola.info("Cancelled.");
        return;
      }
      prdPath = input;
    }
  }

  // Resolve relative paths
  if (!prdPath!.startsWith("/") && !/^[A-Za-z]:/.test(prdPath!)) {
    prdPath = join(projectRoot, prdPath!);
  }

  const prompt = await buildGenerateTasksPrompt(projectRoot, prdPath!);
  const copied = await copyToClipboard(prompt);

  if (copied) {
    consola.success("✅ Tasks Phase 1 prompt copied to clipboard! Paste into your opencode terminal.");
  } else {
    consola.warn("Could not copy to clipboard automatically. Prompt printed below:\n");
    console.log(prompt);
  }

  // Update state with expected tasks path
  const state = await loadState(projectRoot);
  const prdFilename = prdPath!.split(/[\\/]/).pop() || "";
  const featureName = prdFilename.replace("prd-", "").replace(".md", "");
  state.lastTasksPath = join(projectRoot, TASKS_DIR, `tasks-${featureName}.md`);
  await saveState(projectRoot, state);
}

async function handleContinueTasks(projectRoot: string, tasksPathArg: string | null): Promise<void> {
  let tasksPath = tasksPathArg;
  const tasksDirPath = join(projectRoot, TASKS_DIR);

  if (!tasksPath) {
    const state = await loadState(projectRoot);
    if (state.lastTasksPath && statSync(state.lastTasksPath, { throwIfNoEntry: false })) {
      const useState = await confirm({
        message: `Use last tasks file: ${relative(projectRoot, state.lastTasksPath)}?`,
        initialValue: true,
      });
      if (!isCancel(useState) && useState) {
        tasksPath = state.lastTasksPath;
      }
    }

    if (!tasksPath) {
      const detected = findNewestFile(tasksDirPath, /^tasks-.*\.md$/);
      if (detected) {
        const useDetected = await confirm({
          message: `Use detected tasks file: ${relative(projectRoot, detected)}?`,
          initialValue: true,
        });
        if (!isCancel(useDetected) && useDetected) {
          tasksPath = detected;
        }
      }
    }

    if (!tasksPath) {
      const input = await text({
        message: "Enter path to tasks file:",
        placeholder: "tasks/tasks-my-feature.md",
        validate: (value) => (value && value.length > 0 ? undefined : "Path is required"),
      });
      if (isCancel(input)) {
        consola.info("Cancelled.");
        return;
      }
      tasksPath = input;
    }
  }

  // Resolve relative paths
  if (!tasksPath!.startsWith("/") && !/^[A-Za-z]:/.test(tasksPath!)) {
    tasksPath = join(projectRoot, tasksPath!);
  }

  const prompt = await buildContinueTasksPrompt(projectRoot, tasksPath!);
  const copied = await copyToClipboard(prompt);

  if (copied) {
    consola.success("✅ Tasks Phase 2 prompt copied to clipboard! Paste into your opencode terminal.");
  } else {
    consola.warn("Could not copy to clipboard automatically. Prompt printed below:\n");
    console.log(prompt);
  }

  // Update state
  const state = await loadState(projectRoot);
  state.lastTasksPath = tasksPath!;
  await saveState(projectRoot, state);
}

/* ==================================================================
   INTERACTIVE MENU
   ================================================================== */

async function showInteractiveMenu(projectRoot: string): Promise<void> {
  const action = await select({
    message: "What would you like to do?",
    options: [
      { value: "create-prd", label: "📄 Create PRD — generate prompt from a feature description" },
      { value: "check-tasks", label: "✅ Check tasks — view task status overview" },
      { value: "generate-tasks", label: "📑 Generate tasks — from a PRD file" },
      { value: "continue-tasks", label: "⏩ Continue tasks — generate sub-tasks from existing parent tasks" },
    ],
  });

  if (isCancel(action)) {
    consola.info("Cancelled.");
    return;
  }

  switch (action) {
    case "create-prd":
      await handleCreatePrd(projectRoot, null, false);
      break;
    case "check-tasks":
      await runCheckTasks(projectRoot);
      break;
    case "generate-tasks":
      await handleGenerateTasks(projectRoot, null);
      break;
    case "continue-tasks":
      await handleContinueTasks(projectRoot, null);
      break;
  }
}

/* ==================================================================
   EXISTING CHECK-TASKS FLOW
   ================================================================== */

async function runCheckTasks(projectRoot: string): Promise<void> {
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

  const taskColumns: TableColumn[] = [
    { key: "Feature", header: "Feature", width: 30 },
    { key: "Status", header: "Status", width: 12 },
    { key: "Progress", header: "Progress", width: 16 },
    { key: "PRD", header: "PRD", width: 4 },
    { key: "Path", header: "Path", width: 40 },
  ];

  const tableData = sorted.map((task) => ({
    Feature: wrapWords(task.filename, 30).join("\n"),
    Status: task.status,
    Progress: `${task.completedTasks}/${task.totalTasks} (${task.completionPercent}%)`,
    PRD: task.hasPrd ? "✓" : "✗",
    Path: wrapWords(task.filepath, 40).join("\n"),
  }));

  consola.box({
    title: "📋 Task Status Overview",
    message: `${tasks.length} task file(s) found`,
  });

  renderTable(tableData, taskColumns);

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

      const prdColumns: TableColumn[] = [
        { key: "Feature", header: "Feature", width: 30 },
        { key: "Path", header: "Path", width: 40 },
      ];

      const prdTableData = prdsMissingTasks
        .sort((a, b) => {
          if (a.workspace !== b.workspace) {
            return a.workspace.localeCompare(b.workspace);
          }
          return a.filename.localeCompare(b.filename);
        })
        .map((prd) => ({
          Feature: wrapWords(prd.filename, 30).join("\n"),
          Path: wrapWords(prd.filepath, 40).join("\n"),
        }));

      renderTable(prdTableData, prdColumns);
    }
  }

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

/* ==================================================================
   MAIN
   ================================================================== */

async function main() {
  // Detect project root
  const projectRootResult = findProjectRoot();
  if (projectRootResult.isErr()) {
    consola.error(`Failed to detect project: ${projectRootResult.error.message}`);
    process.exit(1);
  }
  const projectRoot = projectRootResult.value;
  consola.info(`📂 Detected project: ${projectRoot}`);

  const args = parseArgs();

  if (args.command) {
    // Flag mode
    switch (args.command) {
      case "create-prd":
        await handleCreatePrd(projectRoot, args.value, args.skipQuestions);
        break;
      case "generate-tasks":
        await handleGenerateTasks(projectRoot, args.value);
        break;
      case "continue-tasks":
        await handleContinueTasks(projectRoot, args.value);
        break;
      default:
        consola.error(`Unknown command: ${args.command}`);
        process.exit(1);
    }
  } else {
    // Interactive menu mode
    await showInteractiveMenu(projectRoot);
  }
}

main().catch((error) => {
  consola.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
