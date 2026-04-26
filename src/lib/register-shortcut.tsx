import { createShortcut } from "@solid-primitives/keyboard";
import type { VoidComponent } from "solid-js";

export const RegisterShortcut: VoidComponent<{
  keys: string[];
  onPress: () => void;
}> = (props) => {
  createShortcut(props.keys, () => props.onPress());
  return null;
};
