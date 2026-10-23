// Integration guidance, not a drop-in replacement. In LoomeyRecommendationEngine.generate(),
// after `const candidates: Book[] = [];`, optionally add the following, with imports:
// import { knowledgeCandidates } from '../bookKnowledge/knowledgeProvider';
// import { interest } from './strategies';
//
// if (process.env.BOOK_KNOWLEDGE_ENABLED === 'true') {
//   try {
//     const terms = [...profile.genres.keys(), ...profile.themes.keys()].slice(0, 8);
//     const local = await knowledgeCandidates(terms);
//     for (const book of local) {
//       if (library.some(owned => ownedMatches(owned, book))) continue;
//       if (!targets.some(id => categoryScore(id, relevance(book, profile)) !== null)) continue;
//       candidates.push(book);
//       await this.cache.saveBook(book);
//     }
//   } catch (error) {
//     catalogLog('engine.knowledge_unavailable', { code: 'BOOK_KNOWLEDGE_UNAVAILABLE' }, context.traceID);
//   }
// }
//
// Keep the existing provider discovery, ranking, exclusions, and cache writes unchanged.
// Important: provider IDs and work identity need end-to-end integration tests before enabling.
export {};
