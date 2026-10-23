import { Book, DiscoveryPlan, DiscoveryProvider, LibraryBook, ProviderContext, RecommendationError } from "../types";
import { cleanText, coverURL, displayTitle as completeTitle, distinct, emptyBook, isbn, isbnVariants, libraryIdentity, list, sameBook, text, title } from "../normalization";
import { ProviderTransport, RequestPolicy } from "../transport";
import { catalogLog } from "../../catalogDiagnostics";

// Verified against hardcoverapp/hardcover-docs/schema.graphql. Selection depth is at most three.
export const HARDCOVER_BOOK_FIELDS = `
  id canonical_id title subtitle alternative_titles description pages release_year users_count cached_tags cached_similar_book_ids
  image { url }
  contributions(limit: 8) { contribution author { id name } }
  book_series(limit: 4) { position series { id name } }
  taggings(limit: 12, where: {spoiler: {_eq: false}}) { tag { id tag } }
  editions(limit: 4, where: {language_id: {_in: $languages}}, order_by: [{edition_format: asc_nulls_last}, {id: asc}]) {
    id title subtitle isbn_10 isbn_13 language_id pages release_date
    image { url } publisher { name }
  }`;
export const HARDCOVER_BOOKS_QUERY = `query LoomeyBooks($where: books_bool_exp!, $languages: [Int!]!, $limit: Int!, $offset: Int!) {
  books(where: $where, limit: $limit, offset: $offset, order_by: [{users_count: desc}, {id: asc}]) { ${HARDCOVER_BOOK_FIELDS} }
}`;
export const HARDCOVER_SEARCH_QUERY = `query LoomeySearch($query: String!) { search(query: $query, query_type: "Book", per_page: 5, page: 1) { ids } }`;
const LANGUAGE_QUERY = `query LoomeyLanguages { languages(where: {_or: [{code2: {_eq: "en"}}, {code3: {_eq: "eng"}}]}) { id code2 code3 } }`;
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const tags = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(item => typeof item === "string" ? [item] : text(item?.tag) ? [item.tag] : []).map(cleanText) : [];

export function hardcoverBook(raw: any, englishIDs: number[]): Book | null {
  if (!Number.isInteger(raw?.id) || !text(raw?.title)) return null;
  const editions = Array.isArray(raw.editions) ? raw.editions.filter((e: any) => englishIDs.includes(e?.language_id) && text(e.title)) : [];
  const edition = editions.find((e: any) => coverURL(e.image?.url)) ?? editions[0];
  const contributions = Array.isArray(raw.contributions) ? raw.contributions : [];
  const authors = contributions.filter((c: any) => !c.contribution || /^(author|writer)$/i.test(c.contribution)).map((c: any) => c.author).filter((a: any) => Number.isInteger(a?.id) && text(a.name));
  if (!authors.length || !edition) return null;
  const book = emptyBook("hardcover", `hc_${raw.canonical_id ?? raw.id}`);
  const names = authors.map((a: any) => cleanText(a.name));
  const values = raw.cached_tags && typeof raw.cached_tags === "object" && !Array.isArray(raw.cached_tags) ? raw.cached_tags : {};
  const tagged = Array.isArray(raw.taggings) ? raw.taggings.map((t: any) => t?.tag).filter((t: any) => t && text(t.tag)) : [];
  const displayTitle = title(edition.title);
  return { ...book, title: displayTitle, subtitle: cleanText(edition.subtitle || (title(raw.title) === displayTitle ? raw.subtitle : null)) || null, authors: distinct(names),
    description: cleanText(raw.description), providerIDs: { hardcover: distinct([String(raw.canonical_id ?? raw.id), String(raw.id)]) },
    isbns: distinct(editions.flatMap((e: any) => [e.isbn_13, e.isbn_10]).filter((v: unknown) => typeof v === "string").map((v: string) => isbn(v) ?? "")),
    titleVariants: distinct([displayTitle, title(raw.title), completeTitle(raw.title, raw.subtitle), ...list(raw.alternative_titles).map(title), ...editions.flatMap((e: any) => [title(e.title), completeTitle(e.title, e.subtitle)])]),
    genres: tags(values.Genre), subjects: tags(values.Subject), tags: distinct([...tags(values.Tag), ...tags(values.Theme), ...tagged.map((t: any) => cleanText(t.tag))]),
    authorIDs: authors.map((a: any) => `hc_${a.id}`), tagIDs: tagged.map((t: any) => String(t.id)),
    series: (Array.isArray(raw.book_series) ? raw.book_series : []).filter((s: any) => Number.isInteger(s?.series?.id) && text(s.series.name)).map((s: any) => ({ id: `hc_${s.series.id}`, name: cleanText(s.series.name), position: finite(s.position) })),
    relatedIDs: (Array.isArray(raw.cached_similar_book_ids) ? raw.cached_similar_book_ids : []).filter((id: unknown) => Number.isInteger(Number(id))).map((id: unknown) => `hc_${id}`),
    coverUrls: distinct([coverURL(edition.image?.url), ...(title(raw.title) === displayTitle ? [coverURL(raw.image?.url)] : []), ...editions.map((e: any) => title(e.title) === displayTitle ? coverURL(e.image?.url) : null)].filter((url): url is string => !!url)),
    language: "eng", pages: finite(edition.pages) ?? finite(raw.pages), publisher: cleanText(edition.publisher?.name) || null,
    releaseYear: finite(raw.release_year), popularity: finite(raw.users_count) ?? 0 };
}

