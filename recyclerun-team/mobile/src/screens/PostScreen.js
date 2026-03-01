import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "../services/api";
import { FALLBACK_MATERIALS } from "../services/materialsFallback";
import { Card, PrimaryButton, SecondaryButton, SectionKicker, colors } from "../components/ui";

const PLACEHOLDER = "rgba(120, 145, 122, 0.8)";

function randomLatLng() {
  return {
    lat: 37.3541 + (Math.random() - 0.5) * 0.05,
    lng: -121.9552 + (Math.random() - 0.5) * 0.05,
  };
}

function formatApiFailure(action, response) {
  const hint = response?.hint ? ` ${response.hint}` : "";
  return `${action} failed: ${response?.error || "Request failed"}${hint}`;
}

export function PostScreen() {
  const [materials, setMaterials] = useState(FALLBACK_MATERIALS);
  const [form, setForm] = useState({
    listing_kind: "household",
    household_name: "",
    address: "",
    phone: "",
    notes: "",
  });
  const [message, setMessage] = useState("");
  const [imageUri, setImageUri] = useState("");
  const [aiMaterials, setAiMaterials] = useState([]);
  const [manualRows, setManualRows] = useState([]);
  const [manualType, setManualType] = useState("cardboard");
  const [manualLbs, setManualLbs] = useState("");
  const [loadingClassify, setLoadingClassify] = useState(false);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const materialKeys = useMemo(() => Object.keys(materials || {}), [materials]);
  const messageIsError = /failed|required|valid|permission/i.test(message || "");

  const loadMaterials = useCallback(async () => {
    const response = await api.getMaterials();
    if (response.ok && response.data) {
      setMaterials(response.data);
      const keys = Object.keys(response.data);
      if (keys.length && !keys.includes(manualType)) setManualType(keys[0]);
      return;
    }
    setMessage(formatApiFailure("Load materials", response));
  }, [manualType]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  const addManualRow = () => {
    const lbs = Number(manualLbs);
    if (!manualType || Number.isNaN(lbs) || lbs <= 0) {
      setMessage("Enter a valid material type and lbs > 0");
      return;
    }
    setManualRows((prev) => [...prev, { id: String(Date.now()), type: manualType, lbs }]);
    setManualLbs("");
    setMessage("");
  };

  const removeManualRow = (id) => {
    setManualRows((prev) => prev.filter((row) => row.id !== id));
  };

  const pickAndClassifyImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage("Photo permission is required for AI classify");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    setImageUri(asset.uri || "");
    setLoadingClassify(true);
    setMessage("");
    const classify = await api.classifyImage(asset.base64 || "");
    if (!classify.ok) {
      setMessage(formatApiFailure("Classify", classify));
      setAiMaterials([]);
    } else {
      setAiMaterials(classify.data?.materials || []);
      setMessage("AI materials detected. Review and submit listing.");
    }
    setLoadingClassify(false);
  };

  const submitListing = async () => {
    if (!form.household_name.trim() || !form.address.trim()) {
      setMessage("Name and address are required");
      return;
    }

    const merged = [
      ...aiMaterials.map((item) => ({ type: item.type, lbs: Number(item.lbs) })),
      ...manualRows.map((item) => ({ type: item.type, lbs: Number(item.lbs) })),
    ].filter((item) => item.type && item.lbs > 0);

    if (!merged.length) {
      setMessage("Add at least one material");
      return;
    }

    setLoadingSubmit(true);
    const { lat, lng } = randomLatLng();
    const response = await api.createListing({
      ...form,
      lat,
      lng,
      materials: merged,
    });
    setLoadingSubmit(false);
    if (!response.ok) {
      setMessage(formatApiFailure("Post", response));
      return;
    }

    setMessage("Listing posted successfully");
    setForm({
      listing_kind: "household",
      household_name: "",
      address: "",
      phone: "",
      notes: "",
    });
    setImageUri("");
    setAiMaterials([]);
    setManualRows([]);
    setManualLbs("");
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Post Recyclables</Text>
      <Text style={styles.subtitle}>Help drivers optimize their route by listing your items.</Text>

      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <MaterialCommunityIcons name="camera-outline" size={16} color={colors.primary} />
          <SectionKicker title="Step 1 - Photo (AMD AI)" />
        </View>
        <Card style={styles.photoCard}>
          <Pressable style={styles.photoDrop} onPress={pickAndClassifyImage}>
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.preview} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <View style={styles.photoIconWrap}>
                  <MaterialCommunityIcons name="camera-outline" size={34} color={colors.primary} />
                </View>
                <Text style={styles.photoTitle}>{loadingClassify ? "Analyzing image..." : "Drop photo or tap to upload"}</Text>
                <Text style={styles.photoSubtitle}>Cardboard, cans, bottles, e-waste, metals</Text>
              </View>
            )}
          </Pressable>
          <PrimaryButton
            title={loadingClassify ? "Classifying..." : "Pick Image and Classify"}
            onPress={pickAndClassifyImage}
            loading={loadingClassify}
            disabled={loadingClassify}
          />
          {aiMaterials.length ? (
            <View style={styles.aiList}>
              {aiMaterials.map((item, index) => (
                <View key={`${item.type}-${index}`} style={styles.aiRow}>
                  <Text style={styles.aiText}>
                    {materials[item.type]?.emoji || "♻️"} {item.type}
                  </Text>
                  <Text style={styles.aiValue}>{Number(item.lbs || 0).toFixed(1)} lbs</Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <MaterialCommunityIcons name="account-outline" size={16} color={colors.primary} />
          <SectionKicker title="Step 2 - Your Details" />
        </View>
        <Card>
          <View style={styles.inlineRow}>
            <View style={styles.inlineCol}>
              <Text style={styles.label}>POSTING AS</Text>
              <View style={styles.kindSwitch}>
                {["household", "business"].map((kind) => {
                  const active = form.listing_kind === kind;
                  return (
                    <Pressable
                      key={kind}
                      style={[styles.kindButton, active ? styles.kindButtonActive : null]}
                      onPress={() => setForm((prev) => ({ ...prev, listing_kind: kind }))}
                    >
                      <Text style={[styles.kindText, active ? styles.kindTextActive : null]}>
                        {kind === "household" ? "Household" : "Business"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          <Text style={styles.label}>NAME</Text>
          <View style={styles.inputWrap}>
            <MaterialCommunityIcons name="account-outline" size={20} color={colors.muted} />
            <TextInput
              value={form.household_name}
              onChangeText={(text) => setForm((prev) => ({ ...prev, household_name: text }))}
              placeholder="Your name"
              placeholderTextColor={PLACEHOLDER}
              style={styles.input}
            />
          </View>

          <Text style={styles.label}>PICKUP ADDRESS</Text>
          <View style={styles.inputWrap}>
            <MaterialCommunityIcons name="map-marker-outline" size={20} color={colors.muted} />
            <TextInput
              value={form.address}
              onChangeText={(text) => setForm((prev) => ({ ...prev, address: text }))}
              placeholder="123 Eco St, Santa Clara"
              placeholderTextColor={PLACEHOLDER}
              style={styles.input}
            />
          </View>

          <Text style={styles.label}>PHONE NUMBER</Text>
          <View style={styles.inputWrap}>
            <MaterialCommunityIcons name="phone-outline" size={20} color={colors.muted} />
            <TextInput
              value={form.phone}
              onChangeText={(text) => setForm((prev) => ({ ...prev, phone: text }))}
              placeholder="(555) 000-0000"
              placeholderTextColor={PLACEHOLDER}
              keyboardType="phone-pad"
              style={styles.input}
            />
          </View>

          <Text style={styles.label}>DRIVER NOTES</Text>
          <View style={[styles.inputWrap, styles.notesWrap]}>
            <MaterialCommunityIcons name="note-text-outline" size={20} color={colors.muted} style={styles.notesIcon} />
            <TextInput
              value={form.notes}
              onChangeText={(text) => setForm((prev) => ({ ...prev, notes: text }))}
              placeholder="e.g. Gate code, specific location"
              placeholderTextColor={PLACEHOLDER}
              multiline
              style={[styles.input, styles.notesInput]}
            />
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <MaterialCommunityIcons name="plus" size={18} color={colors.primary} />
          <SectionKicker title="Or Add Materials Manually" />
        </View>
        <Card>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.materialChips}>
            {materialKeys.map((key) => {
              const active = manualType === key;
              return (
                <Pressable
                  key={key}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => setManualType(key)}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                    {materials[key]?.emoji || "♻️"} {materials[key]?.label || key}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.manualRow}>
            <View style={[styles.inputWrap, styles.manualInputWrap]}>
              <TextInput
                value={manualLbs}
                onChangeText={setManualLbs}
                placeholder="lbs"
                placeholderTextColor={PLACEHOLDER}
                keyboardType="decimal-pad"
                style={styles.input}
              />
            </View>
            <Pressable onPress={addManualRow} style={styles.plusButton}>
              <MaterialCommunityIcons name="plus" size={26} color={colors.primary} />
            </Pressable>
          </View>
          {manualRows.length ? (
            <View style={styles.manualList}>
              {manualRows.map((row) => (
                <View key={row.id} style={styles.manualItem}>
                  <Text style={styles.manualText}>
                    {materials[row.type]?.emoji || "♻️"} {materials[row.type]?.label || row.type} - {row.lbs.toFixed(1)} lbs
                  </Text>
                  <SecondaryButton title="Remove" onPress={() => removeManualRow(row.id)} />
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      </View>

      {message ? (
        <Text style={[styles.message, messageIsError ? styles.messageError : styles.messageSuccess]}>
          {message}
        </Text>
      ) : null}

      <PrimaryButton
        title={loadingSubmit ? "Posting..." : "Post Listing to Map"}
        onPress={submitListing}
        loading={loadingSubmit}
        disabled={loadingSubmit}
      />
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
  subtitle: {
    color: colors.muted,
    fontSize: 18,
    lineHeight: 29,
    marginTop: 8,
    maxWidth: "95%",
  },
  section: {
    marginTop: 24,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  photoCard: {
    gap: 12,
  },
  photoDrop: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    minHeight: 240,
    overflow: "hidden",
  },
  photoPlaceholder: {
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
  },
  photoIconWrap: {
    width: 94,
    height: 94,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.3)",
    backgroundColor: "rgba(0, 232, 122, 0.08)",
  },
  photoTitle: {
    color: colors.ink,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "800",
    textAlign: "center",
  },
  photoSubtitle: {
    color: colors.muted,
    fontSize: 16,
    textAlign: "center",
  },
  preview: {
    width: "100%",
    height: 260,
  },
  aiList: {
    marginTop: 4,
    gap: 8,
  },
  aiRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: colors.cardSoft,
  },
  aiText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  aiValue: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: "800",
  },
  inlineRow: {
    marginBottom: 12,
  },
  inlineCol: {
    flex: 1,
  },
  label: {
    marginBottom: 8,
    color: colors.muted,
    fontWeight: "800",
    letterSpacing: 2.5,
    fontSize: 13,
  },
  kindSwitch: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    marginBottom: 14,
  },
  kindButton: {
    flex: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  kindButtonActive: {
    backgroundColor: "rgba(0, 232, 122, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.35)",
  },
  kindText: {
    color: colors.muted,
    fontWeight: "800",
    fontSize: 16,
  },
  kindTextActive: {
    color: colors.primary,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 17,
    backgroundColor: colors.cardSoft,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 14,
  },
  input: {
    flex: 1,
    color: colors.ink,
    fontSize: 16,
    fontWeight: "500",
  },
  notesWrap: {
    minHeight: 140,
    alignItems: "flex-start",
  },
  notesIcon: {
    marginTop: 2,
  },
  notesInput: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  materialChips: {
    marginBottom: 10,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.cardSoft,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginRight: 8,
  },
  chipActive: {
    borderColor: "rgba(0, 232, 122, 0.35)",
    backgroundColor: "rgba(0, 232, 122, 0.15)",
  },
  chipText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  chipTextActive: {
    color: colors.primary,
  },
  manualRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  manualInputWrap: {
    flex: 1,
    marginBottom: 0,
  },
  plusButton: {
    width: 58,
    height: 58,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(0, 232, 122, 0.3)",
    backgroundColor: "rgba(0, 232, 122, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  manualList: {
    marginTop: 12,
    gap: 10,
  },
  manualItem: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  manualText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 8,
  },
  message: {
    marginTop: 8,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: "700",
  },
  messageError: {
    color: colors.danger,
    borderColor: "rgba(255, 107, 107, 0.35)",
    backgroundColor: "rgba(255, 107, 107, 0.12)",
  },
  messageSuccess: {
    color: colors.primary,
    borderColor: "rgba(0, 232, 122, 0.35)",
    backgroundColor: "rgba(0, 232, 122, 0.12)",
  },
});
