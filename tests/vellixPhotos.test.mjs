import test from 'node:test';
import assert from 'node:assert/strict';
import { createVellixPhotoService } from '../dist/services/vellixPhotoService.js';

const raw = { id: 'sample', urls: { small: 'https://images.unsplash.com/photo-a?ixid=keep-me&w=400', regular: 'https://images.unsplash.com/photo-a?ixid=keep-me&w=1080' },
  links: { html: 'https://unsplash.com/photos/sample', download_location: 'https://api.unsplash.com/photos/sample/download?ixid=event-token' },
  user: { name: 'Author', links: { html: 'https://unsplash.com/@author' } } };

test('Vellix photos preserve hotlink parameters, credits, search paging, and bounded cache lifetime', async () => {
  const calls = []; let now = 0;
  const service = createVellixPhotoService({ key: () => 'private-test-key', now: () => now, fetcher: async (url, options) => {
    calls.push(url); assert.equal(options.headers.Authorization, 'Client-ID private-test-key');
    assert.equal(options.redirect, 'error');
    return Response.json({ results: [raw], total_pages: 3 });
  } });
  const result = await service.search(' mountains ', 2);
  assert.equal(new URL(calls[0]).searchParams.get('query'), 'mountains');
  assert.equal(new URL(calls[0]).searchParams.get('page'), '2');
  assert.equal(result.hasMore, true);
  assert.equal(new URL(result.photos[0].imageURL).searchParams.get('ixid'), 'keep-me');
  assert.equal(new URL(result.photos[0].photographerURL).searchParams.get('utm_source'), 'vellix');
  assert.equal(new URL(result.photos[0].sourceURL).searchParams.get('utm_medium'), 'referral');
  await service.search('mountains', 2); assert.equal(calls.length, 1);
  now = 60_001; await service.search('mountains', 2); assert.equal(calls.length, 2);
  await service.search('mountains', 2, true); assert.equal(calls.length, 3);
});

test('Vellix photo selection calls the provider download event without downloading the image', async () => {
  const calls = [];
  const service = createVellixPhotoService({ key: () => 'private-test-key', fetcher: async url => {
    calls.push(url); return Response.json(calls.length === 1 ? raw : { url: raw.urls.regular });
  } });
  await service.trackSelection('sample');
  assert.equal(calls.length, 2);
  assert.equal(calls[1], raw.links.download_location);
  assert.ok(calls.every(url => new URL(url).hostname === 'api.unsplash.com'));
});

test('Vellix photos reject missing configuration and invalid IDs before any upstream call', async () => {
  let count = 0;
  const service = createVellixPhotoService({ key: () => '', fetcher: async () => { count++; return Response.json([]); } });
  await assert.rejects(service.search(''), error => error.status === 503);
  await assert.rejects(service.trackSelection('../private'), error => error.status === 400);
  assert.equal(count, 0);
});

test('Vellix photos reject foreign image and download hosts', async () => {
  const search = createVellixPhotoService({ key: () => 'test', fetcher: async () => Response.json([{ ...raw, urls: { ...raw.urls, regular: 'https://example.com/a' } }]) });
  await assert.rejects(search.search(''), error => error.status === 502);
  let count = 0;
  const select = createVellixPhotoService({ key: () => 'test', fetcher: async () => {
    count++; return Response.json({ ...raw, links: { download_location: 'https://example.com/private' } });
  } });
  await assert.rejects(select.trackSelection('sample'), error => error.status === 502);
  assert.equal(count, 1);
});

test('Vellix photo errors expose neither provider response text nor access keys', async () => {
  const service = createVellixPhotoService({ key: () => 'private-test-key', fetcher: async () => new Response('private-test-key detailed error', { status: 429 }) });
  await assert.rejects(service.search(''), error => error.status === 429 && !error.message.includes('private-test-key'));
});
