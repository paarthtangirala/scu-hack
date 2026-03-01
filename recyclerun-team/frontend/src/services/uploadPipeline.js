/**
 * Upload-to-post normalization pipeline for household flow.
 * Canonical internal row shape:
 *   { type, weight_lbs, estimated_value }
 * Final API row shape:
 *   { type, lbs, weight_lbs, estimated_value }
 */
import { api } from './api';
import { MATERIAL_RATES } from './demoData';

function roundToOneDecimal(n) {
  return Math.round(n * 10) / 10;
}

function roundToTwoDecimals(n) {
  return Math.round(n * 100) / 100;
}

function toRate(type, rates) {
  const rawRate = rates?.[type]?.rate;
  const parsed = Number(rawRate);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function toNumberOrNaN(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number(value);
}

function toCanonicalMaterialRow(row, rates = MATERIAL_RATES) {
  const type = typeof row?.type === 'string' ? row.type.trim() : '';
  if (!type) return null;

  const rawWeight = row?.weight_lbs ?? row?.lbs;
  const weight_lbs = normalizeLbs(rawWeight);
  if (weight_lbs <= 0) return null;

  const rawEstimatedValue = toNumberOrNaN(row?.estimated_value ?? row?.value);
  const estimated_value = Number.isFinite(rawEstimatedValue)
    ? roundToTwoDecimals(rawEstimatedValue)
    : roundToTwoDecimals(weight_lbs * toRate(type, rates));

  return { type, weight_lbs, estimated_value };
}

export function normalizeLbs(value) {
  const n = toNumberOrNaN(value);
  if (!Number.isFinite(n) || n <= 0) return 0.0;
  return roundToOneDecimal(n);
}

export function safeClassifyMaterials(classifyResponse, rates = MATERIAL_RATES) {
  const materials = classifyResponse?.ok ? classifyResponse?.data?.materials : null;
  if (!Array.isArray(materials)) return [];

  return materials
    .map((item) => toCanonicalMaterialRow(item, rates))
    .filter(Boolean);
}

export function mergeMaterials(aiRows = [], manualRows = [], rates = MATERIAL_RATES) {
  const mergedByType = new Map();
  const orderedTypes = [];

  const allRows = [...aiRows, ...manualRows];
  allRows.forEach((row) => {
    const canonical = toCanonicalMaterialRow(row, rates);
    if (!canonical) return;

    if (!mergedByType.has(canonical.type)) {
      mergedByType.set(canonical.type, canonical.weight_lbs);
      orderedTypes.push(canonical.type);
      return;
    }

    const prev = mergedByType.get(canonical.type);
    mergedByType.set(canonical.type, normalizeLbs(prev + canonical.weight_lbs));
  });

  return orderedTypes.map((type) => {
    const weight_lbs = normalizeLbs(mergedByType.get(type));
    return {
      type,
      weight_lbs,
      estimated_value: roundToTwoDecimals(weight_lbs * toRate(type, rates)),
    };
  });
}

export function buildListingPayload({
  form = {},
  aiMaterials = [],
  manualMaterials = [],
  lat,
  lng,
  rates = MATERIAL_RATES,
}) {
  const canonicalMaterials = mergeMaterials(aiMaterials, manualMaterials, rates);
  const safeLat = Number.isFinite(Number(lat)) ? Number(lat) : 37.3541;
  const safeLng = Number.isFinite(Number(lng)) ? Number(lng) : -121.9552;
  const listing_kind = form?.listing_kind === 'business' ? 'business' : 'household';
  const household_name = (form?.household_name ?? form?.name ?? '').toString().trim();

  return {
    listing_kind,
    household_name,
    address: (form?.address ?? '').toString(),
    phone: (form?.phone ?? '').toString(),
    notes: (form?.notes ?? '').toString(),
    lat: safeLat,
    lng: safeLng,
    materials: canonicalMaterials.map((m) => ({
      type: m.type,
      lbs: m.weight_lbs,
      weight_lbs: m.weight_lbs,
      estimated_value: m.estimated_value,
    })),
  };
}

export async function postListingFromUploadPipeline(params) {
  const payload = buildListingPayload(params);
  const response = await api.createListing(payload);
  return { response, payload };
}

