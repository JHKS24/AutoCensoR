import React, { createContext, useContext, useState, useEffect } from 'react';
import { RunConfig } from '../engine/EngineAdapter';
import { backendUrl } from '../engine/backendUrl';
import {
  DEFAULT_CENSOR_TARGETS,
  LEGACY_GENERIC_DEFAULT_TARGETS,
  LEGACY_GENERIC_DEFAULT_TARGET_SET,
  isLegacyHashedTarget
} from './censorTargets';
import {
  OutputRootPolicy,
  inferOutputRootPolicy,
  resolveScanRunConfig
} from './scanLocationPolicy';

// Keep in sync with backend MAX_GPU_WORKERS in autocensor_server.py.
const MAX_GPU_WORKERS = 300;
const MIN_BRUSH_SIZE = 5;
const MAX_BRUSH_SIZE = 400;

const safeLocalGet = (key: string): string | null => {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    // Storage may be blocked (private mode, policy) or unavailable.
    return null;
  }
};

const safeLocalSet = (key: string, value: string): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    // Storage may be blocked or over quota; settings still live in memory.
  }
};

export type Language = 'en' | 'ko';
export type ThemeModeSetting = 'system' | 'dark' | 'light';

export interface ShortcutConfig {
  previousImage: string;
  nextImage: string;
  resetCurrent: string;
  undo: string;
  redo: string;
  altRedo: string;
  cancel: string;
  brush: string;
  eraser: string;
  region: string;
  stamp: string;
  stampRotateClockwise: string;
  stampRotateCounterClockwise: string;
  quickMask: string;
  original: string;
  brushDown: string;
  brushUp: string;
  zoomReset: string;
  zoomIn: string;
  zoomOut: string;
  startBatch: string;
  censorCurrent: string;
  toggleTabletPressure: string;
  toggleBrushHardness: string;
  toggleExtendedShortcuts: string;
  toggleStraightLine: string;
  toggleQuickMaskOverlay: string;
}

export interface UiPreferences {
  language: Language;
  sfwMode: boolean;
  showHelperButtons: boolean;
  showToolbarButtons: boolean;
  showHelpBar: boolean;
  showFilenames: boolean;
  quickMask: boolean;
  quickMaskColor: string;
  quickMaskOpacity: number;
  quickMaskBackdropMode: 'transparent' | 'white';
  tabletPressure: boolean;
  brushHardnessEnabled: boolean;
  extendedShortcuts: boolean;
  straightLine: boolean;
  straightLineDrawing: boolean;
  stampEmoji: string;
  stampColor: string;
  stampAngle: number;
  autoSaveEdits: boolean;
  confirmReset: boolean;
  completionNotification: 'statusbar' | 'toast' | 'browser' | 'off';
  censorBorderColor: string;
  censorBorderThickness: number;
  thumbnailZoom: number; // 60 to 140
}

export interface AppUiState {
  selectedImageId: string | null;
  koreanFontWarningDismissed: boolean;
}

export interface SettingsState {
  runConfig: RunConfig;
  outputRootPolicy: OutputRootPolicy;
  uiPrefs: UiPreferences;
  shortcuts: ShortcutConfig;
  modelPath: string;
  autoLoadModel: boolean;
  themeMode: ThemeModeSetting;
  uiState: AppUiState;
}

interface SettingsContextType {
  settings: SettingsState;
  settingsLoaded: boolean;
  settingsStoragePath: string;
  updateRunConfig: (updates: Partial<RunConfig>) => void;
  updateOutputDirsAsCustom: (outputDirs: string[]) => void;
  commitResolvedRunConfig: (runConfig: RunConfig, policy: OutputRootPolicy) => void;
  commitPickedInputFolder: (inputDir: string) => void;
  updateUiPrefs: (updates: Partial<UiPreferences>) => void;
  updateShortcuts: (updates: Partial<ShortcutConfig>) => void;
  updateModelPath: (path: string) => void;
  updateAutoLoadModel: (enabled: boolean) => void;
  updateThemeMode: (mode: ThemeModeSetting) => void;
  updateAppUiState: (updates: Partial<AppUiState>) => void;
  resetAllSettings: () => void;
}

