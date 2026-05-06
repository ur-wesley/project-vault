import { For, Show, createSignal } from "solid-js";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useI18n } from "~/lib/i18n-context";
import type { DiscoverVersionFilesResultDto } from "~/types/dto";
import type { ProjectDetailModel } from "../model/createProjectDetailModel";

export function TagVersionDialog(props: {
  model: ProjectDetailModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const m = () => props.model;
  const [tagStep, setTagStep] = createSignal<"bump" | "files">("bump");
  const [selectedBump, setSelectedBump] = createSignal<
    "patch" | "minor" | "major" | "beta"
  >("patch");
  const [discoveredFiles, setDiscoveredFiles] =
    createSignal<DiscoverVersionFilesResultDto | null>(null);
  const [selectedVersionFiles, setSelectedVersionFiles] = createSignal<
    Set<string>
  >(new Set<string>());
  const [tagError, setTagError] = createSignal<string | null>(null);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open);
        setTagError(null);
        if (!open) {
          setTagStep("bump");
          setDiscoveredFiles(null);
          setSelectedVersionFiles(new Set<string>());
        }
      }}
    >
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <Show
            when={tagStep() !== "bump"}
            fallback={
              <div>
                <DialogTitle>
                  {t("projectDetail.gitPushTagTitle") as string}
                </DialogTitle>
                <DialogDescription>
                  {t("projectDetail.gitPushTagDescription") as string}
                </DialogDescription>
              </div>
            }
          >
            <DialogTitle>
              {t("projectDetail.gitBumpTitle") as string}
            </DialogTitle>
            <DialogDescription>
              {discoveredFiles()
                ? (t("projectDetail.gitBumpDescription", {
                    current: discoveredFiles()!.currentVersion,
                    new: discoveredFiles()!.newVersion,
                  }) as string)
                : ""}
            </DialogDescription>
          </Show>
        </DialogHeader>

        <Show when={tagStep() === "bump"}>
          <Show when={tagError()}>
            <div class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {tagError()}
            </div>
          </Show>
          <div class="grid grid-cols-4 gap-3 py-2">
            <BumpButton
              bump="patch"
              label="x.x.1 → x.x.2"
              selectedBump={selectedBump()}
              isDiscovering={m().isDiscoveringFiles()}
              previewVersionsQ={m().previewVersionsQ}
              onClick={async () => {
                setSelectedBump("patch");
                setTagError(null);
                try {
                  const result = await m().discoverVersionFiles("patch");
                  setDiscoveredFiles(result);
                  setSelectedVersionFiles(
                    new Set<string>(result.files.map((f) => f.path)),
                  );
                  setTagStep("files");
                } catch (e: any) {
                  setTagError(e?.message || String(e));
                }
              }}
            />
            <BumpButton
              bump="minor"
              label="x.1.x → x.2.0"
              selectedBump={selectedBump()}
              isDiscovering={m().isDiscoveringFiles()}
              previewVersionsQ={m().previewVersionsQ}
              onClick={async () => {
                setSelectedBump("minor");
                setTagError(null);
                try {
                  const result = await m().discoverVersionFiles("minor");
                  setDiscoveredFiles(result);
                  setSelectedVersionFiles(
                    new Set<string>(result.files.map((f) => f.path)),
                  );
                  setTagStep("files");
                } catch (e: any) {
                  setTagError(e?.message || String(e));
                }
              }}
            />
            <BumpButton
              bump="major"
              label="1.x.x → 2.0.0"
              selectedBump={selectedBump()}
              isDiscovering={m().isDiscoveringFiles()}
              previewVersionsQ={m().previewVersionsQ}
              onClick={async () => {
                setSelectedBump("major");
                setTagError(null);
                try {
                  const result = await m().discoverVersionFiles("major");
                  setDiscoveredFiles(result);
                  setSelectedVersionFiles(
                    new Set<string>(result.files.map((f) => f.path)),
                  );
                  setTagStep("files");
                } catch (e: any) {
                  setTagError(e?.message || String(e));
                }
              }}
            />
            <BumpButton
              bump="beta"
              label="x.x.x → x.x.x-beta.0"
              selectedBump={selectedBump()}
              isDiscovering={m().isDiscoveringFiles()}
              previewVersionsQ={m().previewVersionsQ}
              onClick={async () => {
                setSelectedBump("beta");
                setTagError(null);
                try {
                  const result = await m().discoverVersionFiles("beta");
                  setDiscoveredFiles(result);
                  setSelectedVersionFiles(
                    new Set<string>(result.files.map((f) => f.path)),
                  );
                  setTagStep("files");
                } catch (e: any) {
                  setTagError(e?.message || String(e));
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => props.onOpenChange(false)}>
              {t("common.cancel") as string}
            </Button>
          </DialogFooter>
        </Show>

        <Show when={tagStep() === "files" && discoveredFiles()}>
          {(data) => (
            <div class="space-y-3">
              <Show
                when={data().files.length > 0}
                fallback={
                  <div class="text-center py-4 space-y-3">
                    <p class="text-sm text-muted-foreground">
                      {t("projectDetail.gitBumpNoFiles") as string}
                    </p>
                    <div class="flex justify-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={m().isBumpingVersion()}
                        onClick={() => setTagStep("bump")}
                      >
                        <span class="iconify mdi--arrow-left size-3.5" />
                        {t("common.back") as string}
                      </Button>
                      <Button
                        size="sm"
                        disabled={m().isBumpingVersion()}
                        onClick={() => {
                          m().tagAndPushMutate(selectedBump());
                          props.onOpenChange(false);
                        }}
                      >
                        <Show
                          when={m().isBumpingVersion()}
                          fallback={
                            <span class="iconify mdi--tag-plus size-3.5" />
                          }
                        >
                          <span class="iconify mdi--loading animate-spin size-3.5" />
                        </Show>
                        {t("projectDetail.gitPushTagOnly") as string}
                      </Button>
                    </div>
                  </div>
                }
              >
                <div class="max-h-64 overflow-y-auto space-y-2 border rounded-md p-2">
                  <For each={data().files}>
                    {(file) => (
                      <div class="flex items-start gap-2">
                        <Checkbox
                          id={`version-file-${file.path}`}
                          checked={selectedVersionFiles().has(file.path)}
                          onChange={(checked) => {
                            setSelectedVersionFiles((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(file.path);
                              else next.delete(file.path);
                              return next;
                            });
                          }}
                        />
                        <div class="flex-1 min-w-0">
                          <label
                            for={`version-file-${file.path}`}
                            class="text-xs font-mono font-medium cursor-pointer"
                          >
                            {file.path}
                          </label>
                          <p class="text-[10px] text-muted-foreground font-mono truncate">
                            {file.preview}
                          </p>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    disabled={m().isBumpingVersion()}
                    onClick={() => setTagStep("bump")}
                  >
                    <span class="iconify mdi--arrow-left size-3.5" />
                    {t("common.back") as string}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => props.onOpenChange(false)}
                    disabled={m().isBumpingVersion()}
                  >
                    {t("common.cancel") as string}
                  </Button>
                  <Button
                    disabled={
                      m().isBumpingVersion() ||
                      selectedVersionFiles().size === 0
                    }
                    onClick={() => {
                      m().bumpVersionAndTag({
                        bump: selectedBump(),
                        files: Array.from(selectedVersionFiles()),
                      });
                      props.onOpenChange(false);
                    }}
                  >
                    <Show
                      when={m().isBumpingVersion()}
                      fallback={
                        <span class="iconify mdi--tag-plus size-3.5" />
                      }
                    >
                      <span class="iconify mdi--loading animate-spin size-3.5" />
                    </Show>
                    {t("projectDetail.gitBumpCommitTagPush") as string}
                  </Button>
                </DialogFooter>
              </Show>
            </div>
          )}
        </Show>
      </DialogContent>
    </Dialog>
  );
}

function BumpButton(props: {
  bump: "patch" | "minor" | "major" | "beta";
  label: string;
  selectedBump: string;
  isDiscovering: () => boolean;
  previewVersionsQ: { data: { currentVersion: string; patchVersion: string; minorVersion: string; majorVersion: string; betaVersion: string } | undefined };
  onClick: () => void;
}) {
  const { t } = useI18n();
  const version = () => {
    const v = props.previewVersionsQ.data;
    if (!v) return props.label;
    switch (props.bump) {
      case "patch": return `${v.currentVersion} → ${v.patchVersion}`;
      case "minor": return `${v.currentVersion} → ${v.minorVersion}`;
      case "major": return `${v.currentVersion} → ${v.majorVersion}`;
      case "beta": return `${v.currentVersion} → ${v.betaVersion}`;
    }
  };

  return (
    <Button
      variant="outline"
      class="flex flex-col gap-1 h-auto py-3"
      disabled={props.isDiscovering()}
      onClick={props.onClick}
    >
      <Show
        when={props.isDiscovering() && props.selectedBump === props.bump}
        fallback={
          <div class="flex flex-col gap-1">
            <span class="text-lg font-bold">{props.bump}</span>
            <span class="text-[10px] text-muted-foreground">
              <Show when={props.previewVersionsQ.data} fallback={<span>{props.label}</span>}>
                <span>{version()}</span>
              </Show>
            </span>
          </div>
        }
      >
        <span class="iconify mdi--loading animate-spin size-5" />
      </Show>
    </Button>
  );
}
