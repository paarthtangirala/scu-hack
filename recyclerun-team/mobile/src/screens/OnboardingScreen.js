import React from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Card, PrimaryButton, SecondaryButton, colors } from "../components/ui";

export function OnboardingScreen({
  visible,
  instructionPackage,
  onComplete,
  onSkip,
  loading = false,
}) {
  if (!visible) return null;

  const pkg = instructionPackage || {
    title: "Welcome to Bin2Bucks",
    subtitle: "Follow these steps for your first successful flow.",
    steps: [],
    safety_notes: [],
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>{pkg.title}</Text>
          <Text style={styles.subtitle}>{pkg.subtitle}</Text>

          {(pkg.steps || []).map((step, index) => (
            <Card key={`${step.title}-${index}`} style={styles.stepCard}>
              <View style={styles.stepHead}>
                <View style={styles.stepIndex}>
                  <Text style={styles.stepIndexText}>{index + 1}</Text>
                </View>
                <Text style={styles.stepTitle}>{step.title}</Text>
              </View>
              <Text style={styles.stepBody}>{step.body}</Text>
            </Card>
          ))}

          <Card>
            <View style={styles.safeHead}>
              <MaterialCommunityIcons name="shield-check-outline" size={20} color={colors.primary} />
              <Text style={styles.safeTitle}>Safety + Compliance</Text>
            </View>
            {(pkg.safety_notes || []).map((note, index) => (
              <Text key={`${note}-${index}`} style={styles.safeLine}>
                - {note}
              </Text>
            ))}
          </Card>

          <View style={styles.actions}>
            <PrimaryButton
              title={loading ? "Saving..." : "Got it, Start Using App"}
              onPress={onComplete}
              loading={loading}
              disabled={loading}
            />
            <SecondaryButton title="Remind Me Later" onPress={onSkip} disabled={loading} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(3, 8, 5, 0.92)",
  },
  container: {
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 36,
  },
  title: {
    color: colors.ink,
    fontSize: 36,
    lineHeight: 40,
    fontWeight: "800",
  },
  subtitle: {
    color: colors.muted,
    marginTop: 10,
    marginBottom: 14,
    fontSize: 16,
    lineHeight: 24,
  },
  stepCard: {
    marginBottom: 10,
  },
  stepHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  stepIndex: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 232, 122, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.35)",
  },
  stepIndexText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "800",
  },
  stepTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "800",
  },
  stepBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  safeHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  safeTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "800",
  },
  safeLine: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  actions: {
    gap: 10,
    marginTop: 8,
  },
});
