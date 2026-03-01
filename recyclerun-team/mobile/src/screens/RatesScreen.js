import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../services/api";
import { FALLBACK_MATERIALS } from "../services/materialsFallback";
import { Card, SectionTitle, colors } from "../components/ui";

export function RatesScreen() {
  const [loading, setLoading] = useState(false);
  const [materials, setMaterials] = useState(FALLBACK_MATERIALS);

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

  const keys = useMemo(() => Object.keys(materials).sort(), [materials]);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <SectionTitle title="Material Rates" subtitle="Current payout rates used by optimizer and listing values" />
      <Card>
        {keys.map((key) => (
          <View key={key} style={styles.row}>
            <Text style={styles.name}>
              {materials[key]?.emoji || "♻️"} {materials[key]?.label || key}
            </Text>
            <Text style={styles.value}>${Number(materials[key]?.rate || 0).toFixed(2)} / lb</Text>
          </View>
        ))}
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
  row: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  name: {
    color: colors.ink,
    flex: 1,
    fontSize: 13,
  },
  value: {
    color: colors.primary,
    fontWeight: "700",
    fontSize: 13,
  },
});
