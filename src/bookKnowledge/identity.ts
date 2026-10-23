import { createHash } from 'node:crypto';
export const norm=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export function isbn13(input:string):string|null {
 const raw=input.replace(/[^0-9X]/gi,'').toUpperCase();
 if(/^\d{13}$/.test(raw))return [...raw].reduce((n,c,i)=>n+Number(c)*(i%2?3:1),0)%10===0?raw:null;
 if(!/^\d{9}[0-9X]$/.test(raw)||[...raw].reduce((n,c,i)=>n+(c==='X'?10:Number(c))*(10-i),0)%11!==0)return null;
 const base='978'+raw.slice(0,9);return base+((10-[...base].reduce((n,c,i)=>n+Number(c)*(i%2?3:1),0)%10)%10);
}
export function stableBookKey(title:string,authors:string[]):string{return digest(norm(title)+'|'+authors.map(norm).sort().join('|'));}
