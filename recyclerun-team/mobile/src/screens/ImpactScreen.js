import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../services/api";
import { Card, SectionTitle, StatPill, colors } from "../components/ui";

export function ImpactScreen() {
  const [loading, setLoading] = useState(false);
  const [impact, setImpact] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await api.getImpact();
    if (response.ok) {
      setImpact(response.data);
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
      <SectionTitle title="Community Impact" subtitle="Live metrics based on completed pickups" />

      <Card>
        <View style={styles.pillGrid}>
          <StatPill label="Completed Pickups" value={String(impact?.completed_pickups || 0)} />
          <StatPill label="Lbs Diverted" value={String(impact?.total_lbs_diverted || 0)} />
          <StatPill label="Value Paid" value={`$${Number(impact?.total_value_paid || 0).toFixed(2)}`} />
          <StatPill label="CO2 Saved (lbs)" value={String(impact?.co2_saved_lbs || 0)} />
          <StatPill label="CO2 Saved (tons)" value={String(impact?.co2_saved_tons || 0)} />
        </View>
      </Card>

      <Card>
        <Text style={styles.subtitle}>Status Counts</Text>
        {impact?.status_counts ? (
          <>
            <Text style={styles.countRow}>Available: {impact.status_counts.available || 0}</Text>
            <Text style={styles.countRow}>Claimed: {impact.status_counts.claimed || 0}</Text>
            <Text style={styles.countRow}>Completed: {impact.status_counts.completed || 0}</Text>
          </>
        ) : (
          <Text style={styles.countRow}>No status data yet.</Text>
        )}
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
  pillGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  subtitle: {
    color: colors.ink,
    fontWeight: "700",
    marginBottom: 6,
  },
  countRow: {
    color: colors.ink,
    marginBottom: 6,
  },
});
