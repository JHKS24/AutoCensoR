import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings } from './settings/SettingsContext';
import { i18nStrings } from './i18n/strings';
import { shortcutMatches } from './settings/shortcutUtils';
import { MockEngineAdapter, createMockSvgDataUrl } from './engine/MockEngineAdapter';
import { HttpEngineAdapter } from './engine/HttpEngineAdapter';
import { backendUrl } from './engine/backendUrl';
import { EngineAdapter, ImageItem, ModelState, ProgressState, RegionRequest, RegionResult, RunFinishedSummary } from './engine/EngineAdapter';
import { folderNameOf, joinPath, resolveScanRunConfig } from './settings/scanLocationPolicy';

import { AlertTriangle, HelpCircle, X } from 'lucide-react';

// Components
import { Topbar } from './components/Topbar';
import { ImageList } from './components/ImageList';
import { Canvas } from './components/Canvas';
import { Toolbar } from './components/Toolbar';
import { Statusbar } from './components/Statusbar';
import { SettingsDialog } from './components/SettingsDialog';

const checkKoreanFontAvailable = (): boolean => {
  try {
    if (typeof document === 'undefined') return true;

    if (document.fonts?.check) {
      const targetFonts = [
        'Noto Sans KR',
        'Noto Sans CJK KR',
        'Malgun Gothic',
        'NanumGothic',
        'Nanum Gothic',
        'Apple SD Gothic Neo',
        'Dotum',
        'Gulim',
        'Batang'
      ];

      if (targetFonts.some((font) => document.fonts.check(`12px "${font}"`))) {
        return true;
      }
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return true;

    const testText = '한글폰트검사';
    ctx.font = '72px "NonExistentFontForTestOnly", sans-serif';
    const defaultWidth = ctx.measureText(testText).width;

    const koreanFonts = ['Noto Sans KR', 'Noto Sans CJK KR', 'Malgun Gothic', 'NanumGothic', 'Apple SD Gothic Neo'];
    return koreanFonts.some((font) => {
      ctx.font = `72px "${font}", "NonExistentFontForTestOnly", sans-serif`;
      return ctx.measureText(testText).width !== defaultWidth;
    });
  } catch {
    return true;
  }
};

export const AppContent: React.FC = () => {
  const {
    settings,
    settingsLoaded,
    updateRunConfig,
    updateUiPrefs,
    updateModelPath,
    updateAppUiState,
    commitResolvedRunConfig,
    commitPickedInputFolder
  } = useSettings();
  const strings = i18nStrings[settings.uiPrefs.language];

  // Engine instance. Mock mode is allowed only in dev/test builds so release builds cannot masquerade as a working backend.
  const [engineInit] = useState(() => {
    const engineMode = new URLSearchParams(window.location.search).get('engine') || import.meta.env.VITE_AC_ENGINE;
    const mockAllowed = import.meta.env.DEV || import.meta.env.VITE_AC_ALLOW_MOCK === 'true';
    const adapter = engineMode === 'mock' && mockAllowed ? new MockEngineAdapter() : new HttpEngineAdapter();
    return {
      adapter,
      backendDiagnosticsAvailable: !(adapter instanceof MockEngineAdapter)
    };
  });
  const engine = useRef<EngineAdapter | null>(engineInit.adapter);
  const backendDiagnosticsAvailable = engineInit.backendDiagnosticsAvailable;

  // Core UI States
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(() => settings.uiState.selectedImageId);
  const [manualBackups, setManualBackups] = useState<Record<string, ImageItem>>({});
  
  const [modelState, setModelState] = useState<ModelState>({
    loaded: false,
    loading: false,
    model_name: 'not loaded',
    devices: ['CPU', 'CUDA GPU', 'DirectML GPU'],
    cpu_workers: 4,
    gpu_workers: 1,
    memory_summary: 'Model not loaded'
  });

  const [progress, setProgress] = useState<ProgressState>({
    total: 0,
    processed: 0,
    censored: 0,
    clean: 0,
    failed: 0,
    restored: 0,
    eta_text: '',
    current_file: '',
    message: ''
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanRevision, setScanRevision] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  // dialog & toast
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);
  const [startupTasks, setStartupTasks] = useState({ scan: false, model: false });
  const [isKoreanFontWarningVisible, setIsKoreanFontWarningVisible] = useState(
    () => !settings.uiState.koreanFontWarningDismissed && !checkKoreanFontAvailable()
  );
  const startupRestoreRef = useRef({ scanned: false, modelLoaded: false });
  const scanInFlightRef = useRef(false);
  const uiStateHydratedRef = useRef(false);
  const shortcutHelpRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((msg: string) => {
    setProgress(prev => ({
      ...prev,
      message: msg
    }));
    if (settings.uiPrefs.completionNotification === 'statusbar' || settings.uiPrefs.completionNotification === 'off') {
      return;
    }
    setToast(msg);
    setTimeout(() => {
      setToast(null);
    }, 3000);
  }, [settings.uiPrefs.completionNotification]);

  const showCompletionNotification = useCallback((msg: string) => {
    if (settings.uiPrefs.completionNotification === 'off') return;
    if (settings.uiPrefs.completionNotification === 'browser' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification('AutoCensor', { body: msg });
      } else if (Notification.permission === 'default') {
        void Notification.requestPermission().then((permission) => {
          if (permission === 'granted') {
            new Notification('AutoCensor', { body: msg });
          }
        });
      }
    }
    showToast(msg);
  }, [settings.uiPrefs.completionNotification, showToast]);

  const confirmResetIfNeeded = useCallback(() => {
    if (!settings.uiPrefs.confirmReset) return true;
    return window.confirm(strings.resetConfirmationPrompt);
  }, [settings.uiPrefs.confirmReset, strings.resetConfirmationPrompt]);

  const buildScanProgress = useCallback((scannedImages: ImageItem[], message: string): ProgressState => {
    const censored = scannedImages.filter((image) => image.status === 'censored').length;
    const clean = scannedImages.filter((image) => image.status === 'clean').length;
    const failed = scannedImages.filter((image) => image.status === 'failed').length;
    const restored = scannedImages.filter((image) => image.restored).length;
    return {
      total: scannedImages.length,
      processed: censored + clean + failed,
      censored,
      clean,
      failed,
      restored,
      eta_text: '',
      current_file: '',
      message
    };
  }, []);

  const applyScanResult = useCallback((scannedImages: ImageItem[], message: string) => {
    setImages(scannedImages);
    setManualBackups({});
    setSelectedImageId(prev => {
      if (scannedImages.length === 0) return null;
      if (prev && scannedImages.some((image) => image.id === prev)) return prev;
      const savedSelection = settings.uiState.selectedImageId;
      return scannedImages.some((image) => image.id === savedSelection)
        ? savedSelection
        : scannedImages[0].id;
    });
    setProgress(buildScanProgress(scannedImages, message));
    setScanRevision(value => value + 1);
  }, [buildScanProgress, settings.uiState.selectedImageId]);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (!uiStateHydratedRef.current) {
      uiStateHydratedRef.current = true;
      setSelectedImageId(settings.uiState.selectedImageId);
      setIsShortcutHelpOpen(false);
      setIsKoreanFontWarningVisible(!settings.uiState.koreanFontWarningDismissed && !checkKoreanFontAvailable());
      return;
    }
    updateAppUiState({ selectedImageId });
    // Settings actions are recreated by context; this effect is keyed only by the persisted value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImageId, settingsLoaded, settings.uiState.koreanFontWarningDismissed, settings.uiState.selectedImageId]);

  const outputFolderPath = (): string => {
    const outputRoot = settings.runConfig.output_dirs[0] || 'output';
    const inputName = folderNameOf(settings.runConfig.input_dir) || 'output';
    return joinPath(outputRoot, `${inputName}${settings.runConfig.output_suffix || ''}`);
  };

  const getOutputLocationText = useCallback(() => {
    const format = settings.runConfig.output_format === 'original'
      ? strings.outputOriginalExtension
      : `.${settings.runConfig.output_format}`;
    if (settings.uiPrefs.sfwMode) {
      return [
        strings.outputLocationSafety,
        `${strings.outputFolders}: <output-root>`,
        `${strings.outputLocationConvention}: <output-root>/<input-folder><suffix>/<relative-image-path>${format}`
      ].join('\n');
    }
    const inputName = folderNameOf(settings.runConfig.input_dir) || '<input-folder>';
    return [
      strings.outputLocationSafety,
      `${strings.outputFolders}: ${settings.runConfig.output_dirs.join(', ')}`,
      `${strings.outputLocationConvention}: <output-root>/${inputName}${settings.runConfig.output_suffix}/<relative-image-path>${format}`
    ].join('\n');
  }, [settings.runConfig.input_dir, settings.runConfig.output_dirs, settings.runConfig.output_format, settings.runConfig.output_suffix, settings.uiPrefs.sfwMode, strings]);

  const handleCopyOutputLocation = useCallback(async () => {
    const text = getOutputLocationText();
    try {
      await navigator.clipboard.writeText(text);
      showToast(strings.outputLocationCopied);
    } catch {
      window.prompt(strings.outputLocationFallbackPrompt, text);
    }
  }, [getOutputLocationText, showToast, strings.outputLocationCopied, strings.outputLocationFallbackPrompt]);

  // Setup adapter event triggers
  useEffect(() => {
    const adapter = engine.current!;

    const handleScanned = (scannedImages: ImageItem[]) => {
      if (scanInFlightRef.current) return;
      applyScanResult(scannedImages, strings.imagesScanned);
      showToast(strings.imagesScanned);
    };

    const handleModelState = (state: ModelState) => {
      setModelState(state);
    };

    const handleProgress = (pState: ProgressState) => {
      if (scanInFlightRef.current) return;
      setProgress(pState);
    };

    const handleImageProcessed = (img: ImageItem) => {
      setImages(prev => prev.map(item => item.id === img.id ? img : item));
    };

    const handleFinished = (summary: RunFinishedSummary) => {
      setIsProcessing(false);
      const title = summary.stopped ? strings.batchStopped : strings.batchComplete;
      setProgress(prev => ({
        ...prev,
        message: summary.message || title,
        eta_text: '',
        current_file: ''
      }));
      showCompletionNotification(`${title} ${summary.processed}/${summary.total} (${summary.duration}s)`);
    };

    const handleWarning = (msg: string) => {
      const safeMsg = settings.uiPrefs.sfwMode ? strings.protectedTargetSelection : msg;
      setWarnings(prev => [...prev, `[Warning] ${safeMsg}`]);
    };

    const handleErr = (msg: string) => {
      const safeMsg = settings.uiPrefs.sfwMode ? strings.protectedTargetSelection : msg;
      setErrors(prev => [...prev, `[Error] ${safeMsg}`]);
      setIsProcessing(false);
      showToast(`Error: ${safeMsg}`);
    };

    adapter.on('images_scanned', handleScanned);
    adapter.on('model_state_changed', handleModelState);
    adapter.on('progress_changed', handleProgress);
    adapter.on('image_processed', handleImageProcessed);
    adapter.on('run_finished', handleFinished);
    adapter.on('warning', handleWarning);
    adapter.on('error', handleErr);

    return () => {
      adapter.off('images_scanned', handleScanned);
      adapter.off('model_state_changed', handleModelState);
      adapter.off('progress_changed', handleProgress);
      adapter.off('image_processed', handleImageProcessed);
      adapter.off('run_finished', handleFinished);
      adapter.off('warning', handleWarning);
      adapter.off('error', handleErr);
    };
  }, [applyScanResult, settings.uiPrefs.language, settings.uiPrefs.sfwMode, showCompletionNotification, showToast, strings.batchComplete, strings.batchStopped, strings.imagesScanned, strings.protectedTargetSelection]);

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const clickAction = (action: string) => {
      const btn = document.querySelector(`[data-action="${action}"]`) as HTMLButtonElement | null;
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
      return false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (shortcutMatches(e, settings.shortcuts.cancel)) {
        if (isShortcutHelpOpen) {
          e.preventDefault();
          setIsShortcutHelpOpen(false);
          return;
        }
      }
      if (isSettingsOpen) {
        if (shortcutMatches(e, settings.shortcuts.cancel)) {
          e.preventDefault();
          setIsSettingsOpen(false);
        }
        return;
      }
      const shortcuts = settings.shortcuts;
      const activeEl = document.activeElement;
      const isTextInput = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT' ||
        activeEl.getAttribute('contenteditable') === 'true'
      );
      const isGlobalProcessingShortcut = shortcutMatches(e, shortcuts.startBatch)
        || shortcutMatches(e, shortcuts.censorCurrent)
        || shortcutMatches(e, shortcuts.cancel);
      if (isTextInput && !isGlobalProcessingShortcut) return;

      const extendedShortcutsEnabled = settings.uiPrefs.extendedShortcuts;
      const showShortcutToggle = (label: string, enabled: boolean) => {
        const stateText = settings.uiPrefs.language === 'ko'
          ? (enabled ? '켜짐' : '꺼짐')
          : (enabled ? 'On' : 'Off');
        showToast(`${label}: ${stateText}`);
      };

      if (shortcutMatches(e, shortcuts.previousImage)) {
        e.preventDefault();
        setSelectedImageId(prev => {
          if (images.length === 0) return prev;
          const index = Math.max(0, images.findIndex(img => img.id === prev));
          return images[Math.max(0, index - 1)]?.id || prev;
        });
        return;
      }

      if (shortcutMatches(e, shortcuts.nextImage)) {
        e.preventDefault();
        setSelectedImageId(prev => {
          if (images.length === 0) return prev;
          const index = Math.max(0, images.findIndex(img => img.id === prev));
          return images[Math.min(images.length - 1, index + 1)]?.id || prev;
        });
        return;
      }

      if (shortcutMatches(e, shortcuts.undo)) {
        e.preventDefault();
        clickAction('undo');
        return;
      }

      if (shortcutMatches(e, shortcuts.redo) || shortcutMatches(e, shortcuts.altRedo)) {
        e.preventDefault();
        clickAction('redo');
        return;
      }

      if (shortcutMatches(e, shortcuts.cancel)) {
        e.preventDefault();
        clickAction('cancel-canvas');
        return;
      }

      if (shortcutMatches(e, shortcuts.resetCurrent)) {
        e.preventDefault();
        clickAction('reset-image');
        return;
      }

      if (shortcutMatches(e, shortcuts.brush)) {
        e.preventDefault();
        clickAction('tool-brush');
        return;
      }

      if (shortcutMatches(e, shortcuts.eraser)) {
        e.preventDefault();
        clickAction('tool-eraser');
        return;
      }

      if (shortcutMatches(e, shortcuts.region)) {
        e.preventDefault();
        clickAction('tool-region');
        return;
      }

      if (extendedShortcutsEnabled && shortcutMatches(e, shortcuts.stamp)) {
        e.preventDefault();
        clickAction('tool-emoji');
        return;
      }

      if (extendedShortcutsEnabled && shortcutMatches(e, shortcuts.stampRotateClockwise)) {
        e.preventDefault();
        clickAction('stamp-rotate-cw');
        return;
      }

      if (extendedShortcutsEnabled && shortcutMatches(e, shortcuts.stampRotateCounterClockwise)) {
        e.preventDefault();
        clickAction('stamp-rotate-ccw');
        return;
      }

      if (extendedShortcutsEnabled && shortcutMatches(e, shortcuts.quickMask)) {
        e.preventDefault();
        const next = !settings.uiPrefs.quickMask;
        updateUiPrefs({ quickMask: next });
        showShortcutToggle(strings.toggleQuickMaskOverlayAction, next);
        return;
      }

      if (extendedShortcutsEnabled && (shortcutMatches(e, shortcuts.brushDown) || shortcutMatches(e, shortcuts.brushUp))) {
        e.preventDefault();
        const delta = shortcutMatches(e, shortcuts.brushUp) ? 5 : -5;
        updateRunConfig({
          brush_size: Math.max(5, Math.min(400, settings.runConfig.brush_size + delta))
        });
        return;
      }

      if (shortcutMatches(e, shortcuts.original)) {
        e.preventDefault();
        const previewBtn = document.querySelector('[data-action="preview-original"]') as HTMLButtonElement;
        if (previewBtn && !previewBtn.disabled) {
          previewBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        }
        return;
      }

      if (shortcutMatches(e, shortcuts.zoomReset)) {
        e.preventDefault();
        clickAction('zoom-reset');
        return;
      }

      if (shortcutMatches(e, shortcuts.zoomIn)) {
        e.preventDefault();
        clickAction('zoom-in');
        return;
      }

      if (shortcutMatches(e, shortcuts.zoomOut)) {
        e.preventDefault();
        clickAction('zoom-out');
        return;
      }

      if (shortcutMatches(e, shortcuts.startBatch)) {
        e.preventDefault();
        clickAction('start-batch');
        return;
      }

      if (shortcutMatches(e, shortcuts.censorCurrent)) {
        e.preventDefault();
        clickAction('current-image-censor');
        return;
      }

      if (extendedShortcutsEnabled && shortcutMatches(e, shortcuts.toggleTabletPressure)) {
        e.preventDefault();
        const next = !settings.uiPrefs.tabletPressure;
        updateUiPrefs({ tabletPressure: next });
        showShortcutToggle(strings.toggleTabletPressureAction, next);
        return;
      }

      if (extendedShortcutsEnabled && shortcutMatches(e, shortcuts.toggleBrushHardness)) {
        e.preventDefault();
        const next = !settings.uiPrefs.brushHardnessEnabled;
        updateUiPrefs({ brushHardnessEnabled: next });
        showShortcutToggle(strings.toggleBrushHardnessAction, next);
        return;
      }

      if (shortcutMatches(e, shortcuts.toggleExtendedShortcuts)) {
        e.preventDefault();
        const next = !settings.uiPrefs.extendedShortcuts;
        updateUiPrefs({ extendedShortcuts: next });
        showShortcutToggle(strings.toggleExtendedShortcutsAction, next);
        return;
      }

      if (shortcutMatches(e, shortcuts.toggleStraightLine)) {
        e.preventDefault();
        const next = !settings.uiPrefs.straightLine;
        updateUiPrefs({ straightLine: next });
        showShortcutToggle(strings.toggleStraightLineAction, next);
        return;
      }

      if (shortcutMatches(e, shortcuts.toggleQuickMaskOverlay)) {
        e.preventDefault();
        const next = !settings.uiPrefs.quickMask;
        updateUiPrefs({ quickMask: next });
        showShortcutToggle(strings.toggleQuickMaskOverlayAction, next);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isSettingsOpen) return;
      if (!shortcutMatches(e, settings.shortcuts.original)) return;
      e.preventDefault();
      const previewBtn = document.querySelector('[data-action="preview-original"]') as HTMLButtonElement;
      if (previewBtn && !previewBtn.disabled) {
        previewBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    images,
    isSettingsOpen,
    isShortcutHelpOpen,
    settings.runConfig.brush_size,
    settings.shortcuts,
    settings.uiPrefs.brushHardnessEnabled,
    settings.uiPrefs.extendedShortcuts,
    settings.uiPrefs.language,
    settings.uiPrefs.quickMask,
    settings.uiPrefs.straightLine,
    settings.uiPrefs.tabletPressure,
    showToast,
    strings,
    updateRunConfig,
    updateUiPrefs
  ]);

  useEffect(() => {
    if (!isShortcutHelpOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!shortcutHelpRef.current?.contains(event.target as Node)) {
        setIsShortcutHelpOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isShortcutHelpOpen]);

  // API wrappers
  const performScan = useCallback(async (path: string) => {
    const inputPath = path.trim();
    if (!settingsLoaded || !inputPath || scanInFlightRef.current) return;
    const resolvedConfig = resolveScanRunConfig(settings.runConfig, inputPath, settings.outputRootPolicy);
    commitResolvedRunConfig(resolvedConfig, settings.outputRootPolicy);
    scanInFlightRef.current = true;
    setIsScanning(true);
    try {
      const scannedImages = await engine.current!.scanImages(inputPath, resolvedConfig);
      applyScanResult(scannedImages, strings.imagesScanned);
      showToast(strings.imagesScanned);
    } catch {
      // errors handled by adapter events
    } finally {
      scanInFlightRef.current = false;
      setIsScanning(false);
    }
  }, [
    applyScanResult,
    commitResolvedRunConfig,
    settings.outputRootPolicy,
    settings.runConfig,
    settingsLoaded,
    showToast,
    strings.imagesScanned
  ]);

  const handlePickInputFolder = async () => {
    const typedPath = settings.runConfig.input_dir.trim();
    let selectedPath: string | null;
    try {
      selectedPath = await engine.current!.pickInputFolder(typedPath);
    } catch {
      return;
    }
    if (selectedPath) {
      commitPickedInputFolder(selectedPath);
      showToast(strings.inputFolderSelected);
      return;
    }
  };

  const handlePickModelFile = async () => {
    let selectedPath: string | null;
    try {
      selectedPath = await engine.current!.pickModelFile(settings.modelPath);
    } catch {
      return;
    }
    if (selectedPath) {
      updateModelPath(selectedPath);
      if (settings.autoLoadModel) {
        await engine.current!.loadModel(selectedPath, settings.runConfig);
      } else {
        showToast(strings.modelPathSelected);
      }
    }
  };

  const handleOpenOutputFolder = async () => {
    const target = outputFolderPath();
    let openResult: Awaited<ReturnType<EngineAdapter['openPath']>>;
    try {
      openResult = await engine.current!.openPath(target);
    } catch {
      openResult = { ok: false, path: target };
    }
    if (openResult.ok) {
      showToast(openResult.opened_parent || openResult.missing_target
        ? strings.outputFolderParentOpened
        : strings.outputFolderOpened);
      return;
    }
    await handleCopyOutputLocation();
  };

  const handleLoadModel = async (modelPath = settings.modelPath) => {
    await engine.current!.loadModel(modelPath, settings.runConfig);
  };

  const handleLoadOrPickModel = async () => {
    const savedPath = settings.modelPath.trim();
    if (savedPath) {
      await handleLoadModel(savedPath);
      return;
    }
    await handleLoadModel('');
  };

  useEffect(() => {
    if (!settingsLoaded || startupRestoreRef.current.scanned) return;
    startupRestoreRef.current.scanned = true;
    const inputDir = settings.runConfig.input_dir.trim();
    if (!inputDir) return;
    void (async () => {
      setStartupTasks(prev => ({ ...prev, scan: true }));
      try {
        await performScan(inputDir);
      } finally {
        setStartupTasks(prev => ({ ...prev, scan: false }));
      }
    })();
    // Startup restore must run once for the saved input directory, not whenever handler identities change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, settings.runConfig.input_dir]);

  useEffect(() => {
    if (!settingsLoaded || !settings.autoLoadModel || startupRestoreRef.current.modelLoaded) return;
    if (modelState.loaded || modelState.loading) return;
    if (!backendDiagnosticsAvailable) return;
    const savedModelPath = settings.modelPath.trim();
    startupRestoreRef.current.modelLoaded = true;
    const loadIfModelExists = async () => {
      try {
        const response = await fetch(backendUrl('/api/model/diagnose'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model_path: savedModelPath, config: settings.runConfig })
        });
        const payload = await response.json();
        if (response.ok && payload?.diagnostic?.exists) {
          setStartupTasks(prev => ({ ...prev, model: true }));
          await handleLoadModel(savedModelPath);
        }
      } catch {
        // The mock UI or a static preview can run without a backend settings API.
      } finally {
        setStartupTasks(prev => ({ ...prev, model: false }));
      }
    };
    void loadIfModelExists();
    // Startup model restore is guarded by startupRestoreRef and should not re-run on handler identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendDiagnosticsAvailable, modelState.loaded, modelState.loading, settings.autoLoadModel, settings.modelPath, settings.runConfig, settingsLoaded]);

  const handleUnloadModel = async () => {
    await engine.current!.unloadModel();
  };

  const handleStartBatch = async () => {
    if (isScanning) return;
    setIsProcessing(true);
    try {
      await engine.current!.startBatch(images, settings.runConfig);
    } catch {
      setIsProcessing(false);
    }
  };

  const handleStartCurrentImageBatch = async () => {
    const currentImage = images.find(img => img.id === selectedImageId);
    if (!currentImage || !modelState.loaded || isProcessing || isScanning) return;

    setIsProcessing(true);
    try {
      await engine.current!.startBatch([currentImage], settings.runConfig, { forceReprocess: true });
    } catch {
      setIsProcessing(false);
    }
  };

  const handleStopBatch = async () => {
    try {
      await engine.current!.stopBatch();
      showToast(strings.batchStopped);
    } catch {
      setIsProcessing(false);
    }
  };

  const handleDetectRegion = async (req: RegionRequest): Promise<RegionResult> => {
    return await engine.current!.detectRegion(req);
  };

  const handleSaveEdit = async (imageId: string, editedData: string) => {
    const savedImage = await engine.current!.saveManualEdit(imageId, editedData, settings.runConfig);
    if (!savedImage) {
      throw new Error(settings.uiPrefs.language === 'ko' ? '수동 편집 저장에 실패했습니다' : 'Manual edit save failed');
    }
    const previousImage = images.find(img => img.id === imageId);
    const backupImage: ImageItem = {
      ...(previousImage || savedImage),
      ...savedImage,
      original_thumbnail: savedImage.original_thumbnail || previousImage?.original_thumbnail,
      thumbnail: savedImage.thumbnail || previousImage?.thumbnail || savedImage.thumbnail,
      status: savedImage.status || 'censored'
    };
    setManualBackups(prev => ({ ...prev, [imageId]: backupImage }));
    
    // Keep React state pointed at backend-served image URLs instead of retaining full PNG data URLs.
    setImages(prev => prev.map(img => {
      if (img.id === imageId) {
        return {
          ...img,
          ...savedImage,
          original_thumbnail: savedImage.original_thumbnail || img.original_thumbnail,
          thumbnail: savedImage.thumbnail || img.thumbnail,
          status: savedImage.status || 'censored'
        };
      }
      return img;
    }));
  };

  const handleRestoreManualBackup = (imageId: string): boolean => {
    const backup = manualBackups[imageId];
    if (!backup) return false;
    setImages(prev => prev.map(img => img.id === imageId
      ? {
          ...img,
          ...backup,
          original_thumbnail: backup.original_thumbnail || img.original_thumbnail,
          thumbnail: backup.thumbnail || img.thumbnail,
          status: backup.status || 'censored',
          restored: true
        }
      : img
    ));
    setProgress(prev => ({
      ...prev,
      restored: Math.max(prev.restored || 0, 1),
      message: strings.restoreFromOriginal,
      current_file: backup.filename || prev.current_file,
      eta_text: ''
    }));
    showToast(strings.restoreFromOriginal);
    return true;
  };

  const handleResetImage = (imageId: string) => {
    const previousImage = images.find(img => img.id === imageId);
    const previousStatus = previousImage?.status;
    const wasFinal = previousStatus === 'censored' || previousStatus === 'clean' || previousStatus === 'failed';
    setImages(prev => prev.map(img => {
      if (img.id !== imageId) return img;
      return {
        ...img,
        status: 'pending' as const,
        warnings: undefined,
        result_path: undefined,
        restored: undefined,
        thumbnail: img.original_thumbnail || img.thumbnail
      };
    }));
    setWarnings([]);
    setErrors([]);
    setProgress(prev => ({
      ...prev,
      processed: wasFinal ? Math.max(0, prev.processed - 1) : prev.processed,
      censored: previousStatus === 'censored' ? Math.max(0, prev.censored - 1) : prev.censored,
      clean: previousStatus === 'clean' ? Math.max(0, prev.clean - 1) : prev.clean,
      failed: previousStatus === 'failed' ? Math.max(0, prev.failed - 1) : prev.failed,
      restored: previousImage?.restored ? Math.max(0, (prev.restored || 0) - 1) : prev.restored || 0,
      eta_text: '',
      current_file: '',
      message: strings.resetImage,
      throughput_text: undefined,
      duration_seconds: undefined,
      batch_context: undefined
    }));
    showToast(strings.resetImage);
  };

  const handleAddWarning = (msg: string) => {
    const safeMsg = settings.uiPrefs.sfwMode ? strings.protectedTargetSelection : msg;
    setWarnings(prev => [...prev, `[Warning] ${safeMsg}`]);
  };

  const handleClearLogs = () => {
    setWarnings([]);
    setErrors([]);
    showToast(strings.logCleared);
  };

  const handleResetAll = () => {
    if (isProcessing || isScanning) return;
    if (!confirmResetIfNeeded()) return;
    setWarnings([]);
    setErrors([]);
    setImages(prev => prev.map(img => {
      let type = 'license';
      if (img.id === 'img2' || img.id === 'img6') type = 'cctv';
      if (img.id === 'img3') type = 'id';
      if (img.id === 'img4') type = 'document';
      const isMockThumbnail = img.thumbnail.startsWith('data:image/svg+xml');
      return {
        ...img,
        status: 'pending',
        warnings: undefined,
        result_path: undefined,
        restored: undefined,
        thumbnail: isMockThumbnail ? createMockSvgDataUrl(type, img.filename, false) : img.original_thumbnail || img.thumbnail
      };
    }));
    setProgress(prev => ({
      total: prev.total,
      processed: 0,
      censored: 0,
      clean: 0,
      failed: 0,
      restored: 0,
      eta_text: '',
      current_file: '',
      message: strings.ready
    }));
    showToast(strings.allStatesReset);
  };

  const selectedImage = images.find(img => img.id === selectedImageId) || null;
  const startupMessage = startupTasks.model
    ? (settings.uiPrefs.language === 'ko' ? '저장된 모델을 준비하는 중입니다.' : 'Preparing the saved model.')
    : startupTasks.scan
      ? (settings.uiPrefs.language === 'ko' ? '저장된 입력 폴더를 복원하는 중입니다.' : 'Restoring the saved input folder.')
      : '';

  return (
    <div className="app-container">
      {/* Korean Font Detection Warning Banner */}
      {isKoreanFontWarningVisible && (
        <div className="warning-banner warning-banner-danger">
          <div className="warning-banner-message">
            <AlertTriangle size={16} fill="none" stroke="currentColor" />
            <span style={{ fontWeight: 'bold' }}>WARNING / 경고:</span>
            <span>
              {settings.uiPrefs.language === 'ko' 
                ? '시스템에 한글 글꼴(Noto Sans KR, Malgun Gothic 등)이 감지되지 않았습니다. 한글 텍스트가 깨져 보일 수 있습니다.'
                : 'No Korean font (Noto Sans KR, Malgun Gothic, etc.) detected on this system. Korean text might render as tofu boxes.'}
            </span>
          </div>
          <button 
            onClick={() => {
              setIsKoreanFontWarningVisible(false);
              updateAppUiState({ koreanFontWarningDismissed: true });
            }}
            className="warning-banner-button"
          >
            Dismiss / 닫기
          </button>
        </div>
      )}

      {startupMessage && (
        <div className="startup-overlay" role="status" aria-live="polite">
          <div className="startup-panel">
            <div className="startup-spinner" aria-hidden="true" />
            <div>
              <strong>{settings.uiPrefs.language === 'ko' ? 'AutoCensor 준비 중' : 'Preparing AutoCensor'}</strong>
              <span>{startupMessage}</span>
            </div>
          </div>
        </div>
      )}

      {/* Topbar Command Bar */}
      <Topbar 
        modelState={modelState}
        isProcessing={isProcessing}
        isScanning={isScanning}
        settingsLoaded={settingsLoaded}
        onScan={performScan}
        onPickInputFolder={handlePickInputFolder}
        onPickModelFile={handlePickModelFile}
        onLoadModel={handleLoadOrPickModel}
        onUnloadModel={handleUnloadModel}
        onStartBatch={handleStartBatch}
        onStartCurrentImageBatch={handleStartCurrentImageBatch}
        onStopBatch={handleStopBatch}
        onCopyOutputLocation={handleCopyOutputLocation}
        onOpenOutputFolder={handleOpenOutputFolder}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onResetAll={handleResetAll}
        canStartCurrentImageBatch={Boolean(selectedImage && modelState.loaded && !isProcessing && !isScanning)}
      />

      {/* Main Grid Viewport */}
      <div className="main-workspace">
        {/* Left Side: Folder contents & list filters */}
        <ImageList 
          images={images}
          selectedImageId={selectedImageId}
          onSelectImage={(id) => setSelectedImageId(id)}
        />

        {/* Center: Image editing canvas */}
        <Canvas 
          key={`${scanRevision}:${selectedImage?.id ?? 'empty-canvas'}`}
          selectedImage={selectedImage}
          manualBackupImage={selectedImage ? manualBackups[selectedImage.id] || null : null}
          onDetectRegion={handleDetectRegion}
          onSaveEdit={handleSaveEdit}
          onResetImage={handleResetImage}
          onRestoreManualBackup={handleRestoreManualBackup}
          onAddWarning={handleAddWarning}
        />

        {/* Right Side: Operations options and postprocessing details */}
        <Toolbar />
      </div>

      {/* Status Bar */}
      <Statusbar 
        progress={progress}
        isProcessing={isProcessing}
        warnings={warnings}
        errors={errors}
        onClearLogs={handleClearLogs}
      />

      {/* Settings Dialog */}
      <SettingsDialog 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onToast={showToast}
        onPickFolder={(initialPath) => engine.current!.pickInputFolder(initialPath)}
        onPickModelFile={(initialPath) => engine.current!.pickModelFile(initialPath)}
        onLoadModel={handleLoadModel}
        backendDiagnosticsAvailable={backendDiagnosticsAvailable}
      />

      {/* Quick floating help bar at bottom if configured */}
      {settings.uiPrefs.showHelpBar && (
        <div className="shortcut-help-anchor" ref={shortcutHelpRef}>
          <button
            className="shortcut-help-chip"
            data-evidence="shortcut-help-collapsed"
            onClick={() => setIsShortcutHelpOpen(value => !value)}
            aria-expanded={isShortcutHelpOpen}
            title={strings.shortcutHelp}
          >
            <HelpCircle size={14} />
            <span>{strings.shortcutHelpCollapsed}</span>
          </button>
          {isShortcutHelpOpen && (
            <div className="shortcut-help-popover" data-evidence="shortcut-help-expanded" role="dialog" aria-label={strings.shortcutHelp}>
              <div className="shortcut-help-header">
                <strong>{strings.shortcutHelp}</strong>
                <button onClick={() => setIsShortcutHelpOpen(false)} aria-label="Close" style={{ padding: '3px', border: 'none' }}>
                  <X size={14} />
                </button>
              </div>
              {[
                [strings.shortcutGroupNavigation, [
                  [settings.shortcuts.previousImage, strings.previousImage],
                  [settings.shortcuts.nextImage, strings.nextImage],
                  [settings.shortcuts.original, strings.toggleOriginal]
                ]],
                [strings.shortcutGroupEditing, [
                  [settings.shortcuts.brush, strings.brush],
                  [settings.shortcuts.eraser, strings.eraser],
                  [settings.shortcuts.region, strings.detectRegion],
                  [settings.shortcuts.stamp, strings.emojiTool],
                  [settings.shortcuts.undo, strings.undo],
                  [settings.shortcuts.redo, strings.redo],
                  [settings.shortcuts.altRedo, strings.altRedoAction],
                  [settings.shortcuts.resetCurrent, strings.resetImage],
                  [settings.shortcuts.brushDown, strings.brushDown],
                  [settings.shortcuts.brushUp, strings.brushUp],
                  [settings.shortcuts.quickMask, strings.quickMask],
                  [settings.shortcuts.stampRotateClockwise, strings.rotateStampClockwise],
                  [settings.shortcuts.stampRotateCounterClockwise, strings.rotateStampCounterClockwise]
                ]],
                [strings.shortcutGroupCanvas, [
                  [settings.shortcuts.zoomReset, strings.zoomReset],
                  [settings.shortcuts.zoomIn, strings.zoomInCanvas],
                  [settings.shortcuts.zoomOut, strings.zoomOut],
                  ['Wheel', strings.zoomIn],
                  ['Space + Drag', strings.panCanvas]
                ]],
                [strings.shortcutGroupProcessing, [
                  [settings.shortcuts.startBatch, strings.startBatchAction],
                  [settings.shortcuts.censorCurrent, strings.censorCurrentAction],
                  [settings.shortcuts.cancel, strings.cancelAction]
                ]],
                [strings.shortcutGroupPhotoshop, [
                  [settings.shortcuts.toggleTabletPressure, strings.toggleTabletPressureAction],
                  [settings.shortcuts.toggleBrushHardness, strings.toggleBrushHardnessAction],
                  [settings.shortcuts.toggleExtendedShortcuts, strings.toggleExtendedShortcutsAction],
                  [settings.shortcuts.toggleStraightLine, strings.toggleStraightLineAction],
                  [settings.shortcuts.toggleQuickMaskOverlay, strings.toggleQuickMaskOverlayAction]
                ]]
              ].map(([group, rows]) => (
                <section key={String(group)} className="shortcut-help-group">
                  <h3>{group}</h3>
                  {(rows as string[][]).map(([shortcut, label]) => (
                    <div key={`${shortcut}:${label}`} className="shortcut-help-row">
                      <kbd>{shortcut}</kbd>
                      <span>{label}</span>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Toast Notification Popup */}
      {toast && (
        <div className="toast" data-completion-toast="true">
          {toast}
        </div>
      )}
    </div>
  );
};

// Root wrapper with provider dependencies
export default function App() {
  return (
    <AppContent />
  );
}
