import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors } from "./src/components/ui";
import { api } from "./src/services/api";
import { DriverScreen } from "./src/screens/DriverScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ImpactScreen } from "./src/screens/ImpactScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { OnboardingScreen } from "./src/screens/OnboardingScreen";
import { PostScreen } from "./src/screens/PostScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { RatesScreen } from "./src/screens/RatesScreen";

const SESSION_STORAGE_KEY = "bin2bucks.session_id";

const TABS = [
  { key: "home", label: "HOME", icon: "home-outline", iconActive: "home" },
  { key: "post", label: "GIVE", icon: "hand-heart-outline", iconActive: "hand-heart" },
  { key: "driver", label: "DRIVE", icon: "truck-outline", iconActive: "truck" },
  { key: "impact", label: "IMPACT", icon: "chart-bar-stacked", iconActive: "chart-bar-stacked" },
  { key: "rates", label: "RATES", icon: "currency-usd", iconActive: "currency-usd" },
  { key: "profile", label: "PROFILE", icon: "account-circle-outline", iconActive: "account-circle" },
];

function deviceLabel() {
  const os = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
  return `${os}-expo`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState("home");
  const [apiHealthy, setApiHealthy] = useState(true);
  const [apiChecked, setApiChecked] = useState(false);
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [instructionPackage, setInstructionPackage] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [priorityListingIds, setPriorityListingIds] = useState([]);
  const BRAND_NAME = "Bin2Bucks";

  const isAuthenticated = Boolean(session?.session_id && profile?.id);

  const applySessionState = useCallback((payload) => {
    const nextSession = payload?.session || null;
    const nextProfile = payload?.profile || null;
    setSession(nextSession);
    setProfile(nextProfile);
    setInstructionPackage(payload?.instruction_package || null);
    setShowOnboarding(Boolean(payload?.onboarding_required));
  }, []);

  const clearSessionState = useCallback(async () => {
    setSession(null);
    setProfile(null);
    setInstructionPackage(null);
    setShowOnboarding(false);
    setPriorityListingIds([]);
    setApiChecked(false);
    setApiHealthy(true);
    setActiveTab("home");
    await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const savedSessionId = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
      if (!mounted) return;
      if (!savedSessionId) {
        setBooting(false);
        return;
      }

      const response = await api.getProfileSession(savedSessionId);
      if (!mounted) return;
      if (!response.ok) {
        await clearSessionState();
        setBooting(false);
        return;
      }
      applySessionState(response.data);
      setBooting(false);
    })();
    return () => {
      mounted = false;
    };
  }, [applySessionState, clearSessionState]);

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

  const handleLogin = useCallback(
    async ({ role, display_name, email, phone }) => {
      const response = await api.startProfileSession({
        role,
        displayName: display_name,
        email,
        phone,
        deviceLabel: deviceLabel(),
      });
      if (!response.ok) {
        return { ok: false, error: response.error || response.hint || "Could not start session" };
      }

      applySessionState(response.data);
      await AsyncStorage.setItem(SESSION_STORAGE_KEY, response.data.session.session_id);
      setActiveTab(role === "driver" ? "driver" : "home");
      return { ok: true };
    },
    [applySessionState],
  );

  const handleLogout = useCallback(async () => {
    if (session?.session_id) {
      await api.endProfileSession(session.session_id);
    }
    await clearSessionState();
  }, [clearSessionState, session?.session_id]);

  const refreshProfile = useCallback(async () => {
    if (!profile?.id) return { ok: false, error: "Profile not loaded" };
    const response = await api.getProfile(profile.id);
    if (!response.ok) {
      return { ok: false, error: response.error || response.hint || "Could not refresh profile" };
    }
    setProfile(response.data.profile);
    setInstructionPackage(response.data.instruction_package || null);
    return { ok: true };
  }, [profile?.id]);

  const saveProfile = useCallback(
    async ({ display_name, email, phone }) => {
      if (!profile?.id) return { ok: false, error: "Profile not loaded" };
      const response = await api.updateProfile(profile.id, {
        display_name,
        email,
        phone,
      });
      if (!response.ok) {
        return { ok: false, error: response.error || response.hint || "Could not save profile" };
      }
      setProfile(response.data.profile);
      return { ok: true };
    },
    [profile?.id],
  );

  const completeOnboarding = useCallback(async () => {
    if (!profile?.id) return;
    setSavingOnboarding(true);
    const response = await api.completeOnboarding(profile.id);
    setSavingOnboarding(false);
    if (!response.ok) {
      return;
    }
    setProfile(response.data.profile);
    setInstructionPackage(response.data.instruction_package || null);
    setShowOnboarding(false);
  }, [profile?.id]);

  const renderScreen = () => {
    if (activeTab === "home") {
      return <HomeScreen onNavigate={setActiveTab} />;
    }
    if (activeTab === "post") {
      return (
        <PostScreen
          profile={profile}
          onListingPosted={(listingId) => {
            if (!listingId) return;
            setPriorityListingIds((prev) => {
              const next = [listingId, ...prev.filter((id) => id !== listingId)];
              return next.slice(0, 20);
            });
          }}
        />
      );
    }
    if (activeTab === "driver") {
      return (
        <DriverScreen
          priorityListingIds={priorityListingIds}
          onPriorityListingsConsumed={(consumedIds = []) => {
            if (!Array.isArray(consumedIds) || !consumedIds.length) return;
            setPriorityListingIds((prev) => prev.filter((id) => !consumedIds.includes(id)));
          }}
        />
      );
    }
    if (activeTab === "impact") return <ImpactScreen />;
    if (activeTab === "rates") return <RatesScreen />;
    return (
      <ProfileScreen
        profile={profile}
        session={session}
        instructionPackage={instructionPackage}
        onNavigate={setActiveTab}
        onRefresh={refreshProfile}
        onSaveProfile={saveProfile}
        onReplayGuide={() => setShowOnboarding(true)}
        onLogout={handleLogout}
      />
    );
  };

  if (booting) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading session...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <View style={styles.bgGlowA} />
        <View style={styles.bgGlowB} />
        <LoginScreen onLogin={handleLogin} />
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
          <View>
            <Text style={styles.logo}>{BRAND_NAME}</Text>
            <Text style={styles.identityText}>{profile?.display_name || "Member"} • {profile?.role || "giver"}</Text>
          </View>
        </View>
        <Pressable style={styles.liveBadge} onPress={() => setActiveTab("profile")}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>PROFILE</Text>
        </Pressable>
      </View>

      {apiChecked && !apiHealthy ? (
        <View style={styles.offlineBar}>
          <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.accent} />
          <Text style={styles.offlineText}>OFFLINE MODE • DEMO DATA</Text>
        </View>
      ) : null}

      <View style={styles.body}>{renderScreen()}</View>

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
                  size={22}
                  color={active ? colors.primary : colors.muted}
                />
              </View>
              <Text style={active ? styles.tabTextActive : styles.tabText}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <OnboardingScreen
        visible={showOnboarding}
        instructionPackage={instructionPackage}
        onComplete={completeOnboarding}
        onSkip={() => setShowOnboarding(false)}
        loading={savingOnboarding}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
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
    fontSize: 20,
    lineHeight: 23,
    fontWeight: "800",
    color: colors.ink,
  },
  identityText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
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
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  liveText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
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
    paddingHorizontal: 8,
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
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  tabIconWrapActive: {
    backgroundColor: "rgba(0, 232, 122, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.3)",
  },
  tabText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.8,
  },
  tabTextActive: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.8,
  },
});
