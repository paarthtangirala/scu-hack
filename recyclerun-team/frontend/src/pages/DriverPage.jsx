/** Owner: Anisha */
import { useEffect, useMemo, useRef, useState } from 'react';
import { RouteBanner } from '../components/driver/RouteBanner';
import { StopCard } from '../components/driver/StopCard';
import { TruckMeter } from '../components/driver/TruckMeter';
import { NotificationOverlay } from '../components/shared/NotificationOverlay';
import { useListings } from '../hooks/useListings';
import { useRoute } from '../hooks/useRoute';
import { DEMO_LISTINGS, MATERIAL_RATES } from '../services/demoData';
import { buildDriverMapModel, DEFAULT_DRIVER_CENTER } from '../services/mapPipeline';

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 380;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeViewport(points, center) {
  const safePoints = Array.isArray(points) ? points : [];
  const maxLatDelta = safePoints.reduce((max, p) => Math.max(max, Math.abs(p.lat - center.lat)), 0);
  const maxLngDelta = safePoints.reduce((max, p) => Math.max(max, Math.abs(p.lng - center.lng)), 0);
  return {
    latSpan: Math.max(0.02, maxLatDelta * 2.4, 0.04),
    lngSpan: Math.max(0.02, maxLngDelta * 2.4, 0.04),
  };
}