const defaultRunConfig: RunConfig = {
  input_dir: '',
  output_dirs: ['output'],
  output_suffix: '_censored',
  target_mode: 'selected',
  targets: DEFAULT_CENSOR_TARGETS,
  threshold: 0.25,
  imgsz: 1280,
  censor_mode: 'mosaic',
  fill_color: '#000000',
  opacity: 1.0,
  brush_size: 24,
  brush_hardness: 0.8,
  mosaic_block: 16,
  blur_radius: 15,
  edge_blur: 5,
  supersample: true,
  postprocess_enabled: true,
  output_format: 'original',
  quality: 95,
  preserve_exif: false, // Default off for privacy
  device_mode: 'auto',
  region_device_mode: 'auto',
  selection_region_mode: 'model',
  worker_config: {
    gpu_workers: 1,
    cpu_workers: 4,
    cpu_threads: 4,
    save_threads: 4,
    postprocess_workers: 4,
    batch_size: 4
  }
};

const defaultUiPrefs: UiPreferences = {
  language: 'ko', // Default to Korean as per Korean files
  sfwMode: false,
  showHelperButtons: true,
  showToolbarButtons: true,
  showHelpBar: true,
  showFilenames: true,
  quickMask: false,
  quickMaskColor: '#f38ba8',
  quickMaskOpacity: 0.65,
  quickMaskBackdropMode: 'transparent',
  tabletPressure: true,
  brushHardnessEnabled: true,
  extendedShortcuts: true,
  straightLine: true,
  straightLineDrawing: true,
  stampEmoji: '❤️',
  stampColor: '#000000',
  stampAngle: 0,
  autoSaveEdits: true,
  confirmReset: true,
  completionNotification: 'statusbar',
  censorBorderColor: '#fab387', // Peach border
  censorBorderThickness: 2,
  thumbnailZoom: 100
};

export const DEFAULT_SHORTCUTS: ShortcutConfig = {
  previousImage: 'ArrowLeft',
  nextImage: 'ArrowRight',
  resetCurrent: 'W',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Y',
  altRedo: 'Ctrl+Shift+Z',
  cancel: 'Escape',
  brush: 'B',
  eraser: 'X',
  region: 'D',
  stamp: 'E',
  stampRotateClockwise: 'R',
  stampRotateCounterClockwise: 'Shift+R',
  quickMask: 'A, Q',
  original: 'Tab',
  brushDown: '[',
  brushUp: ']',
  zoomReset: 'Home',
  zoomIn: 'PageUp',
  zoomOut: 'PageDown',
  startBatch: 'F5',
  censorCurrent: 'F9',
  toggleTabletPressure: '1',
  toggleBrushHardness: '2',
  toggleExtendedShortcuts: '3',
  toggleStraightLine: '4',
  toggleQuickMaskOverlay: '5'
};

const defaultSettings: SettingsState = {
  runConfig: defaultRunConfig,
  outputRootPolicy: 'input-parent',
  uiPrefs: defaultUiPrefs,
  shortcuts: DEFAULT_SHORTCUTS,
  modelPath: '',
  autoLoadModel: true,
  themeMode: 'system',
  uiState: {
    selectedImageId: null,
    koreanFontWarningDismissed: false
  }
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const dedupeTargets = (targets: string[]): string[] => Array.from(new Set(targets));

const hasBrokenGenericDefaultSet = (targets: string[]): boolean =>
  LEGACY_GENERIC_DEFAULT_TARGETS.every((target) => targets.includes(target));

const normalizeTargets = (
  targets: unknown,
  fallbackToDefault = true,
  migrateBrokenDefaults = false
): string[] => {
  if (!Array.isArray(targets)) {
    return fallbackToDefault ? [...DEFAULT_CENSOR_TARGETS] : [];
  }
  let cleaned = targets
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((target) => !isLegacyHashedTarget(target));
  if (migrateBrokenDefaults && hasBrokenGenericDefaultSet(cleaned)) {
    cleaned = cleaned.filter((target) => !LEGACY_GENERIC_DEFAULT_TARGET_SET.has(target));
  }
  if (cleaned.length === 0) {
    return fallbackToDefault ? [...DEFAULT_CENSOR_TARGETS] : [];
  }
  return dedupeTargets(cleaned);
};

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
};

