// src/services/lurelia/postCalloutMarkup.ts
//
// Backend contract for Lurelia host-post callouts. This intentionally does
// not depend on TipTap or HTML. The durable source format is markdown:
//
//   :::lurelia-callout icon="starcal" id="cid-..."
//   Body text
//   :::

export type HostPostCallout = {
  icon: string;
  id?: string | undefined;
  body: string;
};

const CALLOUT_OPEN = ":::lurelia-callout";
const CALLOUT_CLOSE = ":::";
const OPEN_RE = /^:::lurelia-callout(?:\s+(.*))?$/;
const CLOSE_RE = /^:::\s*$/;
const ATTR_RE = /([a-zA-Z][a-zA-Z0-9_-]*)="([^"]*)"/g;

export function normalizeHostPostMarkdown(markdown: string): string {
  const source = String(markdown || "").replace(/\r\n?/g, "\n").trim();
  if (!source) return "";

  const lines = source.split("\n");
  const out: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    const open = trimmed.match(OPEN_RE);

    if (!open) {
      out.push(line);
      index += 1;
      continue;
    }

    const attrs = parseAttributes(open[1] || "");
    const icon = normalizeIcon(attrs.icon);
    const id = normalizeIdentifier(attrs.id);
    out.push(`${CALLOUT_OPEN} icon="${icon}"${id ? ` id="${id}"` : ""}`);
    index += 1;

  while (index < lines.length) {
      const bodyLine = lines[index] ?? "";
      if (CLOSE_RE.test(bodyLine.trim())) break;
      out.push(bodyLine);
      index += 1;
    }

    out.push(CALLOUT_CLOSE);
    if (index < lines.length && CLOSE_RE.test((lines[index] ?? "").trim())) {
      index += 1;
    }
  }

  return out.join("\n").trim();
}

export function parseHostPostCallouts(markdown: string): HostPostCallout[] {
  const normalized = normalizeHostPostMarkdown(markdown);
  const lines = normalized.split("\n");
  const callouts: HostPostCallout[] = [];
  let index = 0;

  while (index < lines.length) {
    const open = lines[index]?.trim().match(OPEN_RE);
    if (!open) {
      index += 1;
      continue;
    }

    const attrs = parseAttributes(open[1] || "");
    const icon = normalizeIcon(attrs.icon);
    const id = normalizeIdentifier(attrs.id);
    index += 1;

    const bodyLines: string[] = [];
    while (index < lines.length) {
      const line = lines[index] || "";
      if (CLOSE_RE.test(line.trim())) break;
      bodyLines.push(line);
      index += 1;
    }

    callouts.push({
      icon,
      id,
      body: bodyLines.join("\n").trim(),
    });

    if (index < lines.length && CLOSE_RE.test((lines[index] || "").trim())) {
      index += 1;
    }
  }

  return callouts;
}

export function countMarkdownCallouts(markdown: string): number {
  return parseHostPostCallouts(markdown).length;
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(ATTR_RE)) {
    const key = match[1];
    const value = match[2];
    if (key && value !== undefined) attrs[key] = value;
  }
  return attrs;
}

function normalizeIcon(icon: string | undefined): string {
  const clean = String(icon || "").trim();
  if (/^[a-zA-Z0-9._-]{1,80}$/.test(clean)) return clean;
  return "starcal";
}

function normalizeIdentifier(id: string | undefined): string | undefined {
  const clean = String(id || "").trim();
  if (!clean) return undefined;
  if (/^[a-zA-Z0-9._-]{1,96}$/.test(clean)) return clean;
  return undefined;
}
