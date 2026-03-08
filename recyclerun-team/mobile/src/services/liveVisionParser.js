import { FALLBACK_MATERIALS } from "./materialsFallback";

const FENCED_JSON_PATTERN = /```(?:json)?\s*([\s\S]*?)```/gi;

const MATERIAL_TYPE_ALIASES = {
  aluminum: "aluminum_cans",
  "aluminum can": "aluminum_cans",
  "aluminum cans": "aluminum_cans",
  "aluminium can": "aluminum_cans",
  "aluminium cans": "aluminum_cans",
  "cardboard box": "cardboard",
  "cardboard boxes": "cardboard",
  "pet plastic": "plastic_pet",
  "pet bottle": "plastic_pet",
  "pet bottles": "plastic_pet",
  "hdpe plastic": "plastic_hdpe",
  "hdpe bottle": "plastic_hdpe",
  "hdpe bottles": "plastic_hdpe",
  "glass bottle": "glass_bottles",
  "glass bottles": "glass_bottles",
  copper: "copper_wire",
  "scrap aluminum": "scrap_aluminum",
  "scrap metal": "scrap_metal_mixed",
  "mixed scrap metal": "scrap_metal_mixed",
  steel: "steel_iron",
  iron: "steel_iron",
  "newspaper paper": "newspaper",
  "e waste crt": "ewaste_crt",
  "e waste noncrt": "ewaste_noncrt",
  ewaste: "ewaste_noncrt",
};

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function extractBalancedJson(text) {
  const out = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

function extractJsonCandidates(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  const seen = new Set();
  const out = [];
  const push = (candidate) => {
    const normalized = String(candidate || "").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  push(text);
  for (const match of text.matchAll(FENCED_JSON_PATTERN)) {
    push(match[1]);
  }
  extractBalancedJson(text).forEach(push);
  return out;
}

function normalizeMaterialType(rawType) {
  const normalized = String(rawType || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return "";
  if (FALLBACK_MATERIALS[normalized]) return normalized;
  return MATERIAL_TYPE_ALIASES[normalized.replace(/_/g, " ")] || "";
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;
  const preferred = [
    payload.materials,
    payload.recyclable_materials,
    payload.recyclables,
    payload.items,
    payload.detections,
  ];
  for (const value of preferred) {
    if (Array.isArray(value)) return value;
  }
  return null;
}

function coerceRow(item) {
  if (!item || typeof item !== "object") return null;
  const type = normalizeMaterialType(
    item.type || item.material || item.material_type || item.name || item.label,
  );
  if (!type) return null;

  const count = Math.max(1, Math.round(safeNumber(item.count ?? item.quantity ?? item.instances ?? item.num_items, 1)));
  const lbsRaw =
    item.lbs ??
    item.weight_lbs ??
    item.estimated_weight_lbs ??
    item.weight ??
    item.estimated_weight ??
    item.pounds ??
    item.mass_lbs;
  const lbs = Math.round(Math.max(0, safeNumber(String(lbsRaw || "").match(/-?\d+(?:\.\d+)?/)?.[0] ?? lbsRaw, 0)) * 10) / 10;
  if (lbs <= 0) return null;

  const rate = safeNumber(FALLBACK_MATERIALS[type]?.rate, 0);
  const confidence = Math.max(
    0,
    Math.min(1, safeNumber(item.confidence ?? item.score ?? item.probability, 0.8)),
  );
  const weightConfidence = Math.max(
    0,
    Math.min(1, safeNumber(item.weight_confidence ?? confidence, confidence)),
  );
  const low = Math.round(Math.max(0, safeNumber(item.weight_low ?? item.estimated_lbs_low, lbs * 0.75)) * 10) / 10;
  const high = Math.round(Math.max(lbs, safeNumber(item.weight_high ?? item.estimated_lbs_high, lbs * 1.25)) * 10) / 10;
  return {
    type,
    lbs,
    count,
    value: Math.round(lbs * rate * 100) / 100,
    confidence,
    weight_confidence: weightConfidence,
    weight_low: low,
    weight_high: high,
    provenance: typeof item.provenance === "string" ? item.provenance.trim() : "",
    candidate_id: typeof item.candidate_id === "string" ? item.candidate_id.trim() : "",
  };
}

export function parseLiveModelText(text) {
  const candidates = extractJsonCandidates(text);
  for (const candidate of candidates) {
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const rows = extractRows(parsed);
    if (!Array.isArray(rows)) continue;
    const materials = rows.map(coerceRow).filter(Boolean);
    const notes = typeof parsed.notes === "string"
      ? parsed.notes
      : typeof parsed.summary === "string"
        ? parsed.summary
        : "";
    return {
      materials,
      notes,
      total_lbs: Math.round(materials.reduce((sum, row) => sum + safeNumber(row.lbs, 0), 0) * 10) / 10,
      total_value: Math.round(materials.reduce((sum, row) => sum + safeNumber(row.value, 0), 0) * 100) / 100,
    };
  }
  return null;
}

export function normalizeLiveRows(rows, { lockedTypes = [] } = {}) {
  const locked = new Set((lockedTypes || []).map((item) => String(item || "").trim()).filter(Boolean));
  const merged = new Map();
  const ordered = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const next = coerceRow(row);
    if (!next || locked.has(next.type)) continue;
    if (!merged.has(next.type)) {
      merged.set(next.type, { ...next });
      ordered.push(next.type);
      continue;
    }
    const current = merged.get(next.type);
    current.lbs = Math.round((current.lbs + next.lbs) * 10) / 10;
    current.value = Math.round((current.value + next.value) * 100) / 100;
    current.count += next.count;
    current.confidence = Math.max(current.confidence, next.confidence);
    current.weight_confidence = Math.max(current.weight_confidence, next.weight_confidence);
    current.weight_low = Math.round(Math.min(current.weight_low, next.weight_low) * 10) / 10;
    current.weight_high = Math.round(Math.max(current.weight_high, next.weight_high) * 10) / 10;
    if (!current.provenance && next.provenance) current.provenance = next.provenance;
  }

  return ordered.map((type) => merged.get(type));
}

export function buildLiveDetectionSignature(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const type = String(row?.type || "").trim();
      if (!type) return "";
      const count = Math.max(1, Math.round(safeNumber(row?.count, 1)));
      const lbs = Math.round(Math.max(0, safeNumber(row?.lbs, 0)) * 10) / 10;
      if (lbs <= 0) return "";
      return `${type}:${count}:${lbs.toFixed(1)}`;
    })
    .filter(Boolean)
    .sort()
    .join("|");
}

export function buildSuggestedMaterialRow(row) {
  const normalized = coerceRow(row);
  if (!normalized) return null;
  return {
    type: normalized.type,
    lbs: normalized.lbs,
    count: normalized.count,
    confidence: normalized.confidence,
    weight_confidence: normalized.weight_confidence,
    weight_low: normalized.weight_low,
    weight_high: normalized.weight_high,
    provenance: normalized.provenance,
    candidate_id: normalized.candidate_id,
  };
}
