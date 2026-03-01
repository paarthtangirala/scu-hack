import React, { useEffect, useMemo, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors } from "./src/components/ui";
import { api } from "./src/services/api";
import { DriverScreen } from "./src/screens/DriverScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ImpactScreen } from "./src/screens/ImpactScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { PostScreen } from "./src/screens/PostScreen";
import { RatesScreen } from "./src/screens/RatesScreen";

const TABS = [
  { key: "home", label: "HOME", icon: "home-outline", iconActive: "home" },
  { key: "post", label: "GIVE", icon: "hand-heart-outline", iconActive: "hand-heart" },
  { key: "driver", label: "DRIVE", icon: "truck-outline", iconActive: "truck" },
  { key: "impact", label: "IMPACT", icon: "chart-bar-stacked", iconActive: "chart-bar-stacked" },
  { key: "rates", label: "RATES", icon: "currency-usd", iconActive: "currency-usd" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("home");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [apiHealthy, setApiHealthy] = useState(true);
  const [apiChecked, setApiChecked] = useState(false);
  const BRAND_NAME = "Bin2Bucks";

  const Screen = useMemo(() => {
    switch (activeTab) {
      case "post":
        return PostScreen;
      case "driver":
        return DriverScreen;
      case "impact":
        return ImpactScreen;
      case "rates":
        return RatesScreen;
      case "home":
      default:
        return HomeScreen;
    }
  }, [activeTab]);

  useEffect(() => {
    let mounted = true;
    const checkHealth = async () => {
      const response = await api.health();
      if (!mounted) return;
      setApiHealthy(Boolean(response?.ok && response?.data?.status === "ok"));
      setApiChecked(true);
    };

    if (isAuthenticated) {
      checkHealth();
      const timer = setInterval(checkHealth, 30000);
      return () => {
        mounted = false;
        clearInterval(timer);
      };
    }

    return () => {
      mounted = false;
    };
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <View style={styles.bgGlowA} />
        <View style={styles.bgGlowB} />
        <LoginScreen onLogin={() => setIsAuthenticated(true)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.bgGlowA} />
      <View style={styles.bgGlowB} />
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandIconWrap}>
            <Text style={styles.brandIcon}>♻️</Text>
          </View>
          <Text style={styles.logo}>{BRAND_NAME}</Text>
        </View>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {apiChecked && !apiHealthy ? (
        <View style={styles.offlineBar}>
          <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.accent} />
          <Text style={styles.offlineText}>OFFLINE MODE • DEMO DATA</Text>
        </View>
      ) : null}

      <View style={styles.body}>
        {activeTab === "home" ? <HomeScreen onNavigate={setActiveTab} /> : <Screen />}
      </View>

      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[styles.tabButton, active ? styles.tabButtonActive : null]}
              onPress={() => setActiveTab(tab.key)}
            >
              <View style={[styles.tabIconWrap, active ? styles.tabIconWrapActive : null]}>
                <MaterialCommunityIcons
                  name={active ? tab.iconActive : tab.icon}
                  size={24}
                  color={active ? colors.primary : colors.muted}
                />
              </View>
              <Text style={active ? styles.tabTextActive : styles.tabText}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  bgGlowA: {
    position: "absolute",
    top: -40,
    left: -20,
    width: 240,
    height: 240,
    borderRadius: 999,
    backgroundColor: "rgba(0, 232, 122, 0.08)",
  },
  bgGlowB: {
    position: "absolute",
    bottom: -80,
    right: -40,
    width: 280,
    height: 280,
    borderRadius: 999,
    backgroundColor: "rgba(0, 232, 122, 0.06)",
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: "rgba(7, 16, 11, 0.9)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.35)",
    backgroundColor: "rgba(0, 232, 122, 0.08)",
  },
  brandIcon: {
    fontSize: 22,
  },
  logo: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "800",
    color: colors.ink,
  },
  body: {
    flex: 1,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.35)",
    backgroundColor: "rgba(0, 232, 122, 0.12)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  liveDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  liveText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 2,
  },
  offlineBar: {
    backgroundColor: "rgba(245, 166, 35, 0.12)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(245, 166, 35, 0.3)",
    borderTopWidth: 1,
    borderTopColor: "rgba(245, 166, 35, 0.2)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 8,
  },
  offlineText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
  },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: "rgba(7, 16, 11, 0.92)",
    paddingTop: 8,
    paddingBottom: 12,
    paddingHorizontal: 10,
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    paddingVertical: 4,
  },
  tabButtonActive: {
    backgroundColor: "transparent",
  },
  tabIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  tabIconWrapActive: {
    backgroundColor: "rgba(0, 232, 122, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.35)",
  },
  tabText: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  tabTextActive: {
    fontSize: 10,
    color: colors.primary,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
});
