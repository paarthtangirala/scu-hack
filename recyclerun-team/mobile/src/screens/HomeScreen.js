import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../services/api";
import { Card, SectionTitle, StatPill, colors } from "../components/ui";
import { API_BASE_SOURCE, API_BASE_URL } from "../config";

export function HomeScreen() {
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await api.health();
    if (response.ok) {
      setHealth(response.data);
      setErrorMessage("");
    } else {
      const hint = response?.hint ? ` ${response.hint}` : "";
      setErrorMessage(`Health check failed: ${response?.error || "Unknown error"}${hint}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <SectionTitle
        title="RecycleRun Mobile"
        subtitle="Household + business recycling pickups with optimized driver routes."
      />

      <Card>
        <Text style={styles.headline}>Demo System Status</Text>
        <View style={styles.pillRow}>
          <StatPill label="API Status" value={health?.status || "Unknown"} />
          <StatPill label="Seed Listings" value={String(health?.seeded_listings || 0)} />
          <StatPill label="Total Listings" value={String(health?.total_listings || 0)} />
        </View>
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
        <Text style={styles.muted}>API base: {API_BASE_URL}</Text>
        <Text style={styles.muted}>API source: {API_BASE_SOURCE}</Text>
      </Card>

      <Card>
        <Text style={styles.sectionItemTitle}>How to use</Text>
        <Text style={styles.listItem}>1. Go to Post and create household/business listings.</Text>
        <Text style={styles.listItem}>2. Go to Driver and build an optimized route.</Text>
        <Text style={styles.listItem}>3. Accept route, complete stops, then check Impact.</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 14,
    paddingBottom: 120,
    backgroundColor: colors.bg,
  },
  headline: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 10,
  },
  pillRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  muted: {
    color: colors.muted,
    fontSize: 12,
  },
  error: {
    color: "#9B2C2C",
    fontSize: 12,
    marginBottom: 8,
  },
  sectionItemTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 8,
  },
  listItem: {
    color: colors.ink,
    marginBottom: 6,
    fontSize: 13,
  },
});
