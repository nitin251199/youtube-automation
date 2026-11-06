'use client';
import { useEffect, useState } from 'react';
import { api, type SystemStatus } from '@/lib/api';

export function useSystemStatus() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () => api<SystemStatus>('/system/status').then(s => { if (alive) { setStatus(s); setError(''); } }).catch(e => alive && setError(e.message));
    load();
    const timer = setInterval(load, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return { status, error };
}

export function SetupChecklist({ status, error }: ReturnType<typeof useSystemStatus>) {
  if (error) return <section className="card"><h2>Setup</h2><p className="error-text">{error}</p></section>;
  if (!status) return <section className="card"><h2>Setup</h2><p className="muted">Checking…</p></section>;
  const missing = status.checks.filter(c => !c.ok && c.required);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Setup</h2>
        <span className={`badge ${status.ready ? 'badge-good' : 'badge-warn'}`}><span className="dot" />{status.ready ? 'Ready' : `${missing.length} to fix`}</span>
      </div>
      <ul className="checks">
        {status.checks.map(check => (
          <li key={check.id} className={check.ok ? 'ok' : check.required ? 'missing' : 'optional'}>
            <span className="check-mark" aria-hidden>{check.ok ? '✓' : check.required ? '!' : '·'}</span>
            <div><strong>{check.label}</strong><small>{check.detail}</small></div>
          </li>
        ))}
      </ul>
      <p className="muted small">Keys live only in <code>scripting/.env</code>. Edit that file, then this list refreshes by itself.</p>
    </section>
  );
}
