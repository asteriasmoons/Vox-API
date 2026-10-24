import { createHash } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { Book, CatalogBook, LibraryBook, ProviderName, RecommendationError } from "./types";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
export const list = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
export const distinct = (values: string[]) => [...new Set(values.filter(Boolean))];
export const normalized = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function cleanText(value: unknown): string {
  return sanitizeHtml(text(value), { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#(?:39|x27);|&apos;/gi, "'").replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => Number(n) > 0 && Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : " ")
    .replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g, " ").replace(/\s+/g, " ").trim();
}
export function title(value: unknown): string {
  let result = cleanText(value);
  // Only remove recognizable provider/binding annotations, never arbitrary subtitles or volume numbers.
  const edition = "(?:paperback|hardcover|hardback|softcover|mass.market paperback|kindle edition|ebook(?: edition)?|large print|unabridged|abridged|(?:revised|updated|illustrated|annotated|first|second|third|\\d+(?:st|nd|rd|th)) edition)";
  const suffix = new RegExp(`\\s*(?:\\(${edition}\\)|\\[${edition}\\]|\\s[-|:]\\s${edition})\\s*$`, "i");
  for (let count = 0; count < 4; count++) {
    const next = result.replace(suffix, "").replace(/\s*[:|]\s*a (?:novel|memoir)\s*$/i, "").trim();
    if (!next || next === result) break;
    result = next;
  }
  return result;
}
export function displayTitle(value: unknown, subtitle: unknown): string {
  const main = title(value);
  const extra = cleanText(subtitle);
  return extra && !["a novel", "a memoir"].includes(normalized(extra)) && !normalized(main).includes(normalized(extra)) ? `${main}: ${extra}` : main;
}
export function authorKeys(value: string): string[] {
  const key = (v: string) => normalized(v).replace(/\b([a-z])\s+(?=[a-z]\b)/g, "$1");
  const parts = cleanText(value).split(/,\s*/);
  return distinct([key(value), ...(parts.length === 2 ? [key(`${parts[1]} ${parts[0]}`)] : [])]);
}
export function isbn(value: string): string | null {
  const raw = value.replace(/^\s*ISBN(?:[ -]?1[03])?:?\s*/i, "").replace(/[^\dX]/gi, "").toUpperCase();
  if (/^\d{13}$/.test(raw)) return [...raw].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0) % 10 === 0 ? raw : null;
  if (!/^\d{9}[\dX]$/.test(raw) || [...raw].reduce((s, c, i) => s + (c === "X" ? 10 : Number(c)) * (10 - i), 0) % 11) return null;
  const prefix = `978${raw.slice(0, 9)}`;
  return prefix + ((10 - [...prefix].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0) % 10) % 10);
}
export function isbnVariants(value: string): string[] {
  const canonical = isbn(value);
  if (!canonical) return [];
  if (!canonical.startsWith("978")) return [canonical];
  const nine = canonical.slice(3, 12);
  const digit = (11 - [...nine].reduce((s, c, i) => s + Number(c) * (10 - i), 0) % 11) % 11;
  return [canonical, nine + (digit === 10 ? "X" : digit)];
}
export function coverURL(value: unknown): string | null {
  try {
    const url = new URL(text(value));
    // Google's documented image links can use http; upgrade only known image hosts.
    if (url.protocol === "http:" && ["books.google.com", "books.googleusercontent.com", "covers.openlibrary.org"].includes(url.hostname)) url.protocol = "https:";
    if (url.protocol !== "https:" || url.username || url.password || /^(localhost|127\.|10\.|192\.168\.|\[|0\.)/i.test(url.hostname) || [...url.searchParams.keys()].some(key => /^(key|apiKey|token|authorization)$/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}
type Identity = { title: string; authors: string[]; isbns: string[]; providerIDs?: Book["providerIDs"]; titleVariants?: string[]; knowledgeWorkIDs?: string[] };
export function libraryIdentity(book: LibraryBook): Identity {
  return { title: book.title, authors: [book.author], isbns: book.isbn ? [book.isbn] : [], titleVariants: [displayTitle(book.title, book.subtitle)],
    ...(book.providerBookID ? { providerIDs: { "bookdatabase.io": [book.providerBookID] } } : {}) };
}
export function ownedMatches(library: LibraryBook, candidate: Book): boolean {
  const identifier = isbn(library.isbn ?? "");
  return (!!identifier && candidate.isbns.some(value => isbn(value) === identifier)) || sameBook(libraryIdentity(library), candidate);
}
export function sameBook(a: Identity, b: Identity): boolean {
  if (a.knowledgeWorkIDs?.some(id => b.knowledgeWorkIDs?.includes(id))) return true;
  const sharedProvider = Object.entries(a.providerIDs ?? {}).some(([provider, ids]) => ids?.some(id => b.providerIDs?.[provider as ProviderName]?.includes(id)));
  if (sharedProvider) return true;
  const authors = distinct([...a.authors, a.authors.join(", ")]).flatMap(authorKeys);
  const otherAuthors = distinct([...b.authors, b.authors.join(", ")]).flatMap(authorKeys);
  const compatibleAuthors = authors.some(key => otherAuthors.includes(key));
  if (!compatibleAuthors) return false;
  const aISBNs = a.isbns.map(isbn).filter(Boolean);
  if (b.isbns.map(isbn).some(value => !!value && aISBNs.includes(value))) return true;
  const titles = [a.title, ...(a.titleVariants ?? [])].map(v => normalized(title(v))).filter(Boolean);
  return [b.title, ...(b.titleVariants ?? [])].some(v => titles.includes(normalized(title(v))));
}
export function mergeBooks(a: Book, b: Book): Book {
  if (!sameBook(a, b)) return a;
  const order: ProviderName[] = ["hardcover", "google-books", "open-library", "isbndb", "bookdatabase.io"];
  const priority = (book: Book) => Math.min(...book.sources.map(source => order.indexOf(source)), 99);
  const [first, second] = priority(b) < priority(a) ? [b, a] : [a, b];
  const ids = { ...a.providerIDs };
  for (const provider of Object.keys(b.providerIDs) as ProviderName[]) ids[provider] = distinct([...(ids[provider] ?? []), ...(b.providerIDs[provider] ?? [])]);
  const primaryID = ids.hardcover?.[0] ? `hc_${ids.hardcover[0]}` : ids["open-library"]?.find(id => /W$/.test(id)) ? `ol_${ids["open-library"]!.find(id => /W$/.test(id))}` : ids["google-books"]?.[0] ? `gb_${ids["google-books"]![0]}` : first.id;
  const [coverFirst, coverSecond] = first.coverQuality === "thumbnail" && second.coverUrls.length && second.coverQuality !== "thumbnail" ? [second, first] : [first, second];
  const covers = distinct(Array.from({ length: Math.max(coverFirst.coverUrls.length, coverSecond.coverUrls.length) }, (_, i) => [coverFirst.coverUrls[i] ?? "", coverSecond.coverUrls[i] ?? ""]).flat());
  return { ...a, id: primaryID, title: first.title || second.title, subtitle: first.subtitle || second.subtitle, description: first.description || second.description,
    authors: !first.authors.length || (first.authors.length === 1 && second.authors.length > 1 && authorKeys(first.authors[0]!).some(key => authorKeys(second.authors.join(", ")).includes(key))) ? second.authors : first.authors,
    isbns: distinct([...a.isbns, ...b.isbns]), providerIDs: ids,
    titleVariants: distinct([...a.titleVariants, ...b.titleVariants, a.title, b.title]),
    genres: distinct([...a.genres, ...b.genres]), subjects: distinct([...a.subjects, ...b.subjects]), tags: distinct([...a.tags, ...b.tags]),
    authorIDs: distinct([...a.authorIDs, ...b.authorIDs]), tagIDs: distinct([...a.tagIDs, ...b.tagIDs]),
    series: [...a.series, ...b.series.filter(series => !a.series.some(existing => existing.id === series.id))],
    relatedIDs: distinct([...a.relatedIDs, ...b.relatedIDs]), knowledgeWorkIDs: distinct([...(a.knowledgeWorkIDs ?? []), ...(b.knowledgeWorkIDs ?? [])]), coverUrls: covers, coverQuality: coverFirst.coverQuality ?? "cover",
    language: a.language === "eng" || b.language === "eng" ? "eng" : "unknown",
    pages: first.pages ?? second.pages, publisher: first.publisher || second.publisher, releaseYear: [a.releaseYear, b.releaseYear].filter((year): year is number => year !== null).sort((x, y) => x - y)[0] ?? null,
    popularity: Math.max(a.popularity, b.popularity), sources: (distinct([...a.sources, ...b.sources]) as ProviderName[]).sort((x, y) => order.indexOf(x) - order.indexOf(y)),
    ...((a.imageID || b.imageID) ? { imageID: a.imageID || b.imageID } : {}),
    ...((a.metadataExpiresAt || b.metadataExpiresAt) ? { metadataExpiresAt: a.metadataExpiresAt || b.metadataExpiresAt } : {}) };
}
export function mergeCandidates(books: Book[]): Book[] {
  const result: Book[] = [];
  for (const book of books) {
    // A bridge record may connect two previously separate provider editions.
    const matches = result.filter(existing => sameBook(existing, book));
    let merged = book;
    for (const match of matches) { merged = mergeBooks(match, merged); result.splice(result.indexOf(match), 1); }
    result.push(merged);
  }
  return result;
}
export function emptyBook(provider: ProviderName, id: string): Book {
  return { id, title: "", subtitle: null, authors: [], description: "", isbns: [], providerIDs: {}, titleVariants: [], genres: [], subjects: [], tags: [], authorIDs: [], tagIDs: [], series: [], relatedIDs: [], coverUrls: [], language: "unknown", pages: null, publisher: null, releaseYear: null, popularity: 0, sources: [provider] };
}
export function catalogBook(book: Book): CatalogBook {
  return { id: book.id, title: displayTitle(book.title, book.subtitle), author: book.authors.join(", "), authorNames: book.authors, subtitle: book.subtitle, summary: book.description,
    isbn: book.isbns[0] ?? null, isbns: book.isbns, pages: book.pages, publisher: book.publisher, releaseYear: book.releaseYear,
    coverUrl: book.coverUrls[0] ?? null, coverUrls: book.coverUrls, imageID: book.imageID ?? null, genres: book.genres, subjects: distinct([...book.subjects, ...book.tags]),
    source: book.sources.join(" + "), language: book.language, titleVariants: distinct([book.title, ...book.titleVariants]), providerIDs: book.providerIDs,
    ...(book.metadataExpiresAt ? { metadataExpiresAt: book.metadataExpiresAt } : {}) };
}
export function parseLibrary(body: unknown): LibraryBook[] {
  const books = (body as { books?: unknown })?.books;
  if (!Array.isArray(books) || books.length > 1000) throw new RecommendationError("INVALID_LIBRARY", 400);
  return books.map(book => {
    if (!book || !text(book.id) || typeof book.title !== "string" || typeof book.author !== "string") throw new RecommendationError("INVALID_LIBRARY", 400);
    const finished = text(book.status).toLowerCase() === "finished";
    return { id: text(book.id).slice(0, 128), title: title(book.title).slice(0, 2048), author: cleanText(book.author).slice(0, 512), isbn: text(book.isbn).slice(0, 64),
      genres: finished ? list(book.genres).slice(0, 30) : [], subjects: finished ? list(book.subjects).slice(0, 30) : [], status: finished ? "Finished" : "Excluded",
      rating: finished && Number.isFinite(book.rating) ? Math.max(0, Math.min(5, book.rating)) : 0, favorite: finished && book.favorite === true,
      activity: finished && Number.isFinite(book.activity) ? Math.max(0, Math.min(1000, book.activity)) : 0,
      ...(text(book.providerBookID) ? { providerBookID: text(book.providerBookID).slice(0, 128) } : {}),
      ...(finished && text(book.seriesName) ? { seriesName: cleanText(book.seriesName).slice(0, 256), seriesNumber: text(book.seriesNumber).slice(0, 40) } : {}),
      ...(text(book.subtitle) ? { subtitle: cleanText(book.subtitle).slice(0, 1024) } : {}) };
  }).sort((a, b) => a.id.localeCompare(b.id));
}
