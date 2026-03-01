import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "../services/api";
import { Card, PrimaryButton, SectionTitle, SecondaryButton, StatPill, colors } from "../components/ui";

const OBJECTIVES = [
  { key: "lbs", label: "Max lbs/min" },
  { key: "value", label: "Max $/min" },
];
const MAX_MINUTES_OPTIONS = [60, 120, 180, 240];
const CAPACITY_OPTIONS = [500, 1000, 2000];

function nextRequestId() {
  return `mobile-accept-${Date.now()}`;
}

function formatApiFailure(action, response) {
  const hint = response?.hint ? ` ${response.hint}` : "";
  return `${action} failed: ${response?.error || "Request failed"}${hint}`;
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
  const availableCount = useMemo(() => listings.filter((item) => item.status === "available").length, [listings]);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <SectionTitle title="Driver Dashboard" subtitle="Build, accept, and execute optimized routes" />

      <Card>
        <Text style={styles.label}>Driver Name</Text>
        <TextInput value={driverName} onChangeText={setDriverName} style={styles.input} />
        <Text style={styles.label}>Optimize Objective</Text>
        <View style={styles.optionRow}>
          {OBJECTIVES.map((item) => (
            <Pressable
              key={item.key}
              style={[styles.option, objective === item.key ? styles.optionActive : null]}
              onPress={() => setObjective(item.key)}
            >
              <Text style={objective === item.key ? styles.optionTextActive : styles.optionText}>{item.label}</Text>
            </Pressable>
          ))}
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
            setAccepted(false);
            setCompletedIds({});
            setCollectedLbs(0);
            setEarnedValue(0);
            setMessage("Demo data reset");
          }} />
        </View>
        {accepted ? <Text style={styles.acceptedText}>Route accepted and active</Text> : null}
      </Card>

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
    padding: 14,
    paddingBottom: 120,
    backgroundColor: colors.bg,
  },
  label: {
    color: colors.ink,
    fontWeight: "700",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 10,
    backgroundColor: "#fff",
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
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: "#fff",
  },
  optionActive: {
    borderColor: colors.primary,
    backgroundColor: "#EAF8F3",
  },
  optionText: {
    color: colors.ink,
    fontSize: 12,
  },
  optionTextActive: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  pillRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  actionsRow: {
    gap: 8,
  },
  acceptedText: {
    marginTop: 8,
    color: colors.primary,
    fontWeight: "700",
  },
  stopsTitle: {
    fontSize: 16,
    fontWeight: "700",
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
    fontWeight: "700",
    marginBottom: 4,
  },
  stopMeta: {
    color: colors.muted,
    marginBottom: 8,
    fontSize: 12,
  },
  message: {
    marginTop: 8,
    color: colors.ink,
  },
});
