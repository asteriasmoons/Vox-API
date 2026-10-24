// Explicit adapter, not a DiscoveryProvider: Codex provider names are a closed union.
import type { Book } from '../services/loomeyRecommendations/types';
import { findKnowledgeBooks } from './queries';
export async function knowledgeCandidates(terms:string[]):Promise<Book[]> {
 return findKnowledgeBooks(terms);
}
