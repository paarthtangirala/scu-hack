import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "../services/api";
import { GOOGLE_MAPS_API_KEY } from "../config";
import { Card, PrimaryButton, SectionKicker, SecondaryButton, StatPill, colors } from "../components/ui";

let MapViewComponent = null;
let MarkerComponent = null;
let PolylineComponent = null;
let ProviderGoogle = null;
if (Platform.OS !== "web") {
  const maps = require("react-native-maps");
  MapViewComponent = maps.default;
  MarkerComponent = maps.Marker;
  PolylineComponent = maps.Polyline;
  ProviderGoogle = maps.PROVIDER_GOOGLE;
}

const OBJECTIVES = [
  { key: "value", label: "Max Earnings", icon: "currency-usd" },
  { key: "lbs", label: "Max Impact", icon: "weight-kilogram" },
];
const MAX_MINUTES_OPTIONS = [60, 120, 180, 240];
const CAPACITY_OPTIONS = [500, 1000, 2000];
const DRIVER_START = { latitude: 37.3541, longitude: -121.9552 };
const GOOGLE_DIRECTIONS_BASE_URL = "https://maps.googleapis.com/maps/api/directions/json";
const GOOGLE_DIRECTIONS_MAX_STOPS = 23;
const EXTERNAL_NAV_MAX_STOPS = 10;
const PLACEHOLDER_COLOR = "rgba(120, 145, 122, 0.8)";

function nextRequestId() {
  return `mobile-accept-${Date.now()}`;
}

function formatApiFailure(action, response) {
  const hint = response?.hint ? ` ${response.hint}` : "";
  return `${action} failed: ${response?.error || "Request failed"}${hint}`;
}

function stopCoordinate(stop) {
  const lat = Number(stop?.lat);
  const lng = Number(stop?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
}

function fallbackRouteCoordinates(stops) {
  const unique = [{ ...DRIVER_START }];
  stops.forEach((point) => {
    const prev = unique[unique.length - 1];
    if (!prev || prev.latitude !== point.latitude || prev.longitude !== point.longitude) {
      unique.push(point);
    }
  });
  return unique;
}

function decodeGooglePolyline(encoded) {
  if (!encoded || typeof encoded !== "string") return [];
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < encoded.length);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < encoded.length);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

function computeRouteRegion(points) {
  if (!points.length) {
    return {
      latitude: DRIVER_START.latitude,
      longitude: DRIVER_START.longitude,
      latitudeDelta: 0.08,
      longitudeDelta: 0.08,
    };
  }
  const lats = points.map((point) => point.latitude);
  const lngs = points.map((point) => point.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.03, (maxLat - minLat) * 1.8),
    longitudeDelta: Math.max(0.03, (maxLng - minLng) * 1.8),
  };
}

