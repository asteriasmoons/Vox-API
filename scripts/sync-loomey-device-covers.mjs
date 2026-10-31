#!/usr/bin/env node
// Pull newly saved covers from a wirelessly paired developer iPhone.
// Upload credentials remain exclusively on the Mac.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const work = join(root, 'cover-migration-local');
await mkdir(work, { recursive: true });
const device = process.env.LOOMEY_DEVICE_ID || '00008140-001D54411EE9801C';
const incoming = join(work, 'Loomey-Pending-Covers.json');
const statePath = join(work, 'uploaded-cover-hashes.json');
try {
  execFileSync('xcrun', ['devicectl','device','copy','from','--device',device,
    '--domain-type','appDataContainer','--domain-identifier','im.lystaria.Lumey',
    '--source','Documents/Loomey-Pending-Covers.json','--destination',incoming,'--timeout','20'], {stdio:'pipe'});
} catch { console.log('Loomey device queue not accessible yet; will retry next run.'); process.exit(0); }
const entries = JSON.parse(await readFile(incoming, 'utf8'));
const uploaded = new Set(await readFile(statePath,'utf8').then(JSON.parse).catch(()=>[]));
const token = process.env.LOOMEY_COVER_WRITE_TOKEN;
if (!token) throw Error('LOOMEY_COVER_WRITE_TOKEN missing from Mac environment');
let saved = 0, failed = 0;
for (const entry of entries) {
  if (!entry.title || !entry.author || !entry.imageBase64) continue;
  const bytes = Buffer.from(entry.imageBase64,'base64');
  const key = createHash('sha256').update(bytes).digest('hex') + ':' + entry.title + ':' + entry.author + ':' + (entry.isbn || '');
  if (uploaded.has(key)) continue;
  const mime = bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')) ? 'image/jpeg' : bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) ? 'image/png' : bytes.toString('ascii',0,4)==='RIFF' ? 'image/webp' : null;
  if (!mime || bytes.length > 8*1024*1024) { failed++; continue; }
  const form = new FormData(); form.set('title',entry.title); form.set('author',entry.author);
  if(entry.isbn) form.set('isbns',entry.isbn);
  form.set('cover',new Blob([bytes],{type:mime}),'cover');
  try {
    const response = await fetch((process.env.LOOMEY_API_URL || 'https://appapi.voxiverse.ink') + '/api/books/covers', {
      method:'POST',headers:{'x-loomey-cover-token':token},body:form,signal:AbortSignal.timeout(60000)});
    if (!response.ok) throw Error('HTTP '+response.status);
    uploaded.add(key); saved++;
    await writeFile(statePath,JSON.stringify([...uploaded]));
  } catch(error) { failed++; console.error('Could not sync '+entry.title+': '+error.message); }
}
console.log('Loomey cover sync: '+saved+' uploaded, '+failed+' failed, '+(entries.length-saved-failed)+' previously synced.');
if (failed) process.exitCode=1;