const clampInt = (value: unknown, min: number, max: number, fallback: number): number =>
  Math.round(clamp(value, min, max, fallback));

const coerceBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const coerceEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(value as string) ? (value as T) : fallback;

const coerceHexColor = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
    ? value.trim()
    : fallback;

const coerceOutputDirs = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [...defaultRunConfig.output_dirs];
  const dirs = value.map((item) => String(item ?? '').trim()).filter(Boolean);
  return dirs.length > 0 ? Array.from(new Set(dirs)) : [...defaultRunConfig.output_dirs];
};

const coerceOutputSuffix = (value: unknown): string => {
  if (typeof value !== 'string') return defaultRunConfig.output_suffix;
  // Defense-in-depth mirror of the backend sanitizer: strip path separators,
  // reserved characters and traversal sequences.
  const cleaned = Array.from(value)
    .filter((char) => char.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(char))
    .join('')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return cleaned || defaultRunConfig.output_suffix;
};

const CENSOR_MODES: ReadonlyArray<RunConfig['censor_mode']> = ['solid', 'blackwhite', 'mosaic', 'blur'];
const OUTPUT_FORMATS: ReadonlyArray<RunConfig['output_format']> = ['original', 'jpeg', 'png', 'webp', 'bmp'];
const DEVICE_MODES: ReadonlyArray<RunConfig['device_mode']> = ['auto', 'cpu', 'cuda', 'hybrid'];
const TARGET_MODES: ReadonlyArray<RunConfig['target_mode']> = ['selected', 'all'];
const SELECTION_REGION_MODES: ReadonlyArray<RunConfig['selection_region_mode']> = ['model', 'selection'];

const mergeWorkerConfig = (saved: unknown): RunConfig['worker_config'] => {
  const raw = typeof saved === 'object' && saved !== null ? saved as Record<string, unknown> : {};
  const defaults = defaultRunConfig.worker_config;
  return {
    gpu_workers: clampInt(raw.gpu_workers, 1, MAX_GPU_WORKERS, defaults.gpu_workers),
    cpu_workers: clampInt(raw.cpu_workers, 1, 64, defaults.cpu_workers),
    cpu_threads: clampInt(raw.cpu_threads, 1, 64, defaults.cpu_threads),
    save_threads: clampInt(raw.save_threads, 1, 64, defaults.save_threads),
    postprocess_workers: clampInt(raw.postprocess_workers, 1, 64, defaults.postprocess_workers),
    batch_size: clampInt(raw.batch_size, 1, 64, defaults.batch_size)
  };
};

