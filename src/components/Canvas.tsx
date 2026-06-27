import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings } from '../settings/SettingsContext';
import { i18nStrings } from '../i18n/strings';
import { shouldUseProtectedLabels } from '../settings/privacyDisplay';
import { ImageItem, RegionRequest, RegionResult } from '../engine/EngineAdapter';
import { 
  ZoomIn, 
  ZoomOut, 
  Maximize, 
  Undo2, 
  Redo2, 
  Paintbrush, 
  Eraser, 
  Scan, 
  RefreshCcw, 
  Eye, 
  HelpCircle,
  Smile,
  RotateCcw,
  RotateCw,
  VenetianMask
} from 'lucide-react';

const MIN_BRUSH_SIZE = 5;
const MAX_BRUSH_SIZE = 400;
const MIN_WHEEL_ZOOM = 0.5;
const MIN_DRAG_ZOOM = 0.1;
const WHEEL_ZOOM_MAX = 10.0;
const DRAG_ZOOM_MAX = 50.0;
const TRANSPARENT_PIXEL_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

interface CanvasProps {
  selectedImage: ImageItem | null;
  manualBackupImage?: ImageItem | null;
  onDetectRegion: (req: RegionRequest) => Promise<RegionResult>;
  onSaveEdit: (imageId: string, editedData: string) => Promise<void>;
  onResetImage: (imageId: string) => void;
  onRestoreManualBackup: (imageId: string) => boolean;
  onAddWarning: (msg: string) => void;
}

type CanvasTool = 'brush' | 'eraser' | 'region' | 'emoji';

interface StrokePoint {
  x: number;
  y: number;
  size?: number;
}

interface Stroke {
  points: StrokePoint[];
  color: string;
  size: number;
  opacity: number;
  hardness: number;
  mode: 'draw' | 'erase' | 'emoji';
  emoji?: string;
  emojiColor?: string;
  emojiAngle?: number;
}

interface DetectedRegion {
  box: { x: number; y: number; w: number; h: number };
  label: string;
  confidence: number;
  mask?: string;
  maskImage?: HTMLImageElement;
  source?: string;
}

interface CanvasHistoryState {
  imageDataUrl: string;
}

interface ExistingCensorMask {
  layer: HTMLCanvasElement;
  pixelCount: number;
  key: string;
}

const STAMP_PRESETS = [
  { value: '❤️', name: 'heart' },
  { value: '🖤', name: 'black heart' },
  { value: '💗', name: 'pink heart' },
  { value: '💜', name: 'purple heart' },
  { value: '💛', name: 'yellow heart' },
  { value: '❣️', name: 'exclamation heart' },
  { value: '⭐', name: 'star' },
  { value: '🔥', name: 'fire' },
  { value: '✨', name: 'sparkle' },
  { value: '😊', name: 'smile' },
  { value: '💀', name: 'skull' },
  { value: '🌸', name: 'flower' },
  { value: '☁️', name: 'cloud' },
  { value: '🚫', name: 'no entry' },
  { value: '⭕', name: 'circle' },
  { value: '❌', name: 'cross' }
];

const loadCanvasImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
  image.src = src;
});

