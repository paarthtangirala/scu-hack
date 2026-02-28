/** Owner: Anisha */
export function HomePage({ onNavigate }) {
  return (
    <div className="hero">
      <div className="hero-bg" />
      <div className="hero-grid" />
      <div className="hero-content">
        <div className="hero-badge"><div className="pulse" />15 active listings · Bay Area</div>
        <h1>Recycle Smarter.<br /><em>Earn More.</em></h1>
        <p className="hero-sub">
          Post your recyclables. Drivers get a pre-optimized bundle route —<br />
          maximizing $/mile before they leave home.
        </p>
        <div className="cta-row">
          <button className="cta-btn primary" onClick={() => onNavigate('household')}>📦 I have recyclables</button>
          <button className="cta-btn secondary" onClick={() => onNavigate('driver')}>🚛 I want to collect</button>
        </div>
        <div className="stats-bar">
          {[['15','ACTIVE LISTINGS'],['$94','AVG ROUTE EARNINGS'],['687','LBS DIVERTED THIS WEEK'],['12','MATERIAL TYPES']].map(([n,l])=>(
            <div className="stat" key={l}><span className="stat-num">{n}</span><span className="stat-label">{l}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}
