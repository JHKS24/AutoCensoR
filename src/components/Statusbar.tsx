import React from 'react';
import { useSettings } from '../settings/SettingsContext';
import { i18nStrings } from '../i18n/strings';
import { ProgressState } from '../engine/EngineAdapter';
import { shouldUseProtectedLabels } from '../settings/privacyDisplay';
import { AlertCircle } from 'lucide-react';

interface StatusbarProps {
  progress: ProgressState;
  isProcessing: boolean;
  warnings: string[];
  errors: string[];
  onClearLogs: () => void;
}

export const Statusbar: React.FC<StatusbarProps> = ({
  progress,
  isProcessing,
  warnings,
  errors,
  onClearLogs
}) => {
  const { settings } = useSettings();
  const strings = i18nStrings[settings.uiPrefs.language];
  const protectedUi = shouldUseProtectedLabels(settings.uiPrefs);

  // Calculate percentage
  const percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
  const currentFileText = protectedUi ? strings.protectedCurrentFile : progress.current_file;
  const latestAlert = errors.length > 0 ? errors[errors.length - 1] : warnings[warnings.length - 1];
  const alertText = protectedUi ? strings.protectedTargetSelection : latestAlert;
  const messageText = progress.message
    ? (protectedUi ? strings.protectedTargetSelection : progress.message)
    : '';
  const restoredCount = progress.restored || 0;

  return (
    <footer
      className="statusbar"
      data-processing-state={isProcessing ? 'processing' : 'ready'}
      data-progress-message={protectedUi ? '' : progress.message || ''}
      data-total-count={protectedUi ? undefined : progress.total}
      data-processed-count={protectedUi ? undefined : progress.processed}
      data-censored-count={protectedUi ? undefined : progress.censored}
      data-clean-count={protectedUi ? undefined : progress.clean}
      data-failed-count={protectedUi ? undefined : progress.failed}
      data-restored-count={protectedUi ? undefined : restoredCount}
      data-restore-detected={protectedUi ? undefined : restoredCount > 0 ? 'true' : 'false'}
    >
      {/* Left: General State and Alerts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, whiteSpace: 'nowrap' }}>
          {isProcessing ? (
            <>
              <div 
                style={{ 
                  width: '8px', 
                  height: '8px', 
                  borderRadius: '50%', 
                  backgroundColor: 'var(--color-warning)',
                  boxShadow: '0 0 8px var(--color-warning)'
                }} 
                className="pulse"
              />
              <span style={{ fontWeight: 'bold', color: 'var(--color-warning)' }}>{strings.processing}</span>
            </>
          ) : (
            <>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-success)' }} />
              <span style={{ fontWeight: 'bold', color: 'var(--color-success)' }}>{strings.ready}</span>
            </>
          )}
        </div>

        {messageText && (
          <div
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--color-mutedText)',
              fontSize: '11px'
            }}
            title={messageText}
          >
            {messageText}
          </div>
        )}

        {/* Warning / Error Indicator */}
        {(errors.length > 0 || warnings.length > 0) && (
          <div 
            onClick={onClearLogs}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              backgroundColor: errors.length > 0 ? 'rgba(243,139,168,0.15)' : 'rgba(249,226,175,0.15)',
              border: `1px solid ${errors.length > 0 ? 'var(--color-danger)' : 'var(--color-warning)'}`,
              padding: '2px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              maxWidth: '220px',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
            title={strings.clickToClearLogs}
          >
            <AlertCircle size={12} style={{ color: errors.length > 0 ? 'var(--color-danger)' : 'var(--color-warning)' }} />
            <span style={{ fontSize: '10px', color: errors.length > 0 ? 'var(--color-danger)' : 'var(--color-warning)' }}>
              {alertText}
            </span>
          </div>
        )}
      </div>

      {/* Center: Progress details */}
      {progress.total > 0 && protectedUi && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 2, justifyContent: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--color-mutedText)' }}>{strings.protectedTargetSelection}</span>
          <div style={{
            width: '180px',
            height: '8px',
            backgroundColor: 'var(--color-panel)',
            borderRadius: '4px',
            overflow: 'hidden',
            border: '1px solid var(--color-border)'
          }}>
            <div style={{
              width: isProcessing ? '50%' : '100%',
              height: '100%',
              backgroundColor: 'var(--color-primary)',
              transition: 'width 0.3s ease'
            }} />
          </div>
        </div>
      )}
      {progress.total > 0 && !protectedUi && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 2, justifyContent: 'center' }}>
          {/* Detailed counts */}
          <div style={{ display: 'flex', gap: '10px', fontSize: '11px', whiteSpace: 'nowrap' }}>
            <span>{strings.statusProcessed}: <strong>{progress.processed}/{progress.total}</strong></span>
            <span style={{ color: 'var(--color-primary)' }}>{strings.statusCensored}: <strong>{progress.censored}</strong></span>
            <span style={{ color: 'var(--color-success)' }}>{strings.statusClean}: <strong>{progress.clean}</strong></span>
            {restoredCount > 0 && (
              <span style={{ color: 'var(--color-warning)' }}>{settings.uiPrefs.language === 'ko' ? '복원' : 'Restored'}: <strong>{restoredCount}</strong></span>
            )}
            {progress.failed > 0 && (
              <span style={{ color: 'var(--color-danger)' }}>{strings.statusFailed}: <strong>{progress.failed}</strong></span>
            )}
          </div>

          {/* Progress bar */}
          <div style={{ 
            width: '180px', 
            height: '8px', 
            backgroundColor: 'var(--color-panel)', 
            borderRadius: '4px', 
            overflow: 'hidden',
            border: '1px solid var(--color-border)'
          }}>
            <div style={{ 
              width: `${percent}%`, 
              height: '100%', 
              backgroundColor: 'var(--color-primary)',
              transition: 'width 0.3s ease'
            }} />
          </div>
          <span style={{ fontWeight: 'bold', width: '32px', textAlign: 'right' }}>{percent}%</span>
        </div>
      )}

      {/* Right: ETA & active image path */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1, justifyContent: 'flex-end', minWidth: 0 }}>
        {isProcessing && progress.eta_text && !protectedUi && (
          <span style={{ whiteSpace: 'nowrap' }}>
            {strings.statusEta}: <strong>{progress.eta_text}</strong>
          </span>
        )}

        {progress.current_file && !protectedUi && (
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', minWidth: 0 }} className="tooltip-trigger">
            <span style={{ 
              whiteSpace: 'nowrap', 
              overflow: 'hidden', 
              textOverflow: 'ellipsis', 
              maxWidth: '140px',
              color: 'var(--color-text)'
            }}>
              {currentFileText}
            </span>
            <span className="tooltip-text">{currentFileText}</span>
          </div>
        )}
      </div>
    </footer>
  );
};
