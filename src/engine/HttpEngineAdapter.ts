import {
  BatchStartOptions,
  EngineAdapter,
  ImageItem,
  ModelState,
  OpenPathResult,
  ProgressState,
  RegionRequest,
  RegionResult,
  RunConfig
} from './EngineAdapter';
import { backendBaseUrl, normalizeBackendBaseUrl } from './backendUrl';

type DesktopBridgeWindow = Window & {
  pywebview?: {
    api?: {
      pick_folder?: (initialDir: string) => Promise<DesktopPickerResult> | DesktopPickerResult;
      pick_model_file?: (initialPath: string) => Promise<DesktopPickerResult> | DesktopPickerResult;
      open_path?: (path: string) => Promise<OpenPathResult | boolean | null>;
    };
  };
};

type DesktopPickerResult = string | {
  ok?: boolean;
  path?: string;
  error?: string;
  cancelled?: boolean;
} | null;

type BackendStatus = {
  running: boolean;
  finished: boolean;
  progress: ProgressState;
  images: ImageItem[];
  model_state: ModelState;
  batch_context?: ProgressState['batch_context'];
  error?: string | null;
};

const toAbsoluteUrl = (baseUrl: string, value: string): string => {
  if (!value || value.startsWith('data:')) {
    return value;
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const allowedOrigin = new URL(baseUrl || window.location.origin, window.location.origin).origin;
      return new URL(value).origin === allowedOrigin ? value : '';
    } catch {
      return '';
    }
  }
  return `${baseUrl}${value.startsWith('/') ? value : `/${value}`}`;
};

export class HttpEngineAdapter extends EngineAdapter {
  private readonly baseUrl: string;
  private pollTimer: number | null = null;
  private currentConfig: RunConfig | null = null;
  private runFinishedEmitted = false;

