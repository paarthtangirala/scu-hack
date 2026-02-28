/**
 * Truck fill % meter.
 * Owner: Anisha
 */
export function TruckMeter({ collectedLbs, earnedDollars, capacityLbs }) {
  const pct = Math.min((collectedLbs / capacityLbs) * 100, 100);
  return (
    <div className="truck-meter">
      <div className="truck-header">
        <span className="truck-title">🚛 Truck Capacity</span>
        <span className="truck-pct">{Math.round(pct)}% full</span>
      </div>
      <div className="progress-wrap">
        <div className="progress-bar" style={{ width: `${pct}%`,
          background: pct > 80 ? 'var(--amber)' : 'var(--green)' }} />
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', marginTop:'0.5rem' }}>
        <span style={{ fontFamily:'var(--mono)', fontSize:'0.78rem', color:'var(--muted)' }}>
          {Math.round(collectedLbs)} lbs collected
        </span>
        <span style={{ fontFamily:'var(--mono)', fontSize:'0.78rem', color:'var(--muted)' }}>
          ${earnedDollars.toFixed(2)} earned so far
        </span>
      </div>
    </div>
  );
}
