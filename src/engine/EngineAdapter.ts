export interface ImageItem {
  id: string;
  path: string;
  filename: string;
  status: 'pending' | 'processing' | 'censored' | 'clean' | 'failed';
  thumbnail: string; // URL or Base64 string
  original_thumbnail?: string;
  result_path?: string;
  restored?: boolean;
  warnings?: string[];
}

export interface ModelState {
  loaded: boolean;
  loading: boolean;
  model_name: string;
  devices: string[];
  cpu_workers: number;
  gpu_workers: number;
  memory_summary: string;
  worker_summary?: Record<string, unknown>;
  error?: string;
}

export interface RuntimeBatchContext {
  endpoint?: string;
  real_backend_batch_path?: boolean;
  requested_image_count?: number;
  selected_image_count?: number;
  selected_image_ids?: string[];
  processable_image_count?: number;
  processable_image_ids?: string[];
  skipped_completed_count?: number;
  skipped_completed_image_ids?: string[];
  force_reprocess?: boolean;
  skip_completed?: boolean;
  single_image_batch?: boolean;
  requested_worker_config?: Record<string, unknown>;
  applied_worker_config?: Record<string, unknown>;
  runtime_settings?: Record<string, unknown>;
  output_dir_count?: number;
  duration_seconds?: number;
  processed?: number;
}

export interface RunConfig {
  input_dir: string;
  output_dirs: string[];
  output_suffix: string;
  target_mode: 'selected' | 'all';
  targets: string[];
  threshold: number; // 0 to 1
  imgsz: number; // model inference image size
  censor_mode: 'solid' | 'blackwhite' | 'mosaic' | 'blur';
  fill_color: string; // hex
  opacity: number; // 0 to 1
  brush_size: number; // brush diameter in pixels (5-400)
  brush_hardness: number; // brush hardness 0.0-1.0
  mosaic_block: number; // in pixels
  blur_radius: number; // in pixels
  edge_blur: number; // in pixels
  supersample: boolean;
  postprocess_enabled: boolean;
  output_format: 'original' | 'jpeg' | 'png' | 'webp' | 'bmp';
  quality: number; // 1 to 100
  preserve_exif: boolean;
  device_mode: 'auto' | 'cpu' | 'cuda' | 'hybrid';
  region_device_mode?: 'auto' | 'cpu' | 'cuda' | 'hybrid';
  selection_region_mode: 'model' | 'selection';
  worker_config: {
    gpu_workers: number;
    cpu_workers: number;
    cpu_threads: number;
    save_threads: number;
    postprocess_workers: number;
    batch_size: number;
  };
}

export interface BatchStartOptions {
  forceReprocess?: boolean;
}

export interface OpenPathResult {
  ok: boolean;
  error?: string;
  path?: string;
  opened_path?: string;
  opened_parent?: boolean;
  missing_target?: boolean;
}

export interface ProgressState {
  total: number;
  processed: number;
  censored: number;
  clean: number;
  failed: number;
  restored?: number;
  eta_text: string;
  current_file?: string;
  message?: string;
  throughput_text?: string;
  duration_seconds?: number;
  batch_context?: RuntimeBatchContext;
}

export interface RunFinishedSummary {
  total: number;
  processed: number;
  duration: number;
  stopped?: boolean;
  message?: string;
}

export interface RegionRequest {
  image_id: string;
  image_path: string;
  normalized_rect: { x: number; y: number; w: number; h: number };
  threshold: number;
  target_mode: RunConfig['target_mode'];
  targets: string[];
  device: string;
  config?: RunConfig;
}

export interface RegionMask {
  label: string;
  confidence: number;
  box: { x: number; y: number; w: number; h: number };
  mask?: string;
  source?: string;
}

export interface RegionResult {
  masks: RegionMask[];
  message?: string;
  error?: string;
}

export interface EngineEventMap {
  images_scanned: (images: ImageItem[]) => void;
  model_state_changed: (state: ModelState) => void;
  progress_changed: (progress: ProgressState) => void;
  image_processed: (image: ImageItem) => void;
  region_detected: (result: RegionResult) => void;
  warning: (message: string) => void;
  error: (message: string) => void;
  run_finished: (summary: RunFinishedSummary) => void;
}

type StoredListener = (...args: never[]) => void;

export abstract class EngineAdapter {
  protected listeners: Partial<Record<keyof EngineEventMap, StoredListener[]>> = {};

  on<K extends keyof EngineEventMap>(event: K, listener: EngineEventMap[K]): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(listener as unknown as StoredListener);
  }

  off<K extends keyof EngineEventMap>(event: K, listener: EngineEventMap[K]): void {
    if (!this.listeners[event]) return;
    const stored = listener as unknown as StoredListener;
    this.listeners[event] = this.listeners[event]!.filter(l => l !== stored);
  }

  protected emit<K extends keyof EngineEventMap>(event: K, ...args: Parameters<EngineEventMap[K]>): void {
    const bucket = this.listeners[event] as Array<(...args: Parameters<EngineEventMap[K]>) => void> | undefined;
    if (!bucket) return;
    bucket.forEach(listener => {
      listener(...args);
    });
  }

  abstract scanImages(inputDir: string, config?: RunConfig): Promise<ImageItem[]>;
  abstract pickInputFolder(initialDir?: string): Promise<string | null>;
  abstract pickModelFile(initialPath?: string): Promise<string | null>;
  abstract openPath(path: string): Promise<OpenPathResult>;
  abstract loadModel(modelPath: string, config: RunConfig): Promise<void>;
  abstract unloadModel(): Promise<void>;
  abstract startBatch(images: ImageItem[], config: RunConfig, options?: BatchStartOptions): Promise<void>;
  abstract stopBatch(): Promise<void>;
  abstract detectRegion(request: RegionRequest): Promise<RegionResult>;
  abstract saveManualEdit(imageId: string, editedImage: string, config?: RunConfig): Promise<ImageItem | null>;
}
