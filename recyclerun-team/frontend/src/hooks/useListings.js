/**
 * Custom hook for listings state.
 * Owner: Sara
 */
import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { DEMO_LISTINGS } from '../services/demoData';

export function useListings() {
  const [listings, setListings] = useState(DEMO_LISTINGS);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const response = await api.getListings();
    if (response?.ok && Array.isArray(response?.data?.listings)) {
      setListings(response.data.listings);
    } else {
      setListings(DEMO_LISTINGS);
    }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);
  return { listings, setListings, loading, refresh };
}
