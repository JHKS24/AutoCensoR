import React, { createContext, useContext, useEffect, useState } from 'react';
import { useSettings } from '../settings/SettingsContext';

export type ThemeMode = 'system' | 'dark' | 'light';

interface ThemeContextType {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const normalizeThemeMode = (value: unknown): ThemeMode =>
  value === 'dark' || value === 'light' || value === 'system' ? value : 'system';

const safeLocalGet = (key: string): string | null => {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeLocalSet = (key: string, value: string): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    // Theme remains active in memory when storage is blocked.
  }
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { settings, settingsLoaded, updateThemeMode } = useSettings();
  const [fallbackThemeMode, setFallbackThemeMode] = useState<ThemeMode>(() => {
    return normalizeThemeMode(safeLocalGet('ac-theme-mode'));
  });
  const themeMode = settingsLoaded ? normalizeThemeMode(settings.themeMode) : fallbackThemeMode;

  const [isDark, setIsDark] = useState(false);

  const setThemeMode = (mode: ThemeMode) => {
    setFallbackThemeMode(mode);
    safeLocalSet('ac-theme-mode', mode);
    updateThemeMode(mode);
  };

  useEffect(() => {
    if (!settingsLoaded) return;
    safeLocalSet('ac-theme-mode', normalizeThemeMode(settings.themeMode));
  }, [settings.themeMode, settingsLoaded]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const updateTheme = () => {
      const dark = themeMode === 'system' ? mediaQuery.matches : themeMode === 'dark';
      setIsDark(dark);

      const root = document.documentElement;
      if (dark) {
        root.classList.remove('theme-light');
        root.classList.add('theme-dark');
      } else {
        root.classList.remove('theme-dark');
        root.classList.add('theme-light');
      }
    };

    updateTheme();
    mediaQuery.addEventListener('change', updateTheme);

    return () => {
      mediaQuery.removeEventListener('change', updateTheme);
    };
  }, [themeMode]);

  return (
    <ThemeContext.Provider value={{ themeMode, setThemeMode, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
