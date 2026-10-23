// Explicit adapter, not a DiscoveryProvider: Codex provider names are a closed union.
import type { Book } from '../services/loomeyRecommendations/types';
import { findKnowledgeBooks } from './queries';
import { enqueue } from './jobs';
export async function knowledgeCandidates(terms:string[]):Promise<Book[]> {
 const found=await findKnowledgeBooks(terms);
 if(!found.length && terms.length)await enqueue('discover',{term:terms[0],depth:0});
 return found;
}
