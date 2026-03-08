import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildImpactCards,
  loadImpactData,
  loadMaterialsData,
  sourceLabel,
} from './impactRates';
import { api } from './api';

vi.mock('./api', () => ({
  api: {
    getOrgDashboard: vi.fn(),
    getImpact: vi.fn(),
    getMaterials: vi.fn(),
  },
}));

function makeStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
  };
}

describe('impact + rates pipeline orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getOrgDashboard.mockResolvedValue({ ok: false, status: 404, error: 'not configured' });
  });

  it('Live data: /api/orgs/:id/dashboard returns ok:true and ImpactPage model renders receipt-derived values correctly', async () => {
    api.getOrgDashboard.mockResolvedValue({
      ok: true,
      data: {
        org: { id: 'org_santa_clara_demo', name: 'Santa Clara Diversion Pilot' },
        summary: {
          completed_pickups: 12,
          total_lbs_diverted: 208.4,
          total_value_paid: 99.5,
          contamination_rate: 0.08,
          mean_pickup_time_minutes: 42,
          mean_estimated_confidence: 0.81,
          mean_variance_lbs: 3.4,
        },
        latest_receipts: [
          { receipt_id: 'receipt_1', household_name: 'Chen Family', actual_total_lbs: 20.1, actual_total_value: 8.5 },
        ],
        hotspots: [],
        export_links: {},
      },
    });

    const result = await loadImpactData({ storage: makeStorage(), window: '90d' });
    const cards = buildImpactCards(result.stats);

    expect(result.state).toBe('live');
    expect(result.source).toBe('live');
    expect(result.dashboard?.org?.id).toBe('org_santa_clara_demo');
    expect(api.getOrgDashboard).toHaveBeenCalledWith('org_santa_clara_demo', { window: '90d' });
    expect(cards[0].num).toBe(12);
    expect(cards[1].num).toBe('208.4 lbs');
    expect(cards[2].num).toBe('$99.5');
  });

  it('Live data: /api/materials returns ok:true and MaterialsPage model renders live values correctly', async () => {
    api.getMaterials.mockResolvedValue({
      ok: true,
      data: {
        cardboard: { rate: 0.04, label: 'Cardboard', emoji: '📦' },
        aluminum_cans: { rate: 1.65, label: 'Aluminum Cans', emoji: '🥫' },
      },
    });

    const result = await loadMaterialsData({ storage: makeStorage() });

    expect(result.state).toBe('live');
    expect(result.source).toBe('live');
    expect(result.materials).toHaveLength(2);
    expect(result.materials.find((m) => m.type === 'aluminum_cans')?.rate).toBe(1.65);
  });

  it('Error state: /api/impact returns ok:false and page model reports error without crashing', async () => {
    api.getImpact.mockResolvedValue({ ok: false, status: 500, error: 'server exploded' });

    const result = await loadImpactData({ storage: makeStorage() });

    expect(result.state).toBe('error');
    expect(result.error).toBe('server exploded');
    expect(result.stats).toBeNull();
  });

  it('Error state: /api/materials returns ok:false and page model reports error without crashing', async () => {
    api.getMaterials.mockResolvedValue({ ok: false, status: 503, error: 'maintenance' });

    const result = await loadMaterialsData({ storage: makeStorage() });

    expect(result.state).toBe('error');
    expect(result.error).toBe('maintenance');
    expect(result.materials).toEqual([]);
  });

  it('Offline fallback: backend unavailable triggers fallback values with source indicator visible', async () => {
    api.getOrgDashboard.mockResolvedValue({ ok: false, status: 0, error: 'Network error' });
    api.getImpact.mockResolvedValue({ ok: false, status: 0, error: 'Network error' });

    const result = await loadImpactData({ storage: makeStorage() });

    expect(result.state).toBe('offline');
    expect(result.source).toBe('demo');
    expect(result.stats).not.toBeNull();
    expect(sourceLabel(result.source)).toBe('Demo fallback');
  });

  it('Empty state: impact ok with empty payload returns empty state', async () => {
    api.getOrgDashboard.mockResolvedValue({ ok: false, status: 404, error: 'not configured' });
    api.getImpact.mockResolvedValue({ ok: true, data: {} });

    const result = await loadImpactData({ storage: makeStorage() });

    expect(result.state).toBe('empty');
    expect(result.source).toBe('live');
    expect(result.stats).toBeNull();
  });

  it('Empty state: materials ok with empty array returns empty state', async () => {
    api.getMaterials.mockResolvedValue({ ok: true, data: [] });

    const result = await loadMaterialsData({ storage: makeStorage() });

    expect(result.state).toBe('empty');
    expect(result.source).toBe('live');
    expect(result.materials).toEqual([]);
  });

  it('Source indicator: live data shows live indicator, fallback shows fallback indicator', async () => {
    api.getMaterials.mockResolvedValueOnce({
      ok: true,
      data: { cardboard: { rate: 0.04, label: 'Cardboard', emoji: '📦' } },
    });
    api.getMaterials.mockResolvedValueOnce({ ok: false, status: 0, error: 'offline' });

    const storage = makeStorage();
    const live = await loadMaterialsData({ storage });
    const fallback = await loadMaterialsData({ storage });

    expect(live.source).toBe('live');
    expect(sourceLabel(live.source)).toBe('Live backend');
    expect(fallback.source).toBe('cache');
    expect(sourceLabel(fallback.source)).toBe('Offline cache');
  });
});
