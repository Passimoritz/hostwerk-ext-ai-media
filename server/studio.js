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

const KINDS = { image: 'images', video: 'videos' };
const SIZES = ['1024x1024', '1536x1024', '1024x1536'];
const ASPECTS = ['16:9', '9:16', '1:1'];

class Studio {
  constructor(host) {
    this.host = host;
    this.ctx = host.ctx;
    this.T = (s, v) => host.t(s, v);
  }
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
      return { ready: true, label: c.label, provider: c.provider, local: c.provider === 'local' || c.provider === 'a1111', edit: !!c.edit, i2v: !!c.i2v, audio: !!c.audio, size: c.size || '1024x1024', seconds: Number(c.seconds) || (kind === 'video' ? 8 : null), maxSeconds: c.maxSeconds || null, aspect: c.aspect || '16:9', estimate };
    };
    return { available: true, image: one('image'), video: one('video'), costs: ai.media ? ai.media.costs() : null };
  }

  /** Start a job: image or video from a description (optionally from a picture in the media library). */
  create({ kind = 'image', prompt = '', size, seconds, aspect, from = null } = {}) {
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
    ai.media.check(c.provider, cost); // monthly budget – throws an understandable error when it is used up
    const title = kind === 'video' ? T('Create video ({label})', { label: c.label }) : T('Create image ({label})', { label: c.label });
    return this.host.core('jobs').runJob(title, async (job) => {
      job.progress(5, kind === 'video' ? T('Video is being created – this can take a few minutes …') : T('Image is being created …'));
      const run = kind === 'video'
        ? (cc) => gen.generateVideo(cc, text, { seconds: secs, aspect: aspect || c.aspect || '16:9', image: source || undefined, onStatus: (s) => job.log(String(s)) })
        : (cc) => gen.generateImage(cc, text, { size: size || c.size || '1024x1024', images: source ? [source] : undefined });
      const r = await ai.genRun(KINDS[kind], c, run);
      const entry = ai.media.add({ kind, buf: r.buf, type: r.type, prompt: text, provider: c.provider, model: c.model, label: c.label, cost, source: source ? source.id : 'studio' });
      this.host.broadcast({ type: 'ai-media', id: entry.id });
      return { id: entry.id, kind, cost, label: c.label };
    }, { key: `ai-media-${kind}-${Date.now()}` });
  }

  routes(r) {
    r.get('/ai-media', (req, res) => res.json(this.status()));
    r.post('/ai-media/create', (req, res) => res.json({ job: this.create(req.body || {}).id }));
  }
}

module.exports = { Studio, SIZES, ASPECTS };
