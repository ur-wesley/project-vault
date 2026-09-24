import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";
import type { Element as HastElement, Root as HastRoot } from "hast";
import type { Root as MdastRoot } from "mdast";
import { visit } from "unist-util-visit";
import type { Transformer } from "unified";

import { getHighlighterPromise, VAULT_CODE_THEME } from "~/services/code-highlighter";

const hookInstalled = { current: false };

function ensureLinkHook(): void {
  if (typeof window === "undefined" || hookInstalled.current) return;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if ("target" in node) {
      const href = node.getAttribute("href");
      const isExternal = href != null && /^(https?:\/\/|mailto:|tel:)/i.test(href);
      if (isExternal) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      } else {
        node.removeAttribute("target");
      }
    }
  });
  hookInstalled.current = true;
}

export const MARKDOWN_PURIFY_CONFIG: DOMPurifyConfig = {
  // svg profile keeps the octicon <svg> emitted by remark-github-blockquote-alert.
  // No rehype-sanitize step: its default schema strips Shiki's CSS-var spans and
  // the copy <button>; DOMPurify is the single sanitizer (it passes style through).
  USE_PROFILES: { html: true, svg: true },
  ADD_ATTR: ["target", "rel"],
};

/** Drop YAML/TOML frontmatter so it never renders (remark-frontmatter only parses). */
function remarkStripFrontmatter(): Transformer<MdastRoot, MdastRoot> {
  return (tree) => {
    tree.children = tree.children.filter((node) => {
      // Widen: toml nodes exist at runtime (remark-frontmatter) but are not
      // part of the default mdast RootContent union.
      const kind: string = node.type;
      return kind !== "yaml" && kind !== "toml";
    });
  };
}

function isCodeElement(node: HastElement): boolean {
  return node.children.some((child) => child.type === "element" && child.tagName === "code");
}

function hasCopyButton(node: HastElement): boolean {
  return node.children.some(
    (child) =>
      child.type === "element" &&
      child.tagName === "button" &&
      child.properties.className !== undefined &&
      (Array.isArray(child.properties.className)
        ? child.properties.className.includes("markdown-copy-btn")
        : child.properties.className === "markdown-copy-btn"),
  );
}

/** Prepend the copy <button> to every fenced block (plain and Shiki-highlighted). */
function rehypeCopyButtons(): Transformer<HastRoot, HastRoot> {
  return (tree) => {
    visit(tree, "element", (node) => {
      if (node.tagName !== "pre" || !isCodeElement(node) || hasCopyButton(node)) return;
      const icon: HastElement = {
        type: "element",
        tagName: "span",
        properties: { className: ["iconify", "mdi--content-copy", "h-3.5", "w-3.5"] },
        children: [],
      };
      const button: HastElement = {
        type: "element",
        tagName: "button",
        properties: {
          className: ["markdown-copy-btn"],
          type: "button",
          ariaLabel: "Copy code",
        },
        children: [icon],
      };
      node.children.unshift(button);
    });
  };
}

const EXTERNAL_HREF_RE = /^(https?:\/\/|mailto:|tel:)/i;

/** Mark external links _blank (DOMPurify hook re-applies this post-sanitize). */
function rehypeExternalLinks(): Transformer<HastRoot, HastRoot> {
  return (tree) => {
    visit(tree, "element", (node) => {
      if (node.tagName !== "a") return;
      const href = node.properties.href;
      if (typeof href === "string" && EXTERNAL_HREF_RE.test(href)) {
        node.properties.target = "_blank";
        node.properties.rel = ["noopener", "noreferrer"];
      }
    });
  };
}

async function buildProcessor() {
  // Dynamic imports: the unified chain resolves a DOM-dependent entry
  // (decode-named-character-reference/index.dom.js) under Vite's browser
  // condition, so static imports would break any node-env importer
  // (tests, SSR) at module-evaluation time. Loading lazily also keeps the
  // pipeline out of the initial bundle — first render already awaits Shiki.
  const [
    { unified },
    { default: remarkParse },
    { default: remarkFrontmatter },
    { default: remarkGfm },
    { remarkAlert },
    { default: remarkRehype },
    { default: rehypeRaw },
    { default: rehypeSlug },
    { default: rehypeStringify },
    { default: rehypeShikiFromHighlighter },
  ] = await Promise.all([
    import("unified"),
    import("remark-parse"),
    import("remark-frontmatter"),
    import("remark-gfm"),
    import("remark-github-blockquote-alert"),
    import("remark-rehype"),
    import("rehype-raw"),
    import("rehype-slug"),
    import("rehype-stringify"),
    import("@shikijs/rehype/core"),
  ]);
  const highlighter = await getHighlighterPromise();
  return (
    unified()
      .use(remarkParse)
      .use(remarkFrontmatter, ["yaml", "toml"])
      .use(remarkStripFrontmatter)
      .use(remarkGfm)
      .use(remarkAlert)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeSlug)
      // Closure (not a [plugin, options] tuple) so the resolved highlighter
      // instance is captured without fighting unified's .use() tuple typings.
      .use(function rehypeShiki() {
        return rehypeShikiFromHighlighter(highlighter, {
          // Same token-var theme in both slots: the vars resolve against the
          // active app/community theme, so code follows presets automatically.
          themes: { light: VAULT_CODE_THEME, dark: VAULT_CODE_THEME },
          // Emit --shiki-light/--shiki-dark vars so src/styles/markdown-theme.css
          // can switch palettes with app dark mode (same as file-preview view).
          defaultColor: false,
          addLanguageClass: true,
          fallbackLanguage: "plaintext",
        });
      })
      .use(rehypeCopyButtons)
      .use(rehypeExternalLinks)
      .use(rehypeStringify, { allowDangerousHtml: true })
  );
}

type MarkdownProcessor = Awaited<ReturnType<typeof buildProcessor>>;

let processorPromise: Promise<MarkdownProcessor> | null = null;

function getProcessor(): Promise<MarkdownProcessor> {
  if (!processorPromise) processorPromise = buildProcessor();
  return processorPromise;
}

/** Unified pipeline output before sanitizing (pure, DOM-free — unit-testable). */
export async function renderMarkdownUnsafeHtml(raw: string): Promise<string> {
  if (!raw) return "";
  const processor = await getProcessor();
  return String(await processor.process(raw));
}

const CACHE_LIMIT = 50;
const CACHE_MAX_INPUT = 200_000;
const renderedCache = new Map<string, string>();

/** Parse markdown to sanitized HTML: GFM + alerts + Shiki fences + slug ids. */
export async function renderMarkdownHtml(raw: string): Promise<string> {
  ensureLinkHook();
  if (!raw) return "";
  const cached = renderedCache.get(raw);
  if (cached !== undefined) return cached;
  const html = await renderMarkdownUnsafeHtml(raw);
  const clean = DOMPurify.sanitize(html, MARKDOWN_PURIFY_CONFIG);
  if (raw.length <= CACHE_MAX_INPUT) {
    if (renderedCache.size >= CACHE_LIMIT) {
      const oldest = renderedCache.keys().next();
      if (!oldest.done) renderedCache.delete(oldest.value);
    }
    renderedCache.set(raw, clean);
  }
  return clean;
}

/** For tests / memory pressure. */
export function clearMarkdownCache(): void {
  renderedCache.clear();
}
