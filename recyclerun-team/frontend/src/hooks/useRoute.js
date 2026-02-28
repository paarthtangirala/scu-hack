/**
 * Custom hook for driver route state.
 * Owner: Sara
 */
import { useState } from 'react';
import { api } from '../services/api';
import { optimizeRoute } from '../utils/optimizer';
import { DEMO_LISTINGS } from '../services/demoData';

export function useRoute(listings) {
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [notifications, setNotifications] = useState([]);

  const build = async ({ lat, lng, maxMinutes, truckCapacity, objective }) => {
    setLoading(true);
    const data = await api.optimizeRoute({ lat, lng, maxMinutes, truckCapacity, objective });
    if (data?.stops) {
      setRoute(data);
    } else {
      // client-side fallback
      setRoute(optimizeRoute({ driverLat: lat, driverLng: lng,
        listings: listings.length ? listings : DEMO_LISTINGS,
        maxMinutes, truckCapacityLbs: truckCapacity, objective }));
    }
    setLoading(false);
  };

  const accept = async (driverName) => {
    if (!route) return;
    setLoading(true);
    const data = await api.acceptRoute({ stops: route.stops, driverName });
    setNotifications(data?.notifications || route.stops.map((s, i) => ({
      household: s.household_name, eta_minutes: s.eta_minutes,
      notification: { mode: 'demo', message: `${driverName} arriving in ${s.eta_minutes} min` }
    })));
    setAccepted(true);
    setLoading(false);
  };

  const reset = () => { setRoute(null); setAccepted(false); setNotifications([]); };

  return { route, loading, accepted, notifications, build, accept, reset };
}
