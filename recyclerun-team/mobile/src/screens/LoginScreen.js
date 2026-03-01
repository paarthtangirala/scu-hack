import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, PrimaryButton } from "../components/ui";

const INPUT_PLACEHOLDER = "rgba(120, 145, 122, 0.8)";

export function LoginScreen({ onLogin }) {
  const [role, setRole] = useState("User");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const submit = () => {
    if (!email.trim() || !phone.trim() || !password.trim()) {
      return;
    }
    onLogin?.(role);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.logoWrap}>
          <View style={styles.logoCard}>
            <Text style={styles.logoEmoji}>♻️</Text>
          </View>
          <Text style={styles.brand}>Bin2Bucks</Text>
          <Text style={styles.tagline}>Civic Tech for a Greener Future</Text>
        </View>

        <View style={styles.toggleWrap}>
          {["User", "Driver"].map((item) => {
            const active = role === item;
            return (
              <Pressable
                key={item}
                style={[styles.toggleButton, active ? styles.toggleButtonActive : null]}
                onPress={() => setRole(item)}
              >
                <Text style={[styles.toggleText, active ? styles.toggleTextActive : null]}>
                  {item.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>EMAIL ADDRESS</Text>
          <View style={styles.inputWrap}>
            <MaterialCommunityIcons name="email-outline" size={22} color={colors.muted} />
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
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>PHONE NUMBER</Text>
          <View style={styles.inputWrap}>
            <MaterialCommunityIcons name="phone-outline" size={22} color={colors.muted} />
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="(555) 000-0000"
              placeholderTextColor={INPUT_PLACEHOLDER}
              keyboardType="phone-pad"
              style={styles.input}
            />
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>PASSWORD</Text>
          <View style={styles.inputWrap}>
            <MaterialCommunityIcons name="lock-outline" size={22} color={colors.muted} />
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              placeholder="••••••••"
              placeholderTextColor={INPUT_PLACEHOLDER}
              style={styles.input}
            />
            <Pressable onPress={() => setShowPassword((prev) => !prev)}>
              <MaterialCommunityIcons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={22}
                color={colors.muted}
              />
            </Pressable>
          </View>
        </View>

        <PrimaryButton title="Log In" onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  container: {
    paddingHorizontal: 24,
    paddingBottom: 36,
    paddingTop: 46,
    gap: 22,
  },
  logoWrap: {
    alignItems: "center",
    marginBottom: 14,
  },
  logoCard: {
    width: 120,
    height: 120,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 232, 122, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.3)",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 8,
  },
  logoEmoji: {
    fontSize: 52,
  },
  brand: {
    marginTop: 18,
    color: colors.ink,
    fontSize: 56,
    lineHeight: 60,
    fontWeight: "800",
  },
  tagline: {
    marginTop: 6,
    color: colors.muted,
    fontSize: 16,
    fontWeight: "500",
  },
  toggleWrap: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 4,
    backgroundColor: colors.cardSoft,
    marginTop: 14,
  },
  toggleButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    paddingVertical: 14,
  },
  toggleButtonActive: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.2)",
  },
  toggleText: {
    color: colors.muted,
    fontWeight: "800",
    letterSpacing: 2.5,
    fontSize: 13,
  },
  toggleTextActive: {
    color: colors.primary,
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 3,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: colors.cardSoft,
  },
  input: {
    flex: 1,
    color: colors.ink,
    fontSize: 17,
    fontWeight: "500",
  },
});