export class HardcoverProvider implements DiscoveryProvider {
  readonly name = "hardcover" as const;
  constructor(private http: ProviderTransport, private token = () => process.env.HARDCOVER_API_TOKEN ?? "") {}
  available() { return !!this.token().trim(); }
  private policy(): RequestPolicy {
    const token = this.token().trim().replace(/^Bearer\s+/i, "");
    return { provider: this.name, origin: "https://api.hardcover.app", intervalMs: 1100, dailyLimit: 5000, timeoutMs: 18000,
      headers: { Authorization: `Bearer ${token}` } };
  }
  private async query(query: string, variables: object, context: ProviderContext, ttl?: number) {
    if (!this.available()) throw new RecommendationError("HARDCOVER_NOT_CONFIGURED");
    const response = await this.http.json(this.policy(), new URL("https://api.hardcover.app/v1/graphql"), context, { query, variables }, ttl);
    if (Array.isArray(response?.errors) && response.errors.length) {
      context.failures?.add(this.name);
      catalogLog("engine.provider_partial", { provider: this.name, errors: response.errors.length }, context.traceID);
    }
    if (Array.isArray(response?.errors) && !response?.data) throw new RecommendationError("HARDCOVER_GRAPHQL_ERROR", 502);
    if (!response?.data || typeof response.data !== "object") throw new RecommendationError("INVALID_PROVIDER_RESPONSE", 502);
    return response.data;
  }
  private async books(where: object, context: ProviderContext, limit = 20, offset = 0): Promise<Book[]> {
    const languages = await this.query(LANGUAGE_QUERY, {}, context, 86400000);
    const englishIDs = (Array.isArray(languages.languages) ? languages.languages : []).filter((l: any) => l?.code2 === "en" || l?.code3 === "eng").map((l: any) => Number(l.id));
    if (!englishIDs.length) throw new RecommendationError("ENGLISH_LANGUAGE_UNAVAILABLE");
    const response = await this.query(HARDCOVER_BOOKS_QUERY, { where, languages: englishIDs, limit, offset }, context);
    if (!Array.isArray(response.books)) throw new RecommendationError("INVALID_PROVIDER_RESPONSE", 502);
    return response.books.map((raw: any) => hardcoverBook(raw, englishIDs)).filter((book: Book | null): book is Book => !!book);
  }
  async resolve(seeds: LibraryBook[], context: ProviderContext): Promise<Book[]> {
    if (!seeds.length) return [];
    const clauses = seeds.slice(0, 8).flatMap(seed => [
      { title: { _eq: title(seed.title) } },
      ...isbnVariants(seed.isbn ?? "").flatMap(value => [{ editions: { [value.length === 13 ? "isbn_13" : "isbn_10"]: { _eq: value } } }]),
    ]);
    const found = await this.books({ _or: clauses }, context, 32);
    for (const seed of seeds.filter(seed => !found.some(book => sameBook(libraryIdentity(seed), book))).slice(0, 3)) {
      const search = await this.query(HARDCOVER_SEARCH_QUERY, { query: `${title(seed.title)} ${seed.author}`.slice(0, 256) }, context);
      const ids = Array.isArray(search.search?.ids) ? search.search.ids.map(Number).filter(Number.isInteger) : [];
      if (ids.length) found.push(...await this.books({ id: { _in: ids.slice(0, 5) } }, context, 5));
    }
    return found.filter(book => seeds.some(seed => sameBook(libraryIdentity(seed), book)));
  }
  async discover(plan: DiscoveryPlan, context: ProviderContext): Promise<Book[]> {
    let relationship: object;
    const tagIDs = plan.tagIDs.map(Number).filter(id => Number.isInteger(id) && id > 0 && id <= 2147483647);
    if (plan.kind === "author" && plan.authorID) relationship = { contributions: { author_id: { _eq: Number(plan.authorID.replace(/^hc_/, "")) } } };
    else if (plan.kind === "series" && plan.seriesID) relationship = { book_series: { series_id: { _eq: Number(plan.seriesID.replace(/^hc_/, "")) } } };
    else if (plan.kind === "series" && plan.seriesName) relationship = { book_series: { series: { name: { _eq: plan.seriesName } } } };
    else if (plan.kind === "related" && plan.workIDs.length) relationship = { id: { _in: plan.workIDs.map(id => Number(id.replace(/^hc_/, ""))).filter(Number.isInteger) } };
    else if (tagIDs.length >= 2) relationship = { _and: tagIDs.slice(0, 2).map(id => ({ taggings: { tag_id: { _eq: id } } })) };
    else if (plan.kind === "author" && plan.author) relationship = { contributions: { author: { name: { _eq: plan.author } } } };
    else return [];
    const where = { _and: [relationship, { canonical_id: { _is_null: true }, compilation: { _eq: false } }, { _or: [{ is_partial_book: { _eq: false } }, { is_partial_book: { _is_null: true } }] }] };
    return this.books(where, context, 24);
  }
  async enrich(book: Book, context: ProviderContext): Promise<Book | null> {
    const ids = book.providerIDs.hardcover?.map(Number).filter(Number.isInteger);
    const candidates = ids?.length ? await this.books({ id: { _in: ids } }, context, 3)
      : await this.resolve([{ id: book.id, title: book.title, author: book.authors[0] ?? "", isbn: book.isbns[0] ?? "", genres: [], subjects: [], status: "Finished", rating: 0, favorite: false, activity: 0 }], context);
    return candidates.find(candidate => sameBook(book, candidate)) ?? null;
  }
}
