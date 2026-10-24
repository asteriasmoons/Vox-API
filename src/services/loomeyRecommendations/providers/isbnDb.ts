import { Book, DiscoveryPlan, DiscoveryProvider, LibraryBook, ProviderContext, RecommendationError } from "../types";
import { cleanText, coverURL, distinct, emptyBook, isbn, libraryIdentity, list, sameBook, text, title } from "../normalization";
import { ProviderTransport } from "../transport";

export function isbnDbBook(raw: any): Book | null {
  const name = title(raw?.title ?? "");
  const authors = distinct(list(raw?.authors).map(cleanText).filter(Boolean));
  if (!name || !authors.length) return null;
  const numbers = distinct([raw?.isbn13, raw?.isbn, ...list(raw?.isbns)].map(value => isbn(text(value)) ?? "").filter(Boolean));
  if (!numbers.length) return null;
  const language = text(raw?.language).toLowerCase();
  if (language && !["en", "eng", "english"].includes(language)) return null;
  const yearMatch = text(raw?.date_published).match(/(?:^|\D)(1[5-9]\d{2}|20\d{2}|21\d{2})(?:\D|$)/);
  const pages = Number(raw?.pages);
  const subjects = distinct(list(raw?.subjects).map(cleanText).filter(Boolean));
  const id = numbers[0];
  const cover = coverURL(raw?.image);
  return { ...emptyBook("isbndb", `isbn_${id}`), title: name, authors, description: cleanText(raw?.synopsis ?? raw?.description),
    isbns: numbers, providerIDs: { isbndb: numbers }, titleVariants: [name],
    subjects, genres: subjects, coverUrls: cover ? [cover] : [], coverQuality: cover ? "cover" : "thumbnail",
    language: "eng", pages: Number.isInteger(pages) && pages > 0 ? pages : null,
    publisher: cleanText(raw?.publisher) || null, releaseYear: yearMatch ? Number(yearMatch[1]) : null, popularity: 0 };
}

export class IsbnDbProvider implements DiscoveryProvider {
  readonly name = "isbndb" as const;
  constructor(private http: ProviderTransport, private key = () => process.env.ISBNDB_API_KEY ?? "") {}
  available() { return !!this.key().trim(); }
  private async request(path: string, context: ProviderContext, params?: Record<string, string>): Promise<any> {
    const key = this.key().trim();
    if (!key) throw new RecommendationError("PROVIDER_ACCESS_DENIED", 403);
    const url = new URL(`https://api2.isbndb.com/${path}`);
    for (const [name, value] of Object.entries(params ?? {})) url.searchParams.set(name, value);
    return this.http.json({ provider: this.name, origin: url.origin, intervalMs: 1200, dailyLimit: 100, timeoutMs: 10000,
      headers: { Authorization: key } }, url, context);
  }
  async search(term: string, context: ProviderContext): Promise<Book[]> {
    const result = await this.request(`books/${encodeURIComponent(term)}`, context, { page: "1", pageSize: "20" });
    if (!Array.isArray(result?.books)) throw new RecommendationError("INVALID_PROVIDER_RESPONSE", 502);
    return result.books.map(isbnDbBook).filter((book: Book | null): book is Book => !!book);
  }
  async resolve(seeds: LibraryBook[], context: ProviderContext): Promise<Book[]> {
    const found: Book[] = [];
    for (const seed of seeds.slice(0, 2)) {
      const query = isbn(seed.isbn ?? "") ?? `${seed.title} ${seed.author}`;
      const matches = (await this.search(query, context)).filter(book => sameBook(libraryIdentity(seed), book));
      found.push(...matches);
    }
    return found;
  }
  async discover(plan: DiscoveryPlan, context: ProviderContext): Promise<Book[]> {
    if (plan.kind === "series" || plan.kind === "related") return [];
    const term = plan.kind === "author" ? plan.author : plan.terms[0];
    return term?.trim() ? this.search(term.trim(), context) : [];
  }
  async enrich(book: Book, context: ProviderContext): Promise<Book | null> {
    const number = book.isbns[0];
    if (!number) return null;
    const result = await this.request(`book/${encodeURIComponent(number)}`, context);
    const candidate = isbnDbBook(result?.book);
    return candidate && sameBook(book, candidate) ? candidate : null;
  }
}
