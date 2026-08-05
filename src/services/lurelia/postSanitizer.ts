// src/services/lurelia/postSanitizer.ts
//
// Server-side HTML sanitizer for host posts and announcements. The client's
// Tiptap editor is authoritative on structure, but vox-api is the source
// of truth: we allow only the tags/attributes the editor legitimately
// produces, and we explicitly preserve the callout node markup (the class
// names and data-icon / data-callout-id attributes) so the client renderer
// can reconstruct the box.
//
// Anything unrecognized is dropped. Anything critical to the callout
// contract is enforced.

import sanitizeHtml from "sanitize-html";

// Elements the Tiptap schema on the client can emit.
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "a",
  "img",
  "div",
  "span",
];

// Data attributes required to reconstitute the callout on the client.
const CALLOUT_DATA_ATTRS = [
  "data-icon",
  "data-callout-id",
  "data-icon-name",
];

// Class names we allow — everything the editor emits.
const ALLOWED_CLASSES = [
  "callout",
  "callout-icon-slot",
  "callout-icon-glyph",
  "callout-icon-label",
  "callout-body",
  "file-chip",
];

/**
 * Sanitizes bodyHTML so the persisted string is guaranteed to contain
 * only tags/attributes we know how to render. Preserves the callout node
 * markup fully (including data-icon and the icon slot structure).
 *
 * Returns the sanitized HTML string.
 */
export function sanitizeHostPostHTML(html: string): string {
  if (!html || typeof html !== "string") return "";

  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "target", "rel", "class"],
      img: ["src", "alt", "class"],
      div: ["class", ...CALLOUT_DATA_ATTRS, "contenteditable", "role", "aria-label"],
      span: ["class", ...CALLOUT_DATA_ATTRS],
      code: ["class"],
      pre: ["class"],
      p: ["class"],
    },
    allowedClasses: {
      "*": ALLOWED_CLASSES,
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    // Preserve the wrapping div — never collapse callouts to their inner text.
    exclusiveFilter: () => false,
    // Ensure link target=_blank always gets rel="noopener" for safety.
    transformTags: {
      a: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs };
        if (next.target === "_blank") {
          const rel = new Set((next.rel || "").split(/\s+/).filter(Boolean));
          rel.add("noopener");
          rel.add("noreferrer");
          next.rel = Array.from(rel).join(" ");
        }
        return { tagName, attribs: next };
      },
    },
  });
}

/**
 * Cheap consistency check: if the incoming HTML claims to have a callout
 * (a `<div class="callout">` block), the caller's markdown should
 * reference it too (either as an HTML block or as our future markdown
 * fence). Returns the number of callouts detected in each surface so
 * the service layer can log divergences without rejecting content.
 */
export function countCallouts(bodyMarkdown: string, bodyHTML: string) {
  const htmlCount = (bodyHTML.match(/<div\s+class="callout"/g) || []).length;
  const markdownCount = (bodyMarkdown.match(/<div\s+class="callout"/g) || [])
    .length;
  return { htmlCount, markdownCount };
}

/**
 * Normalize the bodyMarkdown / bodyHTML pair on the way in:
 *   - bodyHTML is sanitized.
 *   - If bodyHTML is empty but bodyMarkdown contains inline HTML (typical
 *     from tiptap-markdown when `html: true`), use bodyMarkdown as the
 *     initial HTML seed. The client will overwrite on next edit.
 *   - Never persists client-supplied `<script>` or event handlers — the
 *     sanitizer strips those.
 */
export function normalizeHostPostBody(input: {
  bodyMarkdown: string;
  bodyHTML?: string | undefined;
}): { bodyMarkdown: string; bodyHTML: string } {
  const rawMd = String(input.bodyMarkdown || "").trim();
  const rawHtml = String(input.bodyHTML || "").trim();

  const html = rawHtml.length > 0
    ? sanitizeHostPostHTML(rawHtml)
    : sanitizeHostPostHTML(rawMd);

  return { bodyMarkdown: rawMd, bodyHTML: html };
}
