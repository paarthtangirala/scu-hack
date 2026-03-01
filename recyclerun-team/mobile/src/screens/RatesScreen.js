import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "../services/api";
import { FALLBACK_MATERIALS } from "../services/materialsFallback";
import { Card, colors } from "../components/ui";

export function RatesScreen() {
  const [loading, setLoading] = useState(false);
  const [materials, setMaterials] = useState(FALLBACK_MATERIALS);
  const [now, setNow] = useState(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    const response = await api.getMaterials();
    if (response.ok && response.data) {
      setMaterials(response.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const keys = useMemo(() => Object.keys(materials).sort(), [materials]);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
    >
      <Text style={styles.title}>Material Rates</Text>
      <View style={styles.subtitleRow}>
        <View style={styles.leftSubtitle}>
          <MaterialCommunityIcons name="chart-bar" size={18} color={colors.primary} />
          <Text style={styles.subtitle}>Live payout estimates per lb.</Text>
        </View>
        <View style={styles.clockBadge}>
          <MaterialCommunityIcons name="clock-outline" size={16} color={colors.primary} />
          <Text style={styles.clockText}>
            {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>
        </View>
      </View>

      <View style={styles.marketRow}>
        <MaterialCommunityIcons name="information-outline" size={18} color={colors.muted} />
        <Text style={styles.marketText}>MARKET INDEX: SANTA CLARA</Text>
      </View>

      <View style={styles.list}>
        {keys.map((key) => {
          const item = materials[key] || {};
          const label = item.label || key;
          const rate = Number(item.rate || 0);
          return (
            <Card key={key} style={styles.rateCard}>
              <View style={styles.rateLeft}>
                <Text style={styles.rateName}>{label}</Text>
              </View>
              <View style={styles.rateRight}>
                <Text style={styles.rateValue}>${rate.toFixed(2)}/lb</Text>
              </View>
            </Card>
          );
        })}
      </View>
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
  },
  subtitleRow: {
    marginTop: 12,
    marginBottom: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
    flexWrap: "wrap",
  },
  leftSubtitle: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    flex: 1,
    minWidth: 0,
    marginRight: 0,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    flexShrink: 1,
  },
  clockBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.35)",
    backgroundColor: "rgba(0, 232, 122, 0.1)",
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  clockText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  marketRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 12,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  marketText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  list: {
    gap: 10,
  },
  rateCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rateLeft: {
    flex: 1,
    marginRight: 10,
  },
  rateName: {
    color: colors.ink,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "800",
  },
  rateRight: {
    alignItems: "flex-end",
  },
  rateValue: {
    color: colors.primary,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "800",
  },
});
