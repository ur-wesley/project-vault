// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { clearMarkdownCache, renderMarkdownHtml, renderMarkdownUnsafeHtml } from "./markdown";

describe("renderMarkdownUnsafeHtml (unified pipeline)", () => {
  it("slugs heading ids for anchor navigation", async () => {
    const html = await renderMarkdownUnsafeHtml("# Hello World\n\n## Foo & Bar");
    expect(html).toContain('id="hello-world"');
    expect(html).toContain('id="foo--bar"');
  });

  it("renders GFM tables, task lists, strikethrough and autolinks", async () => {
    const html = await renderMarkdownUnsafeHtml(
      "| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~gone~~\n\nhttps://example.com/x",
    );
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<del>gone</del>");
    expect(html).toContain('href="https://example.com/x"');
  });

  it("strips YAML frontmatter instead of rendering it", async () => {
    const html = await renderMarkdownUnsafeHtml("---\ntitle: Secret\n---\n\nVisible");
    expect(html).not.toContain("Secret");
    expect(html).toContain("Visible");
  });

  it("renders GitHub-style alerts with theme classes", async () => {
    const html = await renderMarkdownUnsafeHtml("> [!NOTE]\n> Heads up");
    expect(html).toContain("markdown-alert-note");
    expect(html).toContain("Heads up");
  });

  it("renders footnotes", async () => {
    const html = await renderMarkdownUnsafeHtml("Claim[^1]\n\n[^1]: The source");
    expect(html).toContain("The source");
    expect(html).toContain("footnotes");
  });

  it("highlights fenced code with Shiki and injects a copy button", async () => {
    const html = await renderMarkdownUnsafeHtml("```ts\nconst x: number = 1;\n```");
    expect(html).toContain("shiki");
    expect(html).toContain("markdown-copy-btn");
    expect(html).toContain("language-ts");
    // Dual-theme CSS vars (consumed by markdown-theme.css dark/light switch).
    expect(html).toContain("--shiki-light");
    expect(html).toContain("--shiki-dark");
    // Token colors are app-theme vars (vault theme), not fixed hex palettes.
    expect(html).toContain("var(--");
  });

  it("falls back to plaintext for unknown fence languages", async () => {
    const html = await renderMarkdownUnsafeHtml("```nosuchlang\n???\n```");
    expect(html).toContain("markdown-copy-btn");
    expect(html).toContain("???");
  });

  it("marks external links _blank, leaves relative links alone", async () => {
    const html = await renderMarkdownUnsafeHtml(
      "[ext](https://example.com) [rel](./other.md#frag)",
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain("noopener");
    const relAnchor = html.match(/<a[^>]*href="\.\/other\.md#frag"[^>]*>/)?.[0] ?? "";
    expect(relAnchor).not.toContain("target");
  });

  it("passes raw HTML (kbd) through", async () => {
    const html = await renderMarkdownUnsafeHtml("Press <kbd>Ctrl</kbd> now");
    expect(html).toContain("<kbd>Ctrl</kbd>");
  });

  it("returns empty string for empty input", async () => {
    await expect(renderMarkdownUnsafeHtml("")).resolves.toBe("");
    expect(clearMarkdownCache()).toBeUndefined();
  });
});

describe("renderMarkdownHtml (sanitized)", () => {
  it("strips script injection but keeps code text and copy button", async () => {
    const html = await renderMarkdownHtml("<script>alert(1)</script>\n\n```js\nconst a = 1;\n```");
    expect(html).not.toContain("<script>");
    // Shiki tokenizes code into per-token spans, so assert tokens survive.
    expect(html).toContain("const");
    expect(html).toContain("markdown-copy-btn");
  });

  it("keeps alert icons and theme-token Shiki vars", async () => {
    const html = await renderMarkdownHtml("> [!NOTE]\n> hi\n\n```ts\nconst x = 1;\n```");
    expect(html).toContain("<svg");
    expect(html).toContain("--shiki-light");
    // Token colors mix app-theme vars toward --foreground for ≥4.5:1 contrast
    // on all presets (vault theme); raw accent/muted tokens fail badly.
    expect(html).toContain("var(--primary)");
    expect(html).toContain("color-mix");
    expect(html).not.toContain("#D73A49");
  });
});
