import sanitizeHtml from "sanitize-html";

export const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const edition = "(?:paperback|hardback|hardcover|softcover|mass.market paperback|kindle edition|ebook edition|e.book|large print|unabridged|abridged|illustrated edition|annotated edition|revised edition|updated edition|(?:\\d+(?:st|nd|rd|th)|first|second|third) (?:edition|ed\\.?))";
const annotation = new RegExp(`\\s*(?:\\(${edition}\\)|\\[${edition}\\]|(?:\\s[-:|]\\s)${edition})\\s*$`, "i");

export function cleanTitle(value: string): string {
  let result = sanitizeHtml(String(value ?? ""), { allowedTags: [], allowedAttributes: {} })
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, entity => {
      const named: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()]!;
      const number = entity.slice(2, -1);
      const code = number[0]?.toLowerCase() === "x" ? parseInt(number.slice(1), 16) : Number(number);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g, " ").replace(/\s+/g, " ").trim();
  // Remove only recognized terminal format annotations, never arbitrary subtitles or series numbers.
  for (let i = 0; i < 3; i++) {
    const next = result.replace(annotation, "").replace(/\s*[:|]\s*(?:a novel|a memoir)\s*$/i, "").trim();
    if (!next || next === result) break;
    result = next;
  }
  return result;
}

export function authorKeys(value: string): string[] {
  const key = (name: string) => normalize(name).replace(/\b([a-z])\s+(?=[a-z]\b)/g, "$1");
  const result = [key(value)];
  const parts = value.split(",").map(part => part.trim());
  if (parts.length === 2 && parts.every(Boolean)) result.push(key(`${parts[1]} ${parts[0]}`));
  return [...new Set(result.filter(Boolean))];
}

export const normalizeISBN = (value: string) => value.replace(/^\s*ISBN(?:[ -]?1[03])?:?\s*/i, "").replace(/[^\dX]/gi, "").toUpperCase();
export function validISBN(value: string): boolean {
  const isbn = normalizeISBN(value);
  if (/^\d{13}$/.test(isbn)) return [...isbn].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10 === 0;
  return /^\d{9}[\dX]$/.test(isbn) && [...isbn].reduce((sum, digit, i) => sum + (digit === "X" ? 10 : Number(digit)) * (10 - i), 0) % 11 === 0;
}
export function canonicalISBN(value: string): string {
  const isbn = normalizeISBN(value);
  if (!validISBN(isbn)) return "";
  if (isbn.length === 13) return isbn;
  const prefix = `978${isbn.slice(0, 9)}`;
  const check = (10 - [...prefix].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10) % 10;
  return prefix + check;
}

export type BookIdentity = {
  id?: string; source?: string; title: string; author: string; isbn?: string | null;
  isbns?: string[]; titleVariants?: string[]; authorNames?: string[]; providerBookID?: string;
};
export function identityTokens(book: BookIdentity): string[] {
  const tokens = new Set<string>();
  const workID = book.providerBookID || (book.source === "bookdatabase.io" ? book.id : undefined);
  if (workID) tokens.add(`work:${workID}`);
  for (const value of [book.isbn ?? "", ...(book.isbns ?? [])]) {
    const isbn = canonicalISBN(value);
    if (isbn) tokens.add(`isbn:${isbn}`);
  }
  const authors = [book.author ?? "", ...(book.authorNames ?? [])].flatMap(authorKeys);
  for (const value of [book.title, ...(book.titleVariants ?? [])]) {
    const title = normalize(cleanTitle(value));
    if (title) for (const author of authors) if (author) tokens.add(`title:${title}|${author}`);
  }
  return [...tokens];
}
export class CatalogIdentityIndex {
  private tokens = new Set<string>();
  constructor(books: BookIdentity[] = []) { books.forEach(book => this.add(book)); }
  has(book: BookIdentity): boolean { return identityTokens(book).some(token => this.tokens.has(token)); }
  add(book: BookIdentity): void { identityTokens(book).forEach(token => this.tokens.add(token)); }
}
export const bookKey = (title: string, author: string) => `${normalize(cleanTitle(title))}|${authorKeys(author)[0] ?? ""}`;
