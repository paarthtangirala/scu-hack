/** Owner: Anisha */
import { useState } from 'react';
import { RouteBanner } from '../components/driver/RouteBanner';
import { StopCard } from '../components/driver/StopCard';
import { TruckMeter } from '../components/driver/TruckMeter';
import { NotificationOverlay } from '../components/shared/NotificationOverlay';
import { useListings } from '../hooks/useListings';
import { useRoute } from '../hooks/useRoute';
import { DEMO_LISTINGS, MATERIAL_RATES } from '../services/demoData';

export function DriverPage({ onToast }) {
  const { listings } = useListings();
  const { route, loading, accepted, notifications, build, accept, reset } = useRoute(listings);
  const [driverName, setDriverName] = useState('Alex (Driver)');
  const [maxMin, setMaxMin] = useState(120);
  const [capacity, setCapacity] = useState(1000);
  const [objective, setObjective] = useState('lbs');
  const [completed, setCompleted] = useState(new Set());
  const [collectedLbs, setCollectedLbs] = useState(0);
  const [earnedDollars, setEarnedDollars] = useState(0);
  const [showNotif, setShowNotif] = useState(false);

  async function handleBuild() {
    await build({ lat: 37.3541, lng: -121.9552, maxMinutes: maxMin, truckCapacity: capacity, objective });
  }

  async function handleAccept() {
    await accept(driverName);
    setShowNotif(true);
  }

  function handleComplete(stop) {
    const key = stop.id || stop.listing_id;
    if (completed.has(key)) return;
    const next = new Set(completed); next.add(key);
    setCompleted(next);
    setCollectedLbs(p => p + stop.total_lbs);
    setEarnedDollars(p => p + stop.total_value);
    const msg = objective === 'lbs'
      ? `✅ Stop done! +${stop.total_lbs} lbs collected`
      : `✅ Stop done! +$${stop.total_value.toFixed(2)} earned`;
    onToast(msg);
  }

  function handleReset() {
    reset(); setCompleted(new Set()); setCollectedLbs(0); setEarnedDollars(0);
  }

  const displayListings = listings.length ? listings : DEMO_LISTINGS;

  return (
    <div className="content-area">
      {showNotif && notifications.length > 0 && (
        <NotificationOverlay notifications={notifications} onClose={() => setShowNotif(false)} />
      )}

      <div className="driver-controls">
        <div className="control-card"><div className="control-label">YOUR NAME</div>
          <input value={driverName} onChange={e => setDriverName(e.target.value)} /></div>
        <div className="control-card"><div className="control-label">OPTIMIZE FOR</div>
          <select value={objective} onChange={e => setObjective(e.target.value)}>
            <option value="lbs">♻️ Max pounds / min</option>
            <option value="value">💵 Max dollars / min</option>
          </select></div>
        <div className="control-card"><div className="control-label">MAX DRIVE TIME</div>
          <select value={maxMin} onChange={e => setMaxMin(+e.target.value)}>
            {[60,120,180,240].map(v => <option key={v} value={v}>{v/60}h</option>)}</select></div>
        <div className="control-card"><div className="control-label">TRUCK CAPACITY</div>
          <select value={capacity} onChange={e => setCapacity(+e.target.value)}>
            <option value={500}>0.5 ton</option><option value={1000}>1 ton</option><option value={2000}>2 ton</option>
          </select></div>
      </div>

      <button className="btn btn-primary btn-lg btn-full" onClick={handleBuild} disabled={loading}
        style={{ marginBottom:'1rem' }}>
        {loading ? '⚡ Optimizing...' : '⚡ Build Optimized Route'}
      </button>

      {route && <RouteBanner summary={route.summary} onAccept={handleAccept} accepting={loading} />}

      {route && accepted && (
        <TruckMeter collectedLbs={collectedLbs} earnedDollars={earnedDollars} capacityLbs={capacity} />
      )}

      {route?.stops?.length > 0 && (
        <div className="mt-2">
          <div className="section-label" style={{ marginBottom:'1rem' }}>
            ROUTE STOPS — OPTIMIZED BY {objective === 'lbs' ? 'LBS/MIN (FASTEST FILL)' : '$/MIN'}
          </div>
          <div className="stop-list">
            {route.stops.map((stop, i) => (
              <StopCard key={stop.id || stop.listing_id} stop={stop} index={i}
                completed={completed.has(stop.id || stop.listing_id)} onComplete={handleComplete} />
            ))}
          </div>
          <button className="btn btn-secondary btn-full mt-2" onClick={handleReset}>↺ Reset & New Route</button>
        </div>
      )}

      <div className="mt-2">
        <div className="section-label" style={{ marginBottom:'1rem' }}>AVAILABLE LISTINGS ({displayListings.filter(l=>l.status==='available').length})</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:'0.75rem' }}>
          {displayListings.filter(l => l.status === 'available').map(l => (
            <div key={l.id} className="card" style={{ padding:'1rem' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.5rem' }}>
                <span style={{ fontWeight:700, fontSize:'0.9rem' }}>
                  {l.listing_kind === 'business' ? `🏪 ${l.household_name}` : l.household_name}
                </span>
                <span style={{ fontFamily:'var(--mono)', color:'var(--green)', fontSize:'1rem' }}>${l.total_value.toFixed(2)}</span>
              </div>
              <div style={{ fontFamily:'var(--mono)', fontSize:'0.78rem', color:'var(--muted)', marginBottom:'0.5rem' }}>📍 {l.address}</div>
              <div style={{ display:'flex', gap:'0.3rem', flexWrap:'wrap' }}>
                {(l.materials||[]).slice(0,3).map((m,i) =>
                  <span key={i} className="tag tag-green">{MATERIAL_RATES[m.type]?.emoji||'♻️'} {m.lbs}lb</span>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
