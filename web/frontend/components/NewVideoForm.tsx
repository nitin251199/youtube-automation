'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { API, type Job, type SystemStatus } from '@/lib/api';

export function NewVideoForm({ system }: { system: SystemStatus | null }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [script, setScript] = useState('');
  const [concept, setConcept] = useState('');
  const [assetMode, setAssetMode] = useState<'channel' | 'video'>('channel');
  const [logo, setLogo] = useState<File | null>(null);
  const [intro, setIntro] = useState<File | null>(null);
  const [pauseAfterScript, setPauseAfterScript] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const words = script.trim() ? script.trim().split(/\s+/).length : 0;
  const channelAssets = system?.checks.filter(c => c.id === 'logo' || c.id === 'intro') ?? [];
  const channelReady = channelAssets.length > 0 && channelAssets.every(c => c.ok);

  async function submit() {
    setBusy(true); setError('');
    const form = new FormData();
    form.set('title', title); form.set('script', script); form.set('concept', concept);
    form.set('assetMode', assetMode); form.set('pauseAfterScript', String(pauseAfterScript));
    if (assetMode === 'video') { if (logo) form.set('logo', logo); if (intro) form.set('intro', intro); }
    try {
      const response = await fetch(`${API}/api/videos`, { method: 'POST', body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not create the video (${response.status}).`);
      router.push(`/videos/${(body as Job).id}`);
    } catch (e: any) {
      setError(e instanceof TypeError ? `Cannot reach the backend at ${API}. Is it running?` : e.message);
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={e => { e.preventDefault(); void submit(); }}>
      <h2>New video</h2>
      <p className="muted">Paste a finished Hindi folk-horror script. Groq splits it into characters, backgrounds and exactly 12 scenes; Google Flow animates them; narration, music, intro and logo are added; then you approve the upload.</p>

      <label className="field">
        <span>Title <em>{title.length}/100</em></span>
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={100} required placeholder="आख़िरी बस की तीसरी सीट" />
      </label>

      <label className="field">
        <span>Script <em>{words} words · {script.length.toLocaleString()} characters</em></span>
        <textarea value={script} onChange={e => setScript(e.target.value)} required minLength={40} rows={14}
          placeholder={'रात की आख़िरी बस में मीरा अकेली बैठी थी…\n\nInclude every spoken line exactly as it should be heard. About 130–160 words fits one minute.'} />
      </label>

      <label className="field">
        <span>Concept <em>optional</em></span>
        <input value={concept} onChange={e => setConcept(e.target.value)} maxLength={300} placeholder="One-line premise, e.g. a bus seat that is always wet" />
      </label>

      <fieldset className="field">
        <span>Logo &amp; intro</span>
        <div className="segmented">
          <label className={assetMode === 'channel' ? 'active' : ''}>
            <input type="radio" name="assetMode" checked={assetMode === 'channel'} onChange={() => setAssetMode('channel')} />
            Channel logo &amp; intro
          </label>
          <label className={assetMode === 'video' ? 'active' : ''}>
            <input type="radio" name="assetMode" checked={assetMode === 'video'} onChange={() => setAssetMode('video')} />
            Upload for this video
          </label>
        </div>
        {assetMode === 'channel' && system && (
          <small className={channelReady ? 'muted' : 'warn-text'}>
            {channelReady ? 'Using CHANNEL_LOGO_PATH and CHANNEL_INTRO_PATH from scripting/.env.' : 'Channel assets are not configured yet. Set them in scripting/.env or upload them for this video.'}
          </small>
        )}
        {assetMode === 'video' && (
          <div className="uploads">
            <label className="upload">
              <strong>Logo</strong><small>PNG or JPG, lower-right corner</small>
              <input type="file" accept="image/png,image/jpeg" onChange={e => setLogo(e.target.files?.[0] ?? null)} />
            </label>
            <label className="upload">
              <strong>Intro</strong><small>MP4, at least 5 s, with audio</small>
              <input type="file" accept="video/mp4" onChange={e => setIntro(e.target.files?.[0] ?? null)} />
            </label>
            <small className="muted">Anything you leave empty falls back to the channel asset.</small>
          </div>
        )}
      </fieldset>

      <label className="check">
        <input type="checkbox" checked={pauseAfterScript} onChange={e => setPauseAfterScript(e.target.checked)} />
        <span>Let me check the 12-scene plan before Google Flow spends credits</span>
      </label>

      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="actions">
        <button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create video'}</button>
        {system?.queue.activeJobId && <small className="muted">One video renders at a time; this one will wait in the queue.</small>}
      </div>
    </form>
  );
}
