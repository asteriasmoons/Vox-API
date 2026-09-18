// Missing-fields AI enrichment for dictionary lookup.
import { groqChatJson } from "./groqAIClient";
import { cleanWhitespace, dedupeStrings, looksLikeTerm } from "./dictionaryShared";
const MODEL = "openai/gpt-oss-120b";
export interface MissingFieldsContext { word:string; partOfSpeech:string; writtenPronunciation:string; ipaPronunciation:string; definitions:string[]; examples:string[]; synonyms:string[]; antonyms:string[]; originEtymology:string; relatedWords:string[]; }
export interface MissingFieldsResult { synonyms:string[]; antonyms:string[]; originEtymology:string; relatedWords:string[]; tags:string[]; }
const emptyResult=():MissingFieldsResult=>({synonyms:[],antonyms:[],originEtymology:"",relatedWords:[],tags:[]});
function list(value:unknown,limit:number):string[]{ if(!Array.isArray(value))return []; return dedupeStrings(value.map(cleanWhitespace).filter(looksLikeTerm),limit); }
function missing(c:MissingFieldsContext):string[]{const f:string[]=[];if(!c.synonyms.length)f.push("synonyms");if(!c.antonyms.length)f.push("antonyms");if(!c.originEtymology)f.push("originEtymology");if(!c.relatedWords.length)f.push("relatedWords");f.push("tags");return f;}
function parse(raw:string):Record<string,unknown>|null{try{const v=JSON.parse(raw.trim());return v&&typeof v==="object"&&!Array.isArray(v)?v:null;}catch{return null;}}

export async function generateDictionaryMissingFields(c: MissingFieldsContext): Promise<MissingFieldsResult> {
  const requested = missing(c);
  const systemPrompt = "Complete only missing fields in this dictionary record. Return structured dictionary data for synonyms, antonyms, etymology, related words, and tags. Use the supplied evidence and leave uncertain fields empty.";
  const userPrompt = "Word: " + c.word + "\nPart of speech: " + c.partOfSpeech + "\nDefinitions: " + JSON.stringify(c.definitions) + "\nExamples: " + JSON.stringify(c.examples) + "\nExisting synonyms: " + JSON.stringify(c.synonyms) + "\nExisting antonyms: " + JSON.stringify(c.antonyms) + "\nExisting etymology: " + c.originEtymology + "\nExisting related words: " + JSON.stringify(c.relatedWords) + "\nMissing fields: " + requested.join(", ");
  try {
    const raw = await groqChatJson(systemPrompt, userPrompt, { stage: "dictionary-missing-fields", model: MODEL, temperature: 0.2, maxTokens: 900 });
    const p = parse(raw);
    if (!p) { console.error("[vox:dictionary] missing-fields parse failure", { word: c.word, requested }); return emptyResult(); }
    const result: MissingFieldsResult = { synonyms: requested.includes("synonyms") ? list(p.synonyms,12) : [], antonyms: requested.includes("antonyms") ? list(p.antonyms,12) : [], originEtymology: requested.includes("originEtymology") ? cleanWhitespace(p.originEtymology) : "", relatedWords: requested.includes("relatedWords") ? list(p.relatedWords,12) : [], tags: list(p.tags,8) };
    console.log("[vox:dictionary] missing-fields enrichment", { word:c.word, requested }); return result;
  } catch(error) { console.error("[vox:dictionary] missing-fields generation failed", { word:c.word, message:error instanceof Error ? error.message : String(error) }); return emptyResult(); }
}
