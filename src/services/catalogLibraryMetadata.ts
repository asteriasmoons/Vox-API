import { CatalogBook, bookKey, normalizeISBN } from "./automaticCatalogService";
import { CatalogError } from "./automaticCatalogStore";
import sanitizeHtml from "sanitize-html";

// Only independent Google/Open Library data may be saved permanently to a library.
// bookdatabase.io descriptions and classifications remain in temporary catalogs.
export async function independentLibraryMetadata(book: CatalogBook, transport: typeof fetch = fetch) {
  const query = book.isbn ? `isbn:${book.isbn}` : `intitle:${book.title} inauthor:${book.author}`;
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query); url.searchParams.set("maxResults", "5");
  try {
    const response = await transport(url, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) {
      const body: any = await response.json();
      for (const item of body.items ?? []) {
        const info = item.volumeInfo;
        const identifiers: string[] = (info?.industryIdentifiers ?? []).map((i: any) => normalizeISBN(i.identifier ?? ""));
        if (!info?.title || !info.authors?.length) continue;
        if (bookKey(info.title, info.authors.join(", ")) !== bookKey(book.title, book.author)) continue;
        return detail(info.title, info.authors.join(", "), {
          subtitle: info.subtitle ?? null, publisher: info.publisher ?? null,
          publicationYear: Number(String(info.publishedDate ?? "").slice(0, 4)) || null,
          isbn: identifiers[0] ?? null, summary: sanitizeHtml(String(info.description ?? ""), { allowedTags: [], allowedAttributes: {} }),
          coverUrl: (info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null)?.replace(/^http:/, "https:"),
          pages: info.pageCount ?? null, genres: info.categories ?? [], source: "Google Books",
        });
      }
    }
  } catch { /* Open Library remains an independent fallback. */ }
  if (book.isbn) {
    const response = await transport(`https://openlibrary.org/isbn/${encodeURIComponent(book.isbn)}.json`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (response?.ok) {
      const edition: any = await response.json();
      const authorKey = edition.authors?.[0]?.key;
      if (typeof authorKey === "string" && /^\/authors\/[A-Z0-9]+$/.test(authorKey)) {
        const authorResponse = await transport(`https://openlibrary.org${authorKey}.json`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
        const author: any = authorResponse?.ok ? await authorResponse.json() : null;
        if (edition.title && author?.name && bookKey(edition.title, author.name) === bookKey(book.title, book.author)) {
          const isbn = edition.isbn_13?.[0] ?? edition.isbn_10?.[0];
          return detail(edition.title, author.name, {
            subtitle: edition.subtitle ?? null, publisher: edition.publishers?.[0] ?? null,
            publicationYear: Number(String(edition.publish_date ?? "").match(/\b\d{4}\b/)?.[0]) || null,
            isbn: isbn ?? null, summary: typeof edition.description === "string" ? edition.description : edition.description?.value ?? "",
            coverUrl: edition.covers?.[0] ? `https://covers.openlibrary.org/b/id/${edition.covers[0]}-L.jpg` : null,
            pages: edition.number_of_pages ?? null, genres: edition.genres ?? [], source: "Open Library",
          });
        }
      }
    }
  }
  throw new CatalogError("LIBRARY_METADATA_UNAVAILABLE", 404);
}

function detail(title: string, author: string, values: Record<string, unknown>) {
  return { title, author, rating: null, genres: [], subgenres: [], moods: [], tags: [], tropes: [], themes: [],
    tone: null, pacing: null, audience: null, romanceLevel: null, darknessLevel: null, ...values };
}
