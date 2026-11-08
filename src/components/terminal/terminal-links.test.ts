import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ILink, ILinkProvider } from "ghostty-web";

const tauriState = vi.hoisted(() => ({ isTauri: true }));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauriState.isTauri,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
}));

interface StubInner {
  term: unknown;
  provideImpl: (y: number, callback: (links: ILink[] | undefined) => void) => void;
  disposeCalls: number;
}

const ghosttyState = vi.hoisted<{ url: StubInner[]; osc8: StubInner[] }>(() => ({
  url: [],
  osc8: [],
}));

vi.mock("ghostty-web", () => {
  class UrlStub {
    private readonly record: StubInner;
    constructor(term: unknown) {
      this.record = {
        term,
        provideImpl: (_y, callback) => callback(undefined),
        disposeCalls: 0,
      };
      ghosttyState.url.push(this.record);
    }
    provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
      this.record.provideImpl(y, callback);
    }
    dispose(): void {
      this.record.disposeCalls += 1;
    }
  }
  class Osc8Stub {
    private readonly record: StubInner;
    constructor(term: unknown) {
      this.record = {
        term,
        provideImpl: (_y, callback) => callback(undefined),
        disposeCalls: 0,
      };
      ghosttyState.osc8.push(this.record);
    }
    provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
      this.record.provideImpl(y, callback);
    }
    dispose(): void {
      this.record.disposeCalls += 1;
    }
  }
  return { UrlRegexProvider: UrlStub, OSC8LinkProvider: Osc8Stub };
});

import { openUrl } from "@tauri-apps/plugin-opener";

import { attachTauriLinkHandler, wrapLinkProvider } from "./terminal-links";

const openUrlMock = vi.mocked(openUrl);
const warnMock = vi.spyOn(console, "warn").mockImplementation(() => {});

function detectedLink(text: string): ILink {
  return {
    text,
    range: {
      start: { x: 0, y: 7 },
      end: { x: 10, y: 7 },
    },
    activate: () => {},
  };
}

function makeHost(selection = false) {
  const registered: ILinkProvider[] = [];
  const state = { selection };
  const host = {
    buffer: {
      active: {
        length: 0,
        getLine: (_y: number): undefined => undefined,
      },
    },
    hasSelection: (): boolean => state.selection,
    registerLinkProvider: (provider: ILinkProvider): void => {
      registered.push(provider);
    },
  };
  return { host, registered, state };
}

/** Collect what a registered wrapper reports for row 7. */
function collectLinks(provider: ILinkProvider): Array<ILink[] | undefined> {
  const seen: Array<ILink[] | undefined> = [];
  provider.provideLinks(7, (links) => {
    seen.push(links);
  });
  return seen;
}

beforeEach(() => {
  ghosttyState.url.length = 0;
  ghosttyState.osc8.length = 0;
  openUrlMock.mockClear();
  warnMock.mockClear();
});

describe("attachTauriLinkHandler", () => {
  it("registers URL and OSC8 detection through the public hook", () => {
    const { host, registered } = makeHost();
    attachTauriLinkHandler(host, {});
    expect(ghosttyState.url).toHaveLength(1);
    expect(ghosttyState.osc8).toHaveLength(1);
    expect(ghosttyState.url[0]?.term).toBe(host);
    expect(ghosttyState.osc8[0]?.term).toBe(host);
    expect(registered).toHaveLength(2);
  });

  it.each([
    "https://example.com/x",
    "http://example.com",
    "mailto:foo@example.com",
    "tel:+15550100",
  ])("routes allowlisted %s through the system opener", async (href) => {
    const { host, registered } = makeHost();
    attachTauriLinkHandler(host, {});
    ghosttyState.url[0]!.provideImpl = (_y, callback) => {
      callback([detectedLink(href)]);
    };
    const seen = collectLinks(registered[0]!);
    // The wrapped activation ignores the click event; a bare object stands in.
    const event = {} as MouseEvent;
    seen[0]?.[0]?.activate(event);
    expect(openUrlMock).toHaveBeenCalledTimes(1);
    expect(openUrlMock).toHaveBeenCalledWith(href);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it.each([
    "ftp://example.com/x",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hi",
  ])("blocks non-allowlisted %s with a warning", async (href) => {
    const { host, registered } = makeHost();
    attachTauriLinkHandler(host, {});
    ghosttyState.url[0]!.provideImpl = (_y, callback) => {
      callback([detectedLink(href)]);
    };
    const seen = collectLinks(registered[0]!);
    const event = {} as MouseEvent;
    seen[0]?.[0]?.activate(event);
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it("does not open while text is selected", async () => {
    const { host, registered, state } = makeHost();
    attachTauriLinkHandler(host, {});
    ghosttyState.url[0]!.provideImpl = (_y, callback) => {
      callback([detectedLink("https://example.com")]);
    };
    state.selection = true;
    const seen = collectLinks(registered[0]!);
    const event = {} as MouseEvent;
    seen[0]?.[0]?.activate(event);
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it("passes empty detection through as undefined", () => {
    const { host, registered } = makeHost();
    attachTauriLinkHandler(host, {});
    expect(collectLinks(registered[0]!)).toEqual([undefined]);
    expect(collectLinks(registered[1]!)).toEqual([undefined]);
  });

  it("dispose tears down both inner providers", () => {
    const { host } = makeHost();
    const handle = attachTauriLinkHandler(host, {});
    handle.dispose();
    expect(ghosttyState.url[0]?.disposeCalls).toBe(1);
    expect(ghosttyState.osc8[0]?.disposeCalls).toBe(1);
  });
});

describe("wrapLinkProvider", () => {
  it("keeps ranges while replacing activation", () => {
    const inner: ILinkProvider = {
      provideLinks: (_y, callback) => {
        callback([detectedLink("https://example.com/kept?x=1")]);
      },
    };
    const wrapped = wrapLinkProvider({ hasSelection: () => false }, inner);
    const seen = collectLinks(wrapped);
    expect(seen[0]?.[0]?.range).toEqual({
      start: { x: 0, y: 7 },
      end: { x: 10, y: 7 },
    });
    const event = {} as MouseEvent;
    seen[0]?.[0]?.activate(event);
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com/kept?x=1");
  });
});
