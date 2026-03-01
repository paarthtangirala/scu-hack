/**
 * Custom hook for driver route state.
 * Owner: Sara
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { DEMO_LISTINGS } from '../services/demoData';
import { resolveOptimizedRoute } from '../services/mapPipeline';
import { summarizeAcceptFailures } from '../services/stopCompletion';
import {
  normalizeAcceptSummary,
  normalizeNotificationsForRender,
  normalizeRouteForRender,
  normalizeRouteStopsForRender,
  runSafeAsync,
  safeString,
} from '../services/stabilization';

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
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const build = async ({ lat, lng, maxMinutes, truckCapacity, objective }) => {
    if (mountedRef.current) {
      setLoading(true);
    }

    const result = await runSafeAsync(
      () => resolveOptimizedRoute({
        lat,
        lng,
        maxMinutes,
        truckCapacity,
        objective,
        listings,
        fallbackListings: DEMO_LISTINGS,
      }),
      { route: null, source: 'error' }
    );

    const safeRoute = normalizeRouteForRender(result?.route);
    if (mountedRef.current) {
      setRoute(safeRoute);
      setLoading(false);
    }

    return result;
  };

  const accept = async (driverName) => {
    const routeStops = normalizeRouteStopsForRender(route?.stops);
    if (!routeStops.length) {
      return { ok: false, status: 0, error: 'No route stops available' };
    }

    if (mountedRef.current) {
      setLoading(true);
    }

    const response = await runSafeAsync(
      () => api.acceptRoute({ stops: routeStops, driverName: safeString(driverName, 'Driver') }),
      { ok: false, status: 0, error: 'Unable to accept route' }
    );

    if (response?.ok && response?.data) {
      const backendNotifications = normalizeNotificationsForRender(response.data.notifications);
      if (mountedRef.current) {
        setNotifications(backendNotifications);
        setAcceptSummary(normalizeAcceptSummary(summarizeAcceptFailures(response.data, routeStops)));
      }
    } else {
      const fallbackNotifications = normalizeNotificationsForRender(routeStops.map((stop) => ({
        listing_id: stop.listing_id,
        household: stop.household_name,
        eta_minutes: stop.eta_minutes,
        notification: { mode: 'demo', message: `${safeString(driverName, 'Driver')} arriving in ${stop.eta_minutes} min` },
      })));
      if (mountedRef.current) {
        setNotifications(fallbackNotifications);
        setAcceptSummary({
          totalStopsRequested: routeStops.length,
          notificationsSent: routeStops.length,
          failedNotificationsCount: 0,
          failedStops: [],
        });
      }
    }

    if (mountedRef.current) {
      setAccepted(true);
      setLoading(false);
    }

    return response;
  };

  const reset = () => {
    if (!mountedRef.current) {
      return;
    }
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
