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

    const nextListings = response?.ok && Array.isArray(response?.data?.listings)
      ? normalizeListingsForRender(response.data.listings)
      : normalizeListingsForRender(DEMO_LISTINGS);

    if (mountedRef.current) {
      setListings(nextListings);
      setLoading(false);
    }

    return response;
  };

  useEffect(() => {
    void refresh();
  }, []);

  return { listings, setListings, loading, refresh };
}
