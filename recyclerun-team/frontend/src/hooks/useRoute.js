/**
 * Custom hook for driver route state.
 * Owner: Sara
 */
import { useState } from 'react';
import { api } from '../services/api';
import { DEMO_LISTINGS } from '../services/demoData';
import { resolveOptimizedRoute } from '../services/mapPipeline';

export function useRoute(listings) {
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [notifications, setNotifications] = useState([]);

  const build = async ({ lat, lng, maxMinutes, truckCapacity, objective }) => {
    setLoading(true);
    const { route: nextRoute } = await resolveOptimizedRoute({
      lat,
      lng,
      maxMinutes,
      truckCapacity,
      objective,
      listings,
      fallbackListings: DEMO_LISTINGS,
    });
    setRoute(nextRoute);
    setLoading(false);
  };

  const accept = async (driverName) => {
    if (!route) return;
    setLoading(true);
    const response = await api.acceptRoute({ stops: route.stops, driverName });
    const backendNotifications = response?.ok && Array.isArray(response?.data?.notifications)
      ? response.data.notifications
      : null;
    setNotifications(backendNotifications || route.stops.map((s) => ({
      household: s.household_name, eta_minutes: s.eta_minutes,
      notification: { mode: 'demo', message: `${driverName} arriving in ${s.eta_minutes} min` }
    })));
    setAccepted(true);
    setLoading(false);
  };

  const reset = () => { setRoute(null); setAccepted(false); setNotifications([]); };

  return { route, loading, accepted, notifications, build, accept, reset };
}
