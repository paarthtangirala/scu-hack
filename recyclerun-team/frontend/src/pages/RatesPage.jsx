/** Owner: Anisha */
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadMaterialsData, sourceLabel } from '../services/impactRates';
import { getResponsiveLayout, runSafeAsync } from '../services/stabilization';

export function RatesPage() {
  const [view, setView] = useState({
    state: 'loading',
    materials: [],
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
      () => loadMaterialsData(),
      { state: 'error', source: null, materials: [], error: 'Failed to load material rates' }
    );

    if (mountedRef.current) {
      setView(result || { state: 'error', source: null, materials: [], error: 'Failed to load material rates' });
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (view.state === 'loading') {
    return (
      <div className="content-area">
        <div className="card" style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
          Loading material rates...
        </div>
      </div>
    );
  }

  if (view.state === 'error') {
    return (
      <div className="content-area">
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Unable to load material rates</div>
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
          <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>No material rates available</div>
          <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: responsive.rates.sourceFontSize }}>
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
        fontSize: responsive.rates.sourceFontSize,
      }}>
        Source: {sourceLabel(view.source)}
      </div>
      <div className="card" style={{ padding: responsive.spacing.cardPadding }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="rates-table" style={{ minWidth: `${responsive.rates.tableMinWidth}px` }}>
            <thead><tr><th>MATERIAL</th><th>RATE / LB</th><th>10 LBS =</th><th>SOURCE</th></tr></thead>
            <tbody>
              {view.materials.map((mat) => (
                <tr key={mat.type}>
                  <td style={{ whiteSpace: 'nowrap' }}>{mat.emoji} {mat.label}</td>
                  <td style={{ color: mat.rate >= 1 ? 'var(--green)' : 'var(--text)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                    ${mat.rate.toFixed(2)}/lb
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', color: 'var(--amber)', whiteSpace: 'nowrap' }}>${(mat.rate * 10).toFixed(2)}</td>
                  <td style={{ color: 'var(--muted)', fontSize: responsive.rates.sourceFontSize, fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                    {sourceLabel(view.source)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
