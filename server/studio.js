'use strict';
/*
 * Image & video studio: create pictures and short videos straight from a description – without a chat. Uses the provider
 * and model chosen in Hostwerk's AI helper (settings → images & videos: OpenAI, Google, Replicate, fal, Stable Diffusion
 * WebUI or Hostwerk's own local image AI), books the costs against the monthly budget and puts every result into the
 * media library (data/ai/media), where the AI chat finds it too.
 *
 * The generators themselves stay in Hostwerk (the AI chat creates pictures as well); this extension is the studio around them.
 */
const fs = require('fs');
const path = require('path');

const KINDS = { image: 'images', video: 'videos' };
const SIZES = ['1024x1024', '1536x1024', '1024x1536'];
const ASPECTS = ['16:9', '9:16', '1:1'];
const MAX_VARIANTS = 4;
const MAX_RECENT = 20;
const MAX_TEMPLATES = 40;

class Studio {
  constructor(host) {
    this.host = host;
    this.ctx = host.ctx;
    this.T = (s, v) => host.t(s, v);
    this.dir = this.ctx.paths && this.ctx.paths.data ? path.join(this.ctx.paths.data, 'ai-media') : null;
  }
  /** Own small files: descriptions (recent, templates) and the order of the media library (favourites, folders). */
  read(name, d) { if (!this.dir) return d; try { return JSON.parse(fs.readFileSync(path.join(this.dir, `${name}.json`), 'utf8')); } catch { return d; } }
  write(name, v) { if (!this.dir) return; fs.mkdirSync(this.dir, { recursive: true }); const p = path.join(this.dir, `${name}.json`); fs.writeFileSync(`${p}.tmp`, JSON.stringify(v)); fs.renameSync(`${p}.tmp`, p); }
  ai() { if (!this.ctx.ai || !this.ctx.ai.genConfig) throw Object.assign(new Error(this.T('The AI helper is not available.')), { status: 503 }); return this.ctx.ai; }
  gen() { return this.host.service('ai/gen'); }

  /** What can be created right now (chosen models, local models still missing, costs this month). */
  status() {
    const ai = this.ctx.ai;
    if (!ai || !ai.genConfig) return { available: false, image: null, video: null, costs: null };
    const one = (kind) => {
      const c = ai.genConfig(KINDS[kind]);
      const pending = ai.genPending ? ai.genPending(KINDS[kind]) : null;
      if (!c) return { ready: false, pending };
      const estimate = this.gen().estimate(KINDS[kind], c) || 0;
      // Videos cost per second – the page shows the price for the chosen length
      const perSecond = kind === 'video' ? this.gen().estimate(KINDS[kind], c, { seconds: 1 }) || 0 : null;
      return { ready: true, perSecond, label: c.label, provider: c.provider, local: c.provider === 'local' || c.provider === 'a1111', edit: !!c.edit, i2v: !!c.i2v, audio: !!c.audio, size: c.size || '1024x1024', seconds: Number(c.seconds) || (kind === 'video' ? 8 : null), maxSeconds: c.maxSeconds || null, aspect: c.aspect || '16:9', estimate };
    };
    return { available: true, image: one('image'), video: one('video'), costs: ai.media ? ai.media.costs() : null };
  }

