import React, { useEffect, useRef, useState } from 'react';
import { useSettings } from '../settings/SettingsContext';
import { shouldUseProtectedLabels } from '../settings/privacyDisplay';

import { i18nStrings } from '../i18n/strings';
import { ModelState, RunConfig } from '../engine/EngineAdapter';
import { 
  FolderOpen, 
  Copy,
  Play, 
  PlaySquare,
  Square, 
  Settings as SettingsIcon, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  HelpCircle,
  RefreshCcw,
  Eye,
  EyeOff,
  FileText,
  Search,
  Minus,
  X
} from 'lucide-react';

type DesktopWindowApi = {
  pick_folder?: unknown;
  minimize_window?: () => Promise<{ ok: boolean; error?: string }>;
  toggle_maximize_window?: () => Promise<{ ok: boolean; maximized?: boolean; error?: string }>;
  close_window?: () => Promise<{ ok: boolean; error?: string }>;
  start_window_drag?: () => Promise<{ ok: boolean; error?: string }>;
};

type DesktopWindowBridge = Window & {
  __AUTOCENSOR_DESKTOP__?: boolean;
  pywebview?: {
    platform?: string;
    api?: DesktopWindowApi;
  };
};

const isDesktopLaunch = () =>
  Boolean((window as DesktopWindowBridge).__AUTOCENSOR_DESKTOP__) ||
  document.documentElement.dataset.desktopWindow === 'true' ||
  new URLSearchParams(window.location.search).get('desktop') === '1';

interface TopbarProps {
  modelState: ModelState;
  isProcessing: boolean;
  isScanning: boolean;
  settingsLoaded: boolean;
  onScan: (path: string) => void;
  onPickInputFolder: () => void;
  onPickModelFile: () => void;
  onLoadModel: () => void;
  onUnloadModel: () => void;
  onStartBatch: () => void;
  onStartCurrentImageBatch: () => void;
  onStopBatch: () => void;
  onCopyOutputLocation: () => void;
  onOpenOutputFolder: () => void;
  onOpenSettings: () => void;
  onResetAll?: () => void;
  canStartCurrentImageBatch: boolean;
}

