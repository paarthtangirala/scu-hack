/**
 * Custom hook for driver route state.
 * Owner: Sara
 */
import { useState } from 'react';
import { api } from '../services/api';
import { DEMO_LISTINGS } from '../services/demoData';
import { resolveOptimizedRoute } from '../services/mapPipeline';
import { summarizeAcceptFailures } from '../services/stopCompletion';

export function useRoute(listings) {
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [acceptSummary, setAcceptSummary] = useState({
    totalStopsRequested: 0,
    notificationsSent: 0,
    failedNotificationsCount: 0,
    failedStops: [],
  });

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
    if (response?.ok && response?.data) {
      const backendNotifications = Array.isArray(response.data.notifications)
        ? response.data.notifications
        : [];
      setNotifications(backendNotifications);
      setAcceptSummary(summarizeAcceptFailures(response.data, route.stops));
    } else {
      const fallbackNotifications = route.stops.map((s) => ({
        household: s.household_name, eta_minutes: s.eta_minutes,
        notification: { mode: 'demo', message: `${driverName} arriving in ${s.eta_minutes} min` }
      }));
      setNotifications(fallbackNotifications);
      setAcceptSummary({
        totalStopsRequested: route.stops.length,
        notificationsSent: route.stops.length,
        failedNotificationsCount: 0,
        failedStops: [],
      });
    }
    setAccepted(true);
    setLoading(false);
  };

  const reset = () => {
    setRoute(null);
    setAccepted(false);
    setNotifications([]);
    setAcceptSummary({
      totalStopsRequested: 0,
      notificationsSent: 0,
      failedNotificationsCount: 0,
      failedStops: [],
    });
  };

  return { route, loading, accepted, notifications, acceptSummary, build, accept, reset };
}
