import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";
import type { StableError } from "~/types/error";
import { isStableError } from "~/lib/guards";

export function mapInvokeError(e: unknown): StableError {
  if (isStableError(e)) return e;
  if (e instanceof Error) return { code: "INVOKE_FAILED", message: e.message };
  return { code: "INVOKE_FAILED", message: String(e) };
}

export function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): ResultAsync<T, StableError> {
  return ResultAsync.fromPromise(invoke<T>(cmd, args), (e) => {
    console.error("[tauriInvoke] error for cmd:", cmd, "error:", e);
    return mapInvokeError(e);
  });
}
