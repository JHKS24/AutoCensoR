import React, { useState } from 'react';
import { DEFAULT_SHORTCUTS, ShortcutConfig, useSettings, Language } from '../settings/SettingsContext';
import { useTheme, ThemeMode } from '../theme/ThemeContext';
import { i18nStrings } from '../i18n/strings';
import { RunConfig } from '../engine/EngineAdapter';
import { backendUrl } from '../engine/backendUrl';
import { CENSOR_TARGET_GROUPS, DEFAULT_CENSOR_TARGETS, DEFAULT_CENSOR_TARGET_SET, maskSensitiveText } from '../settings/censorTargets';
import { findShortcutConflicts, normalizeShortcutList } from '../settings/shortcutUtils';
import { shouldUseProtectedLabels } from '../settings/privacyDisplay';
import {
  X,
  Save as SaveIcon,
  ShieldAlert,
  Cpu,
  Activity,
  Laptop,
  Key,
  EyeOff,
  Trash2,
  Plus,
  FolderOpen,
  Loader2
} from 'lucide-react';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
  onPickFolder?: (initialPath?: string) => Promise<string | null>;
  onPickModelFile?: (initialPath?: string) => Promise<string | null>;
  onLoadModel?: (modelPath?: string) => Promise<void>;
  backendDiagnosticsAvailable?: boolean;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  isOpen,
  onClose,
  onToast,
  onPickFolder,
  onPickModelFile,
  onLoadModel,
  backendDiagnosticsAvailable = true
}) => {
  const {
    settings,
    settingsStoragePath,
    updateRunConfig,
    updateOutputDirsAsCustom,
    updateUiPrefs,
    updateShortcuts,
    updateModelPath,
    updateAutoLoadModel,
    resetAllSettings
  } = useSettings();
  const { themeMode, setThemeMode } = useTheme();

  const strings = i18nStrings[settings.uiPrefs.language];
  const [activeTab, setActiveTab] = useState<'save' | 'censor' | 'performance' | 'model' | 'ui' | 'shortcuts' | 'privacy'>('save');
  const [customTargetText, setCustomTargetText] = useState('');
  const [shortcutDrafts, setShortcutDrafts] = useState<Partial<ShortcutConfig>>({});
  const protectedUi = shouldUseProtectedLabels(settings.uiPrefs);
  const protectedDiagnosticText = settings.uiPrefs.language === 'ko'
    ? '보호 진단 세부 정보는 프라이버시 모드에서 숨겨집니다.'
    : 'Protected diagnostic details are hidden in privacy mode.';
  const protectedSettingText = settings.uiPrefs.language === 'ko' ? '보호 설정' : 'Protected setting';
  const protectedModelPathPlaceholder = settings.modelPath.trim()
    ? (settings.uiPrefs.language === 'ko' ? '저장된 모델 경로' : 'Saved model path')
    : protectedSettingText;
  const targetModeLabels = settings.uiPrefs.language === 'ko'
    ? {
        selected: protectedUi ? '기본+추가 보호 범주' : 'NTD 기본+추가 검열 라벨',
        all: protectedUi ? '모든 보호 범주' : '모든 모델 라벨',
        help: protectedUi
          ? '전체 모드는 반환된 모든 보호 범주를 처리합니다. 보호 상태에서는 정확한 항목 이름을 표시하지 않습니다.'
          : '선택 모드는 고정 NTD 기본 검열 라벨과 사용자가 추가한 모델별 라벨을 처리합니다. 전체 모드는 로드한 모델이 반환한 모든 라벨을 검열합니다.'
      }
    : {
        selected: protectedUi ? 'Default + added protected categories' : 'NTD defaults + added censor labels',
        all: protectedUi ? 'All protected categories' : 'All model labels',
        help: protectedUi
          ? 'All mode processes every returned protected category. Exact item names are hidden while protection is enabled.'
          : 'Selected mode processes fixed NTD default censor labels plus user-added model-specific labels. All mode censors every label returned by the loaded model.'
      };
  const targetSectionTitle = protectedUi ? strings.protectedTargets : strings.targetClasses;
  const selectionRegionModeText = protectedUi
    ? (settings.uiPrefs.language === 'ko' ? '선택 영역 처리 방식' : 'Selected area processing mode')
    : strings.selectionRegionMode;
  const selectionRegionModeModelText = protectedUi
    ? (settings.uiPrefs.language === 'ko' ? '모델 기반 처리' : 'Model-based processing')
    : strings.selectionRegionModeModel;
  const selectionRegionModeSelectionText = protectedUi
    ? (settings.uiPrefs.language === 'ko' ? '선택 영역 전체 처리' : 'Process the selected area directly')
    : strings.selectionRegionModeSelection;
  const selectionRegionModeHintText = protectedUi
    ? (settings.uiPrefs.language === 'ko'
        ? '우클릭 드래그에 적용됩니다. 보호 상태에서는 정확한 항목 이름을 표시하지 않습니다.'
        : 'Applies to right-click drag. Exact item names are hidden while protection is enabled.')
    : strings.selectionRegionModeHint;
  const defaultFixedText = settings.uiPrefs.language === 'ko'
    ? `NTD 기본 항목 ${DEFAULT_CENSOR_TARGETS.length}개는 목록 기준으로 제공됩니다. 필요한 항목만 켜고, 모델 변경용 추가 라벨은 아래에서 관리하세요.`
    : `${DEFAULT_CENSOR_TARGETS.length} NTD defaults are provided as a baseline. Enable only the needed items, and manage added labels below for other models.`;

  // Diagnostics and optimization loading states
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagResult, setDiagResult] = useState<string>('');

  const [isOptimizing, setIsOptimizing] = useState(false);

  if (!isOpen) return null;

  const shortcutRows: Array<[keyof ShortcutConfig, string]> = [
    ['previousImage', strings.previousImage],
    ['nextImage', strings.nextImage],
    ['resetCurrent', strings.resetImage],
    ['undo', strings.undoAction],
    ['redo', strings.redoAction],
    ['altRedo', strings.altRedoAction],
    ['cancel', strings.cancelAction],
    ['brush', protectedUi ? (settings.uiPrefs.language === 'ko' ? '브러시' : 'Brush') : strings.brush],
    ['eraser', strings.eraser],
    ['region', strings.detectRegion],
    ['stamp', strings.emojiTool],
    ['stampRotateClockwise', strings.rotateStampClockwiseAction],
    ['stampRotateCounterClockwise', strings.rotateStampCounterClockwiseAction],
    ['quickMask', strings.quickMask],
    ['original', strings.toggleOriginal],
    ['brushDown', strings.brushDown],
    ['brushUp', strings.brushUp],
    ['zoomReset', strings.zoomReset],
    ['zoomIn', strings.zoomInCanvas],
    ['zoomOut', strings.zoomOut],
    ['startBatch', protectedUi ? (settings.uiPrefs.language === 'ko' ? '자동 일괄 처리 시작' : 'Start automatic batch processing') : strings.startBatchAction],
    ['censorCurrent', protectedUi ? (settings.uiPrefs.language === 'ko' ? '현재 이미지만 처리' : 'Process current image only') : strings.censorCurrentAction],
    ['toggleTabletPressure', strings.toggleTabletPressureAction],
    ['toggleBrushHardness', strings.toggleBrushHardnessAction],
    ['toggleExtendedShortcuts', strings.toggleExtendedShortcutsAction],
    ['toggleStraightLine', strings.toggleStraightLineAction],
    ['toggleQuickMaskOverlay', strings.toggleQuickMaskOverlayAction]
  ];
  const effectiveShortcuts = { ...settings.shortcuts, ...shortcutDrafts } as ShortcutConfig;
  const shortcutConflicts = findShortcutConflicts(effectiveShortcuts);
  const shortcutLabelByKey = new Map<string, string>([
    ...shortcutRows.map(([key, label]) => [key, label] as [string, string]),
    ['fixedCanvasPan', strings.panCanvas]
  ]);

  const customTargets = settings.runConfig.targets.filter((target) => !DEFAULT_CENSOR_TARGET_SET.has(target));
  const selectedTargetSet = new Set(settings.runConfig.targets);
  const targetEmptyWarning = settings.uiPrefs.language === 'ko'
    ? '선택 모드에서는 최소 1개 이상의 보호 항목이 필요합니다.'
    : 'Selected mode requires at least one protected target.';

  const setTargetLabels = (labels: string[], enabled: boolean) => {
    const next = new Set(settings.runConfig.targets);
    labels.forEach((label) => {
      if (enabled) {
        next.add(label);
      } else {
        next.delete(label);
      }
    });
    if (next.size === 0) {
      onToast(targetEmptyWarning);
      return;
    }
    updateRunConfig({ target_mode: 'selected', targets: Array.from(next) });
  };

  const handleAddCustomTargets = () => {
    const nextTargets = customTargetText
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (nextTargets.length === 0) return;
    updateRunConfig({ target_mode: 'selected', targets: Array.from(new Set([...settings.runConfig.targets, ...nextTargets])) });
    setCustomTargetText('');
  };

  const handleRemoveTarget = (target: string) => {
    if (DEFAULT_CENSOR_TARGET_SET.has(target)) return;
    const nextTargets = settings.runConfig.targets.filter((item) => item !== target);
    if (nextTargets.length === 0) {
      onToast(targetEmptyWarning);
      return;
    }
    updateRunConfig({ target_mode: 'selected', targets: nextTargets });
  };

  const handleShortcutDraftChange = (key: keyof ShortcutConfig, value: string) => {
    setShortcutDrafts(prev => ({ ...prev, [key]: value }));
  };

  const commitShortcutChange = (key: keyof ShortcutConfig, value: string) => {
    const normalized = normalizeShortcutList(value);
    const nextShortcuts = { ...effectiveShortcuts, [key]: normalized };
    const nextConflicts = findShortcutConflicts(nextShortcuts);
    if ((nextConflicts[key] || []).length > 0) {
      onToast(settings.uiPrefs.language === 'ko'
        ? '다른 기능과 겹치는 단축키는 저장하지 않았습니다.'
        : 'Shortcut conflicts with another action and was not saved.');
      setShortcutDrafts(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    setShortcutDrafts(prev => ({ ...prev, [key]: normalized }));
    updateShortcuts({ [key]: normalized } as Partial<ShortcutConfig>);
  };

  const handleEditTarget = (target: string) => {
    if (DEFAULT_CENSOR_TARGET_SET.has(target)) return;
    if (protectedUi) {
      onToast(settings.uiPrefs.language === 'ko'
        ? '보호 상태에서는 정확한 사용자 항목을 숨깁니다.'
        : 'Exact custom items are hidden while protection is enabled.');
      return;
    }
    const edited = window.prompt(
      settings.uiPrefs.language === 'ko' ? '추가 검열 라벨/키워드를 수정하세요.' : 'Edit the added censor label/keyword.',
      target
    );
    if (edited === null) return;
    const nextTargets = edited
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (nextTargets.length === 0) {
      handleRemoveTarget(target);
      return;
    }
    const preserved = settings.runConfig.targets.filter((item) => item !== target);
    updateRunConfig({ target_mode: 'selected', targets: Array.from(new Set([...preserved, ...nextTargets])) });
  };

  const requestOutputFolder = async (initialPath?: string): Promise<string | null> => {
    if (onPickFolder) {
      try {
        const picked = await onPickFolder(initialPath || settings.runConfig.input_dir || settings.runConfig.output_dirs[0]);
        if (picked) return picked;
      } catch {
        onToast(settings.uiPrefs.language === 'ko'
          ? '폴더 선택 창을 열지 못했습니다.'
          : 'Could not open the folder picker.');
        return null;
      }
      const hasNativePicker = typeof (window as unknown as { pywebview?: { api?: { pick_folder?: unknown } } }).pywebview?.api?.pick_folder === 'function';
      if (hasNativePicker) return null;
    }
    const typed = window.prompt(
      settings.uiPrefs.language === 'ko' ? '출력 폴더 경로를 입력하세요.' : 'Enter an output folder path.',
      initialPath || settings.runConfig.output_dirs[0] || ''
    );
    return typed?.trim() || null;
  };

  const handleAddOutputFolder = async () => {
    const folder = await requestOutputFolder(settings.runConfig.output_dirs[settings.runConfig.output_dirs.length - 1]);
    if (!folder) return;
    const newFolders = Array.from(new Set([...settings.runConfig.output_dirs, folder]));
    updateOutputDirsAsCustom(newFolders);
    onToast(strings.outputFolderAdded);
  };

  const handleChooseOutputFolder = async (index: number) => {
    const folder = await requestOutputFolder(settings.runConfig.output_dirs[index]);
    if (!folder) return;
    const newFolders = [...settings.runConfig.output_dirs];
    newFolders[index] = folder;
    updateOutputDirsAsCustom(newFolders);
  };

  const chooseModelFilePath = async (): Promise<string | null> => {
    if (!onPickModelFile) return null;
    let picked: string | null;
    try {
      picked = await onPickModelFile(settings.modelPath);
    } catch {
      onToast(settings.uiPrefs.language === 'ko'
        ? '모델 파일 선택 창을 열지 못했습니다.'
        : 'Could not open the model file picker.');
      return null;
    }
    return picked || null;
  };

  const handleChooseModelFile = async () => {
    const picked = await chooseModelFilePath();
    if (!picked) return;
    updateModelPath(picked);
    if (settings.autoLoadModel && onLoadModel) {
      await onLoadModel(picked);
      return;
    }
    onToast(strings.modelPathSelected);
  };

  const handleLoadSelectedModel = async () => {
    if (!onLoadModel) return;
    let modelPath = settings.modelPath.trim();
    if (!modelPath) {
      const picked = await chooseModelFilePath();
      if (!picked) return;
      modelPath = picked;
      updateModelPath(picked);
    }
    await onLoadModel(modelPath);
  };

  const handleRemoveOutputFolder = (index: number) => {
    if (settings.runConfig.output_dirs.length <= 1) {
      onToast(strings.atLeastOneFolder);
      return;
    }
    const newFolders = settings.runConfig.output_dirs.filter((_, i) => i !== index);
    updateOutputDirsAsCustom(newFolders);
  };

  const runModelDiagnosis = async () => {
    setIsDiagnosing(true);
    setDiagResult('');

    try {
      if (!backendDiagnosticsAvailable) {
        setDiagResult(settings.uiPrefs.language === 'ko'
          ? '모델 진단은 실제 백엔드 연결 상태에서만 사용할 수 있습니다.'
          : 'Model diagnostics are available only when the real backend is connected.');
        return;
      }
      const response = await fetch(backendUrl('/api/model/diagnose'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_path: settings.modelPath, config: settings.runConfig })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Model diagnosis failed');
      }
      const diagnostic = payload.diagnostic || {};
      const safeLabels = strings.protectedDiagnosticLabels;
      const safeModelPath = strings.protectedCurrentFile;
      const visibleModelPath = protectedUi
        ? safeModelPath
        : (settings.modelPath || diagnostic.model_path || 'models/autocensor_model.pt');
      const formatDiagnosticValue = (value: unknown, fallback: string, pretty = false) => {
        const rendered = value ? JSON.stringify(value, null, pretty ? 2 : 0) : fallback;
        return protectedUi ? maskSensitiveText(rendered, 'Protected label') : rendered;
      };

      setDiagResult(
        settings.uiPrefs.language === 'en' ?
`[DIAGNOSTIC REPORT]
- Model Path: ${visibleModelPath}
- Exists: ${diagnostic.exists ? 'YES' : 'NO'}
- Loaded In Backend: ${diagnostic.loaded ? 'YES' : 'NO'}
- File Size: ${diagnostic.size || 'unknown'}
- Labels: ${safeLabels}
- Runtime: ${formatDiagnosticValue(diagnostic.runtime, 'unavailable', true)}
- Worker Config: ${formatDiagnosticValue(diagnostic.worker_config, 'unavailable')}
- Model Pools: ${formatDiagnosticValue(diagnostic.pools, 'not loaded', true)}
- Last Error: ${protectedUi && diagnostic.last_error ? protectedDiagnosticText : (diagnostic.last_error || 'none')}
- Note: ${diagnostic.note || 'Only load trusted model files.'}` :
`[모델 진단 보고서]
- 모델 경로: ${visibleModelPath}
- 파일 존재: ${diagnostic.exists ? '예' : '아니오'}
- 백엔드 로드 상태: ${diagnostic.loaded ? '로드됨' : '로드 안 됨'}
- 파일 크기: ${diagnostic.size || '알 수 없음'}
- 라벨 목록: ${safeLabels}
- 런타임: ${formatDiagnosticValue(diagnostic.runtime, '확인 불가', true)}
- 워커 설정: ${formatDiagnosticValue(diagnostic.worker_config, '확인 불가')}
- 모델 풀: ${formatDiagnosticValue(diagnostic.pools, '로드 안 됨', true)}
- 마지막 오류: ${protectedUi && diagnostic.last_error ? protectedDiagnosticText : (diagnostic.last_error || '없음')}
- 참고: ${diagnostic.note || '신뢰할 수 있는 모델 파일만 사용하세요.'}`
      );
    } catch {
      setDiagResult(protectedDiagnosticText);
    } finally {
      setIsDiagnosing(false);
    }
  };

  const runPerformanceOptimizer = async () => {
    setIsOptimizing(true);
    try {
      const response = await fetch(backendUrl('/api/workers/optimize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: settings.runConfig })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Worker optimization failed');
      }
      const recommendation = payload.recommendation || {};
      const updates: Partial<RunConfig> = {};
      if (recommendation.device_mode) {
        updates.device_mode = recommendation.device_mode as RunConfig['device_mode'];
      }
      if (recommendation.worker_config) {
        updates.worker_config = recommendation.worker_config;
      }
      if (Object.keys(updates).length > 0) {
        updateRunConfig(updates);
      }
      onToast(payload.proof_mode
        ? strings.workerOptimizeHeuristicToast
        : (settings.uiPrefs.language === 'en' ? 'Backend worker settings updated' : '백엔드 기준 작업자 설정이 갱신되었습니다'));
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : strings.workerOptimizeFailed;
      onToast(message);
    } finally {
      setIsOptimizing(false);
    }
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-container">

        {/* Header */}
        <div className="dialog-header">
          <h2 style={{ fontSize: '15px', fontWeight: 700 }}>{strings.settings}</h2>
          <button
            onClick={onClose}
            data-action="close-settings"
            style={{ border: 'none', background: 'transparent', padding: '4px' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab body */}
        <div className="dialog-body">

          {/* Left Tabs list */}
          <div className="dialog-tabs">
            <button
              className={`dialog-tab-button ${activeTab === 'save' ? 'active' : ''}`}
              onClick={() => setActiveTab('save')}
              data-action="settings-tab-save"
            >
              <SaveIcon size={14} />
              <span>{strings.tabSave}</span>
            </button>
            <button
              className={`dialog-tab-button ${activeTab === 'censor' ? 'active' : ''}`}
              onClick={() => setActiveTab('censor')}
              data-action="settings-tab-censor"
            >
              <ShieldAlert size={14} />
              <span>{protectedUi ? (settings.uiPrefs.language === 'ko' ? '보호' : 'Protection') : strings.tabCensor}</span>
            </button>
            <button
              className={`dialog-tab-button ${activeTab === 'performance' ? 'active' : ''}`}
              onClick={() => setActiveTab('performance')}
              data-action="settings-tab-performance"
            >
              <Cpu size={14} />
              <span>{strings.tabPerformance}</span>
            </button>
            <button
              className={`dialog-tab-button ${activeTab === 'model' ? 'active' : ''}`}
              onClick={() => setActiveTab('model')}
              data-action="settings-tab-model"
            >
              <Activity size={14} />
              <span>{strings.tabModel}</span>
            </button>
            <button
              className={`dialog-tab-button ${activeTab === 'ui' ? 'active' : ''}`}
              onClick={() => setActiveTab('ui')}
              data-action="settings-tab-ui"
            >
              <Laptop size={14} />
              <span>{strings.tabUI}</span>
            </button>
            <button
              className={`dialog-tab-button ${activeTab === 'shortcuts' ? 'active' : ''}`}
              onClick={() => setActiveTab('shortcuts')}
              data-action="settings-tab-shortcuts"
            >
              <Key size={14} />
              <span>{strings.tabShortcuts}</span>
            </button>
            <button
              className={`dialog-tab-button ${activeTab === 'privacy' ? 'active' : ''}`}
              onClick={() => setActiveTab('privacy')}
              data-action="settings-tab-privacy"
            >
              <EyeOff size={14} />
              <span>{strings.tabPrivacy}</span>
            </button>
          </div>

          {/* Right Contents */}
          <div className="dialog-tab-content">

            {/* TABS 1: SAVE */}
            {activeTab === 'save' && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>
                    {settings.uiPrefs.language === 'ko' ? '입력 폴더 경로' : 'Input folder path'}
                  </label>
                  <input
                    type="text"
                    value={protectedUi ? '' : settings.runConfig.input_dir}
                    placeholder={protectedUi ? protectedSettingText : settings.uiPrefs.language === 'ko' ? '처리할 이미지 폴더 경로' : 'Folder path to process'}
                    onChange={(e) => updateRunConfig({ input_dir: e.target.value })}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>
                    {settings.uiPrefs.language === 'ko' ? '설정 JSON 저장 위치' : 'Settings JSON location'}
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={protectedUi ? protectedSettingText : settingsStoragePath || 'browser localStorage fallback'}
                    style={{ fontSize: '11px', color: 'var(--color-mutedText)' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>{strings.outputFormat}</label>
                  <select
                    value={settings.runConfig.output_format}
                    onChange={(e) => updateRunConfig({ output_format: e.target.value as RunConfig['output_format'] })}
                  >
                    <option value="original">{strings.originalFormatLabel}</option>
                    <option value="jpeg">JPEG (.jpg)</option>
                    <option value="png">PNG (.png)</option>
                    <option value="webp">WebP (.webp)</option>
                    <option value="bmp">BMP (.bmp)</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <label>{strings.outputQuality}</label>
                    <span style={{ fontWeight: 'bold' }}>{settings.runConfig.quality}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={settings.runConfig.quality}
                    onChange={(e) => updateRunConfig({ quality: parseInt(e.target.value) })}
                    style={{ accentColor: 'var(--color-primary)' }}
                  />
                  <span style={{ color: 'var(--color-mutedText)', fontSize: '10px' }}>
                    {settings.uiPrefs.language === 'ko'
                      ? 'JPEG/WebP 저장 및 원본 형식이 JPEG/WebP인 경우 적용됩니다.'
                      : 'Applies to JPEG/WebP output and original-format JPEG/WebP saves.'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>{strings.outputSuffix}</label>
                  <input
                    type="text"
                    value={settings.runConfig.output_suffix}
                    onChange={(e) => updateRunConfig({ output_suffix: e.target.value })}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>{strings.outputFolders}</label>
                    <button onClick={handleAddOutputFolder} style={{ padding: '2px 6px', fontSize: '11px' }}>
                      <Plus size={12} />
                      <span>{strings.addFolder}</span>
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '120px', overflowY: 'auto' }}>
                    {settings.runConfig.output_dirs.map((path, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <input
                          type="text"
                          value={protectedUi ? protectedSettingText : path}
                          readOnly={protectedUi}
                          onChange={(e) => {
                            if (protectedUi) return;
                            const newPaths = [...settings.runConfig.output_dirs];
                            newPaths[idx] = e.target.value;
                            updateOutputDirsAsCustom(newPaths);
                          }}
                          style={{ flex: 1, fontSize: '12px' }}
                        />
                        <button
                          type="button"
                          onClick={() => void handleChooseOutputFolder(idx)}
                          style={{ padding: '6px' }}
                          title={settings.uiPrefs.language === 'ko' ? '출력 폴더 선택' : 'Choose output folder'}
                        >
                          <FolderOpen size={13} />
                        </button>
                        <button onClick={() => handleRemoveOutputFolder(idx)} style={{ padding: '6px', color: 'var(--color-danger)' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ padding: '10px', backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={settings.runConfig.preserve_exif}
                      onChange={(e) => updateRunConfig({ preserve_exif: e.target.checked })}
                    />
                    <span style={{ fontWeight: 'bold' }}>{strings.exifPreserve}</span>
                  </label>
                  {settings.runConfig.preserve_exif && (
                    <div style={{ color: 'var(--color-danger)', fontSize: '11px', marginTop: '6px', lineHeight: 1.4, display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                      <ShieldAlert size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                      <span>{strings.exifWarning}</span>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* TABS 2: CENSOR */}
            {activeTab === 'censor' && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>
                    {protectedUi ? (settings.uiPrefs.language === 'ko' ? '기본 보호 구성' : 'Default protection configuration') : strings.defaultConfiguration}
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', backgroundColor: 'var(--color-background)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>{protectedUi ? (settings.uiPrefs.language === 'ko' ? '기본 처리 방식' : 'Default processing mode') : strings.defaultMode}</span>
                      <select
                        value={settings.runConfig.censor_mode}
                        onChange={(e) => updateRunConfig({ censor_mode: e.target.value as RunConfig['censor_mode'] })}
                        style={{ height: '28px', padding: '2px 6px' }}
                      >
                        <option value="solid">{strings.censorModeSolid}</option>
                        <option value="blackwhite">{strings.censorModeBlackWhite}</option>
                        <option value="mosaic">{strings.censorModeMosaic}</option>
                        <option value="blur">{strings.censorModeBlur}</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                        <span>{selectionRegionModeText}</span>
                        <select
                          value={settings.runConfig.selection_region_mode}
                          onChange={(e) => updateRunConfig({ selection_region_mode: e.target.value as RunConfig['selection_region_mode'] })}
                          style={{ height: '28px', padding: '2px 6px', maxWidth: '260px' }}
                        >
                          <option value="model">{selectionRegionModeModelText}</option>
                          <option value="selection">{selectionRegionModeSelectionText}</option>
                        </select>
                      </div>
                      <span style={{ color: 'var(--color-mutedText)', fontSize: '10px', lineHeight: 1.35 }}>
                        {selectionRegionModeHintText}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                        <span>{strings.confidenceThreshold}</span>
                        <strong>{Math.round(settings.runConfig.threshold * 100)}%</strong>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="100"
                        step="1"
                        value={Math.round(settings.runConfig.threshold * 100)}
                        onChange={(e) => updateRunConfig({ threshold: Math.max(1, Math.min(100, parseInt(e.target.value) || 1)) / 100 })}
                        style={{ accentColor: 'var(--color-primary)' }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                      <label style={{ fontSize: '12px' }}>{strings.modelImageSize}</label>
                      <input
                        type="number"
                        min="320"
                        max="2048"
                        step="32"
                        value={settings.runConfig.imgsz}
                        onChange={(e) => updateRunConfig({ imgsz: Math.max(320, Math.min(2048, parseInt(e.target.value) || 1280)) })}
                        style={{ width: '96px', textAlign: 'right' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px' }}>{strings.solidColorHex}</label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="color"
                          value={settings.runConfig.fill_color}
                          onChange={(e) => updateRunConfig({ fill_color: e.target.value })}
                          style={{ width: '34px', height: '28px', border: 'none', background: 'transparent' }}
                        />
                        <input
                          type="text"
                          value={settings.runConfig.fill_color}
                          onChange={(e) => updateRunConfig({ fill_color: e.target.value })}
                          style={{ flex: 1 }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', backgroundColor: 'var(--color-background)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>
                    {settings.uiPrefs.language === 'ko' ? '퀵마스크 표시 설정' : 'Quick mask display'}
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--color-mutedText)' }}>
                        {settings.uiPrefs.language === 'ko' ? '색상' : 'Color'}
                      </span>
                      <input
                        type="color"
                        value={settings.uiPrefs.quickMaskColor}
                        onChange={(e) => updateUiPrefs({ quickMaskColor: e.target.value })}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--color-mutedText)' }}>
                        {settings.uiPrefs.language === 'ko' ? '투명도' : 'Opacity'} {Math.round(settings.uiPrefs.quickMaskOpacity * 100)}%
                      </span>
                      <input
                        type="range"
                        min="0.05"
                        max="1"
                        step="0.01"
                        value={settings.uiPrefs.quickMaskOpacity}
                        onChange={(e) => updateUiPrefs({ quickMaskOpacity: parseFloat(e.target.value) })}
                        style={{ accentColor: 'var(--color-primary)' }}
                      />
                    </div>
                  </div>
                  <select
                    value={settings.uiPrefs.quickMaskBackdropMode}
                    onChange={(e) => updateUiPrefs({ quickMaskBackdropMode: e.target.value as typeof settings.uiPrefs.quickMaskBackdropMode })}
                  >
                    <option value="transparent">{settings.uiPrefs.language === 'ko' ? '원본 위에 색상만 표시' : 'Color overlay on original'}</option>
                    <option value="white">{settings.uiPrefs.language === 'ko' ? '흰색 바탕 위에 색상 표시' : 'Color overlay on white base'}</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>
                    {targetSectionTitle}
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', backgroundColor: 'var(--color-background)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                    <select
                      value={settings.runConfig.target_mode}
                      onChange={(e) => updateRunConfig({ target_mode: e.target.value as RunConfig['target_mode'] })}
                      aria-label={settings.uiPrefs.language === 'ko' ? '보호 대상 처리 범위' : 'Target processing scope'}
                    >
                      <option value="selected">{targetModeLabels.selected}</option>
                      <option value="all">{targetModeLabels.all}</option>
                    </select>
                    <span style={{ color: 'var(--color-mutedText)', fontSize: '10px', lineHeight: 1.35 }}>
                      {targetModeLabels.help}
                    </span>
                    {CENSOR_TARGET_GROUPS.map((group) => {
                      const title = protectedUi ? group.sfwLabel[settings.uiPrefs.language] : group.label[settings.uiPrefs.language];
                      const description = protectedUi ? group.sfwDescription[settings.uiPrefs.language] : group.description[settings.uiPrefs.language];
                      const selectedCount = group.labels.filter((label) => selectedTargetSet.has(label)).length;
                      const groupChecked = selectedCount === group.labels.length;
                      return (
                        <div key={group.id} style={{ border: '1px solid var(--color-border)', borderRadius: '6px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {protectedUi ? (
                            <div title={description} style={{ fontWeight: 600 }}>
                              {title}
                            </div>
                          ) : (
                            <label className="checkbox-container" title={description}>
                              <input
                                type="checkbox"
                                checked={groupChecked}
                                onChange={(e) => setTargetLabels(group.labels, e.target.checked)}
                              />
                              <span style={{ fontWeight: 600 }}>
                                {title} <span style={{ color: 'var(--color-mutedText)', fontWeight: 500 }}>({selectedCount}/{group.labels.length})</span>
                              </span>
                            </label>
                          )}
                          <div style={{ color: 'var(--color-mutedText)', fontSize: '11px', lineHeight: 1.35, paddingLeft: '24px' }}>
                            {description}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', paddingLeft: '24px' }}>
                            {protectedUi ? (
                              <span style={{ color: 'var(--color-mutedText)', fontSize: '10px' }}>
                                {settings.uiPrefs.language === 'ko'
                                  ? '보호 항목 숨김'
                                  : 'protected items hidden'}
                              </span>
                            ) : group.labels.map((label) => (
                              <label
                                key={label}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  fontSize: '10px',
                                  padding: '2px 5px',
                                  borderRadius: '4px',
                                  border: '1px solid var(--color-border)',
                                  color: 'var(--color-mutedText)',
                                  cursor: 'pointer'
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedTargetSet.has(label)}
                                  onChange={(e) => setTargetLabels([label], e.target.checked)}
                                  style={{ width: '11px', height: '11px' }}
                                />
                                {label}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    <span style={{ color: 'var(--color-mutedText)', fontSize: '10px' }}>
                      {protectedUi ? strings.protectedTargetSelection : defaultFixedText}
                    </span>
                    {protectedUi ? (
                      <div
                        style={{
                          padding: '8px',
                          borderRadius: '6px',
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-mutedText)',
                          fontSize: '11px'
                        }}
                      >
                        {settings.uiPrefs.language === 'ko'
                          ? '보호 상태에서는 추가 항목 이름 입력과 표시를 숨깁니다. 일반 표시로 전환하면 편집할 수 있습니다.'
                          : 'Exact custom item names are hidden while protection is enabled. Turn off protected display to edit them.'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                        <input
                          type="text"
                          value={customTargetText}
                          placeholder={settings.uiPrefs.language === 'ko' ? '모델 변경용 추가 검열 라벨/키워드, 쉼표로 구분' : 'Added censor labels/keywords for another model, comma-separated'}
                          onChange={(e) => setCustomTargetText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddCustomTargets();
                            }
                          }}
                          style={{ flex: 1 }}
                        />
                        <button type="button" onClick={handleAddCustomTargets}>
                          {settings.uiPrefs.language === 'ko' ? '검열 라벨 추가' : 'Add censor label'}
                        </button>
                      </div>
                    )}
                    {!protectedUi && customTargets.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {customTargets.map((target) => (
                          <div
                            key={target}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '3px 5px',
                              border: '1px solid var(--color-border)',
                              borderRadius: '5px',
                              fontSize: '11px'
                            }}
                          >
                            <span>{protectedUi ? protectedSettingText : target}</span>
                            {!protectedUi && (
                              <button type="button" onClick={() => handleEditTarget(target)} style={{ fontSize: '10px', padding: '2px 5px' }}>
                                {settings.uiPrefs.language === 'ko' ? '수정' : 'Edit'}
                              </button>
                            )}
                            <button type="button" onClick={() => handleRemoveTarget(target)} style={{ fontSize: '10px', padding: '2px 5px' }}>
                              {settings.uiPrefs.language === 'ko' ? '삭제' : 'Delete'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <label>{strings.maskEdgeBlur}</label>
                    <span style={{ fontWeight: 'bold' }}>{settings.runConfig.edge_blur.toFixed(1)}px</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.1"
                    value={settings.runConfig.edge_blur}
                    onChange={(e) => updateRunConfig({ edge_blur: parseFloat(e.target.value) })}
                    style={{ accentColor: 'var(--color-primary)' }}
                  />
                </div>

                <label className="checkbox-container">
                  <input
                    type="checkbox"
                    checked={settings.runConfig.supersample}
                    onChange={(e) => updateRunConfig({ supersample: e.target.checked })}
                  />
                  <span>{strings.maskSupersampling}</span>
                </label>

                <label className="checkbox-container">
                  <input
                    type="checkbox"
                    checked={settings.runConfig.postprocess_enabled}
                    onChange={(e) => updateRunConfig({ postprocess_enabled: e.target.checked })}
                  />
                  <span>{strings.postprocessEnabled}</span>
                </label>
              </>
            )}

            {/* TABS 3: PERFORMANCE */}
            {activeTab === 'performance' && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>{strings.deviceMode}</label>
                  <select
                    value={settings.runConfig.device_mode}
                    onChange={(e) => updateRunConfig({ device_mode: e.target.value as RunConfig['device_mode'] })}
                  >
                    <option value="auto">{strings.deviceAuto}</option>
                    <option value="cpu">{strings.deviceCpu}</option>
                    <option value="cuda">{strings.deviceCuda}</option>
                    <option value="hybrid">{strings.deviceHybrid}</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>{strings.regionDeviceMode}</label>
                  <select
                    value={settings.runConfig.region_device_mode || settings.runConfig.device_mode}
                    onChange={(e) => updateRunConfig({ region_device_mode: e.target.value as RunConfig['device_mode'] })}
                  >
                    <option value="auto">{strings.deviceAuto}</option>
                    <option value="cpu">{strings.deviceCpu}</option>
                    <option value="cuda">{strings.deviceCuda}</option>
                    <option value="hybrid">{strings.deviceHybrid}</option>
                  </select>
                  <span style={{ color: 'var(--color-mutedText)', fontSize: '10px', lineHeight: 1.35 }}>
                    {strings.regionDeviceModeHint}
                  </span>
                </div>

                <div style={{ fontSize: '11px', color: 'var(--color-mutedText)', lineHeight: 1.45, backgroundColor: 'var(--color-background)', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border)' }}>
                  {strings.performanceWorkerExplanation}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', backgroundColor: 'var(--color-background)', padding: '12px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--color-mutedText)' }}>{strings.gpuWorkers}</label>
                    <input
                      type="number"
                      min="1"
                      max="300"
                      value={settings.runConfig.worker_config.gpu_workers}
                      onChange={(e) => updateRunConfig({
                        worker_config: { ...settings.runConfig.worker_config, gpu_workers: parseInt(e.target.value) || 1 }
                      })}
                    />
                    <span style={{ fontSize: '10px', color: 'var(--color-mutedText)', lineHeight: 1.35 }}>{strings.gpuWorkersHint}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--color-mutedText)' }}>{strings.cpuWorkers}</label>
                    <input
                      type="number"
                      min="1"
                      max="64"
                      value={settings.runConfig.worker_config.cpu_workers}
                      onChange={(e) => updateRunConfig({
                        worker_config: { ...settings.runConfig.worker_config, cpu_workers: parseInt(e.target.value) || 1 }
                      })}
                    />
                    <span style={{ fontSize: '10px', color: 'var(--color-mutedText)', lineHeight: 1.35 }}>{strings.cpuWorkersHint}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--color-mutedText)' }}>{strings.cpuThreads}</label>
                    <input
                      type="number"
                      min="1"
                      max="64"
                      value={settings.runConfig.worker_config.cpu_threads}
                      onChange={(e) => updateRunConfig({
                        worker_config: { ...settings.runConfig.worker_config, cpu_threads: parseInt(e.target.value) || 1 }
                      })}
                    />
                    <span style={{ fontSize: '10px', color: 'var(--color-mutedText)', lineHeight: 1.35 }}>{strings.cpuThreadsHint}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--color-mutedText)' }}>{strings.saveThreads}</label>
                    <input
                      type="number"
                      min="1"
                      max="64"
                      value={settings.runConfig.worker_config.save_threads}
                      onChange={(e) => updateRunConfig({
                        worker_config: { ...settings.runConfig.worker_config, save_threads: parseInt(e.target.value) || 1 }
                      })}
                    />
                    <span style={{ fontSize: '10px', color: 'var(--color-mutedText)', lineHeight: 1.35 }}>{strings.saveThreadsHint}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--color-mutedText)' }}>{strings.postprocessWorkers}</label>
                    <input
                      type="number"
                      min="1"
                      max="64"
                      value={settings.runConfig.worker_config.postprocess_workers}
                      disabled={!settings.runConfig.postprocess_enabled}
                      onChange={(e) => updateRunConfig({
                        worker_config: { ...settings.runConfig.worker_config, postprocess_workers: parseInt(e.target.value) || 1 }
                      })}
                      aria-describedby="postprocess-worker-truth"
                    />
                    <span id="postprocess-worker-truth" style={{ fontSize: '10px', color: 'var(--color-mutedText)', lineHeight: 1.35 }}>
                      {strings.postprocessBackendTruth}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--color-mutedText)' }}>{strings.batchSize}</label>
                    <input
                      type="number"
                      min="1"
                      max="64"
                      value={settings.runConfig.worker_config.batch_size}
                      onChange={(e) => updateRunConfig({
                        worker_config: { ...settings.runConfig.worker_config, batch_size: parseInt(e.target.value) || 1 }
                      })}
                    />
                    <span style={{ fontSize: '10px', color: 'var(--color-mutedText)', lineHeight: 1.35 }}>{strings.batchSizeHint}</span>
                  </div>
                </div>

                <button
                  onClick={runPerformanceOptimizer}
                  disabled={isOptimizing}
                  className="primary"
                  style={{ justifyContent: 'center' }}
                >
                  {isOptimizing ? <Loader2 className="animate-spin" size={14} /> : null}
                  <span>{strings.workerOptimizeBtn}</span>
                </button>
              </>
            )}

            {/* TABS 4: MODEL */}
            {activeTab === 'model' && (
              <>
                <label className="checkbox-container">
                  <input
                    type="checkbox"
                    checked={settings.autoLoadModel}
                    onChange={(e) => updateAutoLoadModel(e.target.checked)}
                  />
                  <span>
                    {settings.uiPrefs.language === 'ko'
                      ? '앱 시작 시 저장된 모델 자동 로드'
                      : 'Load saved model on startup'}
                  </span>
                </label>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>{protectedUi ? protectedSettingText : strings.modelFilePath}</label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type={protectedUi ? 'password' : 'text'}
                      value={settings.modelPath}
                      placeholder={protectedUi ? protectedModelPathPlaceholder : strings.modelPathPlaceholder}
                      onChange={(e) => updateModelPath(e.target.value)}
                      autoComplete="off"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => void handleChooseModelFile()}
                      disabled={!onPickModelFile}
                      title={strings.selectModel}
                    >
                      <FolderOpen size={14} />
                      <span>{strings.selectModel}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleLoadSelectedModel()}
                      disabled={!onLoadModel}
                      data-action="settings-load-model"
                    >
                      {strings.loadModel}
                    </button>
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--color-mutedText)', lineHeight: 1.4 }}>
                    {protectedUi ? protectedSettingText : strings.modelNote}
                  </p>
                </div>

                <button
                  onClick={runModelDiagnosis}
                  disabled={isDiagnosing}
                  style={{ justifyContent: 'center' }}
                  data-action="diagnose-model"
                >
                  {isDiagnosing ? <Loader2 className="animate-spin" size={14} /> : null}
                  <span>{protectedUi ? protectedSettingText : strings.diagnoseModelBtn}</span>
                </button>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>{protectedUi ? protectedSettingText : strings.modelDiagTitle}</label>
                  <pre style={{
                    backgroundColor: 'var(--color-background)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    padding: '12px',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap',
                    overflowY: 'auto',
                    height: '140px',
                    color: diagResult ? 'var(--color-text)' : 'var(--color-mutedText)'
                  }}
                    data-action="diagnostic-output"
                  >
                    {diagResult || (protectedUi ? protectedDiagnosticText : strings.modelDiagEmpty)}
                  </pre>
                </div>
              </>
            )}

            {/* TABS 5: UI */}
            {activeTab === 'ui' && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>{strings.themeLabel}</label>
                  <select
                    value={themeMode}
                    onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
                  >
                    <option value="system">{strings.themeSystem}</option>
                    <option value="dark">{strings.themeDark}</option>
                    <option value="light">{strings.themeLight}</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>{strings.languageLabel}</label>
                  <select
                    value={settings.uiPrefs.language}
                    onChange={(e) => updateUiPrefs({ language: e.target.value as Language })}
                  >
                    <option value="ko">한국어 (Korean)</option>
                    <option value="en">English (US)</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: 'var(--color-background)', padding: '12px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={settings.uiPrefs.showHelperButtons}
                      onChange={(e) => updateUiPrefs({ showHelperButtons: e.target.checked })}
                    />
                    <span>{strings.showHelperButtons}</span>
                  </label>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={settings.uiPrefs.showToolbarButtons}
                      onChange={(e) => updateUiPrefs({ showToolbarButtons: e.target.checked })}
                    />
                    <span>{strings.showToolbarButtons}</span>
                  </label>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={settings.uiPrefs.showHelpBar}
                      onChange={(e) => updateUiPrefs({ showHelpBar: e.target.checked })}
                    />
                    <span>{strings.showHelpBar}</span>
                  </label>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={settings.uiPrefs.quickMask}
                      onChange={(e) => updateUiPrefs({ quickMask: e.target.checked })}
                    />
                    <span>{strings.quickMask}</span>
                  </label>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={settings.uiPrefs.tabletPressure}
                      onChange={(e) => updateUiPrefs({ tabletPressure: e.target.checked })}
                    />
                    <span>{strings.tabletPressure}</span>
                  </label>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={settings.uiPrefs.brushHardnessEnabled}
                      onChange={(e) => updateUiPrefs({ brushHardnessEnabled: e.target.checked })}
                    />
                    <span>{strings.brushHardnessEnabled}</span>
                  </label>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={settings.uiPrefs.extendedShortcuts}
                      onChange={(e) => updateUiPrefs({ extendedShortcuts: e.target.checked })}
                    />
                    <span>{strings.extendedShortcuts}</span>
                  </label>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={settings.uiPrefs.straightLine}
                      onChange={(e) => updateUiPrefs({ straightLine: e.target.checked })}
                    />
                    <span>{strings.straightLine}</span>
                  </label>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={true}
                      disabled
                      readOnly
                    />
                    <span>{strings.autoSaveEdits}</span>
                  </label>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={settings.uiPrefs.confirmReset}
                      onChange={(e) => updateUiPrefs({ confirmReset: e.target.checked })}
                    />
                    <span>{strings.confirmReset}</span>
                  </label>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>{strings.completionNotification}</label>
                  <select
                    value={settings.uiPrefs.completionNotification}
                    onChange={(e) => updateUiPrefs({ completionNotification: e.target.value as typeof settings.uiPrefs.completionNotification })}
                  >
                    <option value="statusbar">{strings.notificationStatusbar}</option>
                    <option value="toast">{strings.notificationToast}</option>
                    <option value="browser">{strings.notificationBrowser}</option>
                    <option value="off">{strings.notificationOff}</option>
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--color-mutedText)' }}>
                      {protectedUi ? (settings.uiPrefs.language === 'ko' ? '보호 테두리 색상' : 'Protected border color') : strings.censorBorderColor}
                    </label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input
                        type="color"
                        value={settings.uiPrefs.censorBorderColor}
                        onChange={(e) => updateUiPrefs({ censorBorderColor: e.target.value })}
                        style={{ border: 'none', width: '32px', height: '24px', cursor: 'pointer', borderRadius: '4px' }}
                      />
                      <input
                        type="text"
                        value={settings.uiPrefs.censorBorderColor}
                        onChange={(e) => updateUiPrefs({ censorBorderColor: e.target.value })}
                        style={{ fontSize: '11px', padding: '2px 6px', height: '24px', width: '80px' }}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--color-mutedText)' }}>
                      {protectedUi ? (settings.uiPrefs.language === 'ko' ? '테두리 선 두께' : 'Border thickness') : strings.censorBorderThickness}
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="6"
                      value={settings.uiPrefs.censorBorderThickness}
                      onChange={(e) => updateUiPrefs({ censorBorderThickness: parseInt(e.target.value) || 1 })}
                    />
                  </div>
                </div>
              </>
            )}

            {/* TABS 6: SHORTCUTS */}
            {activeTab === 'shortcuts' && (
              <div className="shortcut-settings-panel" style={{ overflowX: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  onClick={() => {
                    setShortcutDrafts({});
                    updateShortcuts(DEFAULT_SHORTCUTS);
                  }}
                  data-action="reset-shortcuts"
                  style={{ alignSelf: 'flex-start', fontSize: '12px' }}
                >
                  {strings.resetDefaults}
                </button>
                <table className="shortcut-settings-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', color: 'var(--color-mutedText)' }}>
                      <th style={{ padding: '8px 4px' }}>{strings.action}</th>
                      <th style={{ padding: '8px 4px' }}>{strings.shortcut}</th>
                      <th style={{ padding: '8px 4px' }}>{strings.conflict}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shortcutRows.map(([key, label]) => {
                      const conflicts = shortcutConflicts[key] || [];
                      return (
                        <tr key={key} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td className="shortcut-action-cell" style={{ padding: '8px 4px' }}>{label}</td>
                          <td className="shortcut-input-cell" style={{ padding: '8px 4px' }}>
                            <input
                              type="text"
                              data-shortcut-key={key}
                              value={shortcutDrafts[key] ?? settings.shortcuts[key]}
                              onChange={(e) => handleShortcutDraftChange(key, e.target.value)}
                              onBlur={(e) => commitShortcutChange(key, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  commitShortcutChange(key, e.currentTarget.value);
                                  e.currentTarget.blur();
                                }
                              }}
                              style={{
                                height: '28px',
                                width: '132px',
                                fontSize: '12px',
                                borderColor: conflicts.length > 0 ? 'var(--color-warning)' : undefined
                              }}
                            />
                          </td>
                          <td className="shortcut-conflict-cell" style={{ padding: '8px 4px', color: conflicts.length > 0 ? 'var(--color-warning)' : 'var(--color-mutedText)' }}>
                            {conflicts.length > 0 ? conflicts.map(item => shortcutLabelByKey.get(item) || item).join(', ') : ''}
                          </td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td className="shortcut-action-cell" style={{ padding: '8px 4px', color: 'var(--color-mutedText)' }}>{strings.zoomIn}</td>
                      <td className="shortcut-input-cell" style={{ padding: '8px 4px', color: 'var(--color-mutedText)' }}>Wheel</td>
                      <td className="shortcut-conflict-cell" style={{ padding: '8px 4px', color: 'var(--color-mutedText)' }}>{strings.panCanvas}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* TABS 7: PRIVACY */}
            {activeTab === 'privacy' && (
              <>
                <div style={{ padding: '12px', backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={settings.uiPrefs.sfwMode}
                      onChange={(e) => updateUiPrefs({ sfwMode: e.target.checked })}
                    />
                    <span style={{ fontWeight: 'bold' }}>{strings.privacySfwMode}</span>
                  </label>
                  <p style={{ fontSize: '11px', color: 'var(--color-mutedText)', marginTop: '6px', lineHeight: 1.4 }}>
                    {strings.privacySfwDesc}
                  </p>
                </div>

                <div style={{ padding: '12px', backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={settings.uiPrefs.showFilenames}
                      onChange={(e) => updateUiPrefs({ showFilenames: e.target.checked })}
                    />
                    <span style={{ fontWeight: 'bold' }}>{strings.filenameVisibility}</span>
                  </label>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                  <h4 style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--color-warning)' }}>{strings.privacyAuditTitle}</h4>
                  <p style={{ fontSize: '11px', color: 'var(--color-mutedText)', lineHeight: 1.4 }}>
                    {strings.noLlmIntegration}
                  </p>
                </div>
              </>
            )}

          </div>
        </div>

        {/* Footer */}
        <div className="dialog-footer">
          <button
            onClick={() => {
              if (!settings.uiPrefs.confirmReset || window.confirm(strings.resetSettingsPrompt)) {
                resetAllSettings();
              }
            }}
            style={{ marginRight: 'auto', fontSize: '12px', color: 'var(--color-danger)' }}
          >
            {strings.resetSettingsConfirm}
          </button>
          <button onClick={onClose} className="primary" style={{ padding: '6px 16px' }}>
            {strings.doneButton}
          </button>
        </div>

      </div>
    </div>
  );
};
