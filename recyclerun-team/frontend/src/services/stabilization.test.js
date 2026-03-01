import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import {
  buildColdStartState,
  getResponsiveLayout,
  normalizeListingsForRender,
  normalizeNotificationsForRender,
  normalizeRouteStopsForRender,
  runSafeAsync,
  safeNumber,
} from './stabilization';
import { NotificationOverlay } from '../components/shared/NotificationOverlay.jsx';
import { StopCard } from '../components/driver/StopCard.jsx';

vi.mock('./api.js', () => ({
  api: {
    getListings: vi.fn(),
    getImpact: vi.fn(),
    getMaterials: vi.fn(),
  },
}));

function RouteStopsHarness({ stops }) {
  const safeStops = normalizeRouteStopsForRender(stops);
  return React.createElement(
    'div',
    null,
    safeStops.map((stop, index) =>
      React.createElement(StopCard, {
        key: stop.id,
        stop,
        index,
        completed: false,
        onComplete: () => {},
      })
    )
  );
}

function ListingCardHarness({ listings }) {
  const safeListings = normalizeListingsForRender(listings);
  return React.createElement(
    'div',
    null,
    safeListings.map((listing) =>
      React.createElement(
        'div',
        { key: listing.id },
        `${listing.household_name} @ ${listing.address} · $${safeNumber(listing.total_value, 0).toFixed(2)}`
      )
    )
  );
}

function NotificationHarness({ notifications }) {
  const safeNotifications = normalizeNotificationsForRender(notifications);
  return React.createElement(NotificationOverlay, {
    notifications: safeNotifications,
    onClose: () => {},
  });
}

describe('frontend stabilization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Null safety: route component renders without crash when stops is null, undefined, or empty array', () => {
    expect(() => renderToString(React.createElement(RouteStopsHarness, { stops: null }))).not.toThrow();
    expect(() => renderToString(React.createElement(RouteStopsHarness, { stops: undefined }))).not.toThrow();
    expect(() => renderToString(React.createElement(RouteStopsHarness, { stops: [] }))).not.toThrow();
  });

  it('Null safety: listing card renders without crash when required fields are missing', () => {
    const malformed = [
      { id: 'listing-a' },
      { household_name: undefined, address: null, total_value: undefined },
      null,
    ];

    expect(() => renderToString(React.createElement(ListingCardHarness, { listings: malformed }))).not.toThrow();
  });

  it('Null safety: notification component renders without crash when notifications is null or empty', () => {
    expect(() => renderToString(React.createElement(NotificationHarness, { notifications: null }))).not.toThrow();
    expect(() => renderToString(React.createElement(NotificationHarness, { notifications: [] }))).not.toThrow();
  });

  it('Promise handling: async service wrappers resolve without unhandled rejection on API failure', async () => {
    api.getListings.mockRejectedValue(new Error('listings down'));
    api.getImpact.mockRejectedValue(new Error('impact down'));
    api.getMaterials.mockRejectedValue(new Error('materials down'));

    await expect(buildColdStartState()).resolves.toBeDefined();
    await expect(runSafeAsync(() => Promise.reject(new Error('boom')), { ok: false })).resolves.toEqual({ ok: false });
  });

  it('Cold start: full demo flow from empty state initializes without console errors', async () => {
    api.getListings.mockResolvedValue({ ok: false, status: 0, error: 'offline' });
    api.getImpact.mockResolvedValue({ ok: false, status: 0, error: 'offline' });
    api.getMaterials.mockResolvedValue({ ok: false, status: 0, error: 'offline' });

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const coldStart = await buildColdStartState();

    expect(coldStart.listings.length).toBeGreaterThan(0);
    expect(Array.isArray(coldStart.errors)).toBe(true);
    expect(errSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('Responsiveness: key layout containers return correct tokens at 1280px and 390px', () => {
    const desktop = getResponsiveLayout(1280);
    const phone = getResponsiveLayout(390);

    expect(desktop.driver.mapHeight).toBe(380);
    expect(desktop.driver.controlColumns).toBe('repeat(2,minmax(0,1fr))');
    expect(desktop.rates.tableMinWidth).toBe(760);

    expect(phone.driver.mapHeight).toBe(260);
    expect(phone.driver.controlColumns).toBe('1fr');
    expect(phone.rates.tableMinWidth).toBe(640);
    expect(phone.isPhone).toBe(true);
  });
});
