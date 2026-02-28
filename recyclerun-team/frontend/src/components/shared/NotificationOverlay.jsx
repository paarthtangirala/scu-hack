/**
 * Post-accept overlay showing ElevenLabs call status per household.
 * Owner: Anisha
 */
export function NotificationOverlay({ notifications, onClose }) {
  return (
    <div className="notif-overlay">
      <div className="notif-box">
        <div className="notif-icon">📞</div>
        <div className="notif-title">Route Accepted!</div>
        <div className="notif-sub">
          ElevenLabs voice calls sent to all {notifications.length} households
        </div>
        <div className="notif-list">
          {notifications.map((n, i) => {
            const mode = n.notification?.mode;
            return (
              <div key={i} className="notif-item">
                <span>{n.household} · ETA {n.eta_minutes}min</span>
                <span style={{ color: mode === 'live' ? 'var(--green)' : 'var(--amber)' }}>
                  {mode === 'live' ? '✓ Called' : '📞 Demo call'}
                </span>
              </div>
            );
          })}
        </div>
        <button className="btn btn-primary btn-full" onClick={onClose}>
          Start Route →
        </button>
      </div>
    </div>
  );
}
