import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Card, PrimaryButton, SecondaryButton, colors } from "../components/ui";

const INPUT_PLACEHOLDER = "rgba(120, 145, 122, 0.8)";

function roleLabel(role) {
  return role === "driver" ? "Driver" : "Giver";
}

function truncate(value, max = 22) {
  if (!value) return "";
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

export function ProfileScreen({
  profile,
  session,
  instructionPackage,
  onNavigate,
  onRefresh,
  onSaveProfile,
  onReplayGuide,
  onLogout,
}) {
  const [displayName, setDisplayName] = useState(profile?.display_name || "");
  const [email, setEmail] = useState(profile?.email || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.display_name || "");
    setEmail(profile?.email || "");
    setPhone(profile?.phone || "");
  }, [profile?.id, profile?.display_name, profile?.email, profile?.phone]);

  const actionItems = useMemo(() => {
    const items = Array.isArray(profile?.quick_actions) ? profile.quick_actions : [];
    return items.filter((item) => item?.target_tab);
  }, [profile?.quick_actions]);

  const save = async () => {
    setSaving(true);
    const response = await onSaveProfile?.({
      display_name: displayName,
      email,
      phone,
    });
    setSaving(false);
    if (!response?.ok) {
      setMessage(response?.error || "Profile update failed");
      return;
    }
    setMessage("Profile saved");
  };

  const refresh = async () => {
    setRefreshing(true);
    const response = await onRefresh?.();
    setRefreshing(false);
    if (!response?.ok) {
      setMessage(response?.error || "Profile refresh failed");
      return;
    }
    setMessage("Profile refreshed");
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>My Profile</Text>
      <Text style={styles.subtitle}>Personalized for your {roleLabel(profile?.role)} workflow.</Text>

      <Card>
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(displayName || profile?.display_name || "B").slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.identity}>
            <Text style={styles.name}>{profile?.display_name || "Bin2Bucks Member"}</Text>
            <View style={styles.roleBadge}>
              <MaterialCommunityIcons
                name={profile?.role === "driver" ? "truck-fast-outline" : "hand-heart-outline"}
                size={14}
                color={colors.primary}
              />
              <Text style={styles.roleText}>{roleLabel(profile?.role)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Session</Text>
          <Text style={styles.metaValue}>{truncate(session?.session_id, 20)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Last Active</Text>
          <Text style={styles.metaValue}>{session?.last_active_at || "-"}</Text>
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Edit Details</Text>
        <Text style={styles.label}>DISPLAY NAME</Text>
        <View style={styles.inputWrap}>
          <MaterialCommunityIcons name="account-outline" size={20} color={colors.muted} />
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your display name"
            placeholderTextColor={INPUT_PLACEHOLDER}
            style={styles.input}
          />
        </View>

        <Text style={styles.label}>EMAIL</Text>
        <View style={styles.inputWrap}>
          <MaterialCommunityIcons name="email-outline" size={20} color={colors.muted} />
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="name@example.com"
            placeholderTextColor={INPUT_PLACEHOLDER}
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
          />
        </View>

        <Text style={styles.label}>PHONE</Text>
        <View style={styles.inputWrap}>
          <MaterialCommunityIcons name="phone-outline" size={20} color={colors.muted} />
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="(555) 000-0000"
            placeholderTextColor={INPUT_PLACEHOLDER}
            keyboardType="phone-pad"
            style={styles.input}
          />
        </View>

        <View style={styles.buttonRow}>
          <PrimaryButton
            title={saving ? "Saving..." : "Save Profile"}
            onPress={save}
            loading={saving}
            disabled={saving}
          />
          <SecondaryButton
            title={refreshing ? "Refreshing..." : "Refresh"}
            onPress={refresh}
            disabled={refreshing}
          />
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          {actionItems.map((action) => (
            <Pressable
              key={action.id}
              style={styles.actionCard}
              onPress={() => onNavigate?.(action.target_tab)}
            >
              <MaterialCommunityIcons name={action.icon || "arrow-right-circle-outline"} size={20} color={colors.primary} />
              <Text style={styles.actionLabel}>{action.label}</Text>
              <Text style={styles.actionDesc}>{action.description || "Open section"}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{instructionPackage?.title || "First-Time Guide"}</Text>
        <Text style={styles.guideSubtitle}>{instructionPackage?.subtitle || "Review key app instructions."}</Text>
        <View style={styles.guideButtons}>
          <SecondaryButton title="Replay Guide" onPress={onReplayGuide} />
          <SecondaryButton title="Log Out" onPress={onLogout} />
        </View>
      </Card>

      {message ? <Text style={styles.message}>{message}</Text> : null}
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
    fontSize: 42,
    lineHeight: 46,
    fontWeight: "800",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 8,
    marginBottom: 14,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 232, 122, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.4)",
  },
  avatarText: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: "800",
  },
  identity: {
    flex: 1,
  },
  name: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "800",
  },
  roleBadge: {
    marginTop: 6,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "rgba(0, 232, 122, 0.08)",
  },
  roleText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    gap: 12,
  },
  metaLabel: {
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 1.5,
    fontWeight: "700",
  },
  metaValue: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "600",
    maxWidth: "68%",
    textAlign: "right",
  },
  cardTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 12,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 6,
    marginTop: 4,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.cardSoft,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    color: colors.ink,
    fontSize: 16,
  },
  buttonRow: {
    gap: 10,
    marginTop: 8,
  },
  actionsGrid: {
    gap: 8,
  },
  actionCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    backgroundColor: colors.cardSoft,
  },
  actionLabel: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 6,
  },
  actionDesc: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  guideSubtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  guideButtons: {
    gap: 10,
  },
  message: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
});
