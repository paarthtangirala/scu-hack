import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyCompletionSuccess,
  completeStopPersisted,
  summarizeAcceptFailures,
  summarizeRouteCompletion,
} from './stopCompletion';
import { api } from './api';

vi.mock('./api', () => ({
  api: {
    completeListing: vi.fn(),
  },
}));

const STOP_A = {
  listing_id: 'listing_a',
  household_name: 'A House',
  total_lbs: 10.5,
  total_value: 3.25,
  phone: '+14080000001',
};

const STOP_B = {
  listing_id: 'listing_b',
  household_name: 'B House',
  total_lbs: 20,
  total_value: 5.5,
  phone: '+14080000002',
};

describe('stop completion orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('idempotency: calling complete on already-completed stop does not trigger another API call', async () => {
    const completed = new Set(['listing_a']);
    const res = await completeStopPersisted({
      stop: STOP_A,
      completedIds: completed,
      inFlightIds: new Set(),
    });

    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('already_completed');
    expect(api.completeListing).not.toHaveBeenCalled();
  });

  it('state update: marking stop complete updates local state immediately', () => {
    const initial = { completedIds: new Set(), collectedLbs: 0, earnedDollars: 0 };
    const next = applyCompletionSuccess(initial, STOP_A);

    expect(next.changed).toBe(true);
    expect(next.completedIds.has('listing_a')).toBe(true);
    expect(next.collectedLbs).toBe(10.5);
    expect(next.earnedDollars).toBe(3.25);
  });

  it('aggregate refresh: truck meter and completion counts update correctly after stop completion', () => {
    const first = applyCompletionSuccess({ completedIds: new Set(), collectedLbs: 0, earnedDollars: 0 }, STOP_A);
    const second = applyCompletionSuccess(first, STOP_B);
    const completion = summarizeRouteCompletion({
      routeStops: [STOP_A, STOP_B],
      completedIds: second.completedIds,
    });

    expect(second.collectedLbs).toBe(30.5);
    expect(second.earnedDollars).toBe(8.75);
    expect(completion.completedStops).toBe(2);
    expect(completion.totalStops).toBe(2);
    expect(completion.allCompleted).toBe(true);
  });

  it('partial failure: accept-route response with failed notifications identifies failed stops', () => {
    const summary = summarizeAcceptFailures(
      {
        requested_stops: 2,
        notifications_sent: 1,
        notifications: [
          {
            listing_id: 'listing_a',
            status_code: 'claimed_notified',
            retryable: false,
            attempts: 1,
            household: 'A House',
            phone: '+14080000001',
            notification: { success: true, mode: 'live' },
          },
          {
            listing_id: 'listing_b',
            status_code: 'notification_failed',
            retryable: true,
            attempts: 2,
            household: 'B House',
            phone: '+14080000002',
            notification: { success: false, mode: 'failed', error: 'twilio timeout' },
          },
        ],
      },
      [STOP_A, STOP_B]
    );

    expect(summary.notificationsSent).toBe(1);
    expect(summary.totalStopsRequested).toBe(2);
    expect(summary.failedNotificationsCount).toBe(1);
    expect(summary.failedStops[0]).toMatchObject({
      listing_id: 'listing_b',
      household: 'B House',
      status_code: 'notification_failed',
      reason: 'twilio timeout',
      retryable: true,
    });
  });

  it('error handling: complete endpoint failure returns ok:false and stop is not completed locally', async () => {
    api.completeListing.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'internal error',
    });

    const res = await completeStopPersisted({
      stop: STOP_A,
      completedIds: new Set(),
      inFlightIds: new Set(),
    });
    const state = applyCompletionSuccess(
      { completedIds: new Set(), collectedLbs: 0, earnedDollars: 0 },
      res.ok ? STOP_A : { listing_id: '', total_lbs: 0, total_value: 0 }
    );

    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    expect(api.completeListing).toHaveBeenCalledTimes(1);
    expect(state.completedIds.has('listing_a')).toBe(false);
  });

  it('full flow: completing all stops yields correct final state', async () => {
    api.completeListing.mockResolvedValue({ ok: true, data: { listing: { status: 'completed' } } });

    let state = { completedIds: new Set(), collectedLbs: 0, earnedDollars: 0 };
    const stops = [STOP_A, STOP_B];
    for (const stop of stops) {
      const res = await completeStopPersisted({
        stop,
        completedIds: state.completedIds,
        inFlightIds: new Set(),
      });
      expect(res.ok).toBe(true);
      state = applyCompletionSuccess(state, stop);
    }

    const summary = summarizeRouteCompletion({ routeStops: stops, completedIds: state.completedIds });

    expect(api.completeListing).toHaveBeenCalledTimes(2);
    expect(summary.allCompleted).toBe(true);
    expect(state.collectedLbs).toBe(30.5);
    expect(state.earnedDollars).toBe(8.75);
  });
});

