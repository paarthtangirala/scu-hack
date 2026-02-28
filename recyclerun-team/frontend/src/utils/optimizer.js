/**
 * Client-side route optimizer (mirrors backend Python logic).
 * Used as fallback when backend is unavailable.
 * Owner: Sara
 */
const MPH = 25;
const STOP_TIME = 5; // minutes per stop

export function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.8, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export function optimizeRoute({ driverLat, driverLng, listings, maxMinutes, truckCapacityLbs = 1000 }) {
  const available = listings.filter(l => l.status === 'available');
  const route = [], visited = new Set();
  let curLat = driverLat, curLng = driverLng;
  let remainingCap = truckCapacityLbs, remainingTime = maxMinutes;

  while (true) {
    let best = null, bestScore = -1, bestDist = 0, bestTravel = 0;

    for (const l of available) {
      if (visited.has(l.id) || l.total_lbs > remainingCap) continue;
      const dist = haversine(curLat, curLng, l.lat, l.lng);
      const travel = (dist / MPH) * 60;
      const total = travel + STOP_TIME;
      if (total > remainingTime) continue;
      const score = l.total_value / Math.max(total, 0.01);
      if (score > bestScore) { best = l; bestScore = score; bestDist = dist; bestTravel = travel; }
    }
    if (!best) break;

    const cumulativeMin = route.reduce((a, s) => a + s.travel_minutes + STOP_TIME, 0) + bestTravel + STOP_TIME;
    route.push({
      ...best,
      listing_id: best.id,
      distance_from_prev: Math.round(bestDist * 10) / 10,
      travel_minutes: Math.round(bestTravel * 10) / 10,
      eta_minutes: Math.round(cumulativeMin),
    });
    visited.add(best.id);
    remainingCap -= best.total_lbs;
    remainingTime -= (bestTravel + STOP_TIME);
    curLat = best.lat; curLng = best.lng;
  }

  const totalLbs = route.reduce((a, s) => a + s.total_lbs, 0);
  return {
    stops: route,
    summary: {
      total_stops: route.length,
      total_value: Math.round(route.reduce((a, s) => a + s.total_value, 0) * 100) / 100,
      total_lbs: Math.round(totalLbs * 10) / 10,
      total_miles: Math.round(route.reduce((a, s) => a + s.distance_from_prev, 0) * 10) / 10,
      truck_fill_pct: Math.round((totalLbs / truckCapacityLbs) * 1000) / 10,
      estimated_minutes: Math.round(route.reduce((a, s) => a + s.travel_minutes + STOP_TIME, 0)),
    }
  };
}
