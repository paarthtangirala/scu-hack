import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "../services/api";
import { Card, colors } from "../components/ui";

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

  const stats = useMemo(
    () => [
      {
        label: "COMPLETED",
        value: String(impact?.completed_pickups || 0),
        icon: "check-circle-outline",
        tint: colors.primary,
      },
      {
        label: "LBS DIVERTED",
        value: Number(impact?.total_lbs_diverted || 0).toLocaleString(),
        icon: "weight-kilogram",
        tint: "#E2B93B",
      },
      {
        label: "PAID DRIVERS",
        value: `$${Number(impact?.total_value_paid || 0).toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        })}`,
        icon: "currency-usd",
        tint: colors.primary,
      },
      {
        label: "CO2 SAVED",
        value: `${Number(impact?.co2_saved_tons || 0).toFixed(3)}t`,
        icon: "leaf",
        tint: "#47E59E",
      },
    ],
    [impact],
  );

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
    >
      <Text style={styles.title}>Community Impact</Text>
      <View style={styles.subtitleRow}>
        <MaterialCommunityIcons name="earth" size={18} color={colors.primary} />
        <Text style={styles.subtitle}>Santa Clara County Live Stats</Text>
      </View>

      <View style={styles.grid}>
        {stats.map((item) => (
          <Card key={item.label} style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: `${item.tint}22`, borderColor: `${item.tint}55` }]}>
              <MaterialCommunityIcons name={item.icon} size={30} color={item.tint} />
            </View>
            <Text style={styles.statLabel}>{item.label}</Text>
            <Text style={styles.statValue}>{item.value}</Text>
          </Card>
        ))}
      </View>

      <Card style={styles.infoCard}>
        <View style={styles.infoHead}>
          <View style={styles.infoIconWrap}>
            <MaterialCommunityIcons name="earth" size={28} color={colors.primary} />
          </View>
          <Text style={styles.infoTitle}>SB 1383 Support</Text>
        </View>
        <Text style={styles.infoText}>
          Bin2Bucks helps Santa Clara exceed California's organic waste reduction targets by ensuring
          high-value recyclables never hit the landfill.
        </Text>
        <View style={styles.progressHead}>
          <Text style={styles.progressLabel}>GOAL PROGRESS</Text>
          <Text style={styles.progressPct}>84%</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={styles.progressFill} />
        </View>
      </Card>

      <Card>
        <View style={styles.safetyHead}>
          <MaterialCommunityIcons name="shield-check-outline" size={22} color={colors.primary} />
          <Text style={styles.safetyTitle}>COMPLIANCE & SAFETY</Text>
        </View>
        <Text style={styles.safetyText}>
          Pickups are opt-in only. No curbside scavenging. Commercial pickups operate via partner
          agreements. All drivers are background checked.
        </Text>
      </Card>
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
  title: {
    color: colors.ink,
    fontSize: 46,
    lineHeight: 50,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitleRow: {
    marginTop: 10,
    marginBottom: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 18,
    fontWeight: "500",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  statCard: {
    width: "47.5%",
    minHeight: 220,
    justifyContent: "space-between",
  },
  statIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  statLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 3,
  },
  statValue: {
    color: colors.ink,
    fontSize: 42,
    lineHeight: 46,
    fontWeight: "800",
  },
  infoCard: {
    marginTop: 4,
  },
  infoHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  infoIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.35)",
    backgroundColor: "rgba(0, 232, 122, 0.12)",
    marginTop: 2,
  },
  infoTitle: {
    flex: 1,
    flexShrink: 1,
    color: colors.ink,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "800",
  },
  infoText: {
    marginTop: 14,
    color: colors.muted,
    fontSize: 17,
    lineHeight: 30,
    fontWeight: "500",
  },
  progressHead: {
    marginTop: 20,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 3,
  },
  progressPct: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: "800",
  },
  progressTrack: {
    height: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    overflow: "hidden",
  },
  progressFill: {
    width: "84%",
    height: "100%",
    backgroundColor: colors.primary,
  },
  safetyHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  safetyTitle: {
    color: colors.ink,
    fontWeight: "800",
    fontSize: 18,
    letterSpacing: 2,
  },
  safetyText: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 29,
    fontWeight: "500",
  },
});
