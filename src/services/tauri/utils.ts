import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";
import type { StableError } from "~/types/error";

export function mapInvokeError(e: unknown): StableError {
  if (
    e !== null &&
    typeof e === "object" &&
    "code" in e &&
    "message" in e &&
    typeof (e as StableError).code === "string" &&
    typeof (e as StableError).message === "string"
  ) {
    return e as StableError;
  }
  return { code: "INVOKE_FAILED", message: String(e) };
}

export function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): ResultAsync<T, StableError> {
  console.log("[tauriInvoke] cmd:", cmd, "args:", args);
  return ResultAsync.fromPromise(invoke<T>(cmd, args), (e) => {
    console.error("[tauriInvoke] error for cmd:", cmd, "error:", e);
    return mapInvokeError(e);
  });
}
