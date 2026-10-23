import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AppInfo, AppSettings } from '@shared/types';
import { api, errorMessage } from './api';

interface AppContextValue {
  settings: AppSettings | null;
  appInfo: AppInfo | null;
  logoUrl: string | null;
  loading: boolean;
  error: string | null;
  dataVersion: number;
  refresh: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  bumpData: () => void;
  setupSkipped: boolean;
  skipSetup: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [setupSkipped, setSetupSkipped] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSettings, info, logo] = await Promise.all([
        api.settings.get(),
        api.appInfo(),
        api.settings.logoData(),
      ]);
      setSettings(nextSettings);
      setAppInfo(info);
      setLogoUrl(logo.dataUrl);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const [nextSettings, logo] = await Promise.all([api.settings.get(), api.settings.logoData()]);
      setSettings(nextSettings);
      setLogoUrl(logo.dataUrl);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const bumpData = useCallback(() => setDataVersion((value) => value + 1), []);
  const skipSetup = useCallback(() => setSetupSkipped(true), []);

  const value = useMemo<AppContextValue>(
    () => ({
      settings,
      appInfo,
      logoUrl,
      loading,
      error,
      dataVersion,
      refresh,
      refreshSettings,
      bumpData,
      setupSkipped,
      skipSetup,
    }),
    [
      settings,
      appInfo,
      logoUrl,
      loading,
      error,
      dataVersion,
      refresh,
      refreshSettings,
      bumpData,
      setupSkipped,
      skipSetup,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppData(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppData doit être utilisé dans AppProvider.');
  return context;
}