function buildExternalNavigationUrl(stops) {
  const navStops = (stops || [])
    .map(stopCoordinate)
    .filter(Boolean)
    .slice(0, EXTERNAL_NAV_MAX_STOPS);
  if (!navStops.length) return "";

  if (Platform.OS === "ios") {
    const daddr = navStops.map((point) => `${point.latitude},${point.longitude}`).join(" to:");
    return `http://maps.apple.com/?saddr=Current%20Location&daddr=${encodeURIComponent(daddr)}&dirflg=d`;
  }

  const origin = `${DRIVER_START.latitude},${DRIVER_START.longitude}`;
  const destination = navStops[navStops.length - 1];
  const waypoints = navStops
    .slice(0, navStops.length - 1)
    .map((point) => `${point.latitude},${point.longitude}`)
    .join("|");
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination: `${destination.latitude},${destination.longitude}`,
    travelmode: "driving",
  });
  if (waypoints) params.append("waypoints", waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function DriverScreen() {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [driverName, setDriverName] = useState("Alex Driver");
  const [objective, setObjective] = useState("lbs");
  const [maxMinutes, setMaxMinutes] = useState(120);
  const [capacity, setCapacity] = useState(1000);
  const [listings, setListings] = useState([]);
  const [route, setRoute] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [completedIds, setCompletedIds] = useState({});
  const [collectedLbs, setCollectedLbs] = useState(0);
  const [earnedValue, setEarnedValue] = useState(0);
  const [routePolyline, setRoutePolyline] = useState([]);
  const [routeMapMessage, setRouteMapMessage] = useState("");

  const loadListings = useCallback(async () => {
    const response = await api.getListings("available");
    if (response.ok) {
      setListings(response.data?.listings || []);
      return;
    }
    setMessage(formatApiFailure("Load listings", response));
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await loadListings();
    setRefreshing(false);
  }, [loadListings]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  const hydrateRouteMap = useCallback(async (stops) => {
    const coordinates = (stops || []).map(stopCoordinate).filter(Boolean);
    if (!coordinates.length) {
      setRoutePolyline([]);
      setRouteMapMessage("");
      return;
    }

    const limitedCoordinates = coordinates.slice(0, GOOGLE_DIRECTIONS_MAX_STOPS);
    const truncated = coordinates.length > GOOGLE_DIRECTIONS_MAX_STOPS;
    const fallbackCoordinates = fallbackRouteCoordinates(limitedCoordinates);

    if (!GOOGLE_MAPS_API_KEY) {
      setRoutePolyline(fallbackCoordinates);
      setRouteMapMessage("Google Maps API key missing. Showing straight-line preview.");
      return;
    }

    try {
      const destination = limitedCoordinates[limitedCoordinates.length - 1];
      const waypointPoints = limitedCoordinates
        .slice(0, limitedCoordinates.length - 1)
        .map((point) => `${point.latitude},${point.longitude}`);

      const params = new URLSearchParams({
        origin: `${DRIVER_START.latitude},${DRIVER_START.longitude}`,
        destination: `${destination.latitude},${destination.longitude}`,
        mode: "driving",
        key: GOOGLE_MAPS_API_KEY,
      });
      if (waypointPoints.length) {
        params.append("waypoints", waypointPoints.join("|"));
      }

      const response = await fetch(`${GOOGLE_DIRECTIONS_BASE_URL}?${params.toString()}`);
      const data = await response.json();
      const encodedPolyline = data?.routes?.[0]?.overview_polyline?.points || "";
      const decoded = decodeGooglePolyline(encodedPolyline);

      if (!response.ok || data?.status !== "OK" || decoded.length < 2) {
        const status = data?.status || "unknown";
        const details = data?.error_message ? ` (${data.error_message})` : "";
        setRoutePolyline(fallbackCoordinates);
        setRouteMapMessage(
          `Google Directions unavailable (${status}${details}). Showing straight-line preview.` +
            (truncated ? " Showing first 23 stops only." : ""),
        );
        return;
      }

      setRoutePolyline(decoded);
      setRouteMapMessage(
        `Google Directions route loaded for ${limitedCoordinates.length} stop(s).` +
          (truncated ? " Showing first 23 stops only." : ""),
      );
    } catch (error) {
      setRoutePolyline(fallbackCoordinates);
      setRouteMapMessage(
        `Failed to load Google Directions (${error?.message || "network error"}). Showing straight-line preview.` +
          (truncated ? " Showing first 23 stops only." : ""),
      );
    }
  }, []);

  const buildRoute = async () => {
    setLoading(true);
    setMessage("");
    const response = await api.optimizeRoute({
      lat: 37.3541,
      lng: -121.9552,
      maxMinutes,
      truckCapacity: capacity,
      objective,
    });
    setLoading(false);
    if (!response.ok) {
      setMessage(formatApiFailure("Optimize", response));
      return;
    }
    setRoute(response.data);
    hydrateRouteMap(response.data?.stops || []);
    setAccepted(false);
    setCompletedIds({});
    setCollectedLbs(0);
    setEarnedValue(0);
  };

  const acceptRoute = async () => {
    if (!route?.stops?.length) {
      return;
    }
    setLoading(true);
    const response = await api.acceptRoute({
      stops: route.stops.map((stop) => ({
        listing_id: stop.listing_id || stop.id,
        eta_minutes: stop.eta_minutes || 30,
      })),
      driverName,
      requestId: nextRequestId(),
    });
    setLoading(false);
    if (!response.ok) {
      setMessage(formatApiFailure("Accept route", response));
      return;
    }
    setAccepted(true);
    const notifications = response.data?.notifications || [];
    const claimed = Number(response.data?.claimed_count || 0);
    const sent = Number(
      response.data?.notifications_sent ??
      notifications.filter((item) => item?.notification?.success).length
    );
    const skipped = Number(
      response.data?.skipped_count ??
      notifications.filter((item) => item?.notification?.mode === "skipped").length
    );
    const failed = Number(
      response.data?.notifications_failed ??
      notifications.filter((item) => item?.status_code === "notification_failed").length
    );

    let routeMessage = `Route accepted. Claimed: ${claimed}, sent: ${sent}, failed: ${failed}, skipped: ${skipped}`;
    if (failed > 0 && sent === 0) {
      routeMessage += ". Voice calls failed (likely Twilio verification or credentials).";
    }
    setMessage(routeMessage);
  };

  const completeStop = async (stop) => {
    const listingId = stop.listing_id || stop.id;
    if (completedIds[listingId]) {
      return;
    }
    const response = await api.completeListing(listingId);
    if (!response.ok) {
      setMessage(formatApiFailure("Complete stop", response));
      return;
    }
    setCompletedIds((prev) => ({ ...prev, [listingId]: true }));
    setCollectedLbs((prev) => prev + Number(stop.total_lbs || 0));
    setEarnedValue((prev) => prev + Number(stop.total_value || 0));
  };

  const routeSummary = route?.summary || {};
  const routeStops = route?.stops || [];
  const routeStopCoordinates = useMemo(
    () => routeStops.map(stopCoordinate).filter(Boolean),
    [routeStops],
  );
  const mapTitle = Platform.OS === "ios" ? "Route Map (Apple basemap + Google Directions)" : "Route Map (Google Maps)";
  const mapCoordinates = useMemo(
    () => (routePolyline.length ? routePolyline : fallbackRouteCoordinates(routeStopCoordinates)),
    [routePolyline, routeStopCoordinates],
  );
  const mapRegion = useMemo(() => computeRouteRegion(mapCoordinates), [mapCoordinates]);
  const availableCount = useMemo(() => listings.filter((item) => item.status === "available").length, [listings]);
  const openExternalNavigation = useCallback(async () => {
    const url = buildExternalNavigationUrl(routeStops);
    if (!url) {
      setMessage("Build a route first to open turn-by-turn navigation.");
      return;
    }
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        setMessage("Could not open Maps on this device.");
        return;
      }
      await Linking.openURL(url);
      if (routeStops.length > EXTERNAL_NAV_MAX_STOPS) {
        setMessage(
          `Opened Maps with first ${EXTERNAL_NAV_MAX_STOPS} stops to keep navigation stable. Continue remaining stops from Route Stops list.`,
        );
      }
    } catch (error) {
      setMessage(`Failed to open navigation app: ${error?.message || "unknown error"}`);
    }
  }, [routeStops]);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <Text style={styles.pageTitle}>Driver Dashboard</Text>
      <Text style={styles.pageSubtitle}>Find the best route for your truck.</Text>

      <Card>
        <View style={styles.kickerRow}>
          <MaterialCommunityIcons name="chart-box-outline" size={16} color={colors.primary} />
          <SectionKicker title="Optimization Goal" />
        </View>
        <Text style={styles.label}>Driver Name</Text>
        <TextInput
          value={driverName}
          onChangeText={setDriverName}
          placeholderTextColor={PLACEHOLDER_COLOR}
          style={styles.input}
        />
        <View style={styles.optionRow}>
          {OBJECTIVES.map((item) => (
            <Pressable
              key={item.key}
              style={[styles.option, objective === item.key ? styles.optionActive : null]}
              onPress={() => setObjective(item.key)}
            >
              <MaterialCommunityIcons
                name={item.icon}
                size={16}
                color={objective === item.key ? colors.primary : colors.muted}
              />
              <Text style={objective === item.key ? styles.optionTextActive : styles.optionText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.kickerRow}>
          <MaterialCommunityIcons name="clock-outline" size={16} color={colors.primary} />
          <SectionKicker title="Route Time Budget" />
        </View>
        <Text style={styles.label}>Max Minutes</Text>
        <View style={styles.optionRow}>
          {MAX_MINUTES_OPTIONS.map((value) => (
            <Pressable
              key={value}
              style={[styles.option, maxMinutes === value ? styles.optionActive : null]}
              onPress={() => setMaxMinutes(value)}
            >
              <Text style={maxMinutes === value ? styles.optionTextActive : styles.optionText}>{value}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.kickerRow}>
          <MaterialCommunityIcons name="truck-outline" size={16} color={colors.primary} />
          <SectionKicker title="Truck Capacity" />
        </View>
        <Text style={styles.label}>Truck Capacity (lbs)</Text>
        <View style={styles.optionRow}>
          {CAPACITY_OPTIONS.map((value) => (
            <Pressable
              key={value}
              style={[styles.option, capacity === value ? styles.optionActive : null]}
              onPress={() => setCapacity(value)}
            >
              <Text style={capacity === value ? styles.optionTextActive : styles.optionText}>{value}</Text>
            </Pressable>
          ))}
        </View>

        <PrimaryButton
          title={loading ? "Optimizing..." : "Build Route"}
          onPress={buildRoute}
          loading={loading}
          disabled={loading}
        />
      </Card>

      <Card>
        <View style={styles.pillRow}>
          <StatPill label="Available" value={String(availableCount)} />
          <StatPill label="Stops" value={String(routeSummary.total_stops || 0)} />
          <StatPill label="Route lbs" value={String(routeSummary.total_lbs || 0)} />
          <StatPill label="Route $" value={`$${Number(routeSummary.total_value || 0).toFixed(2)}`} />
        </View>
        <View style={styles.pillRow}>
          <StatPill label="Collected lbs" value={collectedLbs.toFixed(1)} />
          <StatPill label="Collected $" value={`$${earnedValue.toFixed(2)}`} />
        </View>
        <View style={styles.actionsRow}>
          <PrimaryButton
            title={loading ? "Accepting..." : "Accept Route"}
            onPress={acceptRoute}
            loading={loading}
            disabled={loading || !route?.stops?.length}
          />
          <SecondaryButton title="Reset Demo" onPress={async () => {
            const reset = await api.resetDemo();
            if (!reset.ok) {
              setMessage(formatApiFailure("Reset demo", reset));
              return;
            }
            await refresh();
            setRoute(null);
            setRoutePolyline([]);
            setRouteMapMessage("");
            setAccepted(false);
            setCompletedIds({});
            setCollectedLbs(0);
            setEarnedValue(0);
            setMessage("Demo data reset");
          }} />
        </View>
        <Text style={styles.helperText}>Optimizer includes both demo seed listings and newly posted available listings.</Text>
        {accepted ? <Text style={styles.acceptedText}>Route accepted and active</Text> : null}
      </Card>

      {route?.stops?.length ? (
        <Card>
          <Text style={styles.stopsTitle}>{mapTitle}</Text>
          {MapViewComponent ? (
            <MapViewComponent
              style={styles.map}
              initialRegion={mapRegion}
              provider={Platform.OS === "android" && ProviderGoogle ? ProviderGoogle : undefined}
            >
              <MarkerComponent coordinate={DRIVER_START} title="Driver Start" description="Santa Clara base" />
              {routeStops.map((stop, idx) => {
                const coordinate = stopCoordinate(stop);
                if (!coordinate) return null;
                return (
                  <MarkerComponent
                    key={`stop-marker-${stop.listing_id || stop.id}`}
                    coordinate={coordinate}
                    title={`${idx + 1}. ${stop.household_name || "Listing"}`}
                    description={stop.address || ""}
                  />
                );
              })}
              {PolylineComponent && mapCoordinates.length >= 2 ? (
                <PolylineComponent
                  coordinates={mapCoordinates}
                  strokeColor={colors.primary}
                  strokeWidth={4}
                />
              ) : null}
            </MapViewComponent>
          ) : (
            <View style={styles.mapUnsupported}>
              <Text style={styles.stopMeta}>Map preview is only available on iOS/Android native runtimes.</Text>
            </View>
          )}
          {Platform.OS === "ios" ? (
            <Text style={styles.mapCaption}>
              iOS Expo Go uses Apple basemap. For full Google basemap on iOS, use an EAS iOS development build.
            </Text>
          ) : null}
          <View style={styles.mapActions}>
            <PrimaryButton
              title={Platform.OS === "ios" ? "Open Full Trip in Apple Maps" : "Open Trip in Maps"}
              onPress={openExternalNavigation}
              disabled={!routeStops.length}
            />
          </View>
          <Text style={styles.mapCaption}>
            {routeMapMessage || "Showing optimized stop geometry. Google Directions API is used when key is configured."}
          </Text>
        </Card>
      ) : null}

      {route?.stops?.length ? (
        <Card>
          <Text style={styles.stopsTitle}>Route Stops</Text>
          {route.stops.map((stop, idx) => {
            const listingId = stop.listing_id || stop.id;
            const isDone = Boolean(completedIds[listingId]);
            return (
              <View key={listingId} style={styles.stopRow}>
                <Text style={styles.stopTitle}>
                  {idx + 1}. {stop.household_name || "Listing"} - {stop.total_lbs} lbs / $
                  {Number(stop.total_value || 0).toFixed(2)}
                </Text>
                <Text style={styles.stopMeta}>ETA {stop.eta_minutes} min - {stop.address}</Text>
                <SecondaryButton
                  title={isDone ? "Completed" : "Mark Completed"}
                  disabled={isDone}
                  onPress={() => completeStop(stop)}
                />
              </View>
            );
          })}
        </Card>
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 120,
    backgroundColor: "transparent",
  },
  pageTitle: {
    color: colors.ink,
    fontSize: 46,
    lineHeight: 50,
    fontWeight: "800",
  },
  pageSubtitle: {
    color: colors.muted,
    fontSize: 18,
    lineHeight: 29,
    marginTop: 8,
    marginBottom: 18,
    maxWidth: "95%",
  },
  kickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  label: {
    color: colors.ink,
    fontWeight: "700",
    marginBottom: 8,
    fontSize: 13,
    letterSpacing: 1.8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
    backgroundColor: colors.cardSoft,
    color: colors.ink,
    fontSize: 16,
    fontWeight: "500",
  },
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  option: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 15,
    paddingVertical: 11,
    paddingHorizontal: 14,
    backgroundColor: colors.cardSoft,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  optionActive: {
    borderColor: "rgba(0, 232, 122, 0.35)",
    backgroundColor: "rgba(0, 232, 122, 0.15)",
  },
  optionText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
  },
  optionTextActive: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "800",
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  actionsRow: {
    gap: 8,
  },
  helperText: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  acceptedText: {
    marginTop: 8,
    color: colors.primary,
    fontWeight: "800",
    fontSize: 16,
  },
  map: {
    height: 250,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  mapUnsupported: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    backgroundColor: colors.cardSoft,
  },
  mapCaption: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  mapActions: {
    marginTop: 10,
  },
  stopsTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.ink,
    marginBottom: 8,
  },
  stopRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    marginTop: 10,
  },
  stopTitle: {
    color: colors.ink,
    fontWeight: "800",
    fontSize: 18,
    marginBottom: 4,
  },
  stopMeta: {
    color: colors.muted,
    marginBottom: 8,
    fontSize: 13,
  },
  message: {
    marginTop: 8,
    marginBottom: 8,
    color: colors.ink,
    fontWeight: "700",
    fontSize: 14,
  },
});
