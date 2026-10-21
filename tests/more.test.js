'use strict';
/*
 * Variants, cancelling, price per second, recent descriptions and templates, favourites/folders, saving into a project –
 * with a fake AI helper and temp folders.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Studio, MAX_VARIANTS } = require('../server/studio');

function world({ abortAfter = null } = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-ams-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-ams-proj-'));
  fs.mkdirSync(path.join(proj, 'public'));
  const added = []; const checked = [];
  const pic = path.join(data, 'pic.png'); fs.writeFileSync(pic, 'PNG');
  const media = { costs: () => null, check: (p, est) => checked.push(est), add: (x) => { const e = { id: `m${added.length + 1}`, ...x }; added.push(e); return e; }, file: (id) => ({ id, kind: 'image', type: 'image/png', path: pic }) };
  const cfg = { images: { provider: 'openai', model: 'gpt-image-1', label: 'GPT Image', edit: true }, videos: { provider: 'google', model: 'veo', label: 'Veo', seconds: '8', maxSeconds: 20 } };
  let runs = 0;
  const ac = new AbortController();
  const ai = { genConfig: (k) => cfg[k], genPending: () => null, genRun: async (k, c, fn) => { runs++; if (abortAfter && runs >= abortAfter) ac.abort(); return fn(c); }, media };
  const gen = { estimate: (k, c, o = {}) => (k === 'videos' ? 0.5 * (o.seconds || 8) : 0.04), generateImage: async () => ({ buf: Buffer.from('png'), type: 'image/png' }), generateVideo: async () => ({ buf: Buffer.from('mp4'), type: 'video/mp4' }) };
  const host = {
    ctx: { ai, paths: { data }, devtools: { get: (id) => (id === 'p1' ? { id: 'p1', name: 'Shop', path: proj } : null) } },
    t: (s, v) => (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m)) : s), broadcast: () => {},
    service: () => gen,
    core: () => ({ runJob: (title, fn) => { const job = { progress: () => {}, log: () => {}, signal: ac.signal }; return { id: 'j', promise: fn(job) }; } }),
  };
  return { studio: new Studio(host), added, checked, proj, data };
}
const png = (w, h) => { const b = Buffer.alloc(32); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return `data:image/png;base64,${b.toString('base64')}`; };

test('variants: several pictures in one job, budget checked for all of them', async () => {
  const w = world();
  const r = await w.studio.create({ kind: 'image', prompt: 'a red bicycle', variants: 3 }).promise;
  assert.strictEqual(r.ids.length, 3);
  assert.strictEqual(r.id, 'm1', 'the first one opens');
  assert.ok(Math.abs(w.checked[0] - 0.12) < 1e-9, 'budget for three pictures');
  await w.studio.create({ kind: 'image', prompt: 'a red bicycle', variants: 99 }).promise;
  assert.strictEqual(w.added.length, 3 + MAX_VARIANTS);
  const v = await w.studio.create({ kind: 'video', prompt: 'a drone shot', variants: 3 }).promise;
  assert.strictEqual(v.ids.length, 1, 'videos one at a time');
});

test('cancelled while the provider works: nothing is kept', async () => {
  const w = world({ abortAfter: 2 });
  const r = await w.studio.create({ kind: 'image', prompt: 'a red bicycle', variants: 4 }).promise;
  assert.strictEqual(r.ids.length, 1, 'only the variant finished before cancelling');
});

test('price per second for videos', () => {
  const s = world().studio.status();
  assert.strictEqual(s.video.perSecond, 0.5);
  assert.strictEqual(s.image.perSecond, null);
});

test('recent descriptions and own templates', async () => {
  const w = world();
  await w.studio.create({ kind: 'image', prompt: 'first idea' }).promise;
  await w.studio.create({ kind: 'image', prompt: 'second idea' }).promise;
  await w.studio.create({ kind: 'image', prompt: 'first idea' }).promise;
  assert.deepStrictEqual(w.studio.prompts().recent, ['first idea', 'second idea'], 'newest first, no doubles');
  assert.deepStrictEqual(w.studio.forgetRecent('second idea').recent, ['first idea']);
  const p = w.studio.setTemplates([{ name: 'Product', prompt: 'white background, soft light', kind: 'image' }, { name: '', prompt: 'x' }, { name: 'Clip', prompt: 'slow pan', kind: 'video' }]);
  assert.deepStrictEqual(p.templates.map((x) => `${x.kind}:${x.name}`), ['image:Product', 'video:Clip']);
});

test('media library order: favourites and folders, several at once, forgotten when deleted', () => {
  const w = world();
  w.studio.setLibrary({ ids: ['a', 'b', '../x'], fav: true });
  let l = w.studio.setLibrary({ ids: ['b', 'c'], folder: 'Logos' });
  assert.deepStrictEqual(l.fav, { a: true, b: true });
  assert.deepStrictEqual(l.folder, { b: 'Logos', c: 'Logos' });
  l = w.studio.setLibrary({ ids: ['c'], folder: null });
  assert.deepStrictEqual(l.folder, { b: 'Logos' });
  l = w.studio.forget(['b']);
  assert.deepStrictEqual([l.fav, l.folder], [{ a: true }, {}]);
});

test('save into a project: original, favicon 64×64, link preview 1200×630, asks before replacing', () => {
  const w = world();
  assert.throws(() => w.studio.toProject({ project: 'nope', id: 'm1' }), /Project not found/);
  const o = w.studio.toProject({ project: 'p1', id: 'm1', kind: 'original' });
  assert.strictEqual(o.file, 'public/m1.png');
  assert.throws(() => w.studio.toProject({ project: 'p1', kind: 'favicon', png: png(32, 32) }), /wrong size/);
  assert.strictEqual(w.studio.toProject({ project: 'p1', kind: 'favicon', png: png(64, 64) }).file, 'public/favicon.png');
  assert.deepStrictEqual(w.studio.toProject({ project: 'p1', kind: 'favicon', png: png(64, 64) }), { exists: true, file: 'public/favicon.png' });
  assert.ok(w.studio.toProject({ project: 'p1', kind: 'favicon', png: png(64, 64), overwrite: true }).ok);
  assert.strictEqual(w.studio.toProject({ project: 'p1', kind: 'preview', png: png(1200, 630) }).file, 'public/og-image.png');
});