  /** Start a job: image or video from a description (optionally from a picture in the media library). */
  create({ kind = 'image', prompt = '', size, seconds, aspect, from = null, variants = 1 } = {}) {
    const T = this.T;
    if (!KINDS[kind]) throw Object.assign(new Error(T('Choose image or video.')), { status: 400 });
    const text = String(prompt || '').trim().slice(0, 4000);
    if (text.length < 3) throw Object.assign(new Error(T('Please describe what it should show.')), { status: 400 });
    const ai = this.ai();
    const c = ai.genConfig(KINDS[kind]);
    if (!c) throw Object.assign(new Error(kind === 'video' ? T('No video model is set up yet – choose one under AI helper → Settings → Images & videos.') : T('No image model is set up yet – choose one under AI helper → Settings → Images & videos.')), { status: 409, code: 'NO_MODEL' });
    if (size && !SIZES.includes(size)) throw Object.assign(new Error(T('Unknown size')), { status: 400 });
    if (aspect && !ASPECTS.includes(aspect)) throw Object.assign(new Error(T('Unknown aspect ratio')), { status: 400 });
    let source = null;
    if (from) {
      const m = ai.media.file(String(from));
      if (m.kind !== 'image') throw Object.assign(new Error(T('Only pictures can be the starting point.')), { status: 400 });
      if (kind === 'image' && !c.edit) throw Object.assign(new Error(T('The chosen image model cannot edit pictures.')), { status: 400 });
      if (kind === 'video' && !c.i2v) throw Object.assign(new Error(T('The chosen video model cannot start from a picture.')), { status: 400 });
      source = { buf: fs.readFileSync(m.path), type: m.type, id: m.id };
    }
    const gen = this.gen();
    const secs = kind === 'video' ? Math.max(1, Math.min(Number(c.maxSeconds) || 20, Number(seconds) || Number(c.seconds) || 8)) : null;
    const cost = gen.estimate(KINDS[kind], c, { seconds: secs || 8 }) || 0;
    // Variants: several pictures from the same description in one go (videos: one at a time – they cost per second)
    const n = kind === 'image' ? Math.max(1, Math.min(MAX_VARIANTS, Math.round(Number(variants) || 1))) : 1;
    ai.media.check(c.provider, cost * n); // monthly budget – throws an understandable error when it is used up
    this.remember(text);
    const title = kind === 'video' ? T('Create video ({label})', { label: c.label }) : T('Create image ({label})', { label: c.label });
    return this.host.core('jobs').runJob(title, async (job) => {
      job.progress(5, kind === 'video' ? T('Video is being created – this can take a few minutes …') : T('Image is being created …'));
      const run = kind === 'video'
        ? (cc) => gen.generateVideo(cc, text, { seconds: secs, aspect: aspect || c.aspect || '16:9', image: source || undefined, onStatus: (s) => job.log(String(s)) })
        : (cc) => gen.generateImage(cc, text, { size: size || c.size || '1024x1024', images: source ? [source] : undefined });
      const ids = [];
      for (let i = 0; i < n; i++) {
        if (n > 1) job.progress(5 + Math.round((i / n) * 90), T('Variant {i} of {n} …', { i: i + 1, n }));
        const r = await ai.genRun(KINDS[kind], c, run);
        // Cancelled while the provider was still working: the result is not kept (and nothing more is booked)
        if (job.signal && job.signal.aborted) break;
        const entry = ai.media.add({ kind, buf: r.buf, type: r.type, prompt: text, provider: c.provider, model: c.model, label: c.label, cost, source: source ? source.id : 'studio' });
        ids.push(entry.id);
        this.host.broadcast({ type: 'ai-media', id: entry.id });
      }
      return { id: ids[0] || null, ids, kind, cost: cost * ids.length, label: c.label };
    }, { key: `ai-media-${kind}-${Date.now()}` });
  }

  /* ---------------- Descriptions: recent ones and own templates ---------------- */

  remember(text) {
    const p = this.read('prompts', { recent: [], templates: [] });
    p.recent = [text, ...(p.recent || []).filter((x) => x !== text)].slice(0, MAX_RECENT);
    this.write('prompts', p);
  }
  prompts() { const p = this.read('prompts', { recent: [], templates: [] }); return { recent: p.recent || [], templates: p.templates || [] }; }
  setTemplates(list) {
    const clean = (Array.isArray(list) ? list : []).map((x) => ({ name: String((x && x.name) || '').trim().slice(0, 60), prompt: String((x && x.prompt) || '').trim().slice(0, 4000), kind: x && x.kind === 'video' ? 'video' : 'image' })).filter((x) => x.name && x.prompt.length > 2).slice(0, MAX_TEMPLATES);
    const p = this.read('prompts', { recent: [], templates: [] });
    p.templates = clean;
    this.write('prompts', p);
    return this.prompts();
  }
  forgetRecent(text) { const p = this.read('prompts', { recent: [], templates: [] }); p.recent = (p.recent || []).filter((x) => x !== text); this.write('prompts', p); return this.prompts(); }

