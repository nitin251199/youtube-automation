import type { Plan } from '@/lib/api';

function speakerName(plan: Plan, speaker: string) {
  if (speaker === 'NARRATOR') return 'Narrator';
  if (speaker === 'none') return 'Music only';
  return plan.characters.find(c => c.tag === speaker)?.name || speaker;
}

export function ScenePlan({ plan, open = false }: { plan: Plan; open?: boolean }) {
  return (
    <details className="card plan" open={open}>
      <summary>
        <h2>Scene plan</h2>
        <span className="muted">{plan.characters.length} characters · {plan.backgrounds.length} backgrounds · {plan.scenes.length} scenes</span>
      </summary>
      <div className="plan-assets">
        {plan.characters.map(c => <span key={c.tag} className={`chip chip-${c.status}`} title={c.tag}>{c.name || c.tag}</span>)}
        {plan.backgrounds.map(b => <span key={b.tag} className={`chip chip-bg chip-${b.status}`} title={b.tag}>{b.name || b.tag}</span>)}
      </div>
      <ol className="scenes">
        {plan.scenes.map(scene => (
          <li key={scene.number} className={`scene scene-${scene.status}`}>
            <span className="scene-no">{scene.number}</span>
            <div>
              <div className="scene-head"><strong>{speakerName(plan, scene.speaker)}</strong>{scene.title && <small>{scene.title}</small>}</div>
              {scene.line ? <p lang="hi">{scene.line}</p> : <p className="muted">No spoken line</p>}
            </div>
            <span className="scene-status">{scene.status === 'done' ? '✓' : scene.status === 'failed' ? '!' : ''}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
