import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import { GITHUB_TOKEN_SETTING_KEY } from "~/services/github";
import { setSetting, startGithubDeviceFlow, waitGithubDeviceFlow } from "~/services/tauri";
import type { StableError } from "~/types/error";

export type GithubDeviceSignInOptions = {
  clientId?: string;
  onUserCode?: (code: string) => void;
  onAfterOpenBrowser?: () => void;
};

export async function runGithubDeviceSignIn(
  options?: GithubDeviceSignInOptions,
): Promise<StableError | "ok"> {
  if (!isTauri()) {
    return { code: "INVOKE_FAILED", message: "Sign in is only available in the desktop app." };
  }
  const startR = await startGithubDeviceFlow(options?.clientId);
  if (startR.isErr()) {
    return startR.error;
  }
  const s = startR.value;
  options?.onUserCode?.(s.userCode);

  // Copy to clipboard
  try {
    await navigator.clipboard.writeText(s.userCode);
  } catch (e) {
    console.error("failed to copy to clipboard", e);
  }

  await openUrl(s.verificationUri);
  options?.onAfterOpenBrowser?.();
  const waitR = await waitGithubDeviceFlow(
    {
      deviceCode: s.deviceCode,
      intervalSec: s.intervalSec,
      expiresIn: s.expiresIn,
    },
    options?.clientId,
  );
  if (waitR.isErr()) {
    return waitR.error;
  }
  const saveR = await setSetting(GITHUB_TOKEN_SETTING_KEY, waitR.value.accessToken);
  if (saveR.isErr()) {
    return saveR.error;
  }
  return "ok";
}
