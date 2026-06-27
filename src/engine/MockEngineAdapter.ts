import {
  BatchStartOptions,
  EngineAdapter,
  ImageItem,
  ModelState,
  OpenPathResult,
  RunConfig,
  ProgressState,
  RegionRequest,
  RegionResult
} from './EngineAdapter';

// Helper to generate mock SVG images as DataURLs
export function createMockSvgDataUrl(type: string, title: string, censored: boolean = false): string {
  let innerContent: string;
  const bgColor = '#1e1e2e';
  
  if (type === 'license') {
    innerContent = `
      <!-- Car body -->
      <rect x="50" y="100" width="300" height="120" rx="20" fill="#89b4fa" />
      <rect x="80" y="60" width="240" height="60" rx="10" fill="#a6adc8" />
      <!-- Wheels -->
      <circle cx="100" cy="220" r="30" fill="#11111b" />
      <circle cx="300" cy="220" r="30" fill="#11111b" />
      <!-- License Plate -->
      <g id="target-license">
        <rect x="160" y="150" width="80" height="25" rx="3" fill="#f9e2af" stroke="#f38ba8" stroke-width="1.5" />
        <text x="200" y="167" font-family="monospace" font-size="12" fill="#11111b" text-anchor="middle" font-weight="bold">SAMPLE 00-000</text>
      </g>
    `;
  } else if (type === 'sample') {
    innerContent = `
      <rect x="50" y="40" width="300" height="220" rx="10" fill="#313244" stroke="#45475a" stroke-width="2" />
      <circle cx="130" cy="125" r="34" fill="#89b4fa" opacity="0.9" />
      <rect x="188" y="92" width="110" height="18" rx="5" fill="#a6e3a1" opacity="0.55" />
      <rect x="188" y="124" width="136" height="18" rx="5" fill="#f9e2af" opacity="0.5" />
      <rect x="188" y="156" width="92" height="18" rx="5" fill="#cba6f7" opacity="0.5" />
      <text x="200" y="222" font-family="sans-serif" font-size="14" fill="#cdd6f4" text-anchor="middle" font-weight="bold">${title}</text>
    `;
  } else if (type === 'id') {
    innerContent = `
      <!-- Card background -->
      <rect x="40" y="50" width="320" height="200" rx="12" fill="#313244" stroke="#45475a" stroke-width="2" />
      <!-- Header -->
      <text x="200" y="75" font-family="sans-serif" font-size="14" fill="#cdd6f4" text-anchor="middle" font-weight="bold">IDENTIFICATION CARD</text>
      <!-- Portrait -->
      <g id="target-face">
        <rect x="60" y="90" width="80" height="100" rx="6" fill="#45475a" stroke="#f38ba8" stroke-width="1.5" />
        <circle cx="100" cy="125" r="22" fill="#fab387" />
        <path d="M75,175 C75,150 125,150 125,175 Z" fill="#89b4fa" />
      </g>
      <!-- Text details -->
      <g id="target-text">
        <rect x="160" y="100" width="180" height="10" rx="2" fill="#f38ba8" opacity="0.3" />
        <text x="160" y="110" font-family="sans-serif" font-size="10" fill="#a6adc8">Name: SAMPLE</text>
        <rect x="160" y="125" width="180" height="10" rx="2" fill="#f38ba8" opacity="0.3" />
        <text x="160" y="135" font-family="sans-serif" font-size="10" fill="#a6adc8">ID: SAMPLE-ID</text>
        <text x="160" y="160" font-family="sans-serif" font-size="9" fill="#585b70">Issued: 2024.05.10</text>
      </g>
    `;
  } else if (type === 'cctv') {
    innerContent = `
      <!-- Street background -->
      <path d="M0,250 L400,250 M150,250 L150,0 M250,250 L250,0" stroke="#585b70" stroke-width="2" />
      <!-- Buildings -->
      <rect x="0" y="50" width="110" height="200" fill="#1e1e2e" stroke="#313244" />
      <rect x="290" y="30" width="110" height="220" fill="#1e1e2e" stroke="#313244" />
      <!-- People -->
      <g id="target-face-1">
        <circle cx="160" cy="180" r="8" fill="#fab387" stroke="#f38ba8" stroke-width="1" />
        <rect x="150" y="190" width="20" height="40" rx="4" fill="#a6e3a1" />
      </g>
      <g id="target-face-2">
        <circle cx="230" cy="170" r="7" fill="#fab387" stroke="#f38ba8" stroke-width="1" />
        <rect x="222" y="179" width="16" height="35" rx="4" fill="#cba6f7" />
      </g>
      <!-- Camera details overlay -->
      <text x="20" y="30" font-family="monospace" font-size="11" fill="#a6e3a1">REC [CAMERA]</text>
      <text x="320" y="30" font-family="monospace" font-size="11" fill="#cdd6f4">23:07:05</text>
    `;
  } else {
    // Standard Document Text
    innerContent = `
      <!-- Paper background -->
      <rect x="50" y="30" width="300" height="240" rx="4" fill="#313244" stroke="#45475a" />
      <!-- Document Header -->
      <text x="200" y="60" font-family="sans-serif" font-size="14" fill="#cdd6f4" text-anchor="middle" font-weight="bold">CONFIDENTIAL CONTRACT</text>
      <!-- Paragraph lines -->
      <g id="target-text-1">
        <line x1="70" y1="90" x2="330" y2="90" stroke="#f38ba8" stroke-width="8" stroke-linecap="round" opacity="0.3" />
        <line x1="70" y1="110" x2="300" y2="110" stroke="#f38ba8" stroke-width="8" stroke-linecap="round" opacity="0.3" />
      </g>
      <line x1="70" y1="140" x2="330" y2="140" stroke="#585b70" stroke-width="6" stroke-linecap="round" />
      <line x1="70" y1="160" x2="280" y2="160" stroke="#585b70" stroke-width="6" stroke-linecap="round" />
      <g id="target-text-2">
        <line x1="70" y1="190" x2="310" y2="190" stroke="#f38ba8" stroke-width="8" stroke-linecap="round" opacity="0.3" />
      </g>
      <!-- Stamp signature -->
      <g id="target-stamp">
        <circle cx="300" cy="220" r="18" fill="none" stroke="#f38ba8" stroke-width="1.5" stroke-dasharray="3,3" />
        <text x="300" y="224" font-family="sans-serif" font-size="8" fill="#f38ba8" text-anchor="middle">OFFICIAL</text>
      </g>
    `;
  }

  // Mask overlay if censored is true
  let maskOverlay = '';
  if (censored) {
    maskOverlay = `
      <rect x="0" y="0" width="400" height="300" fill="rgba(0,0,0,0.4)" />
      <text x="200" y="150" font-family="sans-serif" font-size="18" fill="#a6e3a1" text-anchor="middle" font-weight="bold">CENSORED</text>
    `;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
      <rect width="400" height="300" fill="${bgColor}" />
      ${innerContent}
      <!-- Border outline -->
      <rect x="2" y="2" width="396" height="296" rx="4" fill="none" stroke="#45475a" stroke-width="2" />
      <!-- Image Title -->
      <rect x="10" y="270" width="150" height="20" rx="3" fill="rgba(17,17,27,0.8)" />
      <text x="15" y="284" font-family="sans-serif" font-size="10" fill="#a6adc8">${title}</text>
      ${maskOverlay}
    </svg>
  `;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export class MockEngineAdapter extends EngineAdapter {
  private modelState: ModelState = {
    loaded: false,
    loading: false,
    model_name: 'compatible-segmentation-model.pt',
    devices: ['CPU', 'CUDA GPU', 'DirectML GPU'],
    cpu_workers: 4,
    gpu_workers: 1,
    memory_summary: 'Model not loaded'
  };

  private activeInterval: boolean | null = null;
  private currentBatchImages: ImageItem[] = [];
  private batchConfig: RunConfig | null = null;
  private progressIndex = 0;
  private startTime = 0;

  async scanImages(inputDir: string, _config?: RunConfig): Promise<ImageItem[]> {
    void _config;
    // Simulate short network/disk read delay
    await new Promise(resolve => setTimeout(resolve, 600));

    if (!inputDir) {
      this.emit('error', 'Input directory path is invalid.');
      throw new Error('Input directory is invalid.');
    }

    const mockImages: ImageItem[] = [
      {
        id: 'img1',
        path: `${inputDir}/sample_001.jpg`,
        filename: 'sample_001.jpg',
        status: 'pending',
        thumbnail: createMockSvgDataUrl('sample', 'sample_001.jpg')
      },
      {
        id: 'img2',
        path: `${inputDir}/sample_002.png`,
        filename: 'sample_002.png',
        status: 'pending',
        thumbnail: createMockSvgDataUrl('sample', 'sample_002.png')
      },
      {
        id: 'img3',
        path: `${inputDir}/sample_003.jpeg`,
        filename: 'sample_003.jpeg',
        status: 'pending',
        thumbnail: createMockSvgDataUrl('sample', 'sample_003.jpeg')
      },
      {
        id: 'img4',
        path: `${inputDir}/sample_004.webp`,
        filename: 'sample_004.webp',
        status: 'pending',
        thumbnail: createMockSvgDataUrl('sample', 'sample_004.webp')
      },
      {
        id: 'img5',
        path: `${inputDir}/sample_005.jpg`,
        filename: 'sample_005.jpg',
        status: 'pending',
        thumbnail: createMockSvgDataUrl('sample', 'sample_005.jpg')
      },
      {
        id: 'img6',
        path: `${inputDir}/sample_006.bmp`,
        filename: 'sample_006.bmp',
        status: 'pending',
        thumbnail: createMockSvgDataUrl('sample', 'sample_006.bmp')
      }
    ];

    const imagesWithOriginals = mockImages.map(image => ({ ...image, original_thumbnail: image.thumbnail }));
    this.emit('images_scanned', imagesWithOriginals);
    return imagesWithOriginals;
  }

  async pickInputFolder(initialDir = ''): Promise<string | null> {
    return initialDir.trim() || 'C:/AutoCensor/sample-input';
  }

  async pickModelFile(initialPath = ''): Promise<string | null> {
    return initialPath.trim() || 'C:/AutoCensor/models/autocensor_model.pt';
  }

  async openPath(path: string): Promise<OpenPathResult> {
    return { ok: true, path, opened_path: path };
  }

  async loadModel(modelPath: string, config: RunConfig): Promise<void> {
    if (this.modelState.loading || this.modelState.loaded) return;

    this.modelState.loading = true;
    this.modelState.error = undefined;
    this.emit('model_state_changed', { ...this.modelState });

    // Simulate 1.5s model load time
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Simulate warning/diagnostics
    if (modelPath.includes('error')) {
      this.modelState.loading = false;
      this.modelState.loaded = false;
      this.modelState.error = 'Failed to load model weights. File signature invalid.';
      this.emit('model_state_changed', { ...this.modelState });
      this.emit('error', 'Model load error: File signature invalid.');
      return;
    }

    this.modelState.loading = false;
    this.modelState.loaded = true;
    const modelFile = modelPath.trim()
      ? modelPath.trim().split(/[\\/]/).pop() || modelPath.trim()
      : 'compatible-segmentation-model.pt';

    this.modelState.model_name = modelFile;
    this.modelState.memory_summary = config.device_mode === 'cuda'
      ? 'GPU acceleration available'
      : config.device_mode === 'hybrid'
        ? 'Hybrid inference active'
        : 'Auto/CPU inference active';
    this.emit('model_state_changed', { ...this.modelState });
    this.emit('warning', 'Model loaded in mock mode. Real inference is not connected in this UI prototype.');
  }

  async unloadModel(): Promise<void> {
    this.modelState.loaded = false;
    this.modelState.loading = false;
    this.modelState.error = undefined;
    this.modelState.memory_summary = 'Model not loaded';
    this.emit('model_state_changed', { ...this.modelState });
  }

  async startBatch(images: ImageItem[], config: RunConfig, options: BatchStartOptions = {}): Promise<void> {
    if (this.activeInterval) return;

    if (!this.modelState.loaded) {
      this.emit('error', 'Model not loaded. Please load the model first.');
      return;
    }

    const skippedCompleted = options.forceReprocess
      ? []
      : images.filter((image) => image.status === 'clean' || image.status === 'censored');
    this.currentBatchImages = options.forceReprocess
      ? [...images]
      : images.filter((image) => image.status !== 'clean' && image.status !== 'censored');
    this.batchConfig = config;
    this.progressIndex = 0;
    this.startTime = Date.now();

    if (this.currentBatchImages.length === 0) {
      const progress: ProgressState = {
        total: 0,
        processed: 0,
        censored: 0,
        clean: 0,
        failed: 0,
        eta_text: '',
        current_file: '',
        message: 'Batch complete - skipped already processed images',
        duration_seconds: 0,
        batch_context: {
          selected_image_count: images.length,
          selected_image_ids: images.map((image) => image.id),
          processable_image_count: 0,
          processable_image_ids: [],
          skipped_completed_count: skippedCompleted.length,
          skipped_completed_image_ids: skippedCompleted.map((image) => image.id),
          force_reprocess: options.forceReprocess === true,
          skip_completed: options.forceReprocess !== true,
          processed: 0
        }
      };
      this.emit('progress_changed', progress);
      this.emit('run_finished', {
        total: 0,
        processed: 0,
        duration: 0,
        message: progress.message
      });
      return;
    }

    // Set first image processing
    const runProcessingStep = () => {
      if (this.progressIndex >= this.currentBatchImages.length) {
        this.stopInterval();
        const duration = (Date.now() - this.startTime) / 1000;
        this.emit('run_finished', {
          total: this.currentBatchImages.length,
          processed: this.progressIndex,
          duration: parseFloat(duration.toFixed(1))
        });
        return;
      }

      const img = this.currentBatchImages[this.progressIndex];
      img.status = 'processing';
      this.emit('image_processed', { ...img });

      // Emit Progress State
      const elapsed = (Date.now() - this.startTime) / 1000;
      const progressPerImg = elapsed / (this.progressIndex + 1);
      const remainingImgs = this.currentBatchImages.length - (this.progressIndex + 1);
      const etaSec = Math.round(remainingImgs * progressPerImg);
      
      const processedCount = this.progressIndex + 1;
      const progress: ProgressState = {
        total: this.currentBatchImages.length,
        processed: processedCount,
        censored: Math.ceil(processedCount * 0.75), // mock censor rate
        clean: Math.floor(processedCount * 0.25),
        failed: 0,
        eta_text: etaSec > 0 ? `${etaSec}s` : '0s',
        current_file: img.filename,
        message: `Processing ${img.filename}...`,
        batch_context: {
          selected_image_count: images.length,
          selected_image_ids: images.map((image) => image.id),
          processable_image_count: this.currentBatchImages.length,
          processable_image_ids: this.currentBatchImages.map((image) => image.id),
          skipped_completed_count: skippedCompleted.length,
          skipped_completed_image_ids: skippedCompleted.map((image) => image.id),
          force_reprocess: options.forceReprocess === true,
          skip_completed: options.forceReprocess !== true
        }
      };
      
      this.emit('progress_changed', progress);

      // Finish this image after 1.2s delay
      setTimeout(() => {
        if (!this.activeInterval) return; // stopped in between

        // Mocking censorship decision: check configs
        const isCensored = Math.random() > 0.3; // 70% chance of censoring
        img.status = isCensored ? 'censored' : 'clean';
        
        // Update SVG content to show CENSORED overlay if censored
        let type = 'license';
        if (img.id === 'img2' || img.id === 'img6') type = 'cctv';
        if (img.id === 'img3') type = 'id';
        if (img.id === 'img4') type = 'document';

        img.original_thumbnail = img.original_thumbnail || img.thumbnail;
        img.thumbnail = createMockSvgDataUrl(type, img.filename, isCensored);
        img.result_path = `${config.output_dirs[0] || 'output'}/${config.output_suffix ? config.output_suffix + '_' : ''}${img.filename}`;
        
        if (Math.random() > 0.9) {
          img.warnings = ['Low confidence detection on region [0.42, 0.51]'];
          this.emit('warning', `Low confidence detection on ${img.filename}`);
        }

        this.emit('image_processed', { ...img });
        this.progressIndex++;

        // Trigger next iteration
        runProcessingStep();
      }, 1000);
    };

    // Run first step
    this.activeInterval = true;
    runProcessingStep();
  }

  private stopInterval() {
    this.activeInterval = null;
  }

  async stopBatch(): Promise<void> {
    if (!this.activeInterval) return;
    this.stopInterval();
    this.emit('warning', 'Batch processing stopped by user.');
    // Set active processing images back to pending
    this.currentBatchImages.forEach(img => {
      if (img.status === 'processing') {
        img.status = 'pending';
        this.emit('image_processed', { ...img });
      }
    });
    const duration = (Date.now() - this.startTime) / 1000;
    const progress: ProgressState = {
      total: this.currentBatchImages.length,
      processed: this.progressIndex,
      censored: this.currentBatchImages.filter((img) => img.status === 'censored').length,
      clean: this.currentBatchImages.filter((img) => img.status === 'clean').length,
      failed: this.currentBatchImages.filter((img) => img.status === 'failed').length,
      eta_text: '',
      current_file: '',
      message: 'Batch stopped',
      duration_seconds: parseFloat(duration.toFixed(1))
    };
    this.emit('progress_changed', progress);
    this.emit('run_finished', {
      total: progress.total,
      processed: progress.processed,
      duration: progress.duration_seconds || 0,
      stopped: true,
      message: progress.message
    });
  }

  async detectRegion(request: RegionRequest): Promise<RegionResult> {
    // Simulate region detection computation
    await new Promise(resolve => setTimeout(resolve, 400));
    
    // Check threshold or target class
    if (request.threshold > 0.9) {
      return {
        masks: [],
        message: 'No region detected. Confidence is below threshold.',
        error: 'Below threshold error.'
      };
    }

    return {
      masks: [{ label: 'face', confidence: 0.88, box: request.normalized_rect }],
      message: 'Region detected successfully.'
    };
  }

  async saveManualEdit(imageId: string, editedImage: string, config?: RunConfig): Promise<ImageItem | null> {
    void config;
    await new Promise(resolve => setTimeout(resolve, 200));
    const image: ImageItem = {
      id: imageId,
      path: '',
      filename: imageId,
      status: 'censored',
      thumbnail: editedImage,
      original_thumbnail: editedImage
    };
    this.emit('image_processed', image);
    return image;
  }
}
