import type {
  AddBeadCommentInput,
  BeadCommentDto,
  BeadIssueDto,
  BeadsStatusDto,
  CreateBeadInput,
  UpdateBeadStatusInput,
} from "~/types/dto/beads";
import { tauriInvoke } from "./utils";

export function beadsGetStatus(projectPath: string) {
  return tauriInvoke<BeadsStatusDto>("beads_get_status", {
    projectPath,
  });
}

export function beadsListIssues(projectPath: string) {
  return tauriInvoke<BeadIssueDto[]>("beads_list_issues", {
    projectPath,
  });
}

export function beadsCreateIssue(input: CreateBeadInput) {
  return tauriInvoke<BeadIssueDto>("beads_create_issue", {
    input,
  });
}

export function beadsUpdateIssueStatus(input: UpdateBeadStatusInput) {
  return tauriInvoke<void>("beads_update_issue_status", {
    input,
  });
}

export function beadsInit(projectPath: string) {
  return tauriInvoke<void>("beads_init", {
    projectPath,
  });
}

export function beadsGetComments(projectPath: string, id: string) {
  return tauriInvoke<BeadCommentDto[]>("beads_get_comments", {
    projectPath,
    id,
  });
}

export function beadsAddComment(input: AddBeadCommentInput) {
  return tauriInvoke<void>("beads_add_comment", {
    input,
  });
}

export function startBeadsWatcher(projectId: string, projectPath: string) {
  return tauriInvoke<void>("start_beads_watcher", {
    projectId,
    projectPath,
  });
}

export function stopBeadsWatcher(projectId: string) {
  return tauriInvoke<void>("stop_beads_watcher", {
    projectId,
  });
}