  constructor(baseUrl = backendBaseUrl) {
    super();
    this.baseUrl = normalizeBackendBaseUrl(baseUrl);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {})
      }
    });

    let payload: unknown = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
    }

    if (!response.ok) {
      const message = typeof payload === 'object' && payload && 'error' in payload
        ? String((payload as { error?: unknown }).error)
        : response.statusText;
      throw new Error(message);
    }

    return payload as T;
  }

  private mapImages(images: ImageItem[]): ImageItem[] {
    return images.map((image) => ({
      ...image,
      thumbnail: toAbsoluteUrl(this.baseUrl, image.thumbnail),
      original_thumbnail: image.original_thumbnail ? toAbsoluteUrl(this.baseUrl, image.original_thumbnail) : undefined
    }));
  }

  private emitStatus(status: BackendStatus): void {
    if (status.model_state) {
      this.emit('model_state_changed', status.model_state);
    }
    if (status.progress) {
      this.emit('progress_changed', {
        ...status.progress,
        batch_context: status.batch_context || status.progress.batch_context
      });
    }
    if (status.images) {
      this.mapImages(status.images).forEach((image) => this.emit('image_processed', image));
    }
    if (status.error) {
      this.emit('warning', status.error);
    }
    if (status.finished && !status.running && !this.runFinishedEmitted) {
      this.runFinishedEmitted = true;
      const progress = status.progress || { total: 0, processed: 0 };
      const message = String(progress.message || '');
      const total = Number(progress.total || 0);
      const processed = Number(progress.processed || 0);
      const stopped = /stopped|cancel/i.test(message) || (total > 0 && processed < total);
      this.stopPolling();
      this.emit('run_finished', {
        total,
        processed,
        duration: Number(progress.duration_seconds || 0),
        stopped,
        message
      });
    }
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private schedulePoll(): void {
    this.stopPolling();
    this.pollTimer = window.setTimeout(async () => {
      try {
        const status = await this.request<{ ok: boolean } & BackendStatus>('/api/batch/status');
        this.emitStatus(status);
        if (status.running) {
          this.schedulePoll();
        }
      } catch (error) {
        this.stopPolling();
        this.emit('error', error instanceof Error ? error.message : String(error));
      }
    }, 500);
  }

  async scanImages(inputDir: string, config?: RunConfig): Promise<ImageItem[]> {
    try {
      const payload = await this.request<{ ok: boolean; images: ImageItem[]; progress: ProgressState }>('/api/scan', {
        method: 'POST',
        body: JSON.stringify({ input_dir: inputDir, recursive: true, config: config || this.currentConfig })
      });
      return this.mapImages(payload.images || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('error', message);
      throw error;
    }
  }

  async pickInputFolder(initialDir = ''): Promise<string | null> {
    try {
      const selected = await this.request<DesktopPickerResult>('/api/desktop/picker', {
        method: 'POST',
        body: JSON.stringify({ action: 'pick-folder', initial_dir: initialDir })
      });
      return this.normalizePickerResult(selected, 'Folder picker failed');
    } catch {
      const bridge = (window as DesktopBridgeWindow).pywebview?.api?.pick_folder;
      if (typeof bridge === 'function') {
        const selected = await bridge(initialDir);
        return this.normalizePickerResult(selected, 'Folder picker failed');
      }
      this.emit('warning', 'Native folder picker is available in the desktop app. In server/browser mode, type a server-visible path and press Scan.');
    }
    return null;
  }

  async pickModelFile(initialPath = ''): Promise<string | null> {
    try {
      const selected = await this.request<DesktopPickerResult>('/api/desktop/picker', {
        method: 'POST',
        body: JSON.stringify({ action: 'pick-model-file', initial_path: initialPath })
      });
      return this.normalizePickerResult(selected, 'Model file picker failed');
    } catch {
      const bridge = (window as DesktopBridgeWindow).pywebview?.api?.pick_model_file;
      if (typeof bridge === 'function') {
        const selected = await bridge(initialPath);
        return this.normalizePickerResult(selected, 'Model file picker failed');
      }
      this.emit('warning', 'Native model picker is available in the desktop app. In server/browser mode, type a server-visible model path in Settings.');
    }
    return null;
  }

  private normalizePickerResult(result: DesktopPickerResult, fallbackError: string): string | null {
    if (typeof result === 'string') {
      return result.trim() ? result : null;
    }
    if (!result || result.cancelled) {
      return null;
    }
    if (typeof result.path === 'string' && result.path.trim()) {
      return result.path;
    }
    if (result.error) {
      const message = `${fallbackError}: ${result.error}`;
      this.emit('error', message);
      throw new Error(message);
    }
    return null;
  }

  async openPath(path: string): Promise<OpenPathResult> {
    try {
      const result = await this.request<OpenPathResult>('/api/desktop/open-path', {
        method: 'POST',
        body: JSON.stringify({ path })
      });
      if (result && result.ok) {
        return {
          ok: true,
          path: result.path || path,
          opened_path: result.opened_path || result.path || path,
          opened_parent: Boolean(result.opened_parent),
          missing_target: Boolean(result.missing_target)
        };
      }
    } catch {
      const bridge = (window as DesktopBridgeWindow).pywebview?.api?.open_path;
      if (typeof bridge === 'function') {
        const result = await bridge(path);
        if (result === true) return { ok: true, path, opened_path: path };
        if (result && typeof result === 'object' && result.ok) {
          return {
            ok: true,
            path: result.path || path,
            opened_path: result.opened_path || result.path || path,
            opened_parent: Boolean(result.opened_parent),
            missing_target: Boolean(result.missing_target)
          };
        }
        const error = result && typeof result === 'object' && result.error ? result.error : 'Failed to open path';
        this.emit('warning', String(error));
        return { ok: false, error: String(error), path };
      }
      this.emit('warning', 'Open output folder is available in the desktop app. In server/browser mode, open the server-visible output path manually.');
    }
    return { ok: false, error: 'desktop bridge unavailable', path };
  }

  async loadModel(modelPath: string, config: RunConfig): Promise<void> {
    this.currentConfig = config;
    this.emit('model_state_changed', {
      loaded: false,
      loading: true,
      model_name: modelPath.trim() || 'models/autocensor_model.pt',
      devices: ['CPU', 'CUDA'],
      cpu_workers: config.worker_config.cpu_workers,
      gpu_workers: config.worker_config.gpu_workers,
      memory_summary: 'Loading model'
    });

    try {
      const payload = await this.request<{ ok: boolean; model_state: ModelState }>('/api/model/load', {
        method: 'POST',
        body: JSON.stringify({ model_path: modelPath, config })
      });
      this.emit('model_state_changed', payload.model_state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('model_state_changed', {
        loaded: false,
        loading: false,
        model_name: modelPath.trim() || 'models/autocensor_model.pt',
        devices: ['CPU', 'CUDA'],
        cpu_workers: config.worker_config.cpu_workers,
        gpu_workers: config.worker_config.gpu_workers,
        memory_summary: 'Model load failed',
        error: message
      });
      this.emit('error', message);
    }
  }

  async unloadModel(): Promise<void> {
    try {
      const payload = await this.request<{ ok: boolean; model_state: ModelState }>('/api/model/unload', {
        method: 'POST',
        body: JSON.stringify({})
      });
      this.emit('model_state_changed', payload.model_state);
    } catch (error) {
      this.emit('error', error instanceof Error ? error.message : String(error));
    }
  }

  async startBatch(images: ImageItem[], config: RunConfig, options: BatchStartOptions = {}): Promise<void> {
    this.currentConfig = config;
    this.runFinishedEmitted = false;
    try {
      const payload = await this.request<{ ok: boolean } & BackendStatus>('/api/batch/start', {
        method: 'POST',
        body: JSON.stringify({
          image_ids: images.map((image) => image.id),
          image_statuses: images.map((image) => ({ id: image.id, status: image.status })),
          config,
          force_reprocess: options.forceReprocess === true
        })
      });
      this.emitStatus(payload);
      this.schedulePoll();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('error', message);
      throw error;
    }
  }

  async stopBatch(): Promise<void> {
    try {
      const payload = await this.request<{ ok: boolean } & BackendStatus>('/api/batch/stop', {
        method: 'POST',
        body: JSON.stringify({})
      });
      this.emitStatus(payload);
      if (payload.running) {
        this.schedulePoll();
      }
    } catch (error) {
      this.emit('error', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async detectRegion(request: RegionRequest): Promise<RegionResult> {
    try {
      const payload = await this.request<{ ok: boolean } & RegionResult>('/api/region/detect', {
        method: 'POST',
        body: JSON.stringify(request)
      });
      const result = {
        masks: payload.masks || [],
        message: payload.message,
        error: payload.error
      };
      this.emit('region_detected', result);
      return result;
    } catch (error) {
      const result = {
        masks: [],
        error: error instanceof Error ? error.message : String(error)
      };
      this.emit('region_detected', result);
      this.emit('error', result.error);
      return result;
    }
  }

  async saveManualEdit(imageId: string, editedImage: string, config?: RunConfig): Promise<ImageItem | null> {
    try {
      const payload = await this.request<{ ok: boolean; image: ImageItem }>('/api/manual/save', {
        method: 'POST',
        body: JSON.stringify({
          image_id: imageId,
          edited_image: editedImage,
          config: config || this.currentConfig
        })
      });
      const image = this.mapImages([payload.image])[0];
      this.emit('image_processed', image);
      return image;
    } catch (error) {
      this.emit('error', error instanceof Error ? error.message : String(error));
      return null;
    }
  }
}
