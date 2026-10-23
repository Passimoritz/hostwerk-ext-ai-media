import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Image as ImageIcon, Film, Wand2, Download, Trash2, Search, Settings2, Copy, Coins, Cpu, Cloud, Square, Star, Folder, FolderInput, History, Bookmark, X, Box, FolderGit2, CheckSquare, RotateCw, CloudOff } from 'lucide-react';
import { get, post, put, del, useApi, waitJob, useStore, on, fmtBytes } from '@hostwerk/api';
import { Btn, Callout, Empty, Field, InfoTip, Loading, Modal, Progress, Seg, toast, confirmDialog, promptDialog } from '@hostwerk/ui';
import { LazyImg, contextMenu } from '@hostwerk/kit';
import { t } from '@hostwerk/i18n';
import { useFill } from './fill';
import './style.css';

/*
 * Image & video studio: describe it, pick image or video, create – with the model chosen in the AI helper. Every result
 * lands in the media library (also usable in the AI chat) and can be downloaded, used as the start for the next one, set
 * as a Minecraft server icon or saved into a project. Variants, recent descriptions and own templates; favourites, folders
 * and multi-select in the library. Money and dates follow Hostwerk's language (document language), not the system.
 */
const locale = () => (typeof document !== 'undefined' && document.documentElement.lang) || 'en';
const euro = (n) => `≈ ${Number(n || 0).toLocaleString(locale(), { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })}`;
const when = (ts) => new Date(ts).toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const src = (m) => `/api/ai/media/${m.id}/file`;
const IDEAS = ['A cosy cabin in a snowy forest at dusk, warm light in the windows', 'Flat illustration of a small server rack with friendly faces, pastel colours', 'A drone shot flying over a lighthouse at sunrise'];

/** Picture from the library cut to a centred crop of w×h and scaled (canvas) → PNG data URL. */
async function cropPng(m, w, h) {
  const img = new Image();
  img.src = src(m);
  await img.decode();
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale; const sh = h / scale;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h);
  return c.toDataURL('image/png');
}

/** Recent descriptions and own templates – click to use, × to forget. */
function PromptMemory({ kind, prompt, setPrompt }) {
  const p = useApi('/ai-media/prompts', [], { live: false });
  const data = p.data || { recent: [], templates: [] };
  const templates = data.templates.filter((x) => x.kind === kind);
  const saveTemplate = async () => {
    const name = await promptDialog({ title: 'Save as template', label: 'Name', placeholder: 'e.g. Product photo' });
    if (!name) return;
    try { p.setData(await put('/ai-media/prompts/templates', { templates: [...data.templates.filter((x) => x.name !== name), { name, prompt, kind }] })); toast.success('Template saved'); } catch (e) { toast.error(e); }
  };
  const removeTemplate = async (x) => { try { p.setData(await put('/ai-media/prompts/templates', { templates: data.templates.filter((y) => y !== x) })); } catch (e) { toast.error(e); } };
  const forget = async (text) => { try { p.setData(await del('/ai-media/prompts/recent', { text })); } catch (e) { toast.error(e); } };
  useEffect(() => on('ai-media', () => p.reload({ silent: true })), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!templates.length && !data.recent.length && prompt.trim().length < 3) return null;
  return (
    <div className="stack ams-memory">
      {(templates.length > 0 || prompt.trim().length > 2) && (
        <div className="ams-chips" aria-label="Templates">
          <Bookmark size={13} className="muted" aria-hidden="true" />
          {templates.map((x) => <span key={x.name} className="ams-chip"><button type="button" className="ams-chip-btn" title={x.prompt} onClick={() => setPrompt(x.prompt)}>{x.name}</button><button type="button" className="ams-chip-x" title={t('Remove template “{name}”', { name: x.name })} aria-label={t('Remove template “{name}”', { name: x.name })} onClick={() => removeTemplate(x)}><X size={12} /></button></span>)}
          {prompt.trim().length > 2 && <button type="button" className="btn ghost xs" onClick={saveTemplate}>Save as template</button>}
        </div>
      )}
      {data.recent.length > 0 && (
        <div className="ams-chips" aria-label="Recent descriptions">
          <History size={13} className="muted" aria-hidden="true" />
          {data.recent.slice(0, 6).map((x) => <span key={x} className="ams-chip"><button type="button" className="ams-chip-btn ellipsis" title={x} onClick={() => setPrompt(x)}>{x}</button><button type="button" className="ams-chip-x" title="Forget" aria-label="Forget" onClick={() => forget(x)}><X size={12} /></button></span>)}
        </div>
      )}
    </div>
  );
}