const createSfwPlaceholderDataUrl = (title: string): string => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
      <rect width="400" height="300" fill="#1e1e2e" />
      <rect x="40" y="40" width="320" height="220" rx="12" fill="#313244" stroke="#45475a" stroke-width="2" />
      <text x="200" y="152" font-family="sans-serif" font-size="18" fill="#cdd6f4" text-anchor="middle" font-weight="700">${title}</text>
    </svg>
  `;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const clampRect = (x: number, y: number, w: number, h: number, maxW: number, maxH: number) => {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(maxW, Math.ceil(x + w));
  const bottom = Math.min(maxH, Math.ceil(y + h));
  return {
    x: left,
    y: top,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top)
  };
};

const hexToRgba = (hex: string, opacity: number): string => {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : 'f38ba8';
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const alpha = Math.max(0.05, Math.min(1, opacity));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const buildSourceCanvas = (
  image: CanvasImageSource,
  width: number,
  height: number
): HTMLCanvasElement => {
  const source = document.createElement('canvas');
  source.width = Math.max(1, width);
  source.height = Math.max(1, height);
  const sourceCtx = source.getContext('2d');
  if (sourceCtx) {
    sourceCtx.drawImage(image, 0, 0, source.width, source.height);
  }
  return source;
};

const buildExistingCensorMask = (
  originalImage: CanvasImageSource,
  processedImage: CanvasImageSource,
  width: number,
  height: number
): ExistingCensorMask | null => {
  const source = buildSourceCanvas(originalImage, width, height);
  const processed = buildSourceCanvas(processedImage, width, height);
  const sourceCtx = source.getContext('2d', { willReadFrequently: true });
  const processedCtx = processed.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx || !processedCtx) return null;

  const sourceData = sourceCtx.getImageData(0, 0, width, height).data;
  const processedData = processedCtx.getImageData(0, 0, width, height).data;
  const mask = document.createElement('canvas');
  mask.width = width;
  mask.height = height;
  const maskCtx = mask.getContext('2d');
  if (!maskCtx) return null;
  const maskData = maskCtx.createImageData(width, height);
  const pixelTotal = width * height;
  const candidates = new Uint8Array(pixelTotal);
  let candidateCount = 0;

  for (let index = 0; index < sourceData.length; index += 4) {
    const dr = Math.abs(sourceData[index] - processedData[index]);
    const dg = Math.abs(sourceData[index + 1] - processedData[index + 1]);
    const db = Math.abs(sourceData[index + 2] - processedData[index + 2]);
    const da = Math.abs(sourceData[index + 3] - processedData[index + 3]);
    const maxDiff = Math.max(dr, dg, db, da);
    const totalDiff = dr + dg + db + da;
    if (maxDiff >= 24 || totalDiff >= 72) {
      candidates[index / 4] = 1;
      candidateCount += 1;
    }
  }

  if (candidateCount === 0) return null;

  const visited = new Uint8Array(pixelTotal);
  const queue = new Int32Array(pixelTotal);
  const componentPixels: number[] = [];
  const minComponentPixels = Math.max(48, Math.round(pixelTotal * 0.00075));
  let pixelCount = 0;

  for (let start = 0; start < pixelTotal; start += 1) {
    if (!candidates[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let count = 0;
    let strongCount = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    componentPixels.length = 0;
    visited[start] = 1;
    queue[tail] = start;
    tail += 1;
    while (head < tail) {
      const pixel = queue[head];
      head += 1;
      componentPixels.push(pixel);
      count += 1;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const sourceIndex = pixel * 4;
      const dr = Math.abs(sourceData[sourceIndex] - processedData[sourceIndex]);
      const dg = Math.abs(sourceData[sourceIndex + 1] - processedData[sourceIndex + 1]);
      const db = Math.abs(sourceData[sourceIndex + 2] - processedData[sourceIndex + 2]);
      const da = Math.abs(sourceData[sourceIndex + 3] - processedData[sourceIndex + 3]);
      if (Math.max(dr, dg, db, da) >= 48 || dr + dg + db + da >= 144) {
        strongCount += 1;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbors = [
        x > 0 ? pixel - 1 : -1,
        x < width - 1 ? pixel + 1 : -1,
        y > 0 ? pixel - width : -1,
        y < height - 1 ? pixel + width : -1
      ];
      for (const next of neighbors) {
        if (next >= 0 && candidates[next] && !visited[next]) {
          visited[next] = 1;
          queue[tail] = next;
          tail += 1;
        }
      }
    }

    const bboxWidth = maxX - minX + 1;
    const bboxHeight = maxY - minY + 1;
    const bboxArea = Math.max(1, bboxWidth * bboxHeight);
    const bboxCoverage = bboxArea / Math.max(1, pixelTotal);
    const fillRatio = count / bboxArea;
    const strongRatio = strongCount / Math.max(1, count);
    const sparseWholeImageNoise = bboxCoverage > 0.55 && fillRatio < 0.18 && strongRatio < 0.35;
    const nearFullFrameNoise = bboxCoverage > 0.85 && fillRatio < 0.45 && strongRatio < 0.50;
    if (sparseWholeImageNoise || nearFullFrameNoise) continue;

    const elongatedStroke = Math.max(bboxWidth, bboxHeight) >= 16
      && count >= 12
      && (bboxCoverage < 0.35 || fillRatio >= 0.18 || strongRatio >= 0.35);
    if (count < minComponentPixels && !elongatedStroke) continue;
    for (const pixel of componentPixels) {
      const index = pixel * 4;
      maskData.data[index] = 255;
      maskData.data[index + 1] = 255;
      maskData.data[index + 2] = 255;
      maskData.data[index + 3] = 255;
    }
    pixelCount += count;
  }

  if (pixelCount === 0) return null;
  maskCtx.putImageData(maskData, 0, 0);
  return { layer: mask, pixelCount, key: `${width}x${height}:${pixelCount}` };
};

const drawMosaicFromSource = (
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  blockSize: number,
  opacity: number
) => {
  const rect = clampRect(x, y, w, h, sourceCanvas.width, sourceCanvas.height);
  if (rect.w <= 0 || rect.h <= 0) return;
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) return;
  const size = Math.max(3, Math.round(blockSize || 10));
  ctx.save();
  ctx.globalAlpha = opacity;
  for (let by = rect.y; by < rect.y + rect.h; by += size) {
    for (let bx = rect.x; bx < rect.x + rect.w; bx += size) {
      const bw = Math.min(size, rect.x + rect.w - bx);
      const bh = Math.min(size, rect.y + rect.h - by);
      const pixels = sourceCtx.getImageData(bx, by, bw, bh).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        r += pixels[i];
        g += pixels[i + 1];
        b += pixels[i + 2];
        count += 1;
      }
      ctx.fillStyle = `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`;
      ctx.fillRect(bx, by, bw, bh);
    }
  }
  ctx.restore();
};

const drawBlurFromSource = (
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  opacity: number
) => {
  const rect = clampRect(x, y, w, h, sourceCanvas.width, sourceCanvas.height);
  if (rect.w <= 0 || rect.h <= 0) return;
  const blurRadius = Math.max(0.1, Number(radius) || 15);
  const pad = Math.ceil(blurRadius * 2);
  const sx = Math.max(0, rect.x - pad);
  const sy = Math.max(0, rect.y - pad);
  const sw = Math.min(sourceCanvas.width - sx, rect.w + pad * 2);
  const sh = Math.min(sourceCanvas.height - sy, rect.h + pad * 2);
  const crop = document.createElement('canvas');
  crop.width = sw;
  crop.height = sh;
  const cropCtx = crop.getContext('2d');
  if (!cropCtx) return;
  cropCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.filter = `blur(${blurRadius}px)`;
  ctx.drawImage(crop, sx, sy);
  ctx.filter = 'none';
  ctx.restore();
};

const drawStrokeShape = (
  ctx: CanvasRenderingContext2D,
  stroke: Pick<Stroke, 'points' | 'size'>
) => {
  const points = stroke.points;
  if (points.length === 0) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (points.length === 1) {
    const point = points[0];
    const pointSize = Math.max(MIN_BRUSH_SIZE, point.size || stroke.size);
    ctx.beginPath();
    ctx.arc(point.x, point.y, pointSize / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const firstSize = Math.max(MIN_BRUSH_SIZE, points[0].size || stroke.size);
  const constantWidth = points.every((point) => Math.abs(Math.max(MIN_BRUSH_SIZE, point.size || stroke.size) - firstSize) < 0.5);
  if (constantWidth) {
    ctx.beginPath();
    ctx.lineWidth = firstSize;
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    return;
  }

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const point = points[i];
    ctx.beginPath();
    ctx.lineWidth = Math.max(MIN_BRUSH_SIZE, point.size || stroke.size);
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }
};

const createStrokeMaskLayer = (
  stroke: Pick<Stroke, 'points' | 'size' | 'hardness'>,
  canvasWidth: number,
  canvasHeight: number,
  edgeBlur: number
) => {
  const hardMask = document.createElement('canvas');
  hardMask.width = canvasWidth;
  hardMask.height = canvasHeight;
  const hardCtx = hardMask.getContext('2d');
  if (!hardCtx) return null;
  hardCtx.fillStyle = '#ffffff';
  hardCtx.strokeStyle = '#ffffff';
  drawStrokeShape(hardCtx, stroke);

  const hardness = Math.max(0, Math.min(1, stroke.hardness ?? 1));
  const feather = Math.max(0, edgeBlur) * 1.35 + (1 - hardness) * 8;
  if (feather <= 0.01) return hardMask;

  const softMask = document.createElement('canvas');
  softMask.width = canvasWidth;
  softMask.height = canvasHeight;
  const softCtx = softMask.getContext('2d');
  if (!softCtx) return hardMask;
  softCtx.filter = `blur(${Math.max(0.6, feather * 0.55)}px)`;
  softCtx.drawImage(hardMask, 0, 0);
  softCtx.filter = 'none';
  softCtx.globalCompositeOperation = 'source-over';
  softCtx.drawImage(hardMask, 0, 0);
  return softMask;
};

type ApplyCensorStyle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  sourceCanvas?: HTMLCanvasElement
) => void;

const applyCensorStrokeEffect = (
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  sourceCanvas: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  applyCensorStyle: ApplyCensorStyle,
  edgeBlur: number
) => {
  const maskLayer = createStrokeMaskLayer(stroke, canvasWidth, canvasHeight, edgeBlur);
  if (!maskLayer) return;

  const effectLayer = document.createElement('canvas');
  effectLayer.width = canvasWidth;
  effectLayer.height = canvasHeight;
  const effectCtx = effectLayer.getContext('2d');
  if (!effectCtx) return;
  applyCensorStyle(effectCtx, 0, 0, canvasWidth, canvasHeight, sourceCanvas);
  effectCtx.globalCompositeOperation = 'destination-in';
  effectCtx.drawImage(maskLayer, 0, 0);
  effectCtx.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.drawImage(effectLayer, 0, 0);
  ctx.restore();
};

export const Canvas: React.FC<CanvasProps> = ({
  selectedImage,
  manualBackupImage,
  onDetectRegion,
  onSaveEdit,
  onResetImage,
  onRestoreManualBackup,
  onAddWarning
}) => {
  const { settings, updateRunConfig, updateUiPrefs } = useSettings();
  const strings = i18nStrings[settings.uiPrefs.language];
  const protectedUi = shouldUseProtectedLabels(settings.uiPrefs);
  const sfwMode = settings.uiPrefs.sfwMode;
  const toolLabels = {
    brush: protectedUi ? (settings.uiPrefs.language === 'ko' ? '브러시' : 'Brush') : strings.brush,
    eraser: protectedUi ? (settings.uiPrefs.language === 'ko' ? '복구/지우개' : 'Restore/erase') : strings.eraser,
    region: protectedUi ? (settings.uiPrefs.language === 'ko' ? '영역 감지' : 'Region detect') : strings.detectRegion,
    stamp: protectedUi ? (settings.uiPrefs.language === 'ko' ? '스탬프' : 'Stamp') : strings.emojiTool
  };
  const emojiChar = settings.uiPrefs.stampEmoji || '❤️';
  const emojiColor = settings.uiPrefs.stampColor || '#000000';
  const emojiAngle = settings.uiPrefs.stampAngle || 0;

  // Canvas State
  const [zoom, setZoom] = useState(1);
  const [activeTool, setActiveTool] = useState<CanvasTool>('brush');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [undoStack, setUndoStack] = useState<CanvasHistoryState[]>([]);
  const [redoStack, setRedoStack] = useState<CanvasHistoryState[]>([]);
  const [detectedRegions, setDetectedRegions] = useState<DetectedRegion[]>([]);
  const [existingCensorMask, setExistingCensorMask] = useState<ExistingCensorMask | null>(null);
  const [localDisplayImageDataUrl, setLocalDisplayImageDataUrl] = useState<string | null>(null);
  const [previewOriginal, setPreviewOriginal] = useState(false);
  const previousImageIdRef = useRef<string | null>(null);

  // Mouse / Drawing State
  const [isDrawing, setIsDrawing] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [cursorPressureScale, setCursorPressureScale] = useState(1);
  const [showCursorCircle, setShowCursorCircle] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const [regionSelectionActive, setRegionSelectionActive] = useState(false);
  // Spacebar/Ctrl panning and legacy Z-drag zoom state
  const [spacePressed, setSpacePressed] = useState(false);
  const [zoomDragPressed, setZoomDragPressed] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isZoomDragging, setIsZoomDragging] = useState(false);
  const [zoomDragStart, setZoomDragStart] = useState<{ x: number; y: number } | null>(null);
  const [zoomDragStartLevel, setZoomDragStartLevel] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragEndRef = useRef<{ x: number; y: number } | null>(null);
  const regionSelectionActiveRef = useRef(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previousToolBeforeEraserRef = useRef<CanvasTool>('brush');
  const isSavingEditRef = useRef(false);
  const pendingImageSaveRef = useRef<{ edited: string; clearWorkingState?: boolean } | null>(null);
  const committedImageDataUrlRef = useRef<string | null>(null);
  const isPreviewingOriginal = previewOriginal && !sfwMode;

  const safeSaveEdit = useCallback(async (imageId: string, editedData: string): Promise<boolean> => {
    try {
      await onSaveEdit(imageId, editedData);
      return true;
    } catch (error) {
      const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
      onAddWarning(`${strings.manualEditsSaveFailed}${detail}`);
      return false;
    }
  }, [onSaveEdit, onAddWarning, strings.manualEditsSaveFailed]);

  const selectTool = useCallback((tool: CanvasTool) => {
    if (tool === 'eraser') {
      setActiveTool((current) => {
        if (current === 'eraser') {
          return previousToolBeforeEraserRef.current || 'brush';
        }
        previousToolBeforeEraserRef.current = current;
        return 'eraser';
      });
      return;
    }
    previousToolBeforeEraserRef.current = tool;
    setActiveTool(tool);
  }, []);

  const captureDisplayedImageDataUrl = useCallback((): string | null => {
    const image = imageRef.current;
    if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight) return null;
    const snapshot = document.createElement('canvas');
    snapshot.width = image.naturalWidth;
    snapshot.height = image.naturalHeight;
    const snapshotCtx = snapshot.getContext('2d');
    if (!snapshotCtx) return null;
    snapshotCtx.drawImage(image, 0, 0, snapshot.width, snapshot.height);
    return snapshot.toDataURL('image/png');
  }, []);

  const currentCommittedImageDataUrl = useCallback((): string | null => {
    return committedImageDataUrlRef.current || captureDisplayedImageDataUrl();
  }, [captureDisplayedImageDataUrl]);

  const captureHistoryState = useCallback((): CanvasHistoryState | null => {
    const imageDataUrl = currentCommittedImageDataUrl();
    return imageDataUrl ? { imageDataUrl } : null;
  }, [currentCommittedImageDataUrl]);

  const pushUndoState = useCallback(() => {
    const snapshot = captureHistoryState();
    if (!snapshot) return;
    setUndoStack(prev => [...prev.slice(-49), snapshot]);
    setRedoStack([]);
  }, [captureHistoryState]);

  useEffect(() => {
    const imageId = selectedImage?.id ?? null;
    if (previousImageIdRef.current === imageId) return;
    previousImageIdRef.current = imageId;
    setStrokes([]);
    setDetectedRegions([]);
    setUndoStack([]);
    setRedoStack([]);
    setPreviewOriginal(false);
    setDragStart(null);
    setDragEnd(null);
    setRegionSelectionActive(false);
    dragStartRef.current = null;
    dragEndRef.current = null;
    regionSelectionActiveRef.current = false;
    committedImageDataUrlRef.current = null;
    setLocalDisplayImageDataUrl(null);
    setIsDrawing(false);
    setIsPanning(false);
  }, [selectedImage?.id]);

  const existingCensorMaskKey = selectedImage
    ? [
      selectedImage.id,
      selectedImage.original_thumbnail || '',
      selectedImage.thumbnail || '',
      selectedImage.result_path || '',
      selectedImage.status
    ].join('|')
    : '';
  const activeExistingCensorMask = existingCensorMask && existingCensorMask.key.startsWith(`${existingCensorMaskKey}:`)
    ? existingCensorMask
    : null;

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setExistingCensorMask(null);
    });
    const hasProcessedResult = Boolean(
      selectedImage &&
      selectedImage.original_thumbnail &&
      selectedImage.thumbnail &&
      selectedImage.thumbnail !== selectedImage.original_thumbnail &&
      (selectedImage.status !== 'pending' || selectedImage.result_path || selectedImage.restored)
    );
    if (!selectedImage || !hasProcessedResult || !selectedImage.original_thumbnail) return;

    Promise.all([
      loadCanvasImage(selectedImage.original_thumbnail),
      loadCanvasImage(selectedImage.thumbnail)
    ]).then(([originalImage, processedImage]) => {
      if (cancelled) return;
      const width = Math.max(1, originalImage.naturalWidth || originalImage.width || processedImage.naturalWidth || processedImage.width || 1);
      const height = Math.max(1, originalImage.naturalHeight || originalImage.height || processedImage.naturalHeight || processedImage.height || 1);
      const mask = buildExistingCensorMask(originalImage, processedImage, width, height);
      if (!cancelled) {
        setExistingCensorMask(mask ? { ...mask, key: `${existingCensorMaskKey}:${mask.key}` } : null);
      }
    }).catch(() => {
      if (!cancelled) setExistingCensorMask(null);
    });

    return () => {
      cancelled = true;
    };
  }, [existingCensorMaskKey, selectedImage]);

  // Spacebar panning and legacy Z-drag zoom key listeners.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');
      if (e.code === 'Space' && !isInput) {
        e.preventDefault();
        setSpacePressed(true);
      }
      if (e.code === 'KeyZ' && !isInput) {
        e.preventDefault();
        setZoomDragPressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
        setIsPanning(false);
      }
      if (e.code === 'KeyZ') {
        setZoomDragPressed(false);
        setIsZoomDragging(false);
        setZoomDragStart(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const applyCensorStyle = useCallback((
    ctx: CanvasRenderingContext2D, 
    x: number, 
    y: number, 
    w: number, 
    h: number,
    sourceCanvas?: HTMLCanvasElement
  ) => {
    const config = settings.runConfig;
    ctx.save();
    
    // Set transparency
    const opacity = Math.max(0, Math.min(1, config.opacity));
    ctx.globalAlpha = opacity;

    if (config.censor_mode === 'solid') {
      ctx.fillStyle = config.fill_color || '#000000';
      ctx.fillRect(x, y, w, h);
    } else if (config.censor_mode === 'blackwhite') {
      ctx.fillStyle = '#000000';
      ctx.fillRect(x, y, w, h);
    } else if (config.censor_mode === 'mosaic') {
      ctx.restore();
      if (sourceCanvas) {
        drawMosaicFromSource(ctx, sourceCanvas, x, y, w, h, config.mosaic_block, opacity);
      } else {
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.fillStyle = config.fill_color || '#000000';
        ctx.fillRect(x, y, w, h);
        ctx.restore();
      }
      return;
    } else if (config.censor_mode === 'blur') {
      ctx.restore();
      if (sourceCanvas) {
        drawBlurFromSource(ctx, sourceCanvas, x, y, w, h, config.blur_radius, opacity);
      } else {
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.fillStyle = config.fill_color || '#000000';
        ctx.fillRect(x, y, w, h);
        ctx.restore();
      }
      return;
    }

    ctx.restore();
  }, [settings.runConfig]);

  const applyCensorMask = useCallback((
    ctx: CanvasRenderingContext2D,
    maskImage: HTMLImageElement,
    x: number,
    y: number,
    w: number,
    h: number,
    canvasWidth: number,
    canvasHeight: number,
    sourceCanvas?: HTMLCanvasElement
  ) => {
    const layer = document.createElement('canvas');
    layer.width = canvasWidth;
    layer.height = canvasHeight;
    const layerCtx = layer.getContext('2d');
    if (!layerCtx) return;

    applyCensorStyle(layerCtx, x, y, w, h, sourceCanvas);
    layerCtx.globalCompositeOperation = 'destination-in';
    layerCtx.drawImage(maskImage, x, y, w, h);
    layerCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(layer, 0, 0);
  }, [applyCensorStyle]);

  const applyQuickMask = useCallback((
    ctx: CanvasRenderingContext2D,
    maskImage: CanvasImageSource | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
    canvasWidth: number,
    canvasHeight: number
  ) => {
    ctx.save();
    const color = hexToRgba(settings.uiPrefs.quickMaskColor, settings.uiPrefs.quickMaskOpacity);
    const useWhiteBackdrop = settings.uiPrefs.quickMaskBackdropMode === 'white';
    if (!maskImage) {
      if (useWhiteBackdrop) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, w, h);
      }
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      return;
    }
    const layer = document.createElement('canvas');
    layer.width = canvasWidth;
    layer.height = canvasHeight;
    const layerCtx = layer.getContext('2d');
    if (!layerCtx) {
      ctx.restore();
      return;
    }
    if (useWhiteBackdrop) {
      const baseLayer = document.createElement('canvas');
      baseLayer.width = canvasWidth;
      baseLayer.height = canvasHeight;
      const baseCtx = baseLayer.getContext('2d');
      if (baseCtx) {
        baseCtx.fillStyle = '#ffffff';
        baseCtx.fillRect(x, y, w, h);
        baseCtx.globalCompositeOperation = 'destination-in';
        baseCtx.drawImage(maskImage, x, y, w, h);
        ctx.drawImage(baseLayer, 0, 0);
      }
    }
    layerCtx.fillStyle = color;
    layerCtx.fillRect(x, y, w, h);
    layerCtx.globalCompositeOperation = 'destination-in';
    layerCtx.drawImage(maskImage, x, y, w, h);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }, [settings.uiPrefs.quickMaskBackdropMode, settings.uiPrefs.quickMaskColor, settings.uiPrefs.quickMaskOpacity]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas dimensions to match image natural size
    canvas.width = img.naturalWidth || 800;
    canvas.height = img.naturalHeight || 600;
    setCanvasSize(prev => (
      prev.width === canvas.width && prev.height === canvas.height
        ? prev
        : { width: canvas.width, height: canvas.height }
    ));

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // If "hold to preview original" is active, do not render any censorship masks
    if (isPreviewingOriginal) return;

    const sourceCanvas = buildSourceCanvas(img, canvas.width, canvas.height);

    if (settings.uiPrefs.quickMask && activeExistingCensorMask) {
      applyQuickMask(ctx, activeExistingCensorMask.layer, 0, 0, canvas.width, canvas.height, canvas.width, canvas.height);
    }

    // Draw detected regions (model boxes)
    detectedRegions.forEach(region => {
      const { x, y, w, h } = region.box;
      const px = x * canvas.width;
      const py = y * canvas.height;
      const pw = w * canvas.width;
      const ph = h * canvas.height;

      if (settings.uiPrefs.quickMask) {
        applyQuickMask(ctx, region.maskImage, px, py, pw, ph, canvas.width, canvas.height);
      } else if (region.maskImage) {
        applyCensorMask(ctx, region.maskImage, px, py, pw, ph, canvas.width, canvas.height, sourceCanvas);
      } else {
        applyCensorStyle(ctx, px, py, pw, ph, sourceCanvas);
      }

      // Persisted regions should affect the image, not leave permanent edit boxes.
    });

    // Draw manual strokes
    strokes.forEach(stroke => {
      if (stroke.points.length === 0) return;

      ctx.save();

      if (stroke.mode === 'emoji') {
        const point = stroke.points[0];
        ctx.translate(point.x, point.y);
        ctx.rotate(((stroke.emojiAngle || 0) * Math.PI) / 180);
        ctx.font = `${Math.max(8, stroke.size)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = stroke.opacity;
        ctx.fillStyle = stroke.emojiColor || stroke.color;
        ctx.fillText(stroke.emoji || '■', 0, 0);
        ctx.restore();
        return;
      }
      
      if (stroke.mode === 'erase') {
        // Destination-out composites to erase drawing
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.color;
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = stroke.opacity;
      if (settings.uiPrefs.brushHardnessEnabled && stroke.mode !== 'erase') {
        ctx.shadowColor = stroke.color;
        ctx.shadowBlur = Math.max(0, stroke.size * (1 - stroke.hardness) * 0.35);
      }

      if (stroke.mode === 'draw') {
        if (settings.uiPrefs.quickMask) {
          const strokeEdgeBlur = settings.runConfig.censor_mode === 'mosaic' ? 0 : settings.runConfig.edge_blur;
          const maskLayer = createStrokeMaskLayer(stroke, canvas.width, canvas.height, strokeEdgeBlur);
          if (maskLayer) {
            applyQuickMask(ctx, maskLayer, 0, 0, canvas.width, canvas.height, canvas.width, canvas.height);
          }
          ctx.restore();
          return;
        }
        const strokeEdgeBlur = settings.runConfig.censor_mode === 'mosaic' ? 0 : settings.runConfig.edge_blur;
        applyCensorStrokeEffect(ctx, stroke, sourceCanvas, canvas.width, canvas.height, applyCensorStyle, strokeEdgeBlur);
      } else if (stroke.points.length === 1) {
        const point = stroke.points[0];
        ctx.beginPath();
        ctx.lineWidth = point.size || stroke.size;
        ctx.arc(point.x, point.y, (point.size || stroke.size) / 2, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      } else {
        ctx.save();
        for (let i = 1; i < stroke.points.length; i++) {
          const prev = stroke.points[i - 1];
          const pt = stroke.points[i];
          ctx.beginPath();
          ctx.lineWidth = pt.size || stroke.size;
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(pt.x, pt.y);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.restore();
    });
  }, [activeExistingCensorMask, applyCensorMask, applyCensorStyle, applyQuickMask, detectedRegions, isPreviewingOriginal, settings.runConfig.censor_mode, settings.runConfig.edge_blur, settings.uiPrefs.brushHardnessEnabled, settings.uiPrefs.quickMask, strokes]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const getCanvasPointerCoords = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    // Scale coords to internal natural canvas resolution
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const toNormalizedCanvasPoint = (coords: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, coords.x / Math.max(1, canvas.width))),
      y: Math.max(0, Math.min(1, coords.y / Math.max(1, canvas.height)))
    };
  };

  const beginRegionDrag = (coords: { x: number; y: number }) => {
    const normalized = toNormalizedCanvasPoint(coords);
    regionSelectionActiveRef.current = true;
    dragStartRef.current = normalized;
    dragEndRef.current = normalized;
    setRegionSelectionActive(true);
    setDragStart(normalized);
    setDragEnd(normalized);
  };

  const updateRegionDrag = (coords: { x: number; y: number }) => {
    if (!regionSelectionActiveRef.current) return;
    const normalized = toNormalizedCanvasPoint(coords);
    dragEndRef.current = normalized;
    setDragEnd(normalized);
  };

  const clearRegionDrag = () => {
    regionSelectionActiveRef.current = false;
    dragStartRef.current = null;
    dragEndRef.current = null;
    setRegionSelectionActive(false);
    setDragStart(null);
    setDragEnd(null);
  };

  const pressureScale = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!settings.uiPrefs.tabletPressure) return 1;
    if (e.pointerType !== 'pen') return 1;
    return Math.max(0.1, Math.min(1.0, e.pressure || 1));
  };

  // Drawing Events
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!selectedImage || isPreviewingOriginal || sfwMode) return;
    if (e.button === 1) e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    if (zoomDragPressed && e.button === 0) {
      e.preventDefault();
      setIsZoomDragging(true);
      setZoomDragStart({ x: e.clientX, y: e.clientY });
      setZoomDragStartLevel(zoom);
      return;
    }

    if (spacePressed || (e.ctrlKey && e.button === 0)) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      return;
    }

    const coords = getCanvasPointerCoords(e);
    setCursorPos(coords);
    setCursorPressureScale(pressureScale(e));
    setShowCursorCircle(true);

    const isRegionPointer = e.button === 2 || activeTool === 'region';
    if (isRegionPointer) {
      e.preventDefault();
      beginRegionDrag(coords);
    } else if (activeTool === 'emoji') {
      pushUndoState();
      const newStroke: Stroke = {
        points: [coords],
        color: emojiColor,
        size: Math.max(8, settings.runConfig.brush_size),
        opacity: settings.runConfig.opacity,
        hardness: 1,
        mode: 'emoji',
        emoji: emojiChar || '■',
        emojiColor,
        emojiAngle
      };
      setStrokes(prev => [...prev, newStroke]);
    } else {
      // Brush or Eraser Draw
      setIsDrawing(true);
      pushUndoState();

      const forcedRestore = e.button === 1;
      const pointSize = Math.max(MIN_BRUSH_SIZE, Math.round(settings.runConfig.brush_size * pressureScale(e)));
      const newStroke: Stroke = {
        points: [{ ...coords, size: pointSize }],
        color: settings.runConfig.fill_color || '#000000',
        size: pointSize,
        opacity: settings.runConfig.opacity,
        hardness: settings.uiPrefs.brushHardnessEnabled ? settings.runConfig.brush_hardness : 1,
        mode: forcedRestore || activeTool === 'eraser' ? 'erase' : 'draw'
      };
      setStrokes(prev => [...prev, newStroke]);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isZoomDragging && zoomDragStart) {
      const deltaX = e.clientX - zoomDragStart.x;
      const zoomFactor = Math.pow(1.01, deltaX);
      setZoom(Math.max(MIN_DRAG_ZOOM, Math.min(DRAG_ZOOM_MAX, parseFloat((zoomDragStartLevel * zoomFactor).toFixed(3)))));
      return;
    }

    if (isPanning) {
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
      return;
    }

    const coords = getCanvasPointerCoords(e);
    setCursorPos(coords);
    setCursorPressureScale(pressureScale(e));
    
    if ((regionSelectionActiveRef.current || regionSelectionActive) && (dragStartRef.current || dragStart)) {
      e.preventDefault();
      updateRegionDrag(coords);
    } else if (isDrawing && strokes.length > 0) {
      const updatedStrokes = [...strokes];
      const current = updatedStrokes[updatedStrokes.length - 1];
      const pointSize = Math.max(MIN_BRUSH_SIZE, Math.round(settings.runConfig.brush_size * pressureScale(e)));
      if (e.shiftKey && settings.uiPrefs.straightLine && current.points.length > 0) {
        current.points = [current.points[0], { ...coords, size: pointSize }];
      } else {
        current.points.push({ ...coords, size: pointSize });
      }
      setStrokes(updatedStrokes);
    }
  };

  const handlePointerUp = async () => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isZoomDragging) {
      setIsZoomDragging(false);
      setZoomDragStart(null);
      return;
    }

    if (isDrawing) {
      setIsDrawing(false);
      setTimeout(() => void handleSave(), 0);
    }

    const regionDragStart = dragStartRef.current || dragStart;
    const regionDragEnd = dragEndRef.current || dragEnd;
    if ((regionSelectionActiveRef.current || regionSelectionActive) && regionDragStart && regionDragEnd) {
      const x1 = Math.min(regionDragStart.x, regionDragEnd.x);
      const y1 = Math.min(regionDragStart.y, regionDragEnd.y);
      const w = Math.abs(regionDragStart.x - regionDragEnd.x);
      const h = Math.abs(regionDragStart.y - regionDragEnd.y);
      clearRegionDrag();

      if (w < 0.02 || h < 0.02) {
        onAddWarning(strings.regionDragRequired);
        return;
      }

      if (settings.runConfig.selection_region_mode === 'selection') {
        const selectionRegion: DetectedRegion = {
          box: { x: x1, y: y1, w, h },
          label: 'selected-region',
          confidence: 1,
          source: 'selection-region'
        };
        const nextRegions = [...detectedRegions, selectionRegion];
        pushUndoState();
        const saved = await persistCanvasState(nextRegions, strokes, { clearWorkingState: true });
        if (!saved) {
          setDetectedRegions(nextRegions);
        }
        return;
      }

      const req: RegionRequest = {
        image_id: selectedImage!.id,
        image_path: selectedImage!.path,
        normalized_rect: { x: x1, y: y1, w, h },
        threshold: settings.runConfig.threshold,
        target_mode: settings.runConfig.target_mode,
        targets: settings.runConfig.targets,
        device: settings.runConfig.region_device_mode || settings.runConfig.device_mode,
        config: settings.runConfig
      };

      try {
        const res = await onDetectRegion(req);
        if (res.masks && res.masks.length > 0) {
          const newRegions: DetectedRegion[] = await Promise.all(res.masks.map(async m => {
            let maskImage: HTMLImageElement | undefined;
            if (m.mask) {
              try {
                maskImage = await loadCanvasImage(m.mask);
              } catch {
                maskImage = undefined;
              }
            }
            return {
              box: m.box,
              label: m.label,
              confidence: m.confidence,
              mask: m.mask,
              maskImage,
              source: m.source
            };
          }));
          const nextRegions = [...detectedRegions, ...newRegions];
          if (res.message && newRegions.some(region => region.source === 'manual-grabcut-fallback')) {
            onAddWarning(res.message);
          }
          pushUndoState();
          const saved = await persistCanvasState(nextRegions, strokes, { clearWorkingState: true });
          if (!saved) {
            setDetectedRegions(nextRegions);
          }
        } else {
          onAddWarning(res.message || 'No target classes detected in dragging rectangle.');
        }
      } catch {
        onAddWarning('Error running local region segmentation.');
      }
    }
  };

  const handlePointerCancel = () => {
    setIsDrawing(false);
    setIsPanning(false);
    setIsZoomDragging(false);
    clearRegionDrag();
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectedImage || isPreviewingOriginal || sfwMode || e.button !== 2) return;
    e.preventDefault();
    if (regionSelectionActiveRef.current) return;
    beginRegionDrag(getCanvasPointerCoords(e));
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!regionSelectionActiveRef.current || (e.buttons & 2) !== 2) return;
    e.preventDefault();
    updateRegionDrag(getCanvasPointerCoords(e));
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!regionSelectionActiveRef.current || e.button !== 2) return;
    e.preventDefault();
    void handlePointerUp();
  };

  useEffect(() => {
    const completeRightDrag = (event: MouseEvent) => {
      if (!regionSelectionActiveRef.current || event.button !== 2) return;
      event.preventDefault();
      updateRegionDrag(getCanvasPointerCoords(event));
      void handlePointerUp();
    };
    window.addEventListener('mouseup', completeRightDrag);
    return () => window.removeEventListener('mouseup', completeRightDrag);
  });

  const restoreHistoryState = async (state: CanvasHistoryState): Promise<boolean> => {
    setStrokes([]);
    setDetectedRegions([]);
    return await persistImageDataUrl(state.imageDataUrl, { clearWorkingState: true });
  };

  const handleUndo = async () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    const current = captureHistoryState();
    if (!current) return;
    setRedoStack(r => [...r.slice(-49), current]);
    setUndoStack(u => u.slice(0, -1));
    const restored = await restoreHistoryState(prev);
    if (!restored) {
      setUndoStack(u => [...u, prev]);
      setRedoStack(r => r.slice(0, -1));
    }
  };

  const handleRedo = async () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const current = captureHistoryState();
    if (!current) return;
    setUndoStack(u => [...u.slice(-49), current]);
    setRedoStack(r => r.slice(0, -1));
    const restored = await restoreHistoryState(next);
    if (!restored) {
      setRedoStack(r => [...r, next]);
      setUndoStack(u => u.slice(0, -1));
    }
  };

  const handleReset = () => {
    if (settings.uiPrefs.confirmReset && !window.confirm(strings.resetConfirmationPrompt)) return;
    pushUndoState();
    setStrokes([]);
    setDetectedRegions([]);
    committedImageDataUrlRef.current = null;
    setLocalDisplayImageDataUrl(null);
    if (selectedImage) {
      onResetImage(selectedImage.id);
    }
  };

  const handleCancelCanvas = () => {
    setPreviewOriginal(false);
    setDragStart(null);
    setDragEnd(null);
    setIsDrawing(false);
    setIsPanning(false);
  };

  const handleRestoreFromOriginal = async () => {
    if (!selectedImage) return;
    if (settings.uiPrefs.confirmReset && !window.confirm(strings.resetConfirmationPrompt)) return;
    if (manualBackupImage) {
      pushUndoState();
      const restored = onRestoreManualBackup(selectedImage.id);
      if (restored) {
        committedImageDataUrlRef.current = null;
        setLocalDisplayImageDataUrl(null);
        setStrokes([]);
        setDetectedRegions([]);
      }
      return;
    }
    if (!selectedImage.original_thumbnail) return;
    const originalImage = await loadCanvasImage(selectedImage.original_thumbnail);
    const restored = document.createElement('canvas');
    restored.width = originalImage.naturalWidth || originalImage.width || 1;
    restored.height = originalImage.naturalHeight || originalImage.height || 1;
    const restoredCtx = restored.getContext('2d');
    if (!restoredCtx) return;
    restoredCtx.drawImage(originalImage, 0, 0, restored.width, restored.height);
    pushUndoState();
    const restoredDataUrl = restored.toDataURL('image/png');
    const saved = await persistImageDataUrl(restoredDataUrl, { clearWorkingState: true });
    if (!saved) return;
  };

  const resetViewport = () => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const canResetCurrentImage = Boolean(
    selectedImage && (
      strokes.length > 0 ||
      detectedRegions.length > 0 ||
      selectedImage.status !== 'pending' ||
      selectedImage.result_path
    )
  );

  const buildEditedDataUrl = async (
    regions: DetectedRegion[] = detectedRegions,
    strokeItems: Stroke[] = strokes,
    baseThumbnailSrc: string = committedImageDataUrlRef.current || selectedImage?.thumbnail || ''
  ): Promise<string | null> => {
    if (!selectedImage) return null;
    const overlay = canvasRef.current;
    if (!overlay) return null;

    const composed = document.createElement('canvas');
    composed.width = overlay.width || 1;
    composed.height = overlay.height || 1;
    const ctx = composed.getContext('2d');
    if (!ctx) return null;

    const processedImage = await loadCanvasImage(baseThumbnailSrc);
    ctx.drawImage(processedImage, 0, 0, composed.width, composed.height);
    const saveSourceCanvas = buildSourceCanvas(processedImage, composed.width, composed.height);

    const eraseStrokes = strokeItems.filter(stroke => stroke.mode === 'erase');
    const saveOverlay = document.createElement('canvas');
    saveOverlay.width = composed.width;
    saveOverlay.height = composed.height;
    const saveOverlayCtx = saveOverlay.getContext('2d');
    if (!saveOverlayCtx) return null;

    regions.forEach(region => {
      const { x, y, w, h } = region.box;
      const px = x * saveOverlay.width;
      const py = y * saveOverlay.height;
      const pw = w * saveOverlay.width;
      const ph = h * saveOverlay.height;
      if (region.maskImage) {
        applyCensorMask(saveOverlayCtx, region.maskImage, px, py, pw, ph, saveOverlay.width, saveOverlay.height, saveSourceCanvas);
      } else {
        applyCensorStyle(saveOverlayCtx, px, py, pw, ph, saveSourceCanvas);
      }
    });

    strokeItems.filter(stroke => stroke.mode !== 'erase').forEach(stroke => {
      if (stroke.points.length === 0) return;
      saveOverlayCtx.save();
      if (stroke.mode === 'emoji') {
        const point = stroke.points[0];
        saveOverlayCtx.translate(point.x, point.y);
        saveOverlayCtx.rotate(((stroke.emojiAngle || 0) * Math.PI) / 180);
        saveOverlayCtx.font = `${Math.max(8, stroke.size)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
        saveOverlayCtx.textAlign = 'center';
        saveOverlayCtx.textBaseline = 'middle';
        saveOverlayCtx.globalAlpha = stroke.opacity;
        saveOverlayCtx.fillStyle = stroke.emojiColor || stroke.color;
        saveOverlayCtx.fillText(stroke.emoji || '■', 0, 0);
      } else if (stroke.mode === 'draw') {
        const strokeEdgeBlur = settings.runConfig.censor_mode === 'mosaic' ? 0 : settings.runConfig.edge_blur;
        applyCensorStrokeEffect(
          saveOverlayCtx,
          stroke,
          saveSourceCanvas,
          composed.width,
          composed.height,
          applyCensorStyle,
          strokeEdgeBlur
        );
      }
      saveOverlayCtx.restore();
    });

    ctx.drawImage(saveOverlay, 0, 0, composed.width, composed.height);

    if (eraseStrokes.length > 0 && selectedImage.original_thumbnail) {
      const originalImage = await loadCanvasImage(selectedImage.original_thumbnail);
      const maskLayer = document.createElement('canvas');
      maskLayer.width = composed.width;
      maskLayer.height = composed.height;
      const maskCtx = maskLayer.getContext('2d');
      const restoreLayer = document.createElement('canvas');
      restoreLayer.width = composed.width;
      restoreLayer.height = composed.height;
      const restoreCtx = restoreLayer.getContext('2d');
      if (maskCtx && restoreCtx) {
        eraseStrokes.forEach(stroke => {
          const maskLayer = createStrokeMaskLayer(stroke, composed.width, composed.height, settings.runConfig.edge_blur);
          if (maskLayer) maskCtx.drawImage(maskLayer, 0, 0);
        });
        restoreCtx.drawImage(originalImage, 0, 0, restoreLayer.width, restoreLayer.height);
        restoreCtx.globalCompositeOperation = 'destination-in';
        restoreCtx.drawImage(maskLayer, 0, 0);
        ctx.drawImage(restoreLayer, 0, 0);
      }
    }

    return composed.toDataURL('image/png');
  };

  async function persistImageDataUrl(
    edited: string,
    options: { clearWorkingState?: boolean } = {}
  ) {
    if (!selectedImage) return false;
    const previousImageDataUrl = currentCommittedImageDataUrl();
    committedImageDataUrlRef.current = edited;
    setLocalDisplayImageDataUrl(edited);
    if (options.clearWorkingState) {
      setStrokes([]);
      setDetectedRegions([]);
    }
    if (isSavingEditRef.current) {
      pendingImageSaveRef.current = {
        edited,
        clearWorkingState: options.clearWorkingState
      };
      return true;
    }
    isSavingEditRef.current = true;
    try {
      const saved = await safeSaveEdit(selectedImage.id, edited);
      if (!saved) {
        if (committedImageDataUrlRef.current === edited) {
          committedImageDataUrlRef.current = previousImageDataUrl;
          setLocalDisplayImageDataUrl(previousImageDataUrl);
        }
        return false;
      }
      return true;
    } finally {
      isSavingEditRef.current = false;
      const pending = pendingImageSaveRef.current;
      if (pending) {
        pendingImageSaveRef.current = null;
        void persistImageDataUrl(pending.edited, { clearWorkingState: pending.clearWorkingState });
      }
    }
  }

  async function persistCanvasState(
    regions: DetectedRegion[],
    strokeItems: Stroke[],
    options: { clearWorkingState?: boolean; baseThumbnailSrc?: string } = {}
  ) {
    const edited = await buildEditedDataUrl(regions, strokeItems, options.baseThumbnailSrc);
    if (!edited) return false;
    return await persistImageDataUrl(edited, { clearWorkingState: options.clearWorkingState });
  }

  async function handleSave() {
    if (!selectedImage) return;
    await persistCanvasState(detectedRegions, strokes, { clearWorkingState: true });
  }

  const handleBaseImageLoad = () => {
    drawCanvas();
    if (sfwMode || isPreviewingOriginal) return;
    const snapshot = captureDisplayedImageDataUrl();
    if (snapshot) committedImageDataUrlRef.current = snapshot;
  };



  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!selectedImage) return;
    e.preventDefault();
    if (e.altKey) {
      if (activeTool === 'emoji') {
        const delta = e.deltaY < 0 ? 5 : -5;
        updateUiPrefs({ stampAngle: (emojiAngle + delta + 360) % 360 });
        return;
      }
      return;
    }
    if (!e.ctrlKey) {
      const delta = e.deltaY < 0 ? 2 : -2;
      updateRunConfig({
        brush_size: Math.max(MIN_BRUSH_SIZE, Math.min(MAX_BRUSH_SIZE, settings.runConfig.brush_size + delta))
      });
      return;
    }
    const zoomIntensity = 0.08;
    const delta = e.deltaY < 0 ? 1 : -1;
    setZoom(z => Math.max(MIN_WHEEL_ZOOM, Math.min(WHEEL_ZOOM_MAX, parseFloat((z + delta * zoomIntensity).toFixed(2)))));
  };

  const displayedImageSrc = selectedImage && sfwMode
    ? createSfwPlaceholderDataUrl(strings.sfwPlaceholderTitle)
    : selectedImage && isPreviewingOriginal
      ? selectedImage.original_thumbnail || selectedImage.thumbnail
    : selectedImage && settings.uiPrefs.quickMask && activeExistingCensorMask
      ? selectedImage.original_thumbnail || selectedImage.thumbnail
      : localDisplayImageDataUrl || selectedImage?.thumbnail;

  const cursorCanvasWidth = canvasSize.width || 1;
  const cursorCanvasHeight = canvasSize.height || 1;
  const cursorBrushSize = Math.max(MIN_BRUSH_SIZE, Math.round(settings.runConfig.brush_size * cursorPressureScale));
  const cursorLeftPercent = (cursorPos.x / cursorCanvasWidth) * 100;
  const cursorTopPercent = (cursorPos.y / cursorCanvasHeight) * 100;
  const cursorWidthPercent = (cursorBrushSize / cursorCanvasWidth) * 100;
  const cursorHeightPercent = (cursorBrushSize / cursorCanvasHeight) * 100;
  const lastStroke = strokes[strokes.length - 1];
  const lastStrokeSizes = lastStroke
    ? lastStroke.points.map(point => Math.max(MIN_BRUSH_SIZE, Math.round(point.size || lastStroke.size))).join(',')
    : '';

  return (
    <main className="center-canvas">
      {/* Floating Toolbar Controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        padding: '8px 16px',
        backgroundColor: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        zIndex: 5,
        minWidth: 0,
        overflow: 'hidden'
      }}>
        {/* Tool selectors */}
        <button data-action="cancel-canvas" onClick={handleCancelCanvas} style={{ display: 'none' }} aria-hidden="true" />
        <div style={{ display: 'flex', gap: '4px', minWidth: 0, flexShrink: 1 }}>
          <button
            className={activeTool === 'brush' ? 'primary' : ''}
            onClick={() => selectTool('brush')}
            disabled={!selectedImage}
            data-action="tool-brush"
            title={toolLabels.brush}
          >
            <Paintbrush size={14} />
            {settings.uiPrefs.showToolbarButtons && <span>{toolLabels.brush}</span>}
          </button>
          <button
            className={activeTool === 'eraser' ? 'primary' : ''}
            onClick={() => selectTool('eraser')}
            disabled={!selectedImage}
            data-action="tool-eraser"
            title={toolLabels.eraser}
          >
            <Eraser size={14} />
            {settings.uiPrefs.showToolbarButtons && <span>{toolLabels.eraser}</span>}
          </button>
          <button
            className={activeTool === 'region' ? 'primary' : ''}
            onClick={() => selectTool('region')}
            disabled={!selectedImage}
            data-action="tool-region"
            title={toolLabels.region}
          >
            <Scan size={14} />
            {settings.uiPrefs.showToolbarButtons && <span>{toolLabels.region}</span>}
          </button>
          <button
            className={activeTool === 'emoji' ? 'primary' : ''}
            onClick={() => selectTool('emoji')}
            disabled={!selectedImage}
            data-action="tool-emoji"
            title={toolLabels.stamp}
          >
            <Smile size={14} />
            {settings.uiPrefs.showToolbarButtons && <span>{toolLabels.stamp}</span>}
          </button>
        </div>

        {/* Undo/Redo & Utility Actions */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
          <button onClick={handleUndo} disabled={undoStack.length === 0} data-action="undo" title={strings.undo}>
            <Undo2 size={14} />
          </button>
          <button onClick={handleRedo} disabled={redoStack.length === 0} data-action="redo" title={strings.redo}>
            <Redo2 size={14} />
          </button>
          
          <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--color-border)', margin: '0 4px' }} />

          {/* Hold to Preview Original Button */}
          <button
            onMouseDown={() => {
              if (!sfwMode) setPreviewOriginal(true);
            }}
            onMouseUp={() => setPreviewOriginal(false)}
            onMouseLeave={() => setPreviewOriginal(false)}
            disabled={!selectedImage || sfwMode}
            data-action="preview-original"
            title={sfwMode ? strings.previewOriginalDisabledSfw : strings.previewOriginal}
            style={{ cursor: 'pointer' }}
          >
            <Eye size={14} />
          </button>

          <button onClick={handleReset} disabled={!canResetCurrentImage} data-action="reset-image" title={strings.resetImage}>
            <RefreshCcw size={14} />
          </button>

          <button onClick={handleRestoreFromOriginal} disabled={!selectedImage || (!manualBackupImage && !selectedImage.original_thumbnail)} data-action="restore-original" title={strings.restoreFromOriginal}>
            <RotateCcw size={14} />
          </button>

          <button
            onClick={() => updateUiPrefs({ quickMask: !settings.uiPrefs.quickMask })}
            disabled={!selectedImage}
            className={settings.uiPrefs.quickMask ? 'primary' : ''}
            data-action="toggle-quickmask"
            title={strings.quickMask}
          >
            <VenetianMask size={14} />
          </button>

        </div>
      </div>

      {activeTool === 'emoji' && selectedImage && (
        <div style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          padding: '6px 16px',
          backgroundColor: 'var(--color-background)',
          borderBottom: '1px solid var(--color-border)',
          minWidth: 0,
          overflowX: 'auto'
        }}>
          <select
            value={STAMP_PRESETS.some((preset) => preset.value === emojiChar) ? emojiChar : '__custom__'}
            onChange={(e) => {
              if (e.target.value === '__custom__') return;
              updateUiPrefs({ stampEmoji: e.target.value });
            }}
            data-action="stamp-preset"
            aria-label={strings.emojiTool}
            style={{ height: '28px', minWidth: '104px', fontSize: '13px' }}
          >
            {STAMP_PRESETS.map((preset) => (
              <option key={`${preset.value}:${preset.name}`} value={preset.value}>
                {preset.value} {preset.name}
              </option>
            ))}
            <option value="__custom__">custom</option>
          </select>
          <input
            value={emojiChar}
            onChange={(e) => {
              const nextEmoji = Array.from(e.target.value).slice(0, 2).join('');
              updateUiPrefs({ stampEmoji: nextEmoji || '❤️' });
            }}
            style={{ width: '48px', textAlign: 'center', height: '28px', fontSize: '16px' }}
            aria-label={strings.emojiTool}
            data-action="stamp-custom-input"
          />
          <input
            type="color"
            value={emojiColor}
            onChange={(e) => updateUiPrefs({ stampColor: e.target.value })}
            style={{ width: '34px', height: '28px', border: 'none', background: 'transparent' }}
            aria-label={strings.solidColorHex}
            data-action="stamp-color"
          />
          <button
            onClick={() => updateUiPrefs({ stampAngle: (emojiAngle + 355) % 360 })}
            data-action="stamp-rotate-ccw"
            title={strings.rotateStampCounterClockwise}
          >
            <RotateCcw size={14} />
          </button>
          <span data-stamp-angle="true" style={{ fontSize: '11px', minWidth: '34px', textAlign: 'center', color: 'var(--color-mutedText)' }}>
            {emojiAngle}°
          </span>
          <button
            onClick={() => updateUiPrefs({ stampAngle: (emojiAngle + 5) % 360 })}
            data-action="stamp-rotate-cw"
            title={strings.rotateStampClockwise}
          >
            <RotateCw size={14} />
          </button>
        </div>
      )}

      {/* Main Viewport Container */}
      <div 
        ref={containerRef}
        data-canvas-viewport="true"
        onWheel={handleWheel}
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          backgroundImage: 'var(--canvas-grid)',
          backgroundSize: '16px 16px',
          position: 'relative'
        }}
      >
        {selectedImage ? (
          <div 
            style={{ 
              position: 'relative', 
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: isPanning ? 'none' : 'transform 0.15s ease-out',
              boxShadow: 'var(--shadow-lg)',
              borderRadius: '6px',
              overflow: 'hidden'
            }}
          >
              {/* The base Image */}
            <img
              ref={imageRef}
              src={sfwMode ? TRANSPARENT_PIXEL_DATA_URL : displayedImageSrc || ''}
              crossOrigin="anonymous"
              alt={sfwMode ? '' : protectedUi ? strings.sfwPlaceholderTitle : selectedImage.filename}
              aria-hidden={sfwMode ? true : undefined}
              onLoad={handleBaseImageLoad}
              style={{
                display: 'block',
                maxWidth: '100%',
                maxHeight: '70vh',
                pointerEvents: 'none',
                opacity: 1,
                filter: 'none'
              }}
            />

            {/* Overlaid drawing/mask Canvas */}
            <canvas
              ref={canvasRef}
              data-active-tool={protectedUi ? undefined : activeTool}
              data-stroke-count={protectedUi ? undefined : strokes.length}
              data-undo-depth={protectedUi ? undefined : undoStack.length}
              data-redo-depth={protectedUi ? undefined : redoStack.length}
              data-brush-size={protectedUi ? undefined : settings.runConfig.brush_size}
              data-last-stroke-sizes={protectedUi ? undefined : lastStrokeSizes}
              data-last-stroke-point-count={protectedUi ? undefined : lastStroke?.points.length || 0}
              data-erase-count={protectedUi ? undefined : strokes.filter(stroke => stroke.mode === 'erase').length}
              data-region-count={protectedUi ? undefined : detectedRegions.length}
              data-region-selection-active={protectedUi ? undefined : String(regionSelectionActive)}
              data-quick-mask={protectedUi ? undefined : String(settings.uiPrefs.quickMask)}
              data-existing-censor-mask={protectedUi ? undefined : String(Boolean(activeExistingCensorMask))}
              data-existing-censor-pixels={protectedUi ? undefined : activeExistingCensorMask?.pixelCount || 0}
              data-preview-original={String(previewOriginal && !sfwMode)}
              data-sfw-mode={String(sfwMode)}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onContextMenu={(e) => e.preventDefault()}
              onMouseEnter={() => setShowCursorCircle(true)}
              onMouseLeave={() => {
                setShowCursorCircle(false);
                if (isDrawing || isPanning || isZoomDragging || regionSelectionActive) return;
                handlePointerCancel();
              }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                touchAction: 'none',
                opacity: sfwMode ? 0 : 1,
                cursor: spacePressed 
                  ? (isPanning ? 'grabbing' : 'grab') 
                  : (activeTool === 'region' ? 'crosshair' : activeTool === 'emoji' ? 'copy' : 'none'),
                zIndex: 10
              }}
            />

            {/* Custom drag select rectangle drawing */}
            {regionSelectionActive && dragStart && dragEnd && (
              <div data-evidence="region-selection-rectangle" style={{
                position: 'absolute',
                left: `${Math.min(dragStart.x, dragEnd.x) * 100}%`,
                top: `${Math.min(dragStart.y, dragEnd.y) * 100}%`,
                width: `${Math.abs(dragStart.x - dragEnd.x) * 100}%`,
                height: `${Math.abs(dragStart.y - dragEnd.y) * 100}%`,
                border: '1.5px dashed var(--color-primary)',
                backgroundColor: 'rgba(137, 180, 250, 0.15)',
                pointerEvents: 'none',
                zIndex: 11
              }} />
            )}

            {/* Hover Cursor Circle for Brush size display */}
            {showCursorCircle && activeTool !== 'region' && !spacePressed && (activeTool === 'brush' || activeTool === 'eraser') && (
              <div data-evidence="brush-cursor-preview" style={{
                position: 'absolute',
                left: `${cursorLeftPercent}%`,
                top: `${cursorTopPercent}%`,
                width: `${cursorWidthPercent}%`,
                height: `${cursorHeightPercent}%`,
                borderRadius: '50%',
                border: '1.5px solid var(--color-primary)',
                backgroundColor: activeTool === 'eraser' ? 'rgba(243, 139, 168, 0.15)' : 'rgba(137, 180, 250, 0.25)',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
                zIndex: 12
              }} />
            )}

            {/* SFW mode warning text badge */}
            {sfwMode && (
              <div role="img" aria-label={strings.sfwPlaceholderTitle} style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0,0,0,0.88)',
                color: '#ffffff',
                padding: '20px',
                textAlign: 'center',
                fontSize: '14px',
                fontWeight: 600,
                pointerEvents: 'none',
                zIndex: 20
              }}>
                <Eye size={28} />
                <strong>{strings.sfwPlaceholderTitle}</strong>
                <span>{strings.sfwPlaceholderBody}</span>
                <span style={{ color: '#f8fafc', fontSize: '12px' }}>{strings.sfwActiveMessage}</span>
              </div>
            )}
          </div>
        ) : (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center',
            color: 'var(--color-mutedText)', 
            gap: '12px',
            textAlign: 'center'
          }}>
            <HelpCircle size={48} strokeWidth={1} style={{ color: 'var(--color-border)' }} />
            <p style={{ maxWidth: '300px', fontSize: '13px' }}>{strings.noImageSelected}</p>
          </div>
        )}
      </div>

      {/* Floating Canvas Viewport Tools (Zoom) */}
      {selectedImage && (
        <div style={{
          position: 'absolute',
          bottom: '16px',
          right: '16px',
          display: 'flex',
          gap: '2px',
          backgroundColor: 'var(--color-surface)',
          padding: '4px',
          borderRadius: '8px',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-md)',
          zIndex: 5
        }}>
          <button onClick={() => setZoom(z => Math.max(MIN_WHEEL_ZOOM, z - 0.15))} data-action="zoom-out" style={{ padding: '6px', border: 'none' }} title={strings.zoomOut}>
            <ZoomOut size={14} />
          </button>
          <span data-zoom-label="true" style={{ fontSize: '11px', alignSelf: 'center', padding: '0 8px', minWidth: '42px', textAlign: 'center', fontWeight: 'bold' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => setZoom(z => Math.min(WHEEL_ZOOM_MAX, z + 0.15))} data-action="zoom-in" style={{ padding: '6px', border: 'none' }} title={strings.zoomInCanvas}>
            <ZoomIn size={14} />
          </button>
          <button onClick={resetViewport} data-action="zoom-reset" style={{ padding: '6px', border: 'none' }} title={strings.zoomReset}>
            <Maximize size={14} />
          </button>
        </div>
      )}
      {selectedImage && (
        <div className="canvas-help-chip">
          {strings.zoomPanHint}
        </div>
      )}
    </main>
  );
};