export const Topbar: React.FC<TopbarProps> = ({
  modelState,
  isProcessing,
  isScanning,
  settingsLoaded,
  onScan,
  onPickInputFolder,
  onPickModelFile,
  onLoadModel,
  onUnloadModel,
  onStartBatch,
  onStartCurrentImageBatch,
  onStopBatch,
  onCopyOutputLocation,
  onOpenOutputFolder,
  onOpenSettings,
  onResetAll,
  canStartCurrentImageBatch
}) => {
  const { settings, updateRunConfig, updateUiPrefs } = useSettings();
  const [draftInput, setDraftInput] = useState(settings.runConfig.input_dir);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftFocused, setDraftFocused] = useState(false);
  const titlebarDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [desktopWindowControls, setDesktopWindowControls] = useState(
    () => isDesktopLaunch() || Boolean((window as DesktopWindowBridge).pywebview?.platform && (window as DesktopWindowBridge).pywebview?.api?.pick_folder)
  );
  const strings = i18nStrings[settings.uiPrefs.language];
  const protectedUi = shouldUseProtectedLabels(settings.uiPrefs);
  const protectedModelText = settings.uiPrefs.language === 'ko' ? '처리 준비 상태' : 'Processing readiness';
  const protectedLoadText = settings.uiPrefs.language === 'ko' ? '처리 준비' : 'Prepare processing';
  const protectedUnloadText = settings.uiPrefs.language === 'ko' ? '준비 해제' : 'Clear readiness';
  const protectedFolderText = settings.uiPrefs.language === 'ko' ? '보호 입력' : 'Protected input';
  const controlsBusy = isProcessing || isScanning || !settingsLoaded;
  const desktopChromeActive = desktopWindowControls || isDesktopLaunch();

  useEffect(() => {
    if (draftFocused && draftDirty) return;
    const timer = window.setTimeout(() => {
      setDraftInput(settings.runConfig.input_dir);
      setDraftDirty(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftDirty, draftFocused, settings.runConfig.input_dir]);

  useEffect(() => {
    const hasDesktopBridge = () => {
      const bridge = (window as DesktopWindowBridge).pywebview;
      return Boolean(bridge?.platform && bridge.api?.pick_folder);
    };
    if (desktopWindowControls) return;
    const markReady = () => {
      if (hasDesktopBridge()) {
        setDesktopWindowControls(true);
      }
    };
    window.addEventListener('pywebviewready', markReady);
    const timer = window.setInterval(() => {
      if (hasDesktopBridge()) {
        setDesktopWindowControls(true);
        window.clearInterval(timer);
      }
    }, 250);
    return () => {
      window.removeEventListener('pywebviewready', markReady);
      window.clearInterval(timer);
    };
  }, [desktopWindowControls]);

  useEffect(() => {
    if (desktopWindowControls) return;
    if (!isDesktopLaunch()) return;
    let cancelled = false;
    const probeDesktopWindowApi = async () => {
      try {
        const response = await fetch('/api/desktop/window', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'state' })
        });
        const result = await response.json().catch(() => null);
        if (!cancelled && response.ok && result?.ok && result?.desktop) {
          setDesktopWindowControls(true);
        }
      } catch {
        // Normal browser/server mode has no native window controller.
      }
    };
    void probeDesktopWindowApi();
    return () => {
      cancelled = true;
    };
  }, [desktopWindowControls]);

  const desktopApi = () => (window as DesktopWindowBridge).pywebview?.api;

  const requestDesktopWindowAction = async (action: 'minimize' | 'toggle-maximize' | 'close' | 'drag') => {
    if (isDesktopLaunch()) {
      try {
        const response = await fetch('/api/desktop/window', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        });
        const result = await response.json().catch(() => null);
        if (response.ok && result?.ok) return;
      } catch {
        // Fall back to the pywebview JS bridge below when the HTTP path is not available.
      }
    }
    const api = desktopApi();
    if (action === 'minimize') {
      await api?.minimize_window?.();
    } else if (action === 'toggle-maximize') {
      await api?.toggle_maximize_window?.();
    } else if (action === 'close') {
      await api?.close_window?.();
    } else {
      await api?.start_window_drag?.();
    }
  };

  const handleMinimizeWindow = () => {
    void requestDesktopWindowAction('minimize');
  };

  const handleToggleMaximizeWindow = () => {
    void requestDesktopWindowAction('toggle-maximize');
  };

  const handleCloseWindow = () => {
    void requestDesktopWindowAction('close');
  };

  const isTitlebarInteractiveTarget = (target: HTMLElement) =>
    Boolean(target.closest('button,input,select,textarea,a,.topbar-window-controls'));

  const handleTitlebarMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    if (!desktopChromeActive || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (isTitlebarInteractiveTarget(target)) return;
    if (event.detail >= 2) {
      event.preventDefault();
      titlebarDragStartRef.current = null;
      return;
    }
    titlebarDragStartRef.current = { x: event.screenX, y: event.screenY };
  };

  const handleTitlebarMouseMove = (event: React.MouseEvent<HTMLElement>) => {
    const start = titlebarDragStartRef.current;
    if (!desktopChromeActive || !start) return;
    if ((event.buttons & 1) !== 1) {
      titlebarDragStartRef.current = null;
      return;
    }
    const distance = Math.abs(event.screenX - start.x) + Math.abs(event.screenY - start.y);
    if (distance < 4) return;
    titlebarDragStartRef.current = null;
    void requestDesktopWindowAction('drag');
  };

  const handleTitlebarMouseUp = () => {
    titlebarDragStartRef.current = null;
  };

  const handleTitlebarDoubleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!desktopChromeActive || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (isTitlebarInteractiveTarget(target)) return;
    event.preventDefault();
    void requestDesktopWindowAction('toggle-maximize');
  };

  const handleScanTypedPath = () => {
    const path = draftInput.trim();
    if (!path) return;
    setDraftDirty(false);
    onScan(path);
  };

  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateRunConfig({ device_mode: e.target.value as RunConfig['device_mode'] });
  };

  const windowControlButtons = desktopChromeActive ? (
    <div
      className="topbar-window-controls"
      aria-label={settings.uiPrefs.language === 'ko' ? '창 제어' : 'Window controls'}
    >
      <button
        type="button"
        onClick={handleMinimizeWindow}
        data-action="window-minimize"
        title={settings.uiPrefs.language === 'ko' ? '최소화' : 'Minimize'}
        aria-label={settings.uiPrefs.language === 'ko' ? '최소화' : 'Minimize'}
      >
        <Minus size={15} />
      </button>
      <button
        type="button"
        onClick={handleToggleMaximizeWindow}
        data-action="window-maximize"
        title={settings.uiPrefs.language === 'ko' ? '최대화/복원' : 'Maximize or restore'}
        aria-label={settings.uiPrefs.language === 'ko' ? '최대화/복원' : 'Maximize or restore'}
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        onClick={handleCloseWindow}
        data-action="window-close"
        className="topbar-window-close"
        title={settings.uiPrefs.language === 'ko' ? '닫기' : 'Close'}
        aria-label={settings.uiPrefs.language === 'ko' ? '닫기' : 'Close'}
      >
        <X size={15} />
      </button>
    </div>
  ) : null;

  return (
    <div className={`topbar-stack${desktopChromeActive ? ' topbar-stack-desktop' : ''}`}>
      {desktopChromeActive && (
        <div
          className="desktop-titlebar"
          title={settings.uiPrefs.language === 'ko' ? '창 이동 / 더블클릭으로 최대화' : 'Move window / double-click to maximize'}
          onMouseDown={handleTitlebarMouseDown}
          onMouseMove={handleTitlebarMouseMove}
          onMouseUp={handleTitlebarMouseUp}
          onMouseLeave={handleTitlebarMouseUp}
          onDoubleClick={handleTitlebarDoubleClick}
        >
          <div className="desktop-titlebar-brand">
            <img src="/app-icon.png" alt="" aria-hidden="true" />
            <span>{protectedUi ? (settings.uiPrefs.language === 'ko' ? '보호 작업' : 'Protected Workspace') : strings.appTitle}</span>
          </div>
          <div className="desktop-titlebar-drag-space" aria-hidden="true" />
          {windowControlButtons}
        </div>
      )}
      <header className={`topbar${desktopChromeActive ? ' topbar-toolbar-desktop' : ''}`}>
      {/* App Branding & Logo */}
      {!desktopChromeActive && (
        <div
          className="topbar-brand pywebview-drag-region"
          title={settings.uiPrefs.language === 'ko' ? '창 이동' : 'Move window'}
        >
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            background: 'var(--color-panel)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            border: '1px solid var(--color-border)'
          }}>
            <img
              src="/app-icon.png"
              alt=""
              aria-hidden="true"
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
          </div>
          <h1 className="topbar-title">
            {protectedUi ? (settings.uiPrefs.language === 'ko' ? '보호 작업' : 'Protected Workspace') : strings.appTitle}
            <span style={{ fontSize: '10px', fontWeight: 500, color: 'var(--color-primary)', marginLeft: '4px', verticalAlign: 'middle', background: 'var(--color-selection)', padding: '1px 5px', borderRadius: '3px' }}>
              vNext
            </span>
          </h1>
        </div>
      )}

      {/* Inputs (Folder Scanning) */}
      <div className="topbar-folder-group">
        <div style={{ position: 'relative', width: '100%' }} className="tooltip-trigger">
          <input
            type="text"
            placeholder={protectedUi ? protectedFolderText : strings.selectInputFolder}
            value={protectedUi ? '' : draftInput}
            onChange={(e) => {
              setDraftInput(e.target.value);
              setDraftDirty(true);
            }}
            onFocus={() => setDraftFocused(true)}
            onBlur={() => setDraftFocused(false)}
            disabled={controlsBusy}
            style={{ width: '100%', paddingRight: '32px', textOverflow: 'ellipsis' }}
          />
          {settings.runConfig.input_dir && (
            <span className="tooltip-text">{protectedUi ? protectedFolderText : strings.inputFolderSelected}</span>
          )}
        </div>
        <button 
          onClick={onPickInputFolder}
          disabled={controlsBusy}
          data-action="scan-folder"
          title={strings.selectInputFolder}
        >
          <FolderOpen size={16} />
        </button>
        <button
          onClick={handleScanTypedPath}
          disabled={controlsBusy || !draftInput.trim()}
          data-action="scan-typed-folder"
          title={strings.inputFolderSelected}
        >
          <Search size={14} />
          <span className="topbar-command-label">{settings.uiPrefs.language === 'ko' ? '스캔' : 'Scan'}</span>
        </button>
        <button
          onClick={onOpenOutputFolder}
          disabled={controlsBusy}
          data-action="open-output-folder"
          title={strings.openOutputFolder}
        >
          <Copy size={16} />
          <span className="topbar-command-label">{strings.outputFolder}</span>
        </button>
        <button
          onClick={onCopyOutputLocation}
          disabled={controlsBusy}
          data-action="copy-output-location"
          title={strings.outputLocationSafety}
        >
          <FileText size={14} />
          <span className="topbar-command-label">{settings.uiPrefs.language === 'ko' ? '규칙' : 'Rule'}</span>
        </button>
      </div>

      {/* Model Loading State */}
      {/* Control Actions (Device, Start, Stop, Settings) */}
      <div className="topbar-action-group">
        {/* Device Select */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <select 
            value={settings.runConfig.device_mode} 
            onChange={handleDeviceChange}
            disabled={controlsBusy}
            aria-label={strings.deviceMode}
            title={strings.deviceMode}
            style={{ padding: '4px 8px', height: '30px', width: '168px', maxWidth: '18vw' }}
          >
            <option value="auto">{strings.deviceAuto}</option>
            <option value="cpu">{strings.deviceCpu}</option>
            <option value="cuda">{strings.deviceCuda}</option>
            <option value="hybrid">{strings.deviceHybrid}</option>
          </select>
        </div>

        {/* Toggle SFW Mode in Topbar Helper (if enabled in UI options) */}
        {settings.uiPrefs.showHelperButtons && (
          <button
            onClick={() => updateUiPrefs({ sfwMode: !settings.uiPrefs.sfwMode })}
            data-action="toggle-sfw-mode"
            title={strings.privacySfwMode}
            style={{ height: '30px', padding: '0 8px' }}
          >
            {settings.uiPrefs.sfwMode ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}

        {settings.uiPrefs.showHelperButtons && (
          <button
            onClick={() => updateUiPrefs({ showFilenames: !settings.uiPrefs.showFilenames })}
            title={strings.filenameVisibility}
            style={{ height: '30px', padding: '0 8px' }}
          >
            {settings.uiPrefs.showFilenames ? <FileText size={16} /> : <EyeOff size={16} />}
          </button>
        )}

        {/* Reset All Button (visible when helper buttons are enabled) */}
        {settings.uiPrefs.showHelperButtons && onResetAll && (
          <button
            onClick={onResetAll}
            disabled={controlsBusy}
            title={strings.resetAll}
            style={{ height: '30px', padding: '0 10px' }}
          >
            <RefreshCcw size={14} />
            <span className="topbar-command-label">{settings.uiPrefs.language === 'ko' ? '초기화' : 'Reset'}</span>
          </button>
        )}

        {/* Start Batch Button */}
        <button
          className="primary"
          disabled={controlsBusy || !settings.runConfig.input_dir || !modelState.loaded}
          onClick={onStartBatch}
          data-action="start-batch"
          style={{ height: '30px' }}
        >
          <Play size={14} fill="currentColor" />
          <span className="topbar-command-label">{settings.uiPrefs.language === 'ko' ? '일괄 시작' : 'Batch'}</span>
        </button>

        <button
          disabled={!canStartCurrentImageBatch}
          data-action="current-image-censor"
          onClick={onStartCurrentImageBatch}
          title={protectedUi ? (settings.uiPrefs.language === 'ko' ? '현재 이미지 처리' : 'Process current image') : strings.startCurrentCensor}
          style={{ height: '30px' }}
        >
          <PlaySquare size={14} />
          <span className="topbar-command-label">
            {settings.uiPrefs.language === 'ko' ? '현재' : 'Current'}
          </span>
        </button>

        {/* Stop Batch Button */}
        <button
          className="danger"
          disabled={!isProcessing}
          onClick={onStopBatch}
          data-action="stop-batch"
          style={{ height: '30px' }}
        >
          <Square size={14} fill="currentColor" />
          <span className="topbar-command-label">{settings.uiPrefs.language === 'ko' ? '중지' : 'Stop'}</span>
        </button>
      </div>

      {/* Model Loading State */}
      <div className="topbar-model-group">
        <div className="topbar-model-state" title={protectedUi ? strings.protectedTargetSelection : modelState.model_name || strings.modelState}>
          {modelState.loading ? (
            <>
              <Loader2 className="animate-spin" size={14} style={{ color: 'var(--color-warning)' }} />
              <span>{protectedUi ? protectedModelText : strings.modelLoading}</span>
            </>
          ) : modelState.loaded ? (
            <>
              <CheckCircle2 size={14} style={{ color: 'var(--color-success)' }} />
              <span>{protectedUi ? protectedModelText : strings.modelLoaded}</span>
            </>
          ) : modelState.error ? (
            <>
              <XCircle size={14} style={{ color: 'var(--color-danger)' }} />
              <span>{protectedUi ? protectedModelText : strings.modelError}</span>
            </>
          ) : (
            <>
              <HelpCircle size={14} style={{ color: 'var(--color-mutedText)' }} />
              <span>{protectedUi ? protectedModelText : strings.modelUnloaded}</span>
            </>
          )}
        </div>

        {modelState.loaded ? (
          <button onClick={onUnloadModel} disabled={controlsBusy} title={protectedUi ? protectedUnloadText : strings.unloadModel}>
            {protectedUi ? protectedUnloadText : strings.unloadModel}
          </button>
        ) : (
          <>
            <button
              onClick={onPickModelFile}
              disabled={modelState.loading || controlsBusy}
              data-action="pick-model-file"
              title={protectedUi ? protectedLoadText : strings.selectModel}
            >
              {settings.uiPrefs.language === 'ko' ? '모델' : 'Model'}
            </button>
            <button
              onClick={() => onLoadModel()}
              disabled={modelState.loading || controlsBusy}
              className="primary"
              data-action="load-model"
              title={protectedUi ? protectedLoadText : strings.loadModel}
            >
              {protectedUi ? protectedLoadText : strings.loadModel}
            </button>
          </>
        )}
      </div>

      {/* Settings Dialog Trigger */}
      <button
        onClick={onOpenSettings}
        title={strings.settings}
        data-action="open-settings"
        className="topbar-settings-button"
      >
        <SettingsIcon size={16} />
      </button>
      </header>
    </div>
  );
};
