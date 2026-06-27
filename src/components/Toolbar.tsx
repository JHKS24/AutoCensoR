import React from 'react';
import { useSettings } from '../settings/SettingsContext';
import { i18nStrings } from '../i18n/strings';
import { RunConfig } from '../engine/EngineAdapter';
import { shouldUseProtectedLabels } from '../settings/privacyDisplay';
import { 
  Eye, 
  Layers, 
  Settings2, 
  Sliders
} from 'lucide-react';

export const Toolbar: React.FC = () => {
  const { settings, updateRunConfig } = useSettings();
  const config = settings.runConfig;
  const strings = i18nStrings[settings.uiPrefs.language];
  const protectedUi = shouldUseProtectedLabels(settings.uiPrefs);

  return (
    <aside className="right-panel">
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* Section Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--color-border)', paddingBottom: '8px' }}>
          <Settings2 size={16} style={{ color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: '14px', fontWeight: 600 }}>
            {protectedUi ? (settings.uiPrefs.language === 'ko' ? '보호 설정' : 'Protection Settings') : strings.toolOptions}
          </h2>
        </div>

        {/* 1. Confidence Threshold */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-mutedText)' }}>
              <Sliders size={13} />
              <span style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase' }}>{strings.confidenceThreshold}</span>
            </div>
            <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--color-primary)' }}>{Math.round(config.threshold * 100)}%</span>
          </div>
          <input
            type="range"
            min="1"
            max="100"
            step="1"
            value={Math.round(config.threshold * 100)}
            onChange={(e) => updateRunConfig({ threshold: Math.max(1, Math.min(100, parseInt(e.target.value) || 1)) / 100 })}
            style={{ width: '100%', accentColor: 'var(--color-primary)' }}
          />
        </div>

        {/* 3. Censor Method Mode */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-mutedText)' }}>
            <Eye size={13} />
              <span style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase' }}>
                {protectedUi ? (settings.uiPrefs.language === 'ko' ? '처리 방식' : 'Processing mode') : strings.censorMode}
              </span>
          </div>
          <select 
            value={config.censor_mode} 
            onChange={(e) => updateRunConfig({ censor_mode: e.target.value as RunConfig['censor_mode'] })}
            style={{ width: '100%', height: '34px' }}
          >
            <option value="solid">{strings.censorModeSolid}</option>
            <option value="blackwhite">{strings.censorModeBlackWhite}</option>
            <option value="mosaic">{strings.censorModeMosaic}</option>
            <option value="blur">{strings.censorModeBlur}</option>
          </select>
        </div>

        {/* 4. Brush Size & Hardness */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span>{strings.brushSizeLabel}</span>
              <span style={{ fontWeight: 'bold' }}>{config.brush_size}px</span>
            </div>
            <input
              type="range"
              min="5"
              max="400"
              step="5"
              value={config.brush_size}
              onChange={(e) => updateRunConfig({ brush_size: parseInt(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--color-primary)' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span>{strings.brushHardnessLabel}</span>
              <span style={{ fontWeight: 'bold' }}>{Math.round(config.brush_hardness * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="1.0"
              step="0.05"
              value={config.brush_hardness}
              onChange={(e) => updateRunConfig({ brush_hardness: parseFloat(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--color-primary)' }}
            />
          </div>
        </div>

        {/* 5. Conditional Controls based on mode */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', backgroundColor: 'var(--color-background)', padding: '12px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
          {config.censor_mode === 'solid' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px' }}>{strings.solidColorHex}</span>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input 
                  type="color" 
                  value={config.fill_color} 
                  onChange={(e) => updateRunConfig({ fill_color: e.target.value })}
                  style={{ width: '32px', height: '24px', padding: 0, border: 'none', cursor: 'pointer', borderRadius: '4px' }}
                />
                <input 
                  type="text" 
                  value={config.fill_color} 
                  onChange={(e) => updateRunConfig({ fill_color: e.target.value })}
                  style={{ width: '80px', fontSize: '11px', padding: '2px 6px', height: '24px' }}
                />
              </div>
            </div>
          )}

          {config.censor_mode === 'mosaic' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                <span>{strings.mosaicBlockSize}</span>
                <span style={{ fontWeight: 'bold' }}>{config.mosaic_block}px</span>
              </div>
              <input 
                type="range"
                min="3"
                max="40"
                step="1"
                value={config.mosaic_block}
                onChange={(e) => updateRunConfig({ mosaic_block: parseInt(e.target.value) })}
                style={{ width: '100%', accentColor: 'var(--color-primary)' }}
              />
            </div>
          )}

          {config.censor_mode === 'blur' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                <span>{strings.blurRadius}</span>
                <span style={{ fontWeight: 'bold' }}>{config.blur_radius.toFixed(1)}px</span>
              </div>
              <input 
                type="range"
                min="0.1"
                max="50"
                step="0.1"
                value={config.blur_radius}
                onChange={(e) => updateRunConfig({ blur_radius: parseFloat(e.target.value) })}
                style={{ width: '100%', accentColor: 'var(--color-primary)' }}
              />
            </div>
          )}

          {/* Censor Opacity Slider (always present) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span>{protectedUi ? (settings.uiPrefs.language === 'ko' ? '처리 불투명도' : 'Processing opacity') : strings.censorOpacity}</span>
              <span style={{ fontWeight: 'bold' }}>{Math.round(config.opacity * 100)}%</span>
            </div>
            <input 
              type="range"
              min="0.10"
              max="1.00"
              step="0.05"
              value={config.opacity}
              onChange={(e) => updateRunConfig({ opacity: parseFloat(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--color-primary)' }}
            />
          </div>
        </div>

        {/* 6. Mask Postprocessing Detail parameters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-mutedText)' }}>
            <Layers size={13} />
            <span style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase' }}>{strings.postProcessing}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                <span>{strings.maskEdgeBlur}</span>
                <span style={{ fontWeight: 'bold' }}>{config.edge_blur.toFixed(1)}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                step="0.1"
                value={config.edge_blur}
                onChange={(e) => updateRunConfig({ edge_blur: parseFloat(e.target.value) })}
                style={{ width: '100%', accentColor: 'var(--color-primary)' }}
              />
            </div>

            <label className="checkbox-container" style={{ marginTop: '4px' }}>
              <input 
                type="checkbox" 
                checked={config.supersample} 
                onChange={(e) => updateRunConfig({ supersample: e.target.checked })}
              />
              <span style={{ fontSize: '12px' }}>{strings.maskSupersampling}</span>
            </label>

            <label className="checkbox-container">
              <input 
                type="checkbox" 
                checked={config.postprocess_enabled} 
                onChange={(e) => updateRunConfig({ postprocess_enabled: e.target.checked })}
              />
              <span style={{ fontSize: '12px' }}>{strings.postprocessEnabled}</span>
            </label>
          </div>
        </div>

      </div>
    </aside>
  );
};
