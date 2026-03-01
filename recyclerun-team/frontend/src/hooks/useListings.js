/**
 * Custom hook for listings state.
 * Owner: Sara
 */
import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { DEMO_LISTINGS } from '../services/demoData';
import { normalizeListingsForRender, runSafeAsync } from '../services/stabilization';

export function useListings() {
  const [listings, setListings] = useState(normalizeListingsForRender(DEMO_LISTINGS));
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const refresh = async () => {
    if (mountedRef.current) {
      setLoading(true);
    }

    const response = await runSafeAsync(
      () => api.getListings(),
      { ok: false, status: 0, error: 'Unable to load listings' }
    );

    let apiListings = response?.ok && Array.isArray(response?.data?.listings)
      ? normalizeListingsForRender(response.data.listings)
      : [];
    let finalResponse = response;

    if (response?.ok && apiListings.length === 0) {
      await runSafeAsync(() => api.resetDemo(), null);
      const refreshed = await runSafeAsync(
        () => api.getListings(),
        { ok: false, status: 0, error: 'Unable to reload demo listings' }
      );
      if (refreshed?.ok && Array.isArray(refreshed?.data?.listings)) {
        const resetListings = normalizeListingsForRender(refreshed.data.listings);
        if (resetListings.length > 0) {
          apiListings = resetListings;
          finalResponse = refreshed;
        }
      }
    }

    const nextListings = apiListings.length ? apiListings : normalizeListingsForRender(DEMO_LISTINGS);

    if (mountedRef.current) {
      setListings(nextListings);
      setLoading(false);
    }

    return finalResponse;
  };

  useEffect(() => {
    void refresh();
  }, []);

  return { listings, setListings, loading, refresh };
}
