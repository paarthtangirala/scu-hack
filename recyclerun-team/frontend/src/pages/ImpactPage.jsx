/** Owner: Anisha */
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildImpactCards, loadImpactData, sourceLabel } from '../services/impactRates';
import { getResponsiveLayout, runSafeAsync } from '../services/stabilization';

export function ImpactPage() {
  const [view, setView] = useState({
    state: 'loading',
    stats: null,
    source: null,
    error: null,
  });
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth : 1280
  ));
  const mountedRef = useRef(true);

  const responsive = useMemo(() => getResponsiveLayout(viewportWidth), [viewportWidth]);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      if (mountedRef.current) {
        setViewportWidth(window.innerWidth);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  async function refresh() {
    if (mountedRef.current) {
      setView((prev) => ({ ...prev, state: 'loading', error: null }));
    }

    const result = await runSafeAsync(
      () => loadImpactData(),
      { state: 'error', source: null, stats: null, error: 'Failed to load impact data' }
    );

    if (mountedRef.current) {
      setView(result || { state: 'error', source: null, stats: null, error: 'Failed to load impact data' });
    }
  }

  useEffect(() => {
    void refresh();
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
          <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: responsive.impact.sourceFontSize }}>
            Source: {sourceLabel(view.source)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="content-area">
      <div className="card mb-2" style={{
        fontFamily: 'var(--mono)',
        color: 'var(--muted)',
        fontSize: responsive.impact.sourceFontSize,
      }}>
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
      <div className="card" style={{ padding: responsive.spacing.cardPadding }}>
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
