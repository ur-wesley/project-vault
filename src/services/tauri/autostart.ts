import { ResultAsync } from "neverthrow";
import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";
import { mapInvokeError } from "./utils";

export function getAutostartEnabled() {
  return ResultAsync.fromPromise(isEnabled(), mapInvokeError);
}

export function setAutostartEnabled(value: boolean) {
  return ResultAsync.fromPromise(
    value ? enable() : disable(),
    mapInvokeError,
  );
}
