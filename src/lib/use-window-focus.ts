import { createSignal, onCleanup, onMount, type Accessor } from "solid-js";

export function useWindowFocus(): Accessor<boolean> {
  const [isFocused, setIsFocused] = createSignal(
    typeof document !== "undefined" ? document.hasFocus() : true,
  );

  onMount(() => {
    const onVisibilityChange = () => {
      setIsFocused(document.hasFocus() && document.visibilityState === "visible");
    };
    const onFocus = () => setIsFocused(true);
    const onBlur = () => setIsFocused(false);

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);

    onCleanup(() => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    });
  });

  return isFocused;
}