function Composer({ st, onDone, from, clearFrom }) {
  const [kind, setKind] = useState('image');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('');
  const [aspect, setAspect] = useState('');
  const [seconds, setSeconds] = useState('');
  const [variants, setVariants] = useState(1);
  const [job, setJob] = useState(null);
  const running = useStore((s) => (job ? s.jobs[job] : null));
  const cfg = st[kind];
  const ready = cfg && cfg.ready;
  // Price for what is chosen: videos per second × length, pictures × variants
  const secs = Number(seconds) || (cfg && cfg.seconds) || 8;
  const price = !ready ? 0 : kind === 'video' ? (cfg.perSecond ? cfg.perSecond * secs : cfg.estimate) : cfg.estimate * variants;
  const create = async () => {
    try {
      const r = await post('/ai-media/create', { kind, prompt, size: size || undefined, aspect: aspect || undefined, seconds: seconds || undefined, from: from ? from.id : undefined, variants: kind === 'image' ? variants : 1 });
      setJob(r.job);
      const j = await waitJob(r.job);
      const res = j && j.result;
      toast.success(kind === 'video' ? t('Video created') : res && res.ids && res.ids.length > 1 ? t('{n} images created', { n: res.ids.length }) : t('Image created'));
      clearFrom();
      onDone(res);
    } catch (e) { if (e && e.cancelled) toast('Cancelled – nothing was kept.'); else toast.error(e.message || e); }
    setJob(null);
  };
  const cancel = async () => { if (!job) return; try { await post(`/jobs/${encodeURIComponent(job)}/cancel`); } catch (e) { toast.error(e); } };
  return (
    <div className="card ams-composer">
      <div className="card-head"><Wand2 size={16} /><h3>Create</h3>
        <div className="right"><Seg value={kind} onChange={(k) => { setKind(k); }} options={[{ id: 'image', label: t('Image'), icon: ImageIcon }, { id: 'video', label: t('Video'), icon: Film }]} /></div>
      </div>
      <div className="card-body stack ams-body">
        {!ready ? (
          <Callout kind="info" icon={Settings2} title={kind === 'video' ? t('No video model chosen yet') : t('No image model chosen yet')} dismissible={false}>
            {cfg && cfg.pending ? t('“{label}” still has to be downloaded ({gb} GB).', { label: cfg.pending.label, gb: cfg.pending.gb }) : t('Choose a provider or Hostwerk’s own local image AI in the AI helper – the studio uses the same choice.')} <a className="btn sm ams-gap" href="#/ki/einstellungen">{t('Open AI settings')}</a>
          </Callout>
        ) : (
          <div className="ams-model small muted">{cfg.local ? <Cpu size={13} /> : <Cloud size={13} />} {cfg.label}{cfg.audio ? ` · ${t('with sound')}` : ''} · {price ? t('about {cost}', { cost: euro(price) }) : t('free')}{kind === 'video' && cfg.perSecond ? ` ${t('({cost} per second)', { cost: euro(cfg.perSecond) })}` : ''}</div>
        )}
        {from && <div className="ams-from"><img src={src(from)} alt="" /><span className="small grow">{kind === 'video' ? t('Starts from this picture') : t('Changes this picture')}</span><button type="button" className="btn ghost xs" onClick={clearFrom}>{t('Remove')}</button></div>}
        <Field label={kind === 'video' ? t('What should the video show?') : t('What should the picture show?')}>
          <textarea className="input" rows={4} value={prompt} maxLength={4000} placeholder={t(IDEAS[kind === 'video' ? 2 : 0])} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ready && prompt.trim().length > 2 && !job) create(); }} />
        </Field>
        <PromptMemory kind={kind} prompt={prompt} setPrompt={setPrompt} />
        <div className="row ams-options">
          {kind === 'image' && <label className="small row-tight">{t('Format')} <select className="select sm" value={size} onChange={(e) => setSize(e.target.value)}><option value="">{t('as set ({v})', { v: (cfg && cfg.size) || '1024x1024' })}</option><option value="1024x1024">{t('square')}</option><option value="1536x1024">{t('landscape')}</option><option value="1024x1536">{t('portrait')}</option></select></label>}
          {kind === 'image' && <label className="small row-tight">{t('Variants')} <select className="select sm" value={variants} onChange={(e) => setVariants(Number(e.target.value))}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select><InfoTip title="Variants">Several pictures from the same description in one go – pick the best one. Each one costs the same as a single picture.</InfoTip></label>}
          {kind === 'video' && <label className="small row-tight">{t('Format')} <select className="select sm" value={aspect} onChange={(e) => setAspect(e.target.value)}><option value="">{t('as set ({v})', { v: (cfg && cfg.aspect) || '16:9' })}</option><option value="16:9">{t('landscape 16:9')}</option><option value="9:16">{t('portrait 9:16')}</option><option value="1:1">{t('square 1:1')}</option></select></label>}
          {kind === 'video' && <label className="small row-tight">{t('Seconds')} <input className="input sm ams-secs" type="number" min={1} max={(cfg && cfg.maxSeconds) || 20} value={seconds} placeholder={String((cfg && cfg.seconds) || 8)} onChange={(e) => setSeconds(e.target.value)} /></label>}
          <span className="grow" />
          {job ? <Btn className="danger" icon={Square} onClick={cancel}>Cancel</Btn> : null}
          <Btn className="primary" icon={Sparkles} busy={!!job} disabled={!ready || prompt.trim().length < 3} onClick={create}>{kind === 'video' ? t('Create video') : variants > 1 ? t('Create {n} images', { n: variants }) : t('Create image')}</Btn>
        </div>
        {running && <div><div className="small muted ams-run-text">{running.text}</div><Progress value={running.progress} indeterminate={!running.progress || running.progress < 10} /></div>}
      </div>
    </div>
  );
}

