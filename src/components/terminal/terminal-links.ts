import { OSC8LinkProvider, UrlRegexProvider, type ILinkProvider } from "ghostty-web";

import { openExternal } from "~/lib/open-external";

/**
 * Library link wiring (P1-4, ghostty-web 0.4.0).
 *
 * `Terminal.open()` already builds an internal detector, registers a URL
 * regex provider plus an OSC8 provider, and wires its own canvas click/hover
 * hit-testing (the viewport-to-absolute row math lives inside the library).
 * There is no public accessor for the detector, so the previous hand-rolled
 * canvas rect to column/row path is replaced by registering providers through
 * the public `Terminal.registerLinkProvider` API instead.
 *
 * The providers' default activation calls raw `window.open` (modifier-gated)
 * and the URL regex also matches non-allowlisted schemes (`ftp:`, `ssh:`,
 * `magnet:`, ...), so each detected link is re-wrapped here and activation
 * routes through the allowlisted `openExternal` (P0-2, OQ-5: `http:`,
 * `https:`, `mailto:`, `tel:` only, warn-plus-noop otherwise). Registration
 * runs synchronously right after `term.open()`, before any row is scanned,
 * and same-range links share detector cache keys, so the allowlisted wrappers
 * deterministically win over the built-in defaults. Plain-click-to-open plus
 * the text-selection guard match the pre-P1-4 UX.
 */

/** Exact host surface the library URL provider needs (not exported upstream). */
type UrlProviderHost = ConstructorParameters<typeof UrlRegexProvider>[0];
/** Exact host surface the library OSC8 provider needs (not exported upstream). */
type Osc8ProviderHost = ConstructorParameters<typeof OSC8LinkProvider>[0];

/**
 * Minimal terminal surface link wiring needs: detector host for both library
 * providers, plus the selection guard and the public registration hook.
 * The full public `Terminal` satisfies this; tests use a lean stub.
 */
export type LinkHandlerHost = UrlProviderHost &
  Osc8ProviderHost & {
    hasSelection(): boolean;
    registerLinkProvider(provider: ILinkProvider): void;
  };

/** Selection state needed to keep copy workflows from opening links. */
export interface SelectionGuard {
  hasSelection(): boolean;
}

/**
 * Re-wrap a library provider so detected links keep their ranges but
 * activation flows through the allowlisted opener. Pure adapter: detection
 * stays entirely inside the library provider.
 */
export function wrapLinkProvider(guard: SelectionGuard, inner: ILinkProvider): ILinkProvider {
  return {
    provideLinks(y, callback) {
      inner.provideLinks(y, (links) => {
        if (!links) {
          callback(undefined);
          return;
        }
        callback(
          links.map((link) => ({
            ...link,
            activate: () => {
              if (guard.hasSelection()) return;
              void openExternal(link.text);
            },
          })),
        );
      });
    },
    dispose: () => {
      inner.dispose?.();
    },
  };
}

export function attachTauriLinkHandler(
  term: LinkHandlerHost,
  // Kept for signature stability (both terminal consumers pass the element
  // the terminal was opened on; the P1-2 sibling coordinates on this file):
  // detection is element-agnostic now, the library owns click hit-testing.
  // Typed `unknown` so node-environment unit tests can pass a stub.
  _node: unknown,
): { dispose: () => void } {
  const providers = [
    wrapLinkProvider(term, new UrlRegexProvider(term)),
    wrapLinkProvider(term, new OSC8LinkProvider(term)),
  ];
  for (const provider of providers) term.registerLinkProvider(provider);
  return {
    dispose: () => {
      for (const provider of providers) provider.dispose?.();
    },
  };
}
