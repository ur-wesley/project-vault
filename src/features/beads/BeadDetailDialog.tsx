import { For, Show, createEffect, createSignal, type Component } from "solid-js";
import { createQuery } from "@tanstack/solid-query";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { useI18n } from "~/lib/i18n-context";
import { cn } from "~/lib/utils";
import { beadsGetComments } from "~/services/tauri/beads";
import type { BeadIssueDto } from "~/types/dto/beads";
import { PRIORITY_MAP, TYPE_BADGE_STYLE } from "./types";

type Props = {
  projectPath: string;
  issue: BeadIssueDto | null;
  onClose: () => void;
  onStatusChange: (id: string, status: string, reason?: string) => void;
  onAddComment: (id: string, comment: string) => void;
  onSelectIssue: (id: string) => void;
};

export const BeadDetailDialog: Component<Props> = (props) => {
  const { t } = useI18n();
  const [commentDraft, setCommentDraft] = createSignal("");
  const [copied, setCopied] = createSignal(false);

  const issue = () => props.issue;

  const commentsQ = createQuery(() => ({
    queryKey: ["bead-comments", props.projectPath, issue()?.id],
    queryFn: async () => {
      const id = issue()?.id;
      if (!id || !props.projectPath) return [];
      const r = await beadsGetComments(props.projectPath, id);
      if (r.isErr()) return [];
      return r.value;
    },
    enabled: Boolean(issue()?.id && props.projectPath),
    retry: false,
    // Comments change rarely; cache 30s to avoid a `bd` spawn per dialog open.
    staleTime: 30_000,
    gcTime: 300_000,
  }));

  createEffect(() => {
    // Reset comment draft on issue switch
    const _id = issue()?.id;
    if (_id) {
      setCommentDraft("");
      setCopied(false);
    }
  });

  const handleCopyId = () => {
    const id = issue()?.id;
    if (!id) return;
    void navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddComment = () => {
    const id = issue()?.id;
    const text = commentDraft().trim();
    if (!id || !text) return;
    props.onAddComment(id, text);
    setCommentDraft("");
    setTimeout(() => void commentsQ.refetch(), 300);
  };

  const priorityMeta = () => (issue() ? PRIORITY_MAP[issue()!.priority] ?? PRIORITY_MAP[4]! : PRIORITY_MAP[4]!);
  const typeStyle = () => (issue() ? TYPE_BADGE_STYLE[issue()!.issueType.toLowerCase()] ?? "" : "");

  return (
    <Dialog open={Boolean(issue())} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent class="max-w-2xl max-h-[85vh] flex flex-col gap-4 overflow-hidden p-6">
        <Show when={issue()}>
          {(iss) => (
            <>
              <DialogHeader class="gap-1.5 shrink-0 border-b pb-4">
                <div class="flex items-center gap-2">
                  <Badge variant="outline" class="font-mono text-xs">
                    {iss().id}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    class="size-6 text-muted-foreground"
                    title={t("beads.copyId") as string}
                    onClick={handleCopyId}
                  >
                    <span class={cn("iconify size-3.5", copied() ? "mdi--check text-green-500" : "mdi--content-copy")} />
                  </Button>
                  <Badge variant="outline" class={cn("text-xs uppercase py-0 px-2", typeStyle())}>
                    {iss().issueType}
                  </Badge>
                  <Badge variant="outline" class={cn("text-xs font-bold py-0 px-2", priorityMeta().badgeClass)}>
                    {priorityMeta().label}
                  </Badge>
                  <Badge variant="secondary" class="text-xs ml-auto">
                    {iss().status}
                  </Badge>
                </div>
                <DialogTitle class="text-lg font-semibold leading-snug">
                  {iss().title}
                </DialogTitle>
              </DialogHeader>

              {/* Status Action Buttons */}
              <div class="flex flex-wrap items-center gap-2 shrink-0 border-b pb-3">
                <span class="text-xs text-muted-foreground font-medium">
                  {t("beads.transitionStatus") as string}:
                </span>
                <Show when={iss().status !== "open"}>
                  <Button
                    size="sm"
                    variant="outline"
                    class="h-7 text-xs"
                    onClick={() => props.onStatusChange(iss().id, "open")}
                  >
                    {t("beads.statusOpen") as string}
                  </Button>
                </Show>
                <Show when={iss().status !== "in_progress"}>
                  <Button
                    size="sm"
                    variant="outline"
                    class="h-7 text-xs"
                    onClick={() => props.onStatusChange(iss().id, "in_progress")}
                  >
                    {t("beads.statusInProgress") as string}
                  </Button>
                </Show>
                <Show when={iss().status !== "blocked"}>
                  <Button
                    size="sm"
                    variant="outline"
                    class="h-7 text-xs text-amber-500"
                    onClick={() => props.onStatusChange(iss().id, "blocked")}
                  >
                    {t("beads.statusBlocked") as string}
                  </Button>
                </Show>
                <Show when={iss().status !== "closed"}>
                  <Button
                    size="sm"
                    variant="outline"
                    class="h-7 text-xs text-emerald-500"
                    onClick={() => props.onStatusChange(iss().id, "closed")}
                  >
                    {t("beads.statusClosed") as string}
                  </Button>
                </Show>
              </div>

              {/* Scrollable details and content */}
              <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 pr-1">
                {/* Metadata row */}
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs rounded-lg border bg-muted/20 p-3">
                  <div>
                    <span class="text-muted-foreground block text-[10px] uppercase font-bold">{t("beads.colAssignee") as string}</span>
                    <span class="font-medium">{iss().assignee || "—"}</span>
                  </div>
                  <div>
                    <span class="text-muted-foreground block text-[10px] uppercase font-bold">{t("beads.colOwner") as string}</span>
                    <span class="font-medium">{iss().owner || "—"}</span>
                  </div>
                  <div>
                    <span class="text-muted-foreground block text-[10px] uppercase font-bold">{t("beads.colParent") as string}</span>
                    <Show when={iss().parent} fallback="—">
                      <button
                        type="button"
                        class="font-mono text-primary underline hover:opacity-80"
                        onClick={() => props.onSelectIssue(iss().parent!)}
                      >
                        {iss().parent}
                      </button>
                    </Show>
                  </div>
                  <div>
                    <span class="text-muted-foreground block text-[10px] uppercase font-bold">{t("beads.colCreated") as string}</span>
                    <span class="font-medium text-muted-foreground">{iss().createdAt?.slice(0, 10) ?? "—"}</span>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <h4 class="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                    {t("beads.description") as string}
                  </h4>
                  <div class="rounded-lg border bg-muted/10 p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground min-h-16">
                    {iss().description || <span class="italic text-muted-foreground">{t("beads.noDescription") as string}</span>}
                  </div>
                </div>

                {/* Dependencies */}
                <Show when={(iss().dependencies?.length ?? 0) > 0}>
                  <div>
                    <h4 class="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                      {t("beads.dependencies") as string}
                    </h4>
                    <div class="flex flex-col gap-1 rounded-lg border p-2">
                      <For each={iss().dependencies ?? []}>
                        {(dep) => (
                          <div class="flex items-center gap-2 text-xs py-1 px-1.5 rounded hover:bg-muted/40">
                            <Badge variant="outline" class="text-[10px] py-0">
                              {dep.type}
                            </Badge>
                            <button
                              type="button"
                              class="font-mono text-primary underline hover:opacity-80"
                              onClick={() => props.onSelectIssue(dep.dependsOnId)}
                            >
                              {dep.dependsOnId}
                            </button>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                {/* Comments section */}
                <div>
                  <h4 class="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                    {t("beads.comments") as string} ({commentsQ.data?.length ?? 0})
                  </h4>

                  <div class="flex flex-col gap-2 mb-3">
                    <For each={commentsQ.data ?? []}>
                      {(comment) => (
                        <div class="rounded-lg border bg-card p-2.5 text-xs">
                          <div class="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                            <span class="font-semibold text-foreground">{comment.author || "User"}</span>
                            <span>{comment.createdAt ? comment.createdAt.slice(0, 16) : ""}</span>
                          </div>
                          <p class="leading-relaxed whitespace-pre-wrap">{comment.text}</p>
                        </div>
                      )}
                    </For>
                    <Show when={(commentsQ.data?.length ?? 0) === 0}>
                      <p class="text-xs text-muted-foreground italic py-2">{t("beads.noComments") as string}</p>
                    </Show>
                  </div>

                  {/* Add comment input */}
                  <div class="flex items-center gap-2">
                    <TextField class="flex-1">
                      <TextFieldInput
                        placeholder={t("beads.addCommentPlaceholder") as string}
                        class="h-8 text-xs"
                        value={commentDraft()}
                        onInput={(e) => setCommentDraft(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddComment();
                        }}
                      />
                    </TextField>
                    <Button
                      size="sm"
                      class="h-8 text-xs"
                      disabled={!commentDraft().trim()}
                      onClick={handleAddComment}
                    >
                      {t("beads.sendComment") as string}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </Show>
      </DialogContent>
    </Dialog>
  );
};
