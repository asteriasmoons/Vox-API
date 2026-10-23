import { Book, DiscoveryPlan, DiscoveryProvider, LibraryBook, ProviderContext, RecommendationError } from "../types";
import { cleanText, coverURL, distinct, emptyBook, isbn, libraryIdentity, list, normalized, sameBook, text, title } from "../normalization";
import { ProviderTransport } from "../transport";

export const googleTerm = (value: string) => `"${value.replace(/["\\]/g, " ").trim()}"`;
export function googleBook(raw: any): Book | null {
  const value = raw?.volumeInfo;
  if (!text(raw?.id) || !text(value?.title) || !list(value?.authors).length || value.language !== "en" || value.printType === "MAGAZINE") return null;
  const base = title(value.title);
  const subtitle = cleanText(value.subtitle) || null;
  const complete = subtitle && !normalized(base).includes(normalized(subtitle)) ? `${base}: ${subtitle}` : base;
  const images = value.imageLinks ?? {};
  const categories = list(value.categories).flatMap(category => category.split(/\s*\/\s*/)).map(cleanText);
  return { ...emptyBook("google-books", `gb_${raw.id}`), title: complete, subtitle,
    authors: distinct(list(value.authors).map(cleanText)), description: cleanText(value.description),
    providerIDs: { "google-books": [raw.id] }, titleVariants: distinct([base, complete]),
    isbns: distinct((Array.isArray(value.industryIdentifiers) ? value.industryIdentifiers : []).filter((i: any) => i?.type === "ISBN_10" || i?.type === "ISBN_13").map((i: any) => isbn(text(i.identifier)) ?? "")),
    genres: distinct(categories), subjects: distinct(categories),
    coverUrls: distinct([images.extraLarge, images.large, images.medium, images.small, images.thumbnail, images.smallThumbnail].map(coverURL).filter((v): v is string => !!v)),
    coverQuality: images.extraLarge || images.large || images.medium || images.small ? "cover" : "thumbnail",
    language: "eng", pages: Number.isInteger(value.pageCount) && value.pageCount > 0 ? value.pageCount : null,
    publisher: cleanText(value.publisher) || null, releaseYear: /^\d{4}/.test(text(value.publishedDate)) ? Number(value.publishedDate.slice(0, 4)) : null,
    popularity: Number.isFinite(value.ratingsCount) ? Math.max(0, value.ratingsCount) : 0 };
}
export class GoogleBooksProvider implements DiscoveryProvider {
  readonly name = "google-books" as const;
  constructor(private http: ProviderTransport, private key = () => process.env.GOOGLE_BOOKS_API_KEY ?? "") {}
  available() { return true; }
  async search(query: string, context: ProviderContext, startIndex = 0, maxResults = 24): Promise<{ books: Book[]; total: number }> {
    const url = new URL("https://www.googleapis.com/books/v1/volumes");
    Object.entries({ q: query, langRestrict: "en", printType: "books", maxResults: String(maxResults), startIndex: String(startIndex), orderBy: "relevance" }).forEach(([key, value]) => url.searchParams.set(key, value));
    // Books documents the key query parameter. Only a request digest, never query strings, is logged.
    const key = this.key().trim();
    if (key) url.searchParams.set("key", key);
    const result = await this.http.json({ provider: this.name, origin: url.origin, intervalMs: 250, dailyLimit: 1000, timeoutMs: 10000 }, url, context);
    if (!result || (result.items !== undefined && !Array.isArray(result.items))) throw new RecommendationError("INVALID_PROVIDER_RESPONSE", 502);
    return { books: (result.items ?? []).map(googleBook).filter((book: Book | null): book is Book => !!book), total: Number(result.totalItems) || 0 };
  }
  async resolve(seeds: LibraryBook[], context: ProviderContext): Promise<Book[]> {
    const found: Book[] = [];
    let failure: unknown;
    let successes = 0;
    for (const seed of seeds.slice(0, 4)) {
      try {
        const number = isbn(seed.isbn ?? "");
        const first = await this.search(number ? `isbn:${number}` : `intitle:${googleTerm(title(seed.title))} inauthor:${googleTerm(seed.author)}`, context, 0, 5);
        let matched = first.books.filter(book => sameBook(libraryIdentity(seed), book));
        if (!matched.length && number) matched = (await this.search(`intitle:${googleTerm(title(seed.title))} inauthor:${googleTerm(seed.author)}`, context, 0, 5)).books.filter(book => sameBook(libraryIdentity(seed), book));
        found.push(...matched); successes++;
      } catch (error) { failure = error; }
    }
    if (!successes && failure) throw failure;
    return found;
  }
  async discover(plan: DiscoveryPlan, context: ProviderContext): Promise<Book[]> {
    if (plan.kind === "series" || plan.kind === "related") return [];
    const query = plan.kind === "author" && plan.author ? `inauthor:${googleTerm(plan.author)}`
      : plan.terms.slice(0, 2).map(term => `subject:${googleTerm(term)}`).join(" ");
    if (!query) return [];
    const first = await this.search(query, context);
    // A second page is useful for broad bibliographies without unbounded catalog crawling.
    if (first.total > 24 && first.books.length < 12) first.books.push(...(await this.search(query, context, 24)).books);
    return first.books;
  }
  async enrich(book: Book, context: ProviderContext): Promise<Book | null> {
    const id = book.providerIDs["google-books"]?.[0];
    if (id && /^[a-zA-Z0-9_-]+$/.test(id)) {
      const url = new URL(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(id)}`);
      const key = this.key().trim();
      if (key) url.searchParams.set("key", key);
      const raw = await this.http.json({ provider: this.name, origin: url.origin, intervalMs: 250, dailyLimit: 1000, timeoutMs: 10000 }, url, context);
      const candidate = googleBook(raw);
      return candidate && sameBook(book, candidate) ? candidate : null;
    }
    const result = await this.search(book.isbns[0] ? `isbn:${book.isbns[0]}` : `intitle:${googleTerm(book.title)} inauthor:${googleTerm(book.authors[0] ?? "")}`, context, 0, 5);
    return result.books.find(candidate => sameBook(book, candidate)) ?? null;
  }
}
