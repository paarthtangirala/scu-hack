import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "../services/api";
import { Card, colors } from "../components/ui";

const DEMO_ORG_ID = "org_santa_clara_demo";

export function ImpactScreen() {
  const [loading, setLoading] = useState(false);
  const [impact, setImpact] = useState(null);
  const [dashboard, setDashboard] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const dashboardResponse = await api.getOrgDashboard(DEMO_ORG_ID, { window: "30d" });
    if (dashboardResponse.ok) {
      setDashboard(dashboardResponse.data);
      setImpact({
        completed_pickups: Number(dashboardResponse.data?.summary?.completed_pickups || 0),
        total_lbs_diverted: Number(dashboardResponse.data?.summary?.total_lbs_diverted || 0),
        total_value_paid: Number(dashboardResponse.data?.summary?.total_value_paid || 0),
        co2_saved_tons: Number(dashboardResponse.data?.summary?.total_lbs_diverted || 0) * 0.00025,
      });
    } else {
      const response = await api.getImpact();
      if (response.ok) {
        setImpact(response.data);
      }
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
        label: "CONTAMINATION",
        value: `${Math.round(Number(dashboard?.summary?.contamination_rate || 0) * 100)}%`,
        icon: "alert-circle-outline",
        tint: "#47E59E",
      },
    ],
    [dashboard?.summary?.contamination_rate, impact],
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
          <Text style={styles.infoTitle}>City / EPR Dashboard</Text>
        </View>
        <Text style={styles.infoText}>
          Receipt-derived diversion metrics show what was estimated at capture time, what was actually
          collected by the driver, and where contamination risk is clustering.
        </Text>
        <View style={styles.progressHead}>
          <Text style={styles.progressLabel}>MEAN PICKUP SLA</Text>
          <Text style={styles.progressPct}>
            {Number(dashboard?.summary?.mean_pickup_time_minutes || 0).toFixed(0)} min
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.max(8, Math.min(100, 100 - Number(dashboard?.summary?.mean_pickup_time_minutes || 0) / 2))}%` },
            ]}
          />
        </View>
      </Card>

      <Card>
        <View style={styles.safetyHead}>
          <MaterialCommunityIcons name="file-document-check-outline" size={22} color={colors.primary} />
          <Text style={styles.safetyTitle}>LATEST RECEIPTS</Text>
        </View>
        {(dashboard?.latest_receipts || []).length ? (
          (dashboard?.latest_receipts || []).map((receipt) => (
            <View key={receipt.receipt_id} style={styles.receiptRow}>
              <Text style={styles.receiptTitle}>
                {receipt.household_name} • {Number(receipt.actual_total_lbs || 0).toFixed(1)} lbs
              </Text>
              <Text style={styles.safetyText}>
                {receipt.driver_name} completed {String(receipt.completed_at || "").slice(0, 16).replace("T", " ")} •
                variance {Number(receipt.variance_lbs || 0).toFixed(1)} lbs
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.safetyText}>
            No verified receipts yet. Complete a driver stop to populate compliance evidence.
          </Text>
        )}
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
  receiptRow: {
    paddingTop: 10,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  receiptTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "800",
  },
});
