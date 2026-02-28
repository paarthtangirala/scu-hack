/** Owner: Anisha */
import { useState, useEffect } from 'react';
import { api } from '../services/api';

export function ImpactPage() {
  const [stats, setStats] = useState(null);
  useEffect(() => { api.getImpact().then(d => d && setStats(d)); }, []);

  const cards = stats ? [
    { icon:'🔁', num: stats.completed_pickups,              label:'Completed pickups' },
    { icon:'⚖️', num: stats.total_lbs_diverted + ' lbs',    label:'Lbs diverted from landfill' },
    { icon:'💰', num: '$' + stats.total_value_paid,         label:'Paid to drivers' },
    { icon:'🌱', num: stats.co2_saved_tons + ' tons',        label:'CO₂ saved vs. landfill' },
  ] : [];

  return (
    <div className="content-area">
      <div className="impact-grid mb-2">
        {cards.map(c => (
          <div key={c.label} className="impact-card">
            <div className="impact-icon">{c.icon}</div>
            <div className="impact-num">{c.num}</div>
            <div className="impact-label">{c.label}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <div style={{ fontSize:'1rem', fontWeight:700, marginBottom:'1rem' }}>How RecycleRun Supports SB 1383</div>
        <div style={{ fontFamily:'var(--mono)', fontSize:'0.88rem', color:'var(--muted)', lineHeight:1.9 }}>
          California's SB 1383 mandates 75% reduction in organic and recyclable waste sent to landfills.
          RecycleRun captures recyclable overflow between weekly city pickup days — the cardboard from
          Amazon deliveries, aluminum from weekend parties, e-waste from home offices. Every pound
          collected is a pound that doesn't generate methane in a landfill.
        </div>
      </div>
    </div>
  );
}