function projectToCanvas(point, center, viewport) {
  const minLat = center.lat - viewport.latSpan / 2;
  const maxLat = center.lat + viewport.latSpan / 2;
  const minLng = center.lng - viewport.lngSpan / 2;
  const maxLng = center.lng + viewport.lngSpan / 2;
  const x = ((point.lng - minLng) / Math.max(maxLng - minLng, 1e-9)) * MAP_WIDTH;
  const y = ((maxLat - point.lat) / Math.max(maxLat - minLat, 1e-9)) * MAP_HEIGHT;
  return {
    x: clamp(x, 8, MAP_WIDTH - 8),
    y: clamp(y, 8, MAP_HEIGHT - 8),
  };
}

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
  const [selectedStopIndex, setSelectedStopIndex] = useState(null);
  const stopCardRefs = useRef([]);

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
    reset(); setCompleted(new Set()); setCollectedLbs(0); setEarnedDollars(0); setSelectedStopIndex(null);
  }

  function handleStopCardSelect(index) {
    setSelectedStopIndex(index);
  }

  function handleMapStopSelect(index) {
    setSelectedStopIndex(index);
    const node = stopCardRefs.current[index];
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  const displayListings = listings.length ? listings : DEMO_LISTINGS;
  const mapModel = useMemo(
    () => buildDriverMapModel({
      listings: displayListings,
      route,
      selectedStopIndex,
      fallbackCenter: DEFAULT_DRIVER_CENTER,
    }),
    [displayListings, route, selectedStopIndex]
  );
  const mapPoints = useMemo(
    () => [...mapModel.listingMarkers, ...mapModel.stopMarkers],
    [mapModel]
  );
  const viewport = useMemo(
    () => computeViewport(mapPoints, mapModel.center),
    [mapPoints, mapModel.center]
  );
  const projectedListingMarkers = useMemo(
    () => mapModel.listingMarkers.map((marker) => ({
      ...marker,
      ...projectToCanvas(marker, mapModel.center, viewport),
    })),
    [mapModel.listingMarkers, mapModel.center, viewport]
  );
  const projectedStopMarkers = useMemo(
    () => mapModel.stopMarkers.map((marker) => ({
      ...marker,
      ...projectToCanvas(marker, mapModel.center, viewport),
    })),
    [mapModel.stopMarkers, mapModel.center, viewport]
  );
  const polylinePoints = useMemo(
    () => mapModel.polyline
      .map((point) => projectToCanvas(point, mapModel.center, viewport))
      .map((point) => `${point.x},${point.y}`)
      .join(' '),
    [mapModel.polyline, mapModel.center, viewport]
  );

  useEffect(() => {
    if (!route?.stops?.length) {
      if (selectedStopIndex !== null) setSelectedStopIndex(null);
      return;
    }
    if (selectedStopIndex === null || selectedStopIndex >= route.stops.length) {
      setSelectedStopIndex(0);
    }
  }, [route, selectedStopIndex]);

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

      <div className="card" style={{ marginBottom:'1rem', padding:'1rem' }}>
        <div className="section-label" style={{ marginBottom:'0.65rem' }}>
          DRIVER MAP — LISTINGS, ROUTE, AND STOP SYNC
        </div>
        <div style={{
          position:'relative',
          border:'1px solid var(--border)',
          borderRadius:'14px',
          height:'380px',
          background:'linear-gradient(180deg, rgba(10,16,11,0.95) 0%, rgba(14,24,16,0.92) 100%)',
          overflow:'hidden',
        }}>
          <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} width="100%" height="100%" style={{ position:'absolute', inset:0 }}>
            <defs>
              <pattern id="driver-map-grid" width="60" height="60" patternUnits="userSpaceOnUse">
                <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#driver-map-grid)" />
            {polylinePoints && (
              <polyline
                points={polylinePoints}
                fill="none"
                stroke="rgba(0,232,122,0.95)"
                strokeWidth="4"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
          </svg>

          {projectedListingMarkers.map((marker) => (
            <div
              key={`listing-${marker.id}`}
              title={`${marker.label} (${marker.listing_kind})`}
              style={{
                position:'absolute',
                left:`${(marker.x / MAP_WIDTH) * 100}%`,
                top:`${(marker.y / MAP_HEIGHT) * 100}%`,
                transform:'translate(-50%, -50%)',
                width:'22px',
                height:'22px',
                borderRadius: marker.iconType === 'business' ? '6px' : '50%',
                border:'1px solid rgba(255,255,255,0.28)',
                background: marker.iconType === 'business' ? 'rgba(255,180,0,0.92)' : 'rgba(0,232,122,0.92)',
                color:'#09120d',
                display:'flex',
                alignItems:'center',
                justifyContent:'center',
                fontSize:'0.73rem',
                fontWeight:700,
                zIndex:4,
              }}
            >
              {marker.iconType === 'business' ? 'B' : 'H'}
            </div>
          ))}

          {projectedStopMarkers.map((marker) => (
            <button
              key={`stop-${marker.id}`}
              onClick={() => handleMapStopSelect(marker.index)}
              title={`Stop ${marker.orderNumber} — ${marker.address}`}
              style={{
                position:'absolute',
                left:`${(marker.x / MAP_WIDTH) * 100}%`,
                top:`${(marker.y / MAP_HEIGHT) * 100}%`,
                transform:'translate(-50%, -50%)',
                width:'28px',
                height:'28px',
                borderRadius:'50%',
                border: marker.isSelected ? '2px solid var(--amber)' : '2px solid rgba(255,255,255,0.75)',
                background: marker.isSelected ? 'var(--amber)' : 'rgba(17,26,19,0.95)',
                color: marker.isSelected ? '#1f1200' : '#ffffff',
                fontWeight:800,
                fontSize:'0.8rem',
                cursor:'pointer',
                zIndex:6,
              }}
            >
              {marker.orderNumber}
            </button>
          ))}
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', gap:'0.6rem', marginTop:'0.6rem', flexWrap:'wrap' }}>
          <span style={{ fontFamily:'var(--mono)', fontSize:'0.74rem', color:'var(--muted)' }}>
            H pin = household listing, B pin = business listing
          </span>
          <span style={{ fontFamily:'var(--mono)', fontSize:'0.74rem', color:'var(--muted)' }}>
            Focus: {mapModel.selectedStopIndex === null ? 'Map center' : `Stop ${mapModel.selectedStopIndex + 1}`}
          </span>
          <span style={{ fontFamily:'var(--mono)', fontSize:'0.74rem', color:'var(--muted)' }}>
            Pins: {mapModel.listingMarkers.length} listings · {mapModel.stopMarkers.length} route stops
          </span>
        </div>
      </div>

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
              <div
                key={stop.id || stop.listing_id}
                ref={(node) => { stopCardRefs.current[i] = node; }}
                onClick={() => handleStopCardSelect(i)}
                style={{
                  borderRadius:'12px',
                  boxShadow: selectedStopIndex === i ? '0 0 0 2px rgba(255,184,0,0.45)' : 'none',
                }}
              >
                <StopCard
                  stop={stop}
                  index={i}
                  completed={completed.has(stop.id || stop.listing_id)}
                  onComplete={handleComplete}
                />
              </div>
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
