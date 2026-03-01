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

import { Card, PrimaryButton, SectionTitle, SecondaryButton, colors } from "../components/ui";
import { api } from "../services/api";
import { FALLBACK_MATERIALS } from "../services/materialsFallback";

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

  const materialKeys = useMemo(() => Object.keys(materials), [materials]);

  const loadMaterials = useCallback(async () => {
    const response = await api.getMaterials();
    if (response.ok && response.data) {
      setMaterials(response.data);
      const keys = Object.keys(response.data);
      if (keys.length && !keys.includes(manualType)) {
        setManualType(keys[0]);
      }
    } else {
      setMessage(formatApiFailure("Load materials", response));
    }
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
    if (result.canceled || !result.assets?.length) {
      return;
    }

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
      ...aiMaterials.map((m) => ({ type: m.type, lbs: Number(m.lbs) })),
      ...manualRows.map((m) => ({ type: m.type, lbs: Number(m.lbs) })),
    ].filter((m) => m.type && m.lbs > 0);

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
      <SectionTitle title="Post Listing" subtitle="Household or small business pickup request" />

      <Card>
        <Text style={styles.label}>Listing Type</Text>
        <View style={styles.toggleRow}>
          {["household", "business"].map((kind) => (
            <Pressable
              key={kind}
              style={[styles.toggle, form.listing_kind === kind ? styles.toggleActive : null]}
              onPress={() => setForm((prev) => ({ ...prev, listing_kind: kind }))}
            >
              <Text style={form.listing_kind === kind ? styles.toggleTextActive : styles.toggleText}>
                {kind === "household" ? "Household" : "Business"}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          value={form.household_name}
          onChangeText={(text) => setForm((prev) => ({ ...prev, household_name: text }))}
          placeholder="Name"
          style={styles.input}
        />
        <TextInput
          value={form.address}
          onChangeText={(text) => setForm((prev) => ({ ...prev, address: text }))}
          placeholder="Address"
          style={styles.input}
        />
        <TextInput
          value={form.phone}
          onChangeText={(text) => setForm((prev) => ({ ...prev, phone: text }))}
          placeholder="Phone"
          style={styles.input}
        />
        <TextInput
          value={form.notes}
          onChangeText={(text) => setForm((prev) => ({ ...prev, notes: text }))}
          placeholder="Notes"
          multiline
          style={[styles.input, styles.multiline]}
        />
      </Card>

      <Card>
        <Text style={styles.subTitle}>AI Classify (Photo)</Text>
        {imageUri ? <Image source={{ uri: imageUri }} style={styles.preview} /> : null}
        <PrimaryButton
          title={loadingClassify ? "Classifying..." : "Pick Image and Classify"}
          onPress={pickAndClassifyImage}
          loading={loadingClassify}
          disabled={loadingClassify}
        />
        {aiMaterials.length ? (
          <View style={styles.materialList}>
            {aiMaterials.map((m, idx) => (
              <Text style={styles.materialRow} key={`${m.type}-${idx}`}>
                {materials[m.type]?.emoji || "♻️"} {m.type} - {Number(m.lbs).toFixed(1)} lbs
              </Text>
            ))}
          </View>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.subTitle}>Manual Materials</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalList}>
          {materialKeys.map((key) => (
            <Pressable
              key={key}
              style={[styles.chip, manualType === key ? styles.chipActive : null]}
              onPress={() => setManualType(key)}
            >
              <Text style={manualType === key ? styles.chipTextActive : styles.chipText}>
                {materials[key]?.emoji || "♻️"} {key}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.inlineInputs}>
          <TextInput
            value={manualLbs}
            onChangeText={setManualLbs}
            keyboardType="decimal-pad"
            placeholder="Lbs"
            style={[styles.input, styles.inlineInput]}
          />
          <PrimaryButton title="Add" onPress={addManualRow} />
        </View>
        {manualRows.map((row) => (
          <View key={row.id} style={styles.manualRow}>
            <Text style={styles.manualText}>
              {materials[row.type]?.emoji || "♻️"} {row.type} - {row.lbs.toFixed(1)} lbs
            </Text>
            <SecondaryButton title="Remove" onPress={() => removeManualRow(row.id)} />
          </View>
        ))}
      </Card>

      {message ? <Text style={styles.message}>{message}</Text> : null}
      <PrimaryButton
        title={loadingSubmit ? "Posting..." : "Post Listing"}
        onPress={submitListing}
        loading={loadingSubmit}
        disabled={loadingSubmit}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 14,
    paddingBottom: 120,
    backgroundColor: colors.bg,
  },
  label: {
    color: colors.ink,
    marginBottom: 8,
    fontWeight: "700",
  },
  toggleRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  toggle: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#FCFBF6",
  },
  toggleActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  toggleText: { color: colors.ink, fontWeight: "600" },
  toggleTextActive: { color: "#fff", fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  multiline: {
    minHeight: 70,
    textAlignVertical: "top",
  },
  subTitle: {
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 10,
  },
  preview: {
    width: "100%",
    height: 170,
    borderRadius: 12,
    marginBottom: 10,
  },
  materialList: {
    marginTop: 10,
    gap: 4,
  },
  materialRow: {
    color: colors.ink,
    fontSize: 13,
  },
  horizontalList: {
    marginBottom: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginRight: 8,
    backgroundColor: "#fff",
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: "#EAF8F3",
  },
  chipText: { color: colors.ink, fontSize: 12 },
  chipTextActive: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  inlineInputs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inlineInput: {
    flex: 1,
    marginBottom: 0,
  },
  manualRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  manualText: {
    flex: 1,
    marginRight: 8,
    color: colors.ink,
    fontSize: 13,
  },
  message: {
    marginBottom: 8,
    color: colors.ink,
    fontSize: 13,
  },
});
