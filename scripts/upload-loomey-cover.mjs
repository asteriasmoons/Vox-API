#!/usr/bin/env node
// Upload a cover from your Mac to the shared Loomey Cover Library.
// Usage: npm run loomey:cover-upload -- "/path/to/cover.jpg" "Book Title" "Author" "ISBN (optional)" "Edition (optional)"
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const [filePath, title, author, isbn = "", edition = ""] = process.argv.slice(2);
if (!filePath || !title || !author) {
  console.error('Usage: npm run loomey:cover-upload -- "/path/to/cover.jpg" "Title" "Author" "ISBN (optional)" "Edition (optional)"');
  process.exitCode = 1;
} else {
  try {
    const ext = extname(filePath).toLowerCase();
    const mimeType = ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" })[ext];
    if (!mimeType) throw new Error("Choose a JPEG, PNG, or WebP image.");
    const bytes = await readFile(filePath);
    if (bytes.length > 8 * 1024 * 1024) throw new Error("The cover exceeds the 8 MB limit.");

    let token = process.env.LOOMEY_COVER_WRITE_TOKEN?.trim();
    if (!token) {
      if (!stdin.isTTY) throw new Error("Set LOOMEY_COVER_WRITE_TOKEN in your shell for noninteractive uploads.");
      const readline = createInterface({ input: stdin, output: stdout });
      try {
        token = (await readline.question("Paste your Railway LOOMEY_COVER_WRITE_TOKEN: ")).trim();
      } finally {
        readline.close();
      }
    }
    if (!token) throw new Error("An upload token is required.");
    const form = new FormData();
    form.set("title", title);
    form.set("author", author);
    if (isbn) form.set("isbns", isbn);
    if (edition) form.set("edition", edition);
    form.set("cover", new Blob([bytes], { type: mimeType }), basename(filePath));
    const endpoint = process.env.LOOMEY_API_URL || "https://appapi.voxiverse.ink";
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/api/books/covers`, {
      method: "POST",
      headers: { "x-loomey-cover-token": token },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status}): ${body.error || "Unknown error"}`);
    console.log(body.reused ? "Existing cover reused." : "Cover saved to Railway and MongoDB.");
    console.log(`Cover ID: ${body.cover.id}`);
    console.log(`Image: ${endpoint}${body.cover.imagePath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
