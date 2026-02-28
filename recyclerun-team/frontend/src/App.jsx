/**
 * RecycleRun — Main App
 * Owner: Anisha (routing / shell)
 */
import { useState } from 'react';
import { HomePage }      from './pages/HomePage';
import { HouseholdPage } from './pages/HouseholdPage';
import { DriverPage }    from './pages/DriverPage';
import { ImpactPage }    from './pages/ImpactPage';
import { RatesPage }     from './pages/RatesPage';
import { Toast }         from './components/ui/Toast';

const PAGES = { home: HomePage, household: HouseholdPage, driver: DriverPage, impact: ImpactPage, rates: RatesPage };
const PAGE_TITLES = { home:'Home', household:'📦 Give', driver:'🚛 Drive', impact:'🌱 Impact', rates:'💰 Rates' };

export default function App() {
  const [page, setPage] = useState('home');
  const [toast, setToast] = useState(null);
  const Page = PAGES[page] || HomePage;

  return (
    <div className="app">
      <header>
        <div className="logo"><div className="logo-icon">♻️</div>Recycle<span>Run</span></div>
        <nav>
          {Object.entries(PAGE_TITLES).map(([key, label]) => (
            <button key={key} className={`nav-btn ${page === key ? 'active' : ''}`} onClick={() => setPage(key)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {page !== 'home' && (
          <div className="page-header">
            <div className="page-title">{PAGE_TITLES[page]}</div>
          </div>
        )}
        <Page onNavigate={setPage} onToast={setToast} />
      </main>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
