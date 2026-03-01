import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ title, subtitle }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function PrimaryButton({ title, onPress, disabled, loading }) {
  return (
    <Pressable
      style={[styles.primaryButton, disabled ? styles.disabled : null]}
      onPress={onPress}
      disabled={disabled}
    >
      {loading ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <Text style={styles.primaryButtonText}>{title}</Text>
      )}
    </Pressable>
  );
}

export function SecondaryButton({ title, onPress, disabled }) {
  return (
    <Pressable
      style={[styles.secondaryButton, disabled ? styles.disabled : null]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.secondaryButtonText}>{title}</Text>
    </Pressable>
  );
}

export function StatPill({ label, value }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillLabel}>{label}</Text>
      <Text style={styles.pillValue}>{value}</Text>
    </View>
  );
}

export const colors = {
  bg: "#F4F2E9",
  card: "#FFFFFF",
  ink: "#161616",
  muted: "#545454",
  primary: "#0D7A5A",
  border: "#E7E4D8",
  accent: "#E4A600",
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 12,
  },
  sectionHeader: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.ink,
  },
  sectionSubtitle: {
    marginTop: 4,
    color: colors.muted,
    fontSize: 13,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FDFDFB",
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.55,
  },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 10,
    minWidth: 88,
    backgroundColor: "#FCFBF6",
  },
  pillLabel: {
    color: colors.muted,
    fontSize: 11,
  },
  pillValue: {
    marginTop: 2,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
  },
});
