#!/usr/bin/env node
// Import an existing Loomey cover archive in one batch. Existing app data is never modified.
// Usage: npm run loomey:import-covers -- "/path/to/Loomey-Existing-Covers.json"
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const archivePath = process.argv[2];
if (!archivePath) {
  console.error('Usage: npm run loomey:import-covers -- "/path/to/Loomey-Existing-Covers.json"');
  process.exitCode = 1;
} else {
  try {
    const covers = JSON.parse(await readFile(archivePath, "utf8"));
    if (!Array.isArray(covers)) throw new Error("Invalid Loomey cover archive.");
    let token = process.env.LOOMEY_COVER_WRITE_TOKEN?.trim();
    if (!token) {
      if (!stdin.isTTY) throw new Error("Set LOOMEY_COVER_WRITE_TOKEN for noninteractive imports.");
      const readline = createInterface({ input: stdin, output: stdout });
      try { token = (await readline.question("Paste your Railway LOOMEY_COVER_WRITE_TOKEN: ")).trim(); }
      finally { readline.close(); }
    }
    if (!token) throw new Error("An upload token is required.");
    const endpoint = (process.env.LOOMEY_API_URL || "https://appapi.voxiverse.ink").replace(/\/$/, "");
    let saved = 0, reused = 0, skipped = 0, failed = 0;
    console.log(`Found ${covers.length} existing covers. Starting resumable import...`);
    for (const [index, cover] of covers.entries()) {
      try {
        if (!cover.title || !cover.author || !cover.imageBase64) { skipped++; continue; }
        const bytes = Buffer.from(cover.imageBase64, "base64");
        const mimeType = bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")) ? "image/jpeg"
          : bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ? "image/png"
          : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
        if (!mimeType || bytes.length > 8 * 1024 * 1024) { skipped++; continue; }
        const form = new FormData();
        form.set("title", cover.title);
        form.set("author", cover.author);
        if (cover.isbn) form.set("isbns", cover.isbn);
        form.set("cover", new Blob([bytes], { type: mimeType }), "existing-cover");
        const response = await fetch(`${endpoint}/api/books/covers`, {
          method: "POST", headers: { "x-loomey-cover-token": token },
          body: form, signal: AbortSignal.timeout(60000),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (result.reused) reused++; else saved++;
        console.log(`[${index + 1}/${covers.length}] ${cover.title}: ${result.reused ? "already saved" : "saved"}`);
      } catch (error) {
        failed++;
        console.error(`[${index + 1}/${covers.length}] ${cover.title}: ${error.message}`);
      }
    }
    console.log(`Finished: ${saved} new, ${reused} already stored, ${skipped} unsupported, ${failed} failed.`);
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
