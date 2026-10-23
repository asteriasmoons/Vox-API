import { Book, DiscoveryPlan, DiscoveryProvider, LibraryBook, ProviderContext, RecommendationError } from "../types";
import { cleanText, coverURL, displayTitle, distinct, emptyBook, isbn, libraryIdentity, list, normalized, sameBook, text, title } from "../normalization";
import { ProviderTransport, RequestPolicy } from "../transport";

const FIELDS = "key,title,author_name,author_key,subject,isbn,cover_i,first_publish_year,edition_count,editions,editions.key,editions.title,editions.language,editions.isbn,editions.cover_i";
export const solrTerm = (value: string) => `"${value.replace(/["\\]/g, " ").trim()}"`;
export function openLibraryBook(raw: any): Book | null {
  const workID = text(raw?.key).replace(/^\/works\//, "");
  const editions = Array.isArray(raw?.editions?.docs) ? raw.editions.docs : [];
  const edition = editions.find((e: any) => list(e?.language).includes("eng"));
  if (!/^OL\d+W$/.test(workID) || !text(edition?.title) || !list(raw.author_name).length) return null;
  const coverID = Number(edition.cover_i);
  const workCoverID = normalized(title(raw.title)) === normalized(title(edition.title)) ? Number(raw.cover_i) : 0;
  const editionID = text(edition.key).replace(/^\/books\//, "");
  return { ...emptyBook("open-library", `ol_${workID}`), title: title(edition.title),
    authors: distinct(list(raw.author_name).map(cleanText)), providerIDs: { "open-library": [workID, ...(/^OL\d+M$/.test(editionID) ? [editionID] : [])] },
    // Work-level ISBN lists include translations. Persist only identifiers from the selected English edition.
    isbns: distinct(list(edition.isbn).map(value => isbn(value) ?? "")), titleVariants: distinct([title(edition.title), title(raw.title)]),
    subjects: list(raw.subject).slice(0, 40).map(cleanText), authorIDs: list(raw.author_key).map(id => `ol_${id}`),
    coverUrls: distinct([...(Number.isInteger(coverID) && coverID > 0 ? [`https://covers.openlibrary.org/b/id/${coverID}-L.jpg?default=false`] : []), ...(/^OL\d+M$/.test(editionID) ? [`https://covers.openlibrary.org/b/olid/${editionID}-L.jpg?default=false`] : []), ...(Number.isInteger(workCoverID) && workCoverID > 0 ? [`https://covers.openlibrary.org/b/id/${workCoverID}-L.jpg?default=false`] : [])]),
    language: "eng", releaseYear: Number.isInteger(raw.first_publish_year) ? raw.first_publish_year : null,
    popularity: Number.isFinite(raw.edition_count) ? raw.edition_count : 0 };
}
export class OpenLibraryProvider implements DiscoveryProvider {
  readonly name = "open-library" as const;
  constructor(private http: ProviderTransport, private contact = () => process.env.OPEN_LIBRARY_CONTACT_EMAIL ?? "") {}
  available() { return true; }
  private policy(): RequestPolicy {
    const contact = this.contact().trim().replace(/[\r\n]/g, "");
    return { provider: this.name, origin: "https://openlibrary.org", intervalMs: contact ? 400 : 1100, dailyLimit: 1500, timeoutMs: 12000,
      headers: { "User-Agent": contact ? `Loomey/1.0 (${contact})` : "Loomey/1.0 (https://voxiverse.ink)", ...(contact ? { email: contact } : {}) } };
  }
  async search(query: string, context: ProviderContext, offset = 0, limit = 24): Promise<{ books: Book[]; total: number }> {
    const url = new URL("https://openlibrary.org/search.json");
    Object.entries({ q: `(${query}) AND language:eng`, lang: "en", fields: FIELDS, limit: String(limit), offset: String(offset) }).forEach(([key, value]) => url.searchParams.set(key, value));
    const result = await this.http.json(this.policy(), url, context);
    if (!Array.isArray(result?.docs)) throw new RecommendationError("INVALID_PROVIDER_RESPONSE", 502);
    return { books: result.docs.map(openLibraryBook).filter((book: Book | null): book is Book => !!book), total: Number(result.numFound ?? result.num_found) || 0 };
  }
  async resolve(seeds: LibraryBook[], context: ProviderContext): Promise<Book[]> {
    const found: Book[] = [];
    let failure: unknown;
    let successes = 0;
    for (const seed of seeds.slice(0, 4)) {
      try {
        const number = isbn(seed.isbn ?? "");
        const query = number ? `isbn:${number}` : `title:${solrTerm(title(seed.title))} AND author:${solrTerm(seed.author)}`;
        let matches = (await this.search(query, context, 0, 5)).books.filter(book => sameBook(libraryIdentity(seed), book));
        if (!matches.length && number) matches = (await this.search(`title:${solrTerm(title(seed.title))} AND author:${solrTerm(seed.author)}`, context, 0, 5)).books.filter(book => sameBook(libraryIdentity(seed), book));
        found.push(...matches); successes++;
      } catch (error) { failure = error; }
    }
    if (!successes && failure) throw failure;
    return found;
  }
  async discover(plan: DiscoveryPlan, context: ProviderContext): Promise<Book[]> {
    if (plan.kind === "series" || plan.kind === "related") return [];
    const query = plan.kind === "author" && plan.author ? `author:${solrTerm(plan.author)}`
      : plan.terms.slice(0, 2).map(term => `subject:${solrTerm(term)}`).join(" AND ");
    if (!query) return [];
    const first = await this.search(query, context);
    if (first.total > 24 && first.books.length < 12) first.books.push(...(await this.search(query, context, 24)).books);
    return first.books;
  }
  async enrich(book: Book, context: ProviderContext): Promise<Book | null> {
    const work = book.providerIDs["open-library"]?.find(id => /^OL\d+W$/.test(id));
    const results = await this.search(work ? `key:/works/${work}` : book.isbns[0] ? `isbn:${book.isbns[0]}` : `title:${solrTerm(book.title)} AND author:${solrTerm(book.authors[0] ?? "")}`, context, 0, 5);
    const matched = results.books.find(candidate => sameBook(book, candidate));
    if (!matched) return null;
    const editionID = matched.providerIDs["open-library"]?.find(id => /^OL\d+M$/.test(id));
    try {
    if (editionID) {
      const raw = await this.http.json(this.policy(), new URL(`https://openlibrary.org/books/${editionID}.json`), context);
      const links = Array.isArray(raw?.works) ? raw.works.map((work: any) => text(work?.key).replace(/^\/works\//, "")) : [];
      if (links.some((id: string) => matched.providerIDs["open-library"]?.includes(id)) && Array.isArray(raw?.languages) && raw.languages.some((language: any) => language?.key === "/languages/eng")) {
        matched.isbns = distinct([...list(raw.isbn_13), ...list(raw.isbn_10)].map(value => isbn(value) ?? ""));
        matched.publisher = list(raw.publishers).map(cleanText)[0] ?? null;
        matched.pages = Number.isInteger(raw.number_of_pages) && raw.number_of_pages > 0 ? raw.number_of_pages : null;
        matched.subtitle = cleanText(raw.subtitle) || null;
        matched.titleVariants = distinct([...matched.titleVariants, displayTitle(matched.title, matched.subtitle)]);
        matched.description = cleanText(typeof raw.description === "string" ? raw.description : raw.description?.value);
        matched.coverUrls = distinct([...list(raw.covers?.map(String)).filter(value => /^\d+$/.test(value) && Number(value) > 0).map(id => coverURL(`https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false`)!).filter(Boolean), ...matched.coverUrls]);
      }
    }
    const workID = matched.providerIDs["open-library"]?.find(id => /^OL\d+W$/.test(id));
    if (!matched.description && workID) {
      const raw = await this.http.json(this.policy(), new URL(`https://openlibrary.org/works/${workID}.json`), context);
      if (raw?.key === `/works/${workID}`) matched.description = cleanText(typeof raw.description === "string" ? raw.description : raw.description?.value);
    }
    } catch { context.failures?.add(this.name); /* Search metadata remains usable if an edition/work detail fails. */ }
    return matched;
  }
}
