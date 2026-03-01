import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "../services/api";
import { Card, colors } from "../components/ui";

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(0)}`;
}

export function HomeScreen({ onNavigate }) {
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState(null);
  const [impact, setImpact] = useState(null);
  const [materials, setMaterials] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    const [healthRes, impactRes, materialsRes] = await Promise.all([
      api.health(),
      api.getImpact(),
      api.getMaterials(),
    ]);
    if (healthRes.ok) setHealth(healthRes.data);
    if (impactRes.ok) setImpact(impactRes.data);
    if (materialsRes.ok) setMaterials(materialsRes.data || {});
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const materialCount = useMemo(() => Object.keys(materials || {}).length, [materials]);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
    >
      <View style={styles.countyBadge}>
        <MaterialCommunityIcons name="map-marker-radius-outline" size={14} color={colors.primary} />
        <Text style={styles.countyText}>SANTA CLARA COUNTY • LIVE</Text>
      </View>

      <View style={styles.heroBlock}>
        <Text style={styles.heroTitle}>Recycle Smarter.</Text>
        <Text style={styles.heroHighlight}>Earn More.</Text>
        <Text style={styles.heroSubtitle}>
          Post recyclables. Drivers get pre-optimized routes - maximizing value before they leave.
        </Text>
      </View>

      <View style={styles.ctaRow}>
        <Pressable style={[styles.ctaCard, styles.ctaPrimary]} onPress={() => onNavigate?.("post")}>
          <MaterialCommunityIcons name="hand-heart" size={30} color={colors.primaryDark} />
          <Text style={styles.ctaPrimaryText}>I have{"\n"}recyclables</Text>
        </Pressable>
        <Pressable style={styles.ctaCard} onPress={() => onNavigate?.("driver")}>
          <MaterialCommunityIcons name="lightning-bolt-outline" size={30} color={colors.primary} />
          <Text style={styles.ctaText}>I want to{"\n"}collect</Text>
        </Pressable>
      </View>

      <View style={styles.sectionHead}>
        <MaterialCommunityIcons name="chart-box-outline" size={16} color={colors.primary} />
        <Text style={styles.sectionHeadText}>NETWORK ACTIVITY</Text>
      </View>

      <View style={styles.statsGrid}>
        <Card style={styles.statCard}>
          <Text style={styles.statLabel}>ACTIVE LISTINGS</Text>
          <Text style={styles.statValue}>{Number(health?.total_listings || 0)}</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statLabel}>AVG EARNINGS</Text>
          <Text style={styles.statValue}>{formatCurrency((impact?.total_value_paid || 0) / Math.max(1, impact?.completed_pickups || 1))}/hr</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statLabel}>LBS DIVERTED</Text>
          <Text style={styles.statValue}>{Number(impact?.total_lbs_diverted || 0).toFixed(0)}</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statLabel}>MATERIAL TYPES</Text>
          <Text style={styles.statValue}>{materialCount}</Text>
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 120,
    backgroundColor: "transparent",
  },
  countyBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.35)",
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 14,
    backgroundColor: "rgba(0, 232, 122, 0.1)",
  },
  countyText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
  },
  heroBlock: {
    marginTop: 22,
  },
  heroTitle: {
    color: colors.ink,
    fontSize: 46,
    lineHeight: 50,
    fontWeight: "800",
  },
  heroHighlight: {
    color: colors.primary,
    fontSize: 46,
    lineHeight: 50,
    fontWeight: "800",
  },
  heroSubtitle: {
    color: colors.muted,
    marginTop: 12,
    fontSize: 18,
    lineHeight: 28,
    fontWeight: "500",
    maxWidth: "95%",
  },
  ctaRow: {
    marginTop: 28,
    flexDirection: "row",
    gap: 12,
  },
  ctaCard: {
    flex: 1,
    minHeight: 180,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    padding: 18,
    justifyContent: "space-between",
  },
  ctaPrimary: {
    backgroundColor: colors.primary,
    borderColor: "rgba(0, 232, 122, 0.4)",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 7,
  },
  ctaText: {
    color: colors.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
  },
  ctaPrimaryText: {
    color: colors.primaryDark,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
  },
  sectionHead: {
    marginTop: 30,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionHeadText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 3,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  statCard: {
    width: "47.5%",
    minHeight: 144,
    justifyContent: "space-between",
  },
  statLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
  },
  statValue: {
    color: colors.ink,
    fontSize: 42,
    lineHeight: 46,
    fontWeight: "800",
  },
});
