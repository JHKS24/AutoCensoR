import type { UiPreferences } from './SettingsContext';

export const shouldUseProtectedLabels = (uiPrefs: UiPreferences): boolean =>
  Boolean(uiPrefs.sfwMode || !uiPrefs.showFilenames);
