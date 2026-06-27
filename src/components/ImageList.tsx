import React, { useState } from 'react';
import { useSettings } from '../settings/SettingsContext';
import { i18nStrings } from '../i18n/strings';
import { ImageItem } from '../engine/EngineAdapter';
import { shouldUseProtectedLabels } from '../settings/privacyDisplay';
import { Search, ZoomIn, FolderOpen, Check, Lock, Clock, AlertTriangle } from 'lucide-react';

interface ImageListProps {
  images: ImageItem[];
  selectedImageId: string | null;
  onSelectImage: (id: string) => void;
}

export const ImageList: React.FC<ImageListProps> = ({
  images,
  selectedImageId,
  onSelectImage
}) => {
  const { settings, updateUiPrefs } = useSettings();
  const strings = i18nStrings[settings.uiPrefs.language];
  
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'censored' | 'clean' | 'pending' | 'failed'>('all');
  const protectedUi = shouldUseProtectedLabels(settings.uiPrefs);
  const sfwMode = settings.uiPrefs.sfwMode;
  const protectedFilterLabel = (index: number) =>
    settings.uiPrefs.language === 'ko' ? `보기 ${index + 1}` : `View ${index + 1}`;
  const displayedActiveFilter = protectedUi ? 'all' : activeFilter;

  // Filter images based on search term and active tab filter
  const filteredImages = images.filter(img => {
    if (protectedUi) return true;
    const matchesSearch = img.filename.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = 
      activeFilter === 'all' ||
      (activeFilter === 'censored' && img.status === 'censored') ||
      (activeFilter === 'clean' && img.status === 'clean') ||
      (activeFilter === 'pending' && img.status === 'pending') ||
      (activeFilter === 'failed' && img.status === 'failed');
    return matchesSearch && matchesFilter;
  });

  const getStatusIcon = (status: ImageItem['status']) => {
    switch (status) {
      case 'censored':
        return <Lock size={12} style={{ color: 'var(--color-primary)' }} />;
      case 'clean':
        return <Check size={12} style={{ color: 'var(--color-success)' }} />;
      case 'processing':
        return <Clock size={12} style={{ color: 'var(--color-warning)' }} className="animate-spin" />;
      case 'failed':
        return <AlertTriangle size={12} style={{ color: 'var(--color-danger)' }} />;
      default:
        return <Clock size={12} style={{ color: 'var(--color-mutedText)' }} />;
    }
  };

  const getStatusLabelClass = (status: ImageItem['status']) => {
    switch (status) {
      case 'censored':
        return 'censor-bg';
      case 'clean':
        return 'success-bg';
      case 'processing':
        return 'warning-bg';
      case 'failed':
        return 'danger-bg';
      default:
        return 'muted-bg';
    }
  };

  return (
    <aside className="left-panel">
      {/* Title & Count */}
      <div style={{ padding: '12px', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h2 style={{ fontSize: '14px', fontWeight: 600 }}>
            {strings.images} {!protectedUi && <span style={{ color: 'var(--color-mutedText)', fontWeight: 400 }}>({images.length})</span>}
          </h2>
          {/* Zoom Slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ZoomIn size={12} style={{ color: 'var(--color-mutedText)' }} />
            <input 
              type="range" 
              min="60" 
              max="140" 
              value={settings.uiPrefs.thumbnailZoom} 
              onChange={(e) => updateUiPrefs({ thumbnailZoom: parseInt(e.target.value) })}
              style={{ width: '60px', accentColor: 'var(--color-primary)' }}
            />
          </div>
        </div>

        {/* Search Input */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={14} style={{ position: 'absolute', left: '8px', color: 'var(--color-mutedText)' }} />
          <input
            type="text"
            placeholder={protectedUi ? strings.protectedTargetSelection : strings.searchPlaceholder}
            value={protectedUi ? '' : searchTerm}
            onChange={(e) => {
              if (!protectedUi) setSearchTerm(e.target.value);
            }}
            disabled={protectedUi}
            style={{ width: '100%', paddingLeft: '28px', fontSize: '12px', height: '32px' }}
          />
        </div>
      </div>

      {/* Filters (Tabs) */}
      <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '2px', padding: '6px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)', overflowX: 'auto' }}>
        {(['all', 'censored', 'clean', 'pending', 'failed'] as const).map(f => (
          <button
            key={f}
            onClick={() => {
              if (!protectedUi) setActiveFilter(f);
            }}
            aria-disabled={protectedUi}
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              border: 'none',
              borderRadius: '4px',
              backgroundColor: displayedActiveFilter === f ? 'var(--color-surface)' : 'transparent',
              color: displayedActiveFilter === f ? 'var(--color-primary)' : 'var(--color-mutedText)',
              fontWeight: displayedActiveFilter === f ? 'bold' : 'normal',
              flex: '1 1 auto',
              textAlign: 'center'
            }}
          >
            {protectedUi ? protectedFilterLabel(['all', 'censored', 'clean', 'pending', 'failed'].indexOf(f)) : (
              <>
                {f === 'all' && strings.filterAll}
                {f === 'censored' && strings.filterCensored}
                {f === 'clean' && strings.filterClean}
                {f === 'pending' && strings.filterPending}
                {f === 'failed' && strings.filterFailed}
              </>
            )}
          </button>
        ))}
      </div>

      {/* Scrollable List */}
      <div style={{ overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {images.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '160px', color: 'var(--color-mutedText)', fontSize: '12px', gap: '10px', padding: '16px', textAlign: 'center' }}>
            <FolderOpen size={32} strokeWidth={1} style={{ color: 'var(--color-border)' }} />
            <span style={{ fontWeight: 500 }}>{strings.noImagesLoaded}</span>
            <span style={{ fontSize: '11px', lineHeight: 1.4 }}>{strings.noImagesLoadedHint}</span>
          </div>
        ) : filteredImages.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '120px', color: 'var(--color-mutedText)', fontSize: '12px' }}>
            <span>{strings.noMatchingImages}</span>
          </div>
        ) : (
          filteredImages.map((img, index) => {
            const isSelected = img.id === selectedImageId;
            const size = settings.uiPrefs.thumbnailZoom; // from 60px to 140px
            const displayName = !settings.uiPrefs.showFilenames
              ? ''
              : sfwMode
                ? `${strings.sfwPlaceholderTitle} ${index + 1}`
                : img.filename;
            const tooltipName = !settings.uiPrefs.showFilenames
              ? ''
              : sfwMode
                ? strings.sfwPlaceholderBody
                : img.filename;

            const imageAlt = protectedUi ? strings.images : img.filename;
            const protectedRowLabel = `${strings.sfwPlaceholderTitle} ${index + 1}`;
            const borderStyle = !sfwMode && img.status === 'censored' ? {
              border: `${settings.uiPrefs.censorBorderThickness}px solid ${settings.uiPrefs.censorBorderColor || 'var(--color-primary)'}`
            } : {};

            return (
              <div
                key={img.id}
                role="button"
                aria-label={protectedUi ? protectedRowLabel : img.filename}
                data-image-thumb={protectedUi ? `protected-${index + 1}` : img.id}
                data-selected-thumb={protectedUi ? undefined : isSelected ? 'true' : 'false'}
                onClick={() => onSelectImage(img.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '6px',
                  borderRadius: '8px',
                  border: isSelected ? '1px solid var(--color-primary)' : '1px solid transparent',
                  backgroundColor: isSelected ? 'var(--color-selection)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s ease',
                  gap: '8px'
                }}
              >
                {/* Thumbnail Block */}
                <div 
                  aria-hidden={protectedUi ? true : undefined}
                  style={{ 
                    position: 'relative',
                    width: `${size * 0.7}px`, 
                    height: `${size * 0.52}px`, 
                    backgroundColor: 'var(--color-canvas)', 
                    borderRadius: '4px',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: 'inset 0 0 2px rgba(0,0,0,0.5)',
                    flexShrink: 0,
                    ...borderStyle
                  }}
                >
                  {sfwMode ? (
                    <div className="sfw-thumb-placeholder" aria-label={strings.sfwPlaceholderTitle}>
                      <Lock size={16} />
                    </div>
                  ) : (
                    <img 
                      src={img.thumbnail} 
                      alt={imageAlt}
                      style={{
                        maxWidth: '100%',
                        maxHeight: '100%',
                        objectFit: 'contain',
                        filter: 'none'
                      }}
                    />
                  )}
                  {/* Status indicator on top corner */}
                  <div style={{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    backgroundColor: 'rgba(17,17,27,0.85)',
                    borderRadius: '50%',
                    width: '18px',
                    height: '18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid var(--color-border)'
                  }}>
                    {protectedUi ? <Lock size={12} style={{ color: 'var(--color-mutedText)' }} /> : getStatusIcon(img.status)}
                  </div>
                </div>

                {/* Details */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div aria-hidden={protectedUi ? true : undefined} style={{ position: 'relative' }} className="tooltip-trigger">
                    <span style={{ 
                      fontSize: '12px', 
                      fontWeight: isSelected ? '600' : '400',
                      color: 'var(--color-text)',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      display: 'block'
                    }}>
                      {displayName}
                    </span>
                    {tooltipName && <span className="tooltip-text">{tooltipName}</span>}
                  </div>
                  
                  {/* Miniature badge */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span aria-hidden={protectedUi ? true : undefined} className={`status-badge ${protectedUi ? 'muted-bg' : getStatusLabelClass(img.status)}`}>
                      {protectedUi ? strings.protectedTargetSelection : img.status.toUpperCase()}
                    </span>
                    {img.warnings && img.warnings.length > 0 && (
                      <span title={protectedUi ? strings.protectedTargetSelection : img.warnings.join('\n')} style={{ color: 'var(--color-warning)', display: 'flex', alignItems: 'center' }}>
                        <AlertTriangle size={11} />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Legend / Info Footer */}
      {!protectedUi && <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)', fontSize: '11px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-mutedText)', marginBottom: '4px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-primary)' }} />
            {strings.filterCensored}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-success)' }} />
            {strings.filterClean}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-mutedText)' }} />
            {strings.filterPending}
          </span>
        </div>
      </div>}
    </aside>
  );
};
