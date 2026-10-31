import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { createHash } from "crypto";
import { LoomeyBookCover } from "../models/LoomeyBookCover";
import { signedLoomeyCoverURL, uploadLoomeyCover } from "../services/loomeyCoverStorage";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const normalize = (value: string) => value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const isbn = (value: string) => value.replace(/[^0-9Xx]/g, "").toUpperCase();
const safe = (value: unknown) => typeof value === "string" ? value.trim() : "";

function requireCoverWriteToken(req: Request, res: Response, next: NextFunction) {
  // Until Loomey's client authentication is integrated, uploads are admin-only.
  const token = process.env.LOOMEY_COVER_WRITE_TOKEN;
  if (!token || req.get("x-loomey-cover-token") !== token) {
    res.status(403).json({ error: "Cover uploads are not enabled for this client" });
    return;
  }
  next();
}

function serialize(cover: any) {
  return {
    id: String(cover._id), title: cover.title, author: cover.author,
    isbns: cover.isbns, edition: cover.edition ?? null,
    mimeType: cover.mimeType, byteSize: cover.byteSize,
    uploadedAt: cover.uploadedAt,
    imagePath: `/api/books/covers/${cover._id}/image`,
  };
}

router.get("/", async (req, res) => {
  try {
    const title = safe(req.query.title);
    const author = safe(req.query.author);
    const requestedISBN = isbn(safe(req.query.isbn));
    if (!requestedISBN && (!title || !author)) {
      return res.status(400).json({ error: "Provide an ISBN or both title and author" });
    }
    const query = requestedISBN
      ? { isbns: requestedISBN }
      : { normalizedTitle: normalize(title), normalizedAuthor: normalize(author) };
    let covers = await LoomeyBookCover.find(query).limit(30).lean();
    if (!covers.length && requestedISBN && title && author) {
      covers = await LoomeyBookCover.find({ normalizedTitle: normalize(title), normalizedAuthor: normalize(author) }).limit(30).lean();
    }
    return res.json({ covers: covers.map(serialize) });
  } catch (error) {
    console.error("[loomey covers] lookup:", error);
    return res.status(500).json({ error: "Unable to look up covers" });
  }
});

router.get("/:id/image", async (req, res) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.sendStatus(404);
    const cover = await LoomeyBookCover.findById(req.params.id).lean();
    if (!cover) return res.sendStatus(404);
    const url = await signedLoomeyCoverURL(cover.storageKey);
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.redirect(302, url);
  } catch (error) {
    console.error("[loomey covers] image:", error);
    return res.status(500).json({ error: "Unable to retrieve cover" });
  }
});

router.post("/", requireCoverWriteToken, upload.single("cover"), async (req, res) => {
  try {
    const title = safe(req.body?.title);
    const author = safe(req.body?.author);
    if (!title || !author || !req.file) return res.status(400).json({ error: "Title, author and cover file are required" });
    const bytes = req.file.buffer;
    const mime = req.file.mimetype;
    const signatures: Record<string, boolean> = {
      "image/jpeg": bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
      "image/png": bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
      "image/webp": bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP",
    };
    if (!signatures[mime]) return res.status(415).json({ error: "Only JPEG, PNG or WebP covers are supported" });
    const hash = createHash("sha256").update(bytes).digest("hex");
    const existing = await LoomeyBookCover.findOne({ sha256: hash });
    if (existing) return res.json({ cover: serialize(existing), reused: true });
    const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const key = `loomey/bookcovers/${hash}.${extension}`;
    const rawISBNs = safe(req.body?.isbns).split(",").map(isbn).filter(v => v.length === 10 || v.length === 13);
    await uploadLoomeyCover(key, bytes, mime);
    try {
      const cover = await LoomeyBookCover.create({
        storageKey: key, sha256: hash, mimeType: mime, byteSize: bytes.length,
        title, author, normalizedTitle: normalize(title), normalizedAuthor: normalize(author),
        isbns: [...new Set(rawISBNs)], edition: safe(req.body?.edition) || undefined,
      });
      return res.status(201).json({ cover: serialize(cover), reused: false });
    } catch (error: any) {
      if (error?.code === 11000) {
        const duplicate = await LoomeyBookCover.findOne({ sha256: hash });
        if (duplicate) return res.json({ cover: serialize(duplicate), reused: true });
      }
      // Keep the uploaded object on metadata failure; a retry can safely reuse its hash.
      throw error;
    }
  } catch (error) {
    console.error("[loomey covers] upload:", error);
    return res.status(500).json({ error: "Unable to save cover" });
  }
});

export default router;
