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

export function SectionKicker({ title }) {
  return <Text style={styles.kicker}>{title}</Text>;
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
  bg: "#050B07",
  surface: "#0B1710",
  card: "rgba(11, 24, 16, 0.94)",
  cardSoft: "rgba(11, 24, 16, 0.7)",
  ink: "#E7F1E8",
  muted: "#78917A",
  primary: "#00E87A",
  primaryDark: "#042A18",
  border: "rgba(137, 171, 142, 0.2)",
  accent: "#F5A623",
  danger: "#FF6B6B",
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 6,
  },
  sectionHeader: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 48,
    lineHeight: 54,
    fontWeight: "800",
    color: colors.ink,
  },
  sectionSubtitle: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 17,
    lineHeight: 28,
    fontWeight: "500",
  },
  kicker: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 10,
    textTransform: "uppercase",
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.45)",
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  primaryButtonText: {
    color: colors.primaryDark,
    fontSize: 18,
    fontWeight: "800",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cardSoft,
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.5,
  },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    minWidth: 88,
    backgroundColor: colors.cardSoft,
  },
  pillLabel: {
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 0.3,
    fontWeight: "700",
  },
  pillValue: {
    marginTop: 4,
    color: colors.ink,
    fontSize: 16,
    fontWeight: "800",
  },
});