  /* ---------------- Media library order: favourites, folders ---------------- */

  library() { const l = this.read('library', { fav: {}, folder: {} }); return { fav: l.fav || {}, folder: l.folder || {} }; }
  /** { ids: [...], fav?: bool, folder?: string|null } – several at once (multi-select). */
  setLibrary({ ids = [], fav, folder } = {}) {
    const l = this.library();
    for (const id of (Array.isArray(ids) ? ids : []).map(String).filter((x) => /^[\w-]{1,80}$/.test(x)).slice(0, 500)) {
      if (fav === true) l.fav[id] = true; else if (fav === false) delete l.fav[id];
      if (typeof folder === 'string' && folder.trim()) l.folder[id] = folder.trim().slice(0, 40); else if (folder === null || folder === '') delete l.folder[id];
    }
    this.write('library', l);
    return l;
  }
  /** Deleted media leave the order too. */
  forget(ids) { const l = this.library(); for (const id of ids) { delete l.fav[id]; delete l.folder[id]; } this.write('library', l); return l; }

  /* ---------------- Into a project: original, favicon (64×64) or preview picture (1200×630) ---------------- */

  toProject({ project, id, kind = 'original', png = null, overwrite = false } = {}) {
    const T = this.T;
    const p = this.ctx.devtools && this.ctx.devtools.get ? this.ctx.devtools.get(String(project || '')) : null;
    if (!p || !p.path) throw Object.assign(new Error(T('Project not found')), { status: 404 });
    const base = fs.existsSync(path.join(p.path, 'public')) ? path.join(p.path, 'public') : p.path;
    let buf; let name;
    if (kind === 'original') {
      const m = this.ai().media.file(String(id));
      buf = fs.readFileSync(m.path);
      name = `${String(m.id).replace(/[^\w-]/g, '')}${path.extname(m.path) || (m.kind === 'video' ? '.mp4' : '.png')}`;
    } else {
      const d = String(png || '').match(/^data:image\/png;base64,(.+)$/);
      if (!d) throw Object.assign(new Error(T('Please hand over a PNG picture.')), { status: 400 });
      buf = Buffer.from(d[1], 'base64');
      const want = kind === 'favicon' ? [64, 64] : [1200, 630];
      if (buf.length < 24 || buf.readUInt32BE(16) !== want[0] || buf.readUInt32BE(20) !== want[1]) throw Object.assign(new Error(T('The picture has the wrong size.')), { status: 400 });
      name = kind === 'favicon' ? 'favicon.png' : 'og-image.png';
    }
    const target = path.join(base, name);
    if (fs.existsSync(target) && !overwrite) return { exists: true, file: path.relative(p.path, target).replace(/\\/g, '/') };
    fs.writeFileSync(target, buf);
    return { ok: true, file: path.relative(p.path, target).replace(/\\/g, '/'), project: p.name || p.id };
  }

  routes(r) {
    r.get('/ai-media', (req, res) => res.json(this.status()));
    r.post('/ai-media/create', (req, res) => res.json({ job: this.create(req.body || {}).id }));
    r.get('/ai-media/prompts', (req, res) => res.json(this.prompts()));
    r.put('/ai-media/prompts/templates', (req, res) => res.json(this.setTemplates((req.body || {}).templates)));
    r.delete('/ai-media/prompts/recent', (req, res) => res.json(this.forgetRecent(String((req.body || {}).text || ''))));
    r.get('/ai-media/library', (req, res) => res.json(this.library()));
    r.put('/ai-media/library', (req, res) => res.json(this.setLibrary(req.body || {})));
    r.post('/ai-media/library/forget', (req, res) => res.json(this.forget(((req.body || {}).ids || []).map(String))));
    r.post('/ai-media/to-project', (req, res) => res.json(this.toProject(req.body || {})));
  }
}

module.exports = { Studio, SIZES, ASPECTS, MAX_VARIANTS };
