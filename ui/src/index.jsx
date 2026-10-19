import { useEffect, useState } from 'react';
import { Sparkles, Image as ImageIcon, Film, Wand2, Download, Trash2, Search, Settings2, Copy, Coins, Cpu, Cloud } from 'lucide-react';
import { post, del, useApi, waitJob, useStore, on, fmtDate, fmtBytes } from '@hostwerk/api';
import { Btn, Callout, Empty, Field, InfoTip, Loading, Modal, Progress, Seg, toast, confirmDialog } from '@hostwerk/ui';
import { LazyImg, contextMenu } from '@hostwerk/kit';
import { t } from '@hostwerk/i18n';
import './style.css';

/*
 * Image & video studio: describe it, pick image or video, create – with the model chosen in the AI helper. Every result
 * lands in the media library (also usable in the AI chat) and can be downloaded or used as the start for the next one.
 */
const euro = (n) => `≈ ${Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })}`;
const src = (m) => `/api/ai/media/${m.id}/file`;
const IDEAS = ['A cosy cabin in a snowy forest at dusk, warm light in the windows', 'Flat illustration of a small server rack with friendly faces, pastel colours', 'A drone shot flying over a lighthouse at sunrise'];

function Composer({ st, onDone, from, clearFrom }) {
  const [kind, setKind] = useState(from ? 'image' : 'image');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('');
  const [aspect, setAspect] = useState('');
  const [seconds, setSeconds] = useState('');
  const [job, setJob] = useState(null);
  const running = useStore((s) => (job ? s.jobs[job] : null));
  const cfg = st[kind];
  const ready = cfg && cfg.ready;
  const create = async () => {
    try {
      const r = await post('/ai-media/create', { kind, prompt, size: size || undefined, aspect: aspect || undefined, seconds: seconds || undefined, from: from ? from.id : undefined });
      setJob(r.job);
      const j = await waitJob(r.job);
      toast.success(kind === 'video' ? t('Video created') : t('Image created'));
      clearFrom();
      onDone(j && j.result);
    } catch (e) { if (!e.cancelled) toast.error(e.message); }
    setJob(null);
  };
  return (
    <div className="card ams-composer">
      <div className="card-head"><Wand2 size={16} /><h3>Create</h3>
        <div className="right"><Seg value={kind} onChange={(k) => { setKind(k); }} options={[{ id: 'image', label: t('Image'), icon: ImageIcon }, { id: 'video', label: t('Video'), icon: Film }]} /></div>
      </div>
      <div className="card-body stack" style={{ gap: 10 }}>
        {!ready ? (
          <Callout kind="info" icon={Settings2} title={kind === 'video' ? t('No video model chosen yet') : t('No image model chosen yet')} dismissible={false}>
            {cfg && cfg.pending ? t('“{label}” still has to be downloaded ({gb} GB).', { label: cfg.pending.label, gb: cfg.pending.gb }) : t('Choose a provider or Hostwerk’s own local image AI in the AI helper – the studio uses the same choice.')} <a className="btn sm" href="#/ki/einstellungen" style={{ marginLeft: 6 }}>{t('Open AI settings')}</a>
          </Callout>
        ) : (
          <div className="ams-model small muted">{cfg.local ? <Cpu size={13} /> : <Cloud size={13} />} {cfg.label}{cfg.audio ? ` · ${t('with sound')}` : ''} · {cfg.estimate ? t('about {cost} each', { cost: euro(cfg.estimate) }) : t('free')}</div>
        )}
        {from && <div className="ams-from"><img src={src(from)} alt="" /><span className="small grow">{kind === 'video' ? t('Starts from this picture') : t('Changes this picture')}</span><button className="btn ghost xs" onClick={clearFrom}>{t('Remove')}</button></div>}
        <Field label={kind === 'video' ? t('What should the video show?') : t('What should the picture show?')}>
          <textarea className="input" rows={4} value={prompt} maxLength={4000} placeholder={t(IDEAS[kind === 'video' ? 2 : 0])} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ready && prompt.trim().length > 2) create(); }} />
        </Field>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {kind === 'image' && <label className="small row-tight">{t('Format')} <select className="select sm" value={size} onChange={(e) => setSize(e.target.value)}><option value="">{t('as set ({v})', { v: (cfg && cfg.size) || '1024x1024' })}</option><option value="1024x1024">{t('square')}</option><option value="1536x1024">{t('landscape')}</option><option value="1024x1536">{t('portrait')}</option></select></label>}
          {kind === 'video' && <label className="small row-tight">{t('Format')} <select className="select sm" value={aspect} onChange={(e) => setAspect(e.target.value)}><option value="">{t('as set ({v})', { v: (cfg && cfg.aspect) || '16:9' })}</option><option value="16:9">{t('landscape 16:9')}</option><option value="9:16">{t('portrait 9:16')}</option></select></label>}
          {kind === 'video' && <label className="small row-tight">{t('Seconds')} <input className="input sm" type="number" min={1} max={(cfg && cfg.maxSeconds) || 20} style={{ width: 70 }} value={seconds} placeholder={String((cfg && cfg.seconds) || 8)} onChange={(e) => setSeconds(e.target.value)} /></label>}
          <span className="grow" />
          <Btn className="primary" icon={Sparkles} busy={!!job} disabled={!ready || prompt.trim().length < 3} onClick={create}>{kind === 'video' ? t('Create video') : t('Create image')}</Btn>
        </div>
        {running && <div><div className="small muted" style={{ marginBottom: 6 }}>{running.text}</div><Progress value={running.progress} indeterminate={!running.progress || running.progress < 10} /></div>}
      </div>
    </div>
  );
}