const mergeRunConfig = (saved: unknown): RunConfig => {
  const parsed = typeof saved === 'object' && saved !== null ? saved as Partial<RunConfig> : {};
  const deviceMode = coerceEnum(parsed.device_mode, DEVICE_MODES, defaultRunConfig.device_mode);
  const regionDeviceMode = coerceEnum(parsed.region_device_mode, DEVICE_MODES, deviceMode);
  return {
    ...defaultRunConfig,
    input_dir: typeof parsed.input_dir === 'string' ? parsed.input_dir : defaultRunConfig.input_dir,
    output_dirs: coerceOutputDirs(parsed.output_dirs),
    output_suffix: coerceOutputSuffix(parsed.output_suffix),
    target_mode: coerceEnum(parsed.target_mode, TARGET_MODES, defaultRunConfig.target_mode),
    targets: normalizeTargets(parsed.targets, true, true),
    threshold: clamp(parsed.threshold, 0.01, 1.00, defaultRunConfig.threshold),
    imgsz: clampInt(parsed.imgsz, 320, 2048, defaultRunConfig.imgsz),
    censor_mode: coerceEnum(parsed.censor_mode, CENSOR_MODES, defaultRunConfig.censor_mode),
    fill_color: coerceHexColor(parsed.fill_color, defaultRunConfig.fill_color),
    opacity: clamp(parsed.opacity, 0.10, 1.00, defaultRunConfig.opacity),
    brush_size: clampInt(parsed.brush_size, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE, defaultRunConfig.brush_size),
    brush_hardness: clamp(parsed.brush_hardness, 0.0, 1.0, defaultRunConfig.brush_hardness),
    mosaic_block: clampInt(parsed.mosaic_block, 3, 40, defaultRunConfig.mosaic_block),
    blur_radius: clamp(parsed.blur_radius, 0.1, 50, defaultRunConfig.blur_radius),
    edge_blur: clamp(parsed.edge_blur, 0, 10, defaultRunConfig.edge_blur),
    supersample: coerceBoolean(parsed.supersample, defaultRunConfig.supersample),
    postprocess_enabled: coerceBoolean(parsed.postprocess_enabled, defaultRunConfig.postprocess_enabled),
    output_format: coerceEnum(parsed.output_format, OUTPUT_FORMATS, defaultRunConfig.output_format),
    quality: clampInt(parsed.quality, 1, 100, defaultRunConfig.quality),
    preserve_exif: coerceBoolean(parsed.preserve_exif, defaultRunConfig.preserve_exif),
    device_mode: deviceMode,
    region_device_mode: regionDeviceMode,
    selection_region_mode: coerceEnum(parsed.selection_region_mode, SELECTION_REGION_MODES, defaultRunConfig.selection_region_mode),
    worker_config: mergeWorkerConfig(parsed.worker_config)
  };
};

const mergeShortcuts = (saved: unknown): ShortcutConfig => {
  const parsed = typeof saved === 'object' && saved !== null
    ? saved as Partial<ShortcutConfig> & { reset?: string }
    : {};
  const merged = {
    ...DEFAULT_SHORTCUTS,
    ...parsed,
    resetCurrent: parsed.resetCurrent || parsed.reset || DEFAULT_SHORTCUTS.resetCurrent
  };
  if (String(merged.toggleQuickMaskOverlay || '').replace(/\s+/g, '').toUpperCase() === 'Q,5') {
    merged.toggleQuickMaskOverlay = DEFAULT_SHORTCUTS.toggleQuickMaskOverlay;
  }
  if (String(merged.toggleQuickMaskOverlay || '').trim() === '5') {
    merged.toggleQuickMaskOverlay = DEFAULT_SHORTCUTS.toggleQuickMaskOverlay;
  }
  return merged;
};

const normalizeThemeMode = (value: unknown): ThemeModeSetting => {
  return value === 'dark' || value === 'light' || value === 'system' ? value : 'system';
};

const mergeUiState = (saved: unknown): AppUiState => {
  const parsed = typeof saved === 'object' && saved !== null ? saved as Partial<AppUiState> : {};
  return {
    selectedImageId: typeof parsed.selectedImageId === 'string' ? parsed.selectedImageId : null,
    koreanFontWarningDismissed: Boolean(parsed.koreanFontWarningDismissed)
  };
};

