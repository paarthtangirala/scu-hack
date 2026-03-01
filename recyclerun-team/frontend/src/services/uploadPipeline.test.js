import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyAiAutofill,
  buildListingPayload,
  mergeMaterials,
  normalizeLbs,
  postListingFromUploadPipeline,
  safeClassifyMaterials,
} from './uploadPipeline';
import { api } from './api';

vi.mock('./api', () => ({
  api: {
    createListing: vi.fn(),
  },
}));

describe('upload pipeline hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deduplicates same material type from AI + manual into one merged row', () => {
    const merged = mergeMaterials(
      [{ type: 'cardboard', lbs: 2.0 }],
      [{ type: 'cardboard', lbs: 1.5 }]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      type: 'cardboard',
      weight_lbs: 3.5,
      estimated_value: 0.14,
    });
  });

  it('normalizes precision: 2.3333 -> 2.3 and NaN -> 0.0', () => {
    expect(normalizeLbs(2.3333)).toBe(2.3);
    expect(normalizeLbs(Number.NaN)).toBe(0.0);
  });

  it('defensive guard: classify { ok: true, data: {} } returns empty materials and does not crash', () => {
    expect(() => safeClassifyMaterials({ ok: true, data: {} })).not.toThrow();
    expect(safeClassifyMaterials({ ok: true, data: {} })).toEqual([]);
  });

  it('defensive guard: classify with materials as null returns empty materials and does not crash', () => {
    const response = { ok: true, data: { materials: null } };
    expect(() => safeClassifyMaterials(response)).not.toThrow();
    expect(safeClassifyMaterials(response)).toEqual([]);
  });

  it('buildListingPayload always includes required fields and material keys', () => {
    const payload = buildListingPayload({
      form: {
        listing_kind: 'household',
        name: 'Atharva',
        address: '500 El Camino',
        phone: '123',
        notes: 'n/a',
      },
      aiMaterials: [{ type: 'aluminum_cans', lbs: 2.3333 }],
      manualMaterials: [{ type: 'cardboard', lbs: Number.NaN }],
      lat: 37.1,
      lng: -121.9,
    });

    expect(payload).toMatchObject({
      listing_kind: 'household',
      address: '500 El Camino',
      lat: 37.1,
      lng: -121.9,
    });
    expect(Array.isArray(payload.materials)).toBe(true);
    expect(payload.materials[0]).toHaveProperty('type');
    expect(payload.materials[0]).toHaveProperty('lbs');
    expect(payload.materials[0]).toHaveProperty('weight_lbs');
    expect(payload.materials[0]).toHaveProperty('estimated_value');
  });

  it('both listing_kind values produce valid payloads', () => {
    const householdPayload = buildListingPayload({
      form: { listing_kind: 'household', household_name: 'H', address: 'A' },
      aiMaterials: [{ type: 'cardboard', lbs: 1.1 }],
      manualMaterials: [],
      lat: 37.2,
      lng: -121.8,
    });
    const businessPayload = buildListingPayload({
      form: { listing_kind: 'business', household_name: 'B', address: 'A' },
      aiMaterials: [{ type: 'cardboard', lbs: 1.1 }],
      manualMaterials: [],
      lat: 37.2,
      lng: -121.8,
    });

    expect(householdPayload.listing_kind).toBe('household');
    expect(businessPayload.listing_kind).toBe('business');
    expect(householdPayload.materials[0].lbs).toBe(1.1);
    expect(businessPayload.materials[0].lbs).toBe(1.1);
  });

  it('posts payload through api.createListing with lbs derived from canonical weight_lbs', async () => {
    api.createListing.mockResolvedValue({ ok: true, data: { id: 'listing_1' } });

    const { payload } = await postListingFromUploadPipeline({
      form: { listing_kind: 'household', household_name: 'Atharva', address: 'Address' },
      aiMaterials: [{ type: 'cardboard', lbs: 2.3333 }],
      manualMaterials: [{ type: 'cardboard', lbs: 1.0 }],
      lat: 37.3,
      lng: -121.7,
    });

    expect(api.createListing).toHaveBeenCalledTimes(1);
    const posted = api.createListing.mock.calls[0][0];
    expect(posted.materials).toHaveLength(1);
    expect(posted.materials[0]).toMatchObject({
      type: 'cardboard',
      lbs: 3.3,
      weight_lbs: 3.3,
      estimated_value: 0.13,
    });
    expect(payload.materials[0].lbs).toBe(payload.materials[0].weight_lbs);
  });

  it('applies AI autofill while respecting locked manual override types', () => {
    const aiRows = [
      { type: 'cardboard', lbs: 2.0 },
      { type: 'aluminum_cans', lbs: 1.5 },
      { type: 'cardboard', lbs: 1.0 },
    ];
    const next = applyAiAutofill(aiRows, ['cardboard']);

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ type: 'aluminum_cans', weight_lbs: 1.5 });
  });

  it('manual lock prevents AI overwrite in merged payload rows', () => {
    const merged = mergeMaterials(
      [{ type: 'cardboard', lbs: 4.0 }, { type: 'aluminum_cans', lbs: 1.0 }],
      [{ type: 'cardboard', lbs: 2.5 }],
      undefined,
      ['cardboard']
    );

    const byType = Object.fromEntries(merged.map((m) => [m.type, m]));
    expect(byType.cardboard.weight_lbs).toBe(2.5);
    expect(byType.aluminum_cans.weight_lbs).toBe(1.0);
  });

  it('AI autofill is stable for repeated identical suggestions', () => {
    const aiRows = [
      { type: 'plastic_pet', lbs: 1.4 },
      { type: 'plastic_pet', lbs: 0.6 },
    ];

    const first = applyAiAutofill(aiRows, []);
    const second = applyAiAutofill(aiRows, []);
    expect(first).toEqual(second);
  });
});