/** Set a picture as the icon of a Minecraft server (64×64, centred crop). */
function ServerIcon({ m }) {
  const servers = useApi('/mc/servers', [], { live: false, poll: false });
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const list = Array.isArray(servers.data) ? servers.data : (servers.data && servers.data.servers) || [];
  if (!list.length) return null;
  const go = async () => {
    setBusy(true);
    try { const png = await cropPng(m, 64, 64); const r = await put(`/mc/servers/${encodeURIComponent(id || list[0].id)}/icon`, { png }); toast.success(r && r.needsRestart ? t('Server icon set – shows after a restart') : t('Server icon set')); } catch (e) { toast.error(e); }
    setBusy(false);
  };
  return (
    <div className="row-tight ams-use">
      <Box size={14} className="muted" aria-hidden="true" />
      <span className="small">Server icon</span>
      <select className="select sm" aria-label="Minecraft server" value={id || list[0].id} onChange={(e) => setId(e.target.value)}>{list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <Btn className="sm" busy={busy} onClick={go}>Use</Btn>
      <InfoTip title="Server icon">Cut to 64×64 pixels from the middle of the picture – that is what the Minecraft server list shows.</InfoTip>
    </div>
  );
}

/** Save into a project: the original, as favicon (64×64) or as preview picture for links (1200×630). */
function ToProject({ m }) {
  const projects = useApi('/projects', [], { live: false, poll: false });
  const [id, setId] = useState('');
  const [as, setAs] = useState(m.kind === 'video' ? 'original' : 'favicon');
  const [busy, setBusy] = useState(false);
  const list = Array.isArray(projects.data) ? projects.data : [];
  if (!list.length) return null;
  const go = async () => {
    setBusy(true);
    try {
      const body = { project: id || list[0].id, id: m.id, kind: as, png: as === 'favicon' ? await cropPng(m, 64, 64) : as === 'preview' ? await cropPng(m, 1200, 630) : undefined };
      let r = await post('/ai-media/to-project', body);
      if (r.exists) {
        if (!(await confirmDialog({ title: t('Replace {file}?', { file: r.file }), text: 'There is already a file with this name in the project.', confirm: 'Replace', danger: true }))) { setBusy(false); return; }
        r = await post('/ai-media/to-project', { ...body, overwrite: true });
      }
      toast.success(t('Saved as {file} in {project}', { file: r.file, project: r.project }));
    } catch (e) { toast.error(e); }
    setBusy(false);
  };
  return (
    <div className="row-tight ams-use">
      <FolderGit2 size={14} className="muted" aria-hidden="true" />
      <span className="small">Into a project</span>
      <select className="select sm" aria-label="Project" value={id || list[0].id} onChange={(e) => setId(e.target.value)}>{list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      {m.kind === 'image' && <select className="select sm" aria-label="Save as" value={as} onChange={(e) => setAs(e.target.value)}><option value="favicon">{t('as favicon (64×64)')}</option><option value="preview">{t('as link preview (1200×630)')}</option><option value="original">{t('as it is')}</option></select>}
      <Btn className="sm" busy={busy} onClick={go}>Save</Btn>
    </div>
  );
}

function Preview({ m, lib, onClose, onDeleted, onUse, onFav }) {
  const fav = !!lib.fav[m.id];
  return (
    <Modal title={m.kind === 'video' ? t('Video') : t('Image')} subtitle={`${m.label || m.model} · ${when(m.t)} · ${fmtBytes(m.size)}${m.cost ? ` · ${euro(m.cost)}` : ''}`} size="wide" onClose={onClose}
      footer={<>
        <Btn className="ghost" icon={Trash2} onClick={async () => { if (await confirmDialog({ title: t('Delete from the media library?'), confirm: t('Delete'), danger: true })) { await del(`/ai/media/${m.id}`); onDeleted([m.id]); } }}>Delete</Btn>
        <Btn className="ghost" icon={Star} aria-pressed={fav} onClick={() => onFav([m.id], !fav)}>{fav ? 'Favourite' : 'Mark as favourite'}</Btn>
        <a className="btn" href={`${src(m)}?download=1`}><Download />{t('Download')}</a>
        {m.kind === 'image' && <Btn className="primary" icon={Wand2} onClick={() => onUse(m)}>Use as a start</Btn>}
      </>}>
      <div className="stack">
        <div className="media-preview">{m.kind === 'video' ? <video src={src(m)} controls autoPlay /> : <img src={src(m)} alt={m.prompt} />}</div>
        {m.prompt && <div className="media-prompt"><span className="small">{m.prompt}</span><button type="button" className="btn ghost xs icon" title="Copy description" aria-label={t('Copy description')} onClick={() => navigator.clipboard.writeText(m.prompt).then(() => toast.success(t('Copied')))}><Copy /></button></div>}
        {m.kind === 'image' && <ServerIcon m={m} />}
        <ToProject m={m} />
        <div className="tiny muted">{t('Media ID {id} – in the AI chat e.g. “Edit picture {id}: …”.', { id: m.id })}</div>
      </div>
    </Modal>
  );
}

export function StudioPage() {
  // Erzeugen und Mediathek nebeneinander (ab ~1100 px), beide in der Fensterhöhe – die Mediathek scrollt in ihrer Fläche
  const fill = useFill({ min: 300 });
  const st = useApi('/ai-media', [], { live: false });
  const libApi = useApi('/ai-media/library', [], { live: false, poll: false });
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState(''); // '' = all, '*' = favourites, else folder name
  const list = useApi(`/ai/media?kind=${kind}&q=${encodeURIComponent(q)}`, [kind, q], { live: false });
  const [sel, setSel] = useState(null);
  const [from, setFrom] = useState(null);
  const [picked, setPicked] = useState(null); // multi-select: Set of ids (null = off)
  useEffect(() => on('ai-media', () => list.reload({ silent: true })), []); // eslint-disable-line react-hooks/exhaustive-deps
  const lib = libApi.data || { fav: {}, folder: {} };
  const folders = useMemo(() => [...new Set(Object.values(lib.folder))].sort((a, b) => a.localeCompare(b)), [lib.folder]);
  if (!st.data && st.error) return <div className="page"><Empty icon={CloudOff} title="Could not load the studio" text={st.error} action={<Btn icon={RotateCw} onClick={() => st.reload()}>Try again</Btn>} /></div>;
  if (!st.data) return <div className="page"><Loading /></div>;
  const s = st.data;
  const spent = s.costs ? Object.values(s.costs.spent || {}).reduce((a, b) => a + b, 0) : 0;
  const all = Array.isArray(list.data) ? list.data : null;
  const items = all && all.filter((m) => (folder === '' ? true : folder === '*' ? lib.fav[m.id] : lib.folder[m.id] === folder));
  const setLib = async (body) => { try { libApi.setData(await put('/ai-media/library', body)); } catch (e) { toast.error(e); } };
  const fav = (ids, on2) => setLib({ ids, fav: on2 });
  const moveTo = async (ids) => {
    const name = await promptDialog({ title: 'Move to folder', label: 'Folder (empty = no folder)', value: folders[0] || '', placeholder: 'e.g. Logos' });
    if (name === null || name === undefined) return;
    await setLib({ ids, folder: String(name).trim() || null });
  };
  const removeMany = async (ids) => {
    if (!(await confirmDialog({ title: t('Delete {n} items from the media library?', { n: ids.length }), confirm: t('Delete'), danger: true }))) return;
    for (const id of ids) { try { await del(`/ai/media/${id}`); } catch (e) { toast.error(e); break; } }
    try { libApi.setData(await post('/ai-media/library/forget', { ids })); } catch { /* order only */ }
    setPicked(null); list.reload();
  };
  // After creating: reload the library and open the (first) new result directly by its id
  const opened = async (r) => {
    st.reload({ silent: true });
    const fresh = await get('/ai/media?kind=&q=').catch(() => null);
    list.reload({ silent: true });
    const m = Array.isArray(fresh) && r && r.id ? fresh.find((x) => x.id === r.id) : null;
    if (m) setSel(m);
  };
  const toggle = (id) => setPicked((p) => { const n = new Set(p || []); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ids = picked ? [...picked] : [];
  return (
    <div className="page fade-in">
      <div className="page-head">
        <div><h1><Sparkles size={22} /> Image &amp; video studio</h1><p>Describe it – Hostwerk creates the picture or video with the model you chose in the AI helper. Everything lands in the media library.</p></div>
        <div className="actions">{spent > 0 && <span className="pill"><Coins size={13} /> {t('{cost} this month', { cost: euro(spent) })}</span>}<a className="btn ghost" href="#/ki/einstellungen"><Settings2 size={14} />{t('Models & budget')}</a></div>
      </div>
      <div className="ams-split" ref={fill}>
      <div className="ams-left">{!s.available ? <Callout kind="warn" dismissible={false}>The AI helper is not available on this machine – the studio needs it.</Callout> : <Composer st={s} from={from} clearFrom={() => setFrom(null)} onDone={opened} />}</div>
      <div className="card ams-lib">
        <div className="card-head"><ImageIcon size={16} /><h3>Media library</h3><InfoTip>{t('Pictures and videos from the studio and from the AI chat. Use one as the start for the next, or name its ID in the chat.')}</InfoTip>
          <div className="right row-tight"><Seg value={kind} onChange={setKind} options={[{ id: '', label: t('All') }, { id: 'image', label: t('Images'), icon: ImageIcon }, { id: 'video', label: t('Videos'), icon: Film }]} /></div>
        </div>
        <div className="card-body stack ams-body ams-lib-body">
          <div className="row-tight ams-libbar">
            <div className="input-icon grow"><Search /><input className="input sm" aria-label={t('Search by description')} placeholder="Search by description …" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <select className="select sm" aria-label="Folder" value={folder} onChange={(e) => setFolder(e.target.value)}>
              <option value="">{t('All folders')}</option><option value="*">{t('Favourites')}</option>
              {folders.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <Btn className="sm ghost" icon={CheckSquare} aria-pressed={!!picked} onClick={() => setPicked(picked ? null : new Set())}>{picked ? 'Done' : 'Select'}</Btn>
          </div>
          {picked && (
            <div className="row-tight ams-pickbar">
              <span className="small grow">{t('{n} selected', { n: ids.length })}</span>
              <Btn className="sm ghost" icon={Star} disabled={!ids.length} onClick={() => fav(ids, true)}>Favourite</Btn>
              <Btn className="sm ghost" icon={FolderInput} disabled={!ids.length} onClick={() => moveTo(ids)}>Move to folder</Btn>
              <Btn className="sm ghost danger" icon={Trash2} disabled={!ids.length} onClick={() => removeMany(ids)}>Delete</Btn>
            </div>
          )}
          {!items ? (list.error ? <Empty icon={CloudOff} title="Could not load the media library" text={list.error} action={<Btn icon={RotateCw} onClick={() => list.reload()}>Try again</Btn>} /> : <Loading />) : items.length === 0 ? <Empty icon={folder ? Folder : Sparkles} title={folder ? 'Nothing in here yet' : 'Nothing created yet'} text={folder ? 'Mark pictures as favourites or move them into a folder.' : 'Describe the first picture above – it shows up here.'} /> : (
            <div className="media-grid">
              {items.map((m, i) => (
                <div key={m.id} className={`ams-card ${picked && picked.has(m.id) ? 'is-picked' : ''}`}>
                  <button type="button" className="media-card" style={{ '--i': Math.min(i, 12) }} title={m.prompt} aria-label={m.prompt || m.label} aria-pressed={picked ? picked.has(m.id) : undefined} onClick={() => (picked ? toggle(m.id) : setSel(m))}
                    onContextMenu={(e) => contextMenu(e, [
                      { label: t('Open'), icon: Search, onClick: () => setSel(m) },
                      m.kind === 'image' && { label: t('Use as a start'), icon: Wand2, onClick: () => setFrom(m) },
                      { label: lib.fav[m.id] ? t('Remove from favourites') : t('Mark as favourite'), icon: Star, onClick: () => fav([m.id], !lib.fav[m.id]) },
                      { label: t('Move to folder'), icon: FolderInput, onClick: () => moveTo([m.id]) },
                      { label: t('Download'), icon: Download, onClick: () => { location.href = `${src(m)}?download=1`; } },
                      '-',
                      { label: t('Delete'), icon: Trash2, danger: true, onClick: () => removeMany([m.id]) },
                    ])}>
                    {m.kind === 'video' ? <video src={src(m)} muted preload="metadata" /> : <LazyImg src={src(m)} alt="" className="ams-thumb" />}
                    <span className="media-meta"><span className="ellipsis">{lib.folder[m.id] ? `${lib.folder[m.id]} · ` : ''}{m.label || m.model}</span><span className="tiny">{m.cost ? euro(m.cost) : t('free')}</span></span>
                    {m.kind === 'video' && <Film size={14} className="media-kind" aria-hidden="true" />}
                  </button>
                  {lib.fav[m.id] && <Star size={14} className="ams-fav" aria-label="Favourite" />}
                  {picked && <span className="ams-check" aria-hidden="true">{picked.has(m.id) ? '✓' : ''}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
      {sel && <Preview m={sel} lib={lib} onFav={fav} onClose={() => setSel(null)} onDeleted={(gone) => { setSel(null); list.reload(); post('/ai-media/library/forget', { ids: gone }).then((l) => libApi.setData(l)).catch(() => {}); }} onUse={(m) => { setFrom(m); setSel(null); window.scrollTo({ top: 0, behavior: 'smooth' }); const c = document.querySelector('.ams-left'); if (c) c.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
    </div>
  );
}

export default {
  pages: { main: StudioPage },
  slots: {
    // Seit Hostwerk 3.0 (SDK 3.2) ohne eigenen Seitenleisten-Eintrag ("nav": false) – die ganze Seite als Reiter im passenden Bereich;
    // Hostwerk blendet dabei ihren Titel aus (Reiter + Herkunftszeile sagen schon, was es ist), die Knöpfe bleiben
    'ai.tabs': [{ id: 'media', title: 'Images & videos', icon: ImageIcon, Component: StudioPage, order: 40 }],
  },
};
