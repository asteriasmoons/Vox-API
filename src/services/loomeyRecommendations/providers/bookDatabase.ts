import { BookDatabaseClient, refs } from "../../bookDatabaseClient";
import { Book, ProviderContext } from "../types";
import { cleanText, distinct, emptyBook, isbn, sameBook, title } from "../normalization";
import { RecommendationStore } from "../repository";

export class BookDatabaseSupplement {
  constructor(readonly client: BookDatabaseClient, private store: RecommendationStore, private configured = () => {
    const expiry = process.env.BOOKDATABASE_SUBSCRIPTION_EXPIRES_AT;
    return !!process.env.BOOKDATABASE_API_KEY && process.env.BOOKDATABASE_DISABLED !== "true" && (!expiry || Date.parse(expiry) > Date.now());
  }) {}
  async available(): Promise<boolean> {
    if (!this.configured()) return false;
    return !await this.store.get<boolean>("bookdatabase-disabled:access");
  }
  async enrich(target: Book, context: ProviderContext): Promise<Book | null> {
    if (!await this.available() || !target.isbns[0]) return null;
    const client = this.client.withSignal(context.signal, context.traceID).withTimeout(8000);
    try {
      const until = Math.min(Date.now() + 24 * 3600000, await client.assertActive());
      const editions = await client.page("editions", { isbn: target.isbns[0], includeRelationships: "All", pageSize: "3" });
      for (const edition of editions) {
        if (!(edition.isbns ?? []).some(value => isbn(value) === isbn(target.isbns[0]!))) continue;
        const authors = refs(edition, "authors").map(author => cleanText(author.name)).filter(Boolean);
        const draft = { ...emptyBook("bookdatabase.io", `bd_${edition.id}`), title: title(edition.title), authors, isbns: (edition.isbns ?? []).map(value => isbn(value) ?? "").filter(Boolean), titleVariants: (edition.alternateTitles ?? []).map(title) };
        if (!sameBook(target, draft)) continue;
        let english = false;
        for (const language of refs(edition, "languages").slice(0, 2)) {
          const raw = await client.get(`languages/${encodeURIComponent(language.id)}`);
          if (raw?.iso639Code === "eng") english = true;
        }
        if (!english) continue;
        const works = refs(edition, "books");
        const work = works.length === 1 ? await client.get(`books/${encodeURIComponent(works[0]!.id)}?includeRelationships=All`) : null;
        const workAuthors = work ? refs(work, "authors").map(author => cleanText(author.name)).filter(Boolean) : [];
        if (work && !sameBook(target, { title: title(work.title), authors: workAuthors, isbns: [], titleVariants: (work.alternateTitles ?? []).map(title) })) continue;
        const imageID = refs(edition, "images")[0]?.id;
        const supplemental: Book = { ...draft, providerIDs: { "bookdatabase.io": works.map(work => work.id) }, language: "eng",
          description: cleanText(edition.description || work?.description), subtitle: cleanText(edition.subtitle) || null,
          genres: refs(edition, "genres").map(ref => cleanText(ref.name)).filter(Boolean), subjects: work ? refs(work, "subjects").map(ref => cleanText(ref.name)).filter(Boolean) : [],
          pages: edition.pageCount ?? null, publisher: refs(edition, "publishers").map(ref => cleanText(ref.name)).find(Boolean) ?? null,
          titleVariants: distinct([draft.title, ...draft.titleVariants]), metadataExpiresAt: new Date(until).toISOString(), ...(imageID ? { imageID } : {}) };
        await this.store.set(`licensed:${target.id}`, supplemental, until - Date.now());
        return supplemental;
      }
      return null;
    } catch (error: any) {
      if (["PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED"].includes(error?.code)) await this.revoke();
      throw error;
    }
  }
  async revoke() {
    await this.store.purgeGroup("licensed");
    await this.store.set("bookdatabase-disabled:access", true, 15 * 60000);
  }
  async maintain() {
    if (!this.configured()) { await this.revoke(); return; }
    try {
      await this.client.get("books/random?includeRelationships=None", 15 * 60000);
      await this.store.remove("bookdatabase-disabled:access");
    } catch (error: any) { if (["PROVIDER_ACCESS_DENIED", "CATALOG_NOT_CONFIGURED"].includes(error?.code)) await this.revoke(); }
  }
}
