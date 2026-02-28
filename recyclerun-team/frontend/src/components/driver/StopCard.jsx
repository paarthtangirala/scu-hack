/**
 * Single stop card in the driver route list.
 * Owner: Anisha
 */
import { MATERIAL_RATES } from '../../services/demoData';
import { Tag } from '../ui/Tag';

export function StopCard({ stop, index, completed, onComplete }) {
  return (
    <div className={`stop-card ${completed ? 'completed-stop' : ''}`}>
      <div className={`stop-num ${completed ? 'done' : ''}`}>
        {completed ? '✓' : index + 1}
      </div>
      <div className="stop-body">
        <div className="stop-addr">{stop.address}</div>
        <div className="stop-meta">
          {stop.household_name} · {stop.distance_from_prev} mi away · {stop.travel_minutes} min drive
        </div>
        {stop.notes && (
          <div className="stop-meta" style={{ color:'var(--amber)', marginTop:'0.2rem' }}>
            💬 {stop.notes}
          </div>
        )}
        <div className="stop-materials">
          {(stop.materials || []).slice(0, 3).map((m, i) => (
            <Tag key={i} color="green">
              {MATERIAL_RATES[m.type]?.emoji || '♻️'} {m.lbs}lb
            </Tag>
          ))}
        </div>
      </div>
      <div className="stop-right">
        <div className="stop-value">${stop.total_value.toFixed(2)}</div>
        <div className="stop-lbs">{stop.total_lbs} lbs</div>
        <div className="stop-eta">ETA +{stop.eta_minutes}min</div>
        {!completed && (
          <button className="btn btn-secondary" style={{ marginTop:'0.5rem', padding:'0.4rem 0.75rem', fontSize:'0.78rem' }}
            onClick={() => onComplete(stop)}>
            ✓ Done
          </button>
        )}
      </div>
    </div>
  );
}
