/** Owner: Anisha */
import { MATERIAL_RATES } from '../services/demoData';

export function RatesPage() {
  return (
    <div className="content-area">
      <div className="card">
        <table className="rates-table">
          <thead><tr><th>MATERIAL</th><th>RATE / LB</th><th>10 LBS =</th><th>SOURCE</th></tr></thead>
          <tbody>
            {Object.entries(MATERIAL_RATES).map(([key, mat]) => (
              <tr key={key}>
                <td>{mat.emoji} {mat.label}</td>
                <td style={{ color: mat.rate >= 1 ? 'var(--green)' : 'var(--text)', fontFamily:'var(--mono)' }}>
                  ${mat.rate.toFixed(2)}/lb
                </td>
                <td style={{ fontFamily:'var(--mono)', color:'var(--amber)' }}>${(mat.rate*10).toFixed(2)}</td>
                <td style={{ color:'var(--muted)', fontSize:'0.78rem', fontFamily:'var(--mono)' }}>CalRecycle 2025</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
