/** Owner: Anisha */
import { useEffect, useMemo, useState } from 'react';
import { buildImpactCards, loadImpactData, sourceLabel } from '../services/impactRates';

export function ImpactPage() {
  const [view, setView] = useState({
    state: 'loading',
    stats: null,
    source: null,
    error: null,
  });

  async function refresh() {
    setView((prev) => ({ ...prev, state: 'loading', error: null }));
    const result = await loadImpactData();
    setView(result);
  }

  useEffect(() => {
    refresh();
  }, []);

  const cards = useMemo(() => buildImpactCards(view.stats), [view.stats]);

  if (view.state === 'loading') {
    return (
      <div className="content-area">
        <div className="card" style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
          Loading impact data...
        </div>
      </div>
    );
  }

  if (view.state === 'error') {
    return (
      <div className="content-area">
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Unable to load impact data</div>
          <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: '1rem' }}>
            {view.error || 'Unknown error'}
          </div>
          <button className="btn" onClick={refresh}>Retry</button>
        </div>
      </div>
    );
  }

  if (view.state === 'empty') {
    return (
      <div className="content-area">
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>No impact data yet</div>
          <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            Source: {sourceLabel(view.source)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="content-area">
      <div className="card mb-2" style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
        Source: {sourceLabel(view.source)}
      </div>
      <div className="impact-grid mb-2">
        {cards.map((c) => (
          <div key={c.label} className="impact-card">
            <div className="impact-icon">{c.icon}</div>
            <div className="impact-num">{c.num}</div>
            <div className="impact-label">{c.label}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>How RecycleRun Supports SB 1383</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.88rem', color: 'var(--muted)', lineHeight: 1.9 }}>
          California's SB 1383 mandates 75% reduction in organic and recyclable waste sent to landfills.
          RecycleRun captures recyclable overflow between weekly city pickup days — the cardboard from
          Amazon deliveries, aluminum from weekend parties, e-waste from home offices. Every pound
          collected is a pound that doesn't generate methane in a landfill.
        </div>
      </div>
    </div>
  );
}
