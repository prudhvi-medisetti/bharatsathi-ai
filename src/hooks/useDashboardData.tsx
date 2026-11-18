import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { subscribeToDashboard, type DashboardData } from '../services/dashboard';

type DashboardState = {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  profilePhotoOverride: string | null;
  setProfilePhotoOverride: (photoURL: string | null) => void;
};

const DashboardDataContext = createContext<DashboardState | null>(null);

export function DashboardDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profilePhotoOverride, setProfilePhotoOverride] = useState<string | null>(null);

  useEffect(() => {
    setProfilePhotoOverride(null);
    if (!user) {
      setData(null);
      setLoading(false);
      return;
    }

    setData(null);
    setLoading(true);
    setError(null);
    return subscribeToDashboard(user.uid, (subscription) => {
      setData(subscription.data);
      setError(subscription.error);
      setLoading(!subscription.ready);
    });
  }, [user]);

  useEffect(() => {
    if (profilePhotoOverride && data?.profile?.photoURL === profilePhotoOverride) {
      setProfilePhotoOverride(null);
    }
  }, [data?.profile?.photoURL, profilePhotoOverride]);

  const value = useMemo(() => ({
    data,
    loading,
    error,
    profilePhotoOverride,
    setProfilePhotoOverride,
  }), [data, loading, error, profilePhotoOverride]);
  return <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>;
}

export function useDashboardData() {
  const value = useContext(DashboardDataContext);
  if (!value) throw new Error('useDashboardData must be used within DashboardDataProvider');
  return value;
}
