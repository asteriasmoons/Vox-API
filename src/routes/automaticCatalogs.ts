import { Router, Request, Response } from "express";
import { automaticCatalogService, bookDatabaseClient, parseLibrary } from "../services/automaticCatalogService";
import { CatalogError, limitCatalogRequests } from "../services/automaticCatalogStore";
import { independentLibraryMetadata } from "../services/catalogLibraryMetadata";
import { randomUUID } from "node:crypto";
import { catalogFailure, catalogLog } from "../services/catalogDiagnostics";

export function createAutomaticCatalogRouter(dependencies = {
  service: automaticCatalogService, client: bookDatabaseClient,
  limit: limitCatalogRequests,
}) {
  const router = Router();
  const fail = (res: Response, error: unknown) => {
    const failure = error instanceof CatalogError ? error : new CatalogError("CATALOG_UNAVAILABLE");
    catalogLog("http.failed", catalogFailure(error), res.locals.catalogTrace);
    res.setHeader("Cache-Control", "private, no-store");
    if ([429, 503, 504].includes(failure.status)) res.setHeader("Retry-After", String(failure.retryAfter));
    return res.status(failure.status).json({ error: failure.code });
  };
  router.use(async (req: Request, res: Response, next) => {
    const incomingTrace = req.header("X-Loomey-Catalog-Trace");
    const traceID = incomingTrace && /^[a-f0-9-]{36}$/i.test(incomingTrace) ? incomingTrace : randomUUID();
    const started = Date.now();
    res.locals.catalogTrace = traceID;
    res.setHeader("X-Loomey-Catalog-Trace", traceID);
    catalogLog("http.start", { method: req.method, path: req.path, libraryBooks: Array.isArray(req.body?.books) ? req.body.books.length : undefined, progressive: req.body?.progressive === true }, traceID);
    res.once("finish", () => catalogLog("http.finish", { method: req.method, path: req.path, status: res.statusCode, elapsedMs: Date.now() - started }, traceID));
    try {
      const isImage = req.path.startsWith("/images/");
      const isProgress = req.method === "POST" && req.path === "/" && req.body?.progressive === true;
      const address = req.ip ?? req.socket.remoteAddress ?? "unknown";
      await dependencies.limit(`${address}:${isImage ? "images" : isProgress ? "progress" : "catalogs"}`, isImage ? 90 : isProgress ? 40 : 20);
      res.setHeader("Cache-Control", "private, no-store");
      next();
    } catch (error) { fail(res, error); }
  });
  router.post("/", async (req, res) => {
    try {
      const library = parseLibrary(req.body);
      if (req.body?.progressive !== true) {
        res.json(await dependencies.service.catalogs(library, undefined, false, res.locals.catalogTrace));
        return;
      }
      const result = await dependencies.service.requestCatalogs(library, req.body?.forceRefresh === true, res.locals.catalogTrace);
      catalogLog("http.progress", { state: result.state, jobTraceID: result.traceID, catalogs: result.catalogs?.map(c => ({ id: c.id, books: c.books.length })), partial: result.partial, errorCode: result.errorCode }, res.locals.catalogTrace);
      if (result.state === "building") res.setHeader("Retry-After", String(result.retryAfter ?? 4));
      res.status(result.state === "building" ? 202 : 200).json(result);
    }
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
