/** Owner: Anisha */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import { buildImpactCards, loadImpactData, sourceLabel } from '../services/impactRates';
import { getResponsiveLayout, runSafeAsync } from '../services/stabilization';

const DASHBOARD_WINDOWS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All receipts' },
];

function formatPct(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Unknown time';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString();
}

function downloadTextAsFile(text, filename) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(href);
  return true;
}

function buildHotspotPlotModel(hotspots = []) {
  if (!Array.isArray(hotspots) || hotspots.length === 0) {
    return [];
  }

  const latitudes = hotspots.map((item) => Number(item.lat || 0));
  const longitudes = hotspots.map((item) => Number(item.lng || 0));
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latSpan = Math.max(maxLat - minLat, 0.001);
  const lngSpan = Math.max(maxLng - minLng, 0.001);

  return hotspots.map((item) => {
    const lat = Number(item.lat || 0);
    const lng = Number(item.lng || 0);
    const lbs = Number(item.actual_total_lbs || 0);
    return {
      ...item,
      x: ((lng - minLng) / lngSpan) * 100,
      y: 100 - ((lat - minLat) / latSpan) * 100,
      size: Math.max(10, Math.min(28, 10 + lbs / 8)),
    };
  });
}

export function ImpactPage() {
  const [view, setView] = useState({
    state: 'loading',
    stats: null,
    dashboard: null,
    source: null,
    error: null,
  });
  const [windowValue, setWindowValue] = useState('30d');
  const [exportingCsv, setExportingCsv] = useState(false);
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
      () => loadImpactData({ window: windowValue }),
      { state: 'error', source: null, stats: null, dashboard: null, error: 'Failed to load impact data' }
    );

    if (mountedRef.current) {
      setView(result || { state: 'error', source: null, stats: null, dashboard: null, error: 'Failed to load impact data' });
    }
  }

  useEffect(() => {
    void refresh();
  }, [windowValue]);

  const cards = useMemo(() => buildImpactCards(view.stats), [view.stats]);
  const hotspotPoints = useMemo(() => buildHotspotPlotModel(view.dashboard?.hotspots || []), [view.dashboard?.hotspots]);
  const materialMix = useMemo(() => (view.dashboard?.material_mix || []).slice(0, 6), [view.dashboard?.material_mix]);

  async function exportCsv() {
    setExportingCsv(true);
    const result = await runSafeAsync(
      () => api.downloadOrgDashboardCsv(view.dashboard?.org?.id || 'org_santa_clara_demo', { window: windowValue }),
      { ok: false, error: 'Export failed', status: 0 }
    );
    setExportingCsv(false);

    if (!result?.ok) {
      setView((prev) => ({ ...prev, error: result?.error || 'CSV export failed' }));
      return;
    }

    const filename = `bin2bucks-${view.dashboard?.org?.id || 'org'}-${windowValue}.csv`;
    downloadTextAsFile(result.data, filename);
  }

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
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.75rem',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>
            {view.dashboard?.org?.name || 'Santa Clara Diversion Pilot'}
          </div>
          <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: responsive.impact.sourceFontSize }}>
            Source: {sourceLabel(view.source)}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
          <select value={windowValue} onChange={(event) => setWindowValue(event.target.value)} style={{ minWidth: 168 }}>
            {DASHBOARD_WINDOWS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={refresh}>Refresh</button>
          <button className="btn btn-primary" onClick={exportCsv} disabled={exportingCsv || !view.dashboard}>
            {exportingCsv ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>
      <div className="card mb-2" style={{
        fontFamily: 'var(--mono)',
        color: 'var(--muted)',
        fontSize: responsive.impact.sourceFontSize,
      }}>
        Window: {windowValue} · receipts: {view.dashboard?.receipt_count ?? 0}
      </div>
      {view.error ? (
        <div className="card mb-2" style={{ color: 'var(--amber)', fontFamily: 'var(--mono)' }}>
          {view.error}
        </div>
      ) : null}
      <div className="impact-grid mb-2">
        {cards.map((c) => (
          <div key={c.label} className="impact-card">
            <div className="impact-icon">{c.icon}</div>
            <div className="impact-num">{c.num}</div>
            <div className="impact-label">{c.label}</div>
          </div>
        ))}
      </div>
      {view.dashboard ? (
        <div className="card mb-2" style={{ padding: responsive.spacing.cardPadding }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>
            {view.dashboard.org?.name || 'City / EPR Dashboard'}
          </div>
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: responsive.isPhone ? '1fr' : 'repeat(3, minmax(0, 1fr))' }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '1rem' }}>
              <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: '0.35rem' }}>Pickup SLA</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{view.dashboard.summary.mean_pickup_time_minutes} min</div>
            </div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '1rem' }}>
              <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: '0.35rem' }}>Contamination Rate</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{formatPct(view.dashboard.summary.contamination_rate)}</div>
            </div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '1rem' }}>
              <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: '0.35rem' }}>Estimate Variance</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{view.dashboard.summary.mean_variance_lbs} lbs</div>
            </div>
          </div>
        </div>
      ) : null}
      {view.dashboard ? (
        <div className="card mb-2" style={{ padding: responsive.spacing.cardPadding }}>
          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: responsive.isPhone ? '1fr' : '1.2fr 0.8fr' }}>
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Neighborhood Activity</div>
              <div style={{
                position: 'relative',
                height: '260px',
                borderRadius: '18px',
                border: '1px solid var(--border)',
                background: 'radial-gradient(circle at 20% 20%, rgba(0,232,122,0.08), transparent 35%), linear-gradient(180deg, rgba(17,24,17,1) 0%, rgba(10,15,10,1) 100%)',
                overflow: 'hidden',
              }}>
                {hotspotPoints.length ? hotspotPoints.map((point) => (
                  <div
                    key={point.receipt_id}
                    title={`${point.household_name}: ${point.actual_total_lbs} lbs`}
                    style={{
                      position: 'absolute',
                      left: `calc(${point.x}% - ${point.size / 2}px)`,
                      top: `calc(${point.y}% - ${point.size / 2}px)`,
                      width: `${point.size}px`,
                      height: `${point.size}px`,
                      borderRadius: '999px',
                      background: 'rgba(0,232,122,0.28)',
                      border: '1px solid rgba(0,232,122,0.65)',
                      boxShadow: '0 0 18px rgba(0,232,122,0.28)',
                    }}
                  />
                )) : (
                  <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', padding: '1rem' }}>
                    No hotspot points yet. Completed receipts will appear here.
                  </div>
                )}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Material Mix</div>
              <div style={{ display: 'grid', gap: '0.65rem' }}>
                {materialMix.length ? materialMix.map((item) => (
                  <div key={item.type} style={{ border: '1px solid var(--border)', borderRadius: '16px', padding: '0.85rem', background: 'var(--surface)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                      <div style={{ fontWeight: 700 }}>{item.emoji} {item.label}</div>
                      <div style={{ color: 'var(--green)', fontWeight: 700 }}>{item.total_lbs} lbs</div>
                    </div>
                    <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '0.82rem', marginTop: '0.35rem' }}>
                      ${item.total_value} recovered · {item.pickup_count} line items
                    </div>
                  </div>
                )) : (
                  <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)' }}>No material receipts yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {view.dashboard ? (
        <div className="card mb-2" style={{ padding: responsive.spacing.cardPadding }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Latest Diversion Receipts</div>
          {(view.dashboard.latest_receipts || []).length ? (
            <div style={{ display: 'grid', gap: '0.85rem' }}>
              {view.dashboard.latest_receipts.map((receipt) => (
                <div key={receipt.receipt_id} style={{ borderTop: '1px solid var(--border)', paddingTop: '0.85rem' }}>
                  {receipt.completion_media?.signed_url ? (
                    <div style={{ marginBottom: '0.6rem' }}>
                      <img
                        src={receipt.completion_media.signed_url}
                        alt={`Proof for ${receipt.household_name}`}
                        style={{ width: '100%', maxWidth: '240px', height: '140px', objectFit: 'cover', borderRadius: '14px', border: '1px solid var(--border)' }}
                      />
                    </div>
                  ) : null}
                  <div style={{ fontWeight: 700 }}>
                    {receipt.household_name} · {receipt.actual_total_lbs} lbs · ${receipt.actual_total_value}
                  </div>
                  <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '0.88rem', marginTop: '0.25rem' }}>
                    {receipt.receipt_id} · driver {receipt.driver_name} · variance {receipt.variance_lbs} lbs · {formatDateTime(receipt.completed_at)}
                  </div>
                  <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '0.88rem', marginTop: '0.25rem' }}>
                    {receipt.contamination_flags?.length ? `Flags: ${receipt.contamination_flags.join(', ')}` : 'Flags: none'} · capture {receipt.capture_mode || 'manual'} · confidence {formatPct(receipt.estimated_confidence)}
                  </div>
                  {receipt.completion_media?.signed_url ? (
                    <div style={{ marginTop: '0.45rem' }}>
                      <a
                        href={receipt.completion_media.signed_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: '0.82rem' }}
                      >
                        Open signed proof image
                      </a>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)' }}>No verified receipts yet.</div>
          )}
        </div>
      ) : null}
      <div className="card" style={{ padding: responsive.spacing.cardPadding }}>
        <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>How RecycleRun Supports SB 1383</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.88rem', color: 'var(--muted)', lineHeight: 1.9 }}>
          Bin2Bucks now ties household AI estimates to driver-completed diversion receipts. That gives
          city and EPR operators an auditable trail from source capture to completed pickup, instead of
          relying on unverified listing counts alone.
        </div>
      </div>
    </div>
  );
}