const mergeSettings = (saved: unknown): SettingsState => {
  const parsed = typeof saved === 'object' && saved !== null ? saved as Partial<SettingsState> : {};
  const mergedRunConfig = mergeRunConfig(parsed.runConfig);
  const outputRootPolicy = inferOutputRootPolicy(
    parsed.outputRootPolicy,
    typeof parsed.runConfig === 'object' && parsed.runConfig !== null
      ? (parsed.runConfig as Partial<RunConfig>).output_dirs
      : undefined,
    mergedRunConfig.input_dir,
    defaultRunConfig.output_dirs[0]
  );
  const savedUiPrefs: Partial<UiPreferences> = parsed.uiPrefs || {};
  const straightLine = typeof savedUiPrefs.straightLine === 'boolean'
    ? savedUiPrefs.straightLine
    : typeof savedUiPrefs.straightLineDrawing === 'boolean'
      ? savedUiPrefs.straightLineDrawing
      : defaultUiPrefs.straightLine;
  const stampEmoji = Array.from(String(savedUiPrefs.stampEmoji || defaultUiPrefs.stampEmoji)).slice(0, 2).join('')
    || defaultUiPrefs.stampEmoji;
  const localTheme = safeLocalGet('ac-theme-mode');
  return {
    runConfig: mergedRunConfig,
    outputRootPolicy,
    uiPrefs: {
      ...defaultUiPrefs,
      ...savedUiPrefs,
      autoSaveEdits: true,
      straightLine,
      straightLineDrawing: straightLine,
      stampEmoji,
      stampColor: coerceHexColor(savedUiPrefs.stampColor, defaultUiPrefs.stampColor),
      stampAngle: clampInt(savedUiPrefs.stampAngle, 0, 359, defaultUiPrefs.stampAngle),
      quickMaskOpacity: clamp(parsed.uiPrefs?.quickMaskOpacity, 0.05, 1.00, defaultUiPrefs.quickMaskOpacity),
      quickMaskBackdropMode: parsed.uiPrefs?.quickMaskBackdropMode === 'white' ? 'white' : 'transparent'
    },
    shortcuts: mergeShortcuts(parsed.shortcuts),
    modelPath: typeof parsed.modelPath === 'string' ? parsed.modelPath : defaultSettings.modelPath,
    autoLoadModel: typeof parsed.autoLoadModel === 'boolean' ? parsed.autoLoadModel : defaultSettings.autoLoadModel,
    themeMode: normalizeThemeMode(parsed.themeMode || localTheme),
    uiState: mergeUiState(parsed.uiState)
  };
};

