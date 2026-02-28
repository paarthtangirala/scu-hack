/**
 * Route summary banner shown after optimization.
 * Owner: Anisha
 */
export function RouteBanner({ summary, onAccept, accepting }) {
  if (!summary) return null;
  const objective = (summary.objective || 'value').toString().toLowerCase();
  return (
    <div className="route-banner">
      <div className="route-stats">
        {[
          { val: summary.total_stops, lbl: 'STOPS' },
          { val: summary.total_miles, lbl: 'MILES' },
          { val: summary.estimated_minutes + ' min', lbl: 'EST. TIME' },
          { val: `${summary.total_lbs} lbs`, lbl: 'DIVERTED', green: true },
          { val: `${summary.lbs_per_hour} lb/hr`, lbl: 'RATE' },
          ...(objective === 'value'
            ? [{ val: `$${summary.total_value.toFixed(2)}`, lbl: 'EST. EARNINGS', green: true }]
            : []),
        ].map(({ val, lbl, green }) => (
          <div key={lbl} className="route-stat">
            <span className="val" style={green ? { color:'var(--green)' } : {}}>{val}</span>
            <span className="lbl">{lbl}</span>
          </div>
        ))}
      </div>
      <button className="btn btn-primary btn-lg" onClick={onAccept} disabled={accepting}>
        {accepting ? '📞 Notifying households...' : '✅ Accept Route'}
      </button>
    </div>
  );
}
