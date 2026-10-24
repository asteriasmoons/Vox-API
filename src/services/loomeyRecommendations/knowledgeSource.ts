import { queryKnowledgeBooks, KnowledgeBookSearch } from '../../bookKnowledge/queries';
import { catalogLog } from '../catalogDiagnostics';
import { distinct, hash, libraryIdentity, sameBook } from './normalization';
import { cached, RecommendationStore } from './repository';
import { Book, BookKnowledgeSource, DiscoveryPlan, LibraryBook, ProviderContext, ReadingPreferences } from './types';

export class PostgresBookKnowledgeSource implements BookKnowledgeSource {
  constructor(private store: RecommendationStore, private search = queryKnowledgeBooks,
    private configured = () => !!process.env.BOOK_KNOWLEDGE_DATABASE_URL?.trim()) {}
  available() { return this.configured(); }

  private async lookup(search: KnowledgeBookSearch, context: ProviderContext): Promise<Book[]> {
    context.signal.throwIfAborted();
    const key = `knowledge-search:v1:${hash(JSON.stringify(search))}`;
    const result = await cached(this.store, key, 300000, context.signal, () => this.search(search));
    context.signal.throwIfAborted();
    catalogLog('engine.knowledge_read', { records: result.length, terms: search.terms?.length ?? 0, authors: search.authors?.length ?? 0,
      relatedWorks: search.relatedTo?.length ?? 0, category: search.category ?? 'both' }, context.traceID);
    return result;
  }

  async resolve(books: LibraryBook[], context: ProviderContext): Promise<Book[]> {
    if (!books.length || !this.available()) return [];
    const found = await this.lookup({ titles: books.map(book => book.title), isbns: books.map(book => book.isbn ?? ''), limit: 64 }, context);
    return found.filter(book => books.some(source => sameBook(libraryIdentity(source), book)));
  }

  async discover(plan: DiscoveryPlan, context: ProviderContext, preferences?: ReadingPreferences): Promise<Book[]> {
    const query: KnowledgeBookSearch = { limit: 48, category: preferences?.preferredCategory ?? 'both' };
    if (plan.kind === 'author') query.authors = plan.author ? [plan.author] : [];
    else if (plan.kind === 'series') query.seriesNames = plan.seriesName ? [plan.seriesName] : [];
    else if (plan.kind === 'related') {
      query.workIDs = plan.workIDs.filter(id => id.startsWith('pg_'));
      query.providerIDs = plan.workIDs.filter(id => /^hc_\d+$/.test(id)).map(id => ({ provider: 'hardcover', id: id.slice(3) }));
    } else query.terms = distinct(plan.terms);
    if (!this.available()) return [];
    return this.lookup(query, context);
  }
}