const readLocalSettings = (): SettingsState => {
  const saved = safeLocalGet('ac-user-settings');
  if (saved) {
    try {
      return mergeSettings(JSON.parse(saved));
    } catch (e) {
      console.error('Failed to parse user settings, using defaults.', e);
    }
  }
  return mergeSettings(defaultSettings);
};

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<SettingsState>(() => readLocalSettings());
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsStoragePath, setSettingsStoragePath] = useState('');

  useEffect(() => {
    let cancelled = false;
    const loadFileSettings = async () => {
      try {
        const response = await fetch(backendUrl('/api/settings'));
        if (!response.ok) throw new Error(`settings load failed: ${response.status}`);
        const payload = await response.json();
        if (cancelled) return;
        if (payload?.settings && Object.keys(payload.settings).length > 0) {
          setSettings(mergeSettings(payload.settings));
        }
        if (typeof payload?.settings_path === 'string') {
          setSettingsStoragePath(payload.settings_path);
        }
      } catch (e) {
        console.warn('File-backed settings unavailable; using browser storage fallback.', e);
      } finally {
        if (!cancelled) setSettingsLoaded(true);
      }
    };
    void loadFileSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    safeLocalSet('ac-user-settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (!settingsLoaded) return;
    const controller = new AbortController();
    const persistSettings = (signal?: AbortSignal) => fetch(backendUrl('/api/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
        signal
      });
    const timer = window.setTimeout(() => {
      void persistSettings(controller.signal).catch((e) => {
        if (!controller.signal.aborted) {
          console.warn('Failed to save file-backed settings.', e);
        }
      });
    }, 250);
    const flushSettings = () => {
      const body = JSON.stringify({ settings });
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(backendUrl('/api/settings'), blob);
        return;
      }
      void persistSettings().catch(() => undefined);
    };
    window.addEventListener('pagehide', flushSettings);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', flushSettings);
      controller.abort();
    };
  }, [settings, settingsLoaded]);

  const updateRunConfig = (updates: Partial<RunConfig>) => {
    setSettings(prev => ({
      ...prev,
      runConfig: mergeRunConfig({
        ...prev.runConfig,
        ...updates,
        targets: Object.prototype.hasOwnProperty.call(updates, 'targets')
          ? normalizeTargets(updates.targets, true, false)
          : prev.runConfig.targets,
        worker_config: updates.worker_config
          ? { ...prev.runConfig.worker_config, ...updates.worker_config }
          : prev.runConfig.worker_config
      })
    }));
  };

  const updateOutputDirsAsCustom = (outputDirs: string[]) => {
    setSettings(prev => ({
      ...prev,
      outputRootPolicy: 'custom',
      runConfig: mergeRunConfig({
        ...prev.runConfig,
        output_dirs: outputDirs
      })
    }));
  };

  const commitResolvedRunConfig = (runConfig: RunConfig, policy: OutputRootPolicy) => {
    setSettings(prev => ({
      ...prev,
      outputRootPolicy: policy,
      runConfig: mergeRunConfig({
        ...prev.runConfig,
        ...runConfig,
        targets: runConfig.targets
      })
    }));
  };

  const commitPickedInputFolder = (inputDir: string) => {
    setSettings(prev => {
      const resolved = resolveScanRunConfig(prev.runConfig, inputDir, 'input-parent');
      return {
        ...prev,
        outputRootPolicy: 'input-parent',
        runConfig: mergeRunConfig({
          ...prev.runConfig,
          ...resolved,
          targets: resolved.targets
        })
      };
    });
  };

  const updateUiPrefs = (updates: Partial<UiPreferences>) => {
    setSettings(prev => ({
      ...prev,
      uiPrefs: (() => {
        const next = { ...prev.uiPrefs, ...updates, autoSaveEdits: true };
        if (Object.prototype.hasOwnProperty.call(updates, 'straightLine')) {
          next.straightLineDrawing = Boolean(updates.straightLine);
        } else if (Object.prototype.hasOwnProperty.call(updates, 'straightLineDrawing')) {
          next.straightLine = Boolean(updates.straightLineDrawing);
        }
        return next;
      })()
    }));
  };

  const updateShortcuts = (updates: Partial<ShortcutConfig>) => {
    setSettings(prev => ({
      ...prev,
      shortcuts: { ...prev.shortcuts, ...updates }
    }));
  };

  const updateModelPath = (path: string) => {
    setSettings(prev => ({
      ...prev,
      modelPath: path
    }));
  };

  const updateAutoLoadModel = (enabled: boolean) => {
    setSettings(prev => ({
      ...prev,
      autoLoadModel: enabled
    }));
  };

  const updateThemeMode = (mode: ThemeModeSetting) => {
    setSettings(prev => ({
      ...prev,
      themeMode: normalizeThemeMode(mode)
    }));
    safeLocalSet('ac-theme-mode', normalizeThemeMode(mode));
  };

  const updateAppUiState = (updates: Partial<AppUiState>) => {
    setSettings(prev => {
      const nextUiState = {
        ...prev.uiState,
        ...updates
      };
      if (
        nextUiState.selectedImageId === prev.uiState.selectedImageId &&
        nextUiState.koreanFontWarningDismissed === prev.uiState.koreanFontWarningDismissed
      ) {
        return prev;
      }
      return {
        ...prev,
        uiState: nextUiState
      };
    });
  };

  const resetAllSettings = () => {
    setSettings(mergeSettings(defaultSettings));
  };

  return (
    <SettingsContext.Provider value={{
      settings,
      settingsLoaded,
      settingsStoragePath,
      updateRunConfig,
      updateOutputDirsAsCustom,
      commitResolvedRunConfig,
      commitPickedInputFolder,
      updateUiPrefs,
      updateShortcuts,
      updateModelPath,
      updateAutoLoadModel,
      updateThemeMode,
      updateAppUiState,
      resetAllSettings
    }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