function Preview({ m, onClose, onDeleted, onUse }) {
  return (
    <Modal title={m.kind === 'video' ? t('Video') : t('Image')} subtitle={`${m.label || m.model} · ${fmtDate(m.t)} · ${fmtBytes(m.size)}${m.cost ? ` · ${euro(m.cost)}` : ''}`} size="wide" onClose={onClose}
      footer={<>
        <Btn className="ghost" icon={Trash2} onClick={async () => { if (await confirmDialog({ title: t('Delete from the media library?'), confirm: t('Delete'), danger: true })) { await del(`/ai/media/${m.id}`); onDeleted(); } }}>Delete</Btn>
        <a className="btn" href={`${src(m)}?download=1`}><Download />{t('Download')}</a>
        {m.kind === 'image' && <Btn className="primary" icon={Wand2} onClick={() => onUse(m)}>Use as a start</Btn>}
      </>}>
      <div className="stack">
        <div className="media-preview">{m.kind === 'video' ? <video src={src(m)} controls autoPlay /> : <img src={src(m)} alt={m.prompt} />}</div>
        {m.prompt && <div className="media-prompt"><span className="small">{m.prompt}</span><button className="btn ghost xs icon" title="Copy description" aria-label={t('Copy description')} onClick={() => navigator.clipboard.writeText(m.prompt).then(() => toast.success(t('Copied')))}><Copy /></button></div>}
        <div className="tiny muted">{t('Media ID {id} – in the AI chat e.g. “Edit picture {id}: …”.', { id: m.id })}</div>
      </div>
    </Modal>
  );
}

export function StudioPage() {
  const st = useApi('/ai-media', [], { live: false });
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const list = useApi(`/ai/media?kind=${kind}&q=${encodeURIComponent(q)}`, [kind, q], { live: false });
  const [sel, setSel] = useState(null);
  const [from, setFrom] = useState(null);
  useEffect(() => on('ai-media', () => list.reload({ silent: true })), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st.data) return <div className="page"><Loading /></div>;
  const s = st.data;
  const spent = s.costs ? Object.values(s.costs.spent || {}).reduce((a, b) => a + b, 0) : 0;
  const items = Array.isArray(list.data) ? list.data : null;
  return (
    <div className="page fade-in">
      <div className="page-head">
        <div><h1><Sparkles size={22} /> Image &amp; video studio</h1><p>Describe it – Hostwerk creates the picture or video with the model you chose in the AI helper. Everything lands in the media library.</p></div>
        <div className="actions">{spent > 0 && <span className="pill"><Coins size={13} /> {t('{cost} this month', { cost: euro(spent) })}</span>}<a className="btn ghost" href="#/ki/einstellungen"><Settings2 size={14} />{t('Models & budget')}</a></div>
      </div>
      {!s.available ? <Callout kind="warn" dismissible={false}>The AI helper is not available on this machine – the studio needs it.</Callout> : <Composer st={s} from={from} clearFrom={() => setFrom(null)} onDone={(r) => { list.reload(); st.reload({ silent: true }); if (r && r.id) setTimeout(() => { const m = (list.data || []).find((x) => x.id === r.id); if (m) setSel(m); }, 600); }} />}
      <div className="card">
        <div className="card-head"><ImageIcon size={16} /><h3>Media library</h3><InfoTip>{t('Pictures and videos from the studio and from the AI chat. Use one as the start for the next, or name its ID in the chat.')}</InfoTip>
          <div className="right row-tight"><Seg value={kind} onChange={setKind} options={[{ id: '', label: t('All') }, { id: 'image', label: t('Images'), icon: ImageIcon }, { id: 'video', label: t('Videos'), icon: Film }]} /></div>
        </div>
        <div className="card-body stack" style={{ gap: 10 }}>
          <div className="input-icon"><Search /><input className="input sm" aria-label={t('Search by description')} placeholder="Search by description …" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {!items ? <Loading /> : items.length === 0 ? <Empty icon={Sparkles} title="Nothing created yet" text="Describe the first picture above – it shows up here." /> : (
            <div className="media-grid">
              {items.map((m, i) => (
                <button key={m.id} type="button" className="media-card" style={{ '--i': Math.min(i, 12) }} title={m.prompt} aria-label={m.prompt || m.label} onClick={() => setSel(m)}
                  onContextMenu={(e) => contextMenu(e, [
                    { label: t('Open'), icon: Search, onClick: () => setSel(m) },
                    m.kind === 'image' && { label: t('Use as a start'), icon: Wand2, onClick: () => setFrom(m) },
                    { label: t('Download'), icon: Download, onClick: () => { location.href = `${src(m)}?download=1`; } },
                    '-',
                    { label: t('Delete'), icon: Trash2, danger: true, onClick: async () => { if (await confirmDialog({ title: t('Delete from the media library?'), confirm: t('Delete'), danger: true })) { await del(`/ai/media/${m.id}`); list.reload(); } } },
                  ])}>
                  {m.kind === 'video' ? <video src={src(m)} muted preload="metadata" /> : <LazyImg src={src(m)} alt="" style={{ width: '100%', height: '100%' }} />}
                  <span className="media-meta"><span className="ellipsis">{m.label || m.model}</span><span className="tiny">{m.cost ? euro(m.cost) : t('free')}</span></span>
                  {m.kind === 'video' && <Film size={14} className="media-kind" aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {sel && <Preview m={sel} onClose={() => setSel(null)} onDeleted={() => { setSel(null); list.reload(); }} onUse={(m) => { setFrom(m); setSel(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
    </div>
  );
}

export default {
  pages: { main: StudioPage },
};
