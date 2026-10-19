'use strict';
/*
 * Image & video studio with a fake AI helper: status per kind, checks before a job (description, model, size, starting
 * picture), budget check, result in the media library with costs, German messages.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Studio } = require('../server/studio');
const ext = require('../server/index');
const de = require('../locales/de.json');

const fill = (s, v) => (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m)) : s);

function world({ lang = 'en', images = true, videos = false, budgetLeft = true } = {}) {
  const added = [];
  const media = {
    costs: () => ({ month: '2026-10', spent: { openai: 1.2 }, budget: {} }),
    check: (provider, est) => { if (!budgetLeft && est > 0) throw new Error('Monthly budget reached'); },
    add: (x) => { const e = { id: `m${added.length + 1}`, ...x }; added.push(e); return e; },
    file: (id) => ({ id, kind: id === 'vid' ? 'video' : 'image', type: 'image/png', path: __filename }),
  };
  const cfg = { images: images ? { provider: 'openai', model: 'gpt-image-1', label: 'GPT Image', size: '1024x1024', edit: true } : null, videos: videos ? { provider: 'google', model: 'veo', label: 'Veo', seconds: '8', aspect: '16:9', i2v: false, audio: true } : null };
  const ai = { genConfig: (k) => cfg[k], genPending: () => null, genRun: (kind, c, fn) => fn(c), media };
  const gen = { estimate: (k) => (k === 'videos' ? 3.2 : 0.04), generateImage: async () => ({ buf: Buffer.from('png'), type: 'image/png' }), generateVideo: async () => ({ buf: Buffer.from('mp4'), type: 'video/mp4' }) };
  const jobs = [];
  const host = {
    ctx: { ai }, t: (s, v) => fill(lang === 'de' && de[s] ? de[s] : s, v), broadcast: () => {},
    service: (n) => ({ 'ai/gen': gen }[n]),
    core: (n) => ({ jobs: { runJob: (title, fn) => { const job = { progress: () => {}, log: () => {} }; const promise = fn(job); jobs.push({ title, promise }); return { id: `j${jobs.length}`, promise }; } } }[n]),
  };
  return { studio: new Studio(host), added, jobs, host };
}

test('status: ready image model with price, video model missing', () => {
  const { studio } = world();
  const s = studio.status();
  assert.strictEqual(s.available, true);
  assert.strictEqual(s.image.ready, true); assert.strictEqual(s.image.label, 'GPT Image'); assert.strictEqual(s.image.estimate, 0.04);
  assert.strictEqual(s.video.ready, false);
});

test('checks before a job (German messages)', () => {
  const { studio } = world({ lang: 'de' });
  assert.throws(() => studio.create({ kind: 'gif', prompt: 'cat' }), /Bild oder Video/);
  assert.throws(() => studio.create({ kind: 'image', prompt: 'x' }), /beschreib/);
  assert.throws(() => studio.create({ kind: 'video', prompt: 'a cat on a roof' }), /Noch kein Video-Modell/);
  assert.throws(() => studio.create({ kind: 'image', prompt: 'a cat on a roof', size: '99x99' }), /Unbekannte Größe/);
  assert.throws(() => studio.create({ kind: 'image', prompt: 'a cat', from: 'vid' }), /Nur Bilder/);
});

test('create image: result in the media library with costs; budget is checked first', async () => {
  const w = world();
  const job = w.studio.create({ kind: 'image', prompt: 'a lighthouse at sunrise' });
  const r = await job.promise;
  assert.strictEqual(r.kind, 'image'); assert.strictEqual(w.added[0].cost, 0.04); assert.strictEqual(w.added[0].source, 'studio');
  assert.match(w.jobs[0].title, /Create image \(GPT Image\)/);
  const poor = world({ budgetLeft: false });
  assert.throws(() => poor.studio.create({ kind: 'image', prompt: 'a lighthouse at sunrise' }), /budget/);
});

test('video: seconds limited, starting picture needs a model that can do it', async () => {
  const w = world({ videos: true });
  assert.throws(() => w.studio.create({ kind: 'video', prompt: 'drone over a lighthouse', from: 'img' }), /cannot start from a picture/);
  const r = await w.studio.create({ kind: 'video', prompt: 'drone over a lighthouse', seconds: 99 }).promise;
  assert.strictEqual(r.kind, 'video');
  assert.strictEqual(w.added[0].type, 'video/mp4');
});

test('activate registers the routes', () => {
  const routes = [];
  ext.activate({ ...world().host, router: new Proxy({}, { get: (_, m) => (p) => routes.push(`${m.toUpperCase()} ${p}`) }) });
  assert.deepStrictEqual(routes, ['GET /ai-media', 'POST /ai-media/create']);
});

test('every German text has a value', () => {
  for (const [k, v] of Object.entries(de)) if (k !== '$patterns') assert.ok(typeof v === 'string' && v.trim(), k);
});
