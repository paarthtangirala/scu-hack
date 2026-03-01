/** Owner: Anisha */
import { useEffect, useState } from 'react';
import { loadMaterialsData, sourceLabel } from '../services/impactRates';

export function RatesPage() {
  const [view, setView] = useState({
    state: 'loading',
    materials: [],
    source: null,
    error: null,
  });

  async function refresh() {
    setView((prev) => ({ ...prev, state: 'loading', error: null }));
    const result = await loadMaterialsData();
    setView(result);
  }

  useEffect(() => {
    refresh();
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
      <div className="card">
        <table className="rates-table">
          <thead><tr><th>MATERIAL</th><th>RATE / LB</th><th>10 LBS =</th><th>SOURCE</th></tr></thead>
          <tbody>
            {view.materials.map((mat) => (
              <tr key={mat.type}>
                <td>{mat.emoji} {mat.label}</td>
                <td style={{ color: mat.rate >= 1 ? 'var(--green)' : 'var(--text)', fontFamily: 'var(--mono)' }}>
                  ${mat.rate.toFixed(2)}/lb
                </td>
                <td style={{ fontFamily: 'var(--mono)', color: 'var(--amber)' }}>${(mat.rate * 10).toFixed(2)}</td>
                <td style={{ color: 'var(--muted)', fontSize: '0.78rem', fontFamily: 'var(--mono)' }}>
                  {sourceLabel(view.source)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
