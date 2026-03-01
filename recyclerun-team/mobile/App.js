import React, { useMemo, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { APP_NAME } from "./src/config";
import { colors } from "./src/components/ui";
import { DriverScreen } from "./src/screens/DriverScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ImpactScreen } from "./src/screens/ImpactScreen";
import { PostScreen } from "./src/screens/PostScreen";
import { RatesScreen } from "./src/screens/RatesScreen";

const TABS = [
  { key: "home", label: "Home", icon: "🏠" },
  { key: "post", label: "Post", icon: "📦" },
  { key: "driver", label: "Driver", icon: "🚛" },
  { key: "impact", label: "Impact", icon: "🌱" },
  { key: "rates", label: "Rates", icon: "💰" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("home");

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

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.logo}>♻️ {APP_NAME}</Text>
        <Text style={styles.subtitle}>Mobile Ops Console</Text>
      </View>

      <View style={styles.body}>
        <Screen />
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
              <Text style={styles.tabIcon}>{tab.icon}</Text>
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
  header: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: "#F8F7F0",
  },
  logo: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.ink,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.muted,
  },
  body: {
    flex: 1,
  },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: "#FFFFFF",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    paddingVertical: 6,
  },
  tabButtonActive: {
    backgroundColor: "#EAF8F3",
  },
  tabIcon: {
    fontSize: 16,
    marginBottom: 2,
  },
  tabText: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: "600",
  },
  tabTextActive: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: "700",
  },
});
