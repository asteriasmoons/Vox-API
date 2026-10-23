import { Router, Request, Response } from "express";
import { automaticCatalogService, bookDatabaseClient, parseLibrary } from "../services/automaticCatalogService";
import { CatalogError, limitCatalogRequests } from "../services/automaticCatalogStore";
import { independentLibraryMetadata } from "../services/catalogLibraryMetadata";

export function createAutomaticCatalogRouter(dependencies = {
  service: automaticCatalogService, client: bookDatabaseClient,
  limit: limitCatalogRequests,
}) {
  const router = Router();
  const fail = (res: Response, error: unknown) => {
    const failure = error instanceof CatalogError ? error : new CatalogError("CATALOG_UNAVAILABLE");
    res.setHeader("Cache-Control", "private, no-store");
    if (failure.status === 429 || failure.status === 503) res.setHeader("Retry-After", String(failure.retryAfter));
    return res.status(failure.status).json({ error: failure.code });
  };
  router.use(async (req: Request, res: Response, next) => {
    try {
      const isImage = req.path.startsWith("/images/");
      const address = req.ip ?? req.socket.remoteAddress ?? "unknown";
      await dependencies.limit(`${address}:${isImage ? "images" : "catalogs"}`, isImage ? 90 : 20);
      res.setHeader("Cache-Control", "private, no-store");
      next();
    } catch (error) { fail(res, error); }
  });
  router.post("/", async (req, res) => {
    try { res.json(await dependencies.service.catalogs(parseLibrary(req.body))); }
    catch (error) { fail(res, error); }
  });
  router.get("/books/:id", async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new CatalogError("INVALID_BOOK_ID", 400);
      const book = await dependencies.service.work(id);
      if (!book) throw new CatalogError("BOOK_NOT_FOUND", 404);
      res.json(book);
    } catch (error) { fail(res, error); }
  });
  router.get("/images/:id", async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new CatalogError("INVALID_IMAGE_ID", 400);
      const image = await dependencies.client.get(`images/${encodeURIComponent(id)}/contentUrl`, 240_000);
      if (!image?.contentUrl || !image.contentUrl.startsWith("https://") || image.contentUrl.includes("apiKey=")) throw new CatalogError("IMAGE_NOT_FOUND", 404);
      res.json({ url: image.contentUrl, expiresIn: 240 });
    } catch (error) { fail(res, error); }
  });
  router.get("/books/:id/library-metadata", async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new CatalogError("INVALID_BOOK_ID", 400);
      const book = await dependencies.service.work(id);
      if (!book) throw new CatalogError("BOOK_NOT_FOUND", 404);
      res.json(await independentLibraryMetadata(book));
    } catch (error) { fail(res, error); }
  });
  return router;
}
export default createAutomaticCatalogRouter();
