import * as THREE from 'three';

import { InputManager } from './input';
import { ServiceRegistry } from './services';
import {
  DEFAULT_RUNTIME_CONFIG,
} from './types';
import type {
  FrameContext,
  RuntimeContext,
  RuntimeConfig,
  RuntimeFeature,
  RuntimeFrameContext,
  RuntimeLifecycle,
  RuntimeOptions,
  RuntimeResizeContext,
  RuntimeUi,
  RuntimeViewport,
} from './types';

const EMPTY_UI: RuntimeUi = {
  loading: {
    state: { phase: 'idle', message: '' },
    begin: () => undefined,
    update: () => undefined,
    complete: () => undefined,
    fail: () => undefined,
  },
  fatalError: {
    show: () => undefined,
    clear: () => undefined,
  },
  setStatus: () => undefined,
  dispose: () => undefined,
};

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unknown runtime error';
}

export class Runtime {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly timer: THREE.Timer;

  private readonly canvas: HTMLCanvasElement;
  private readonly features: readonly RuntimeFeature[];
  private readonly config: RuntimeConfig;
  private readonly input: InputManager;
  private readonly services = new ServiceRegistry();
  private readonly ui: RuntimeUi;
  private readonly resizeObserver: ResizeObserver | null;
  private viewport: RuntimeViewport = { width: 1, height: 1, pixelRatio: 1 };
  private lifecycle: RuntimeLifecycle = 'idle';
  private frameNumber = 0;
  private animationFrame: number | null = null;
  private startPromise: Promise<void> | null = null;
  private stopRequested = false;

  public constructor(options: RuntimeOptions) {
    this.canvas = options.canvas;
    this.features = options.features ?? [];
    this.config = options.config ?? DEFAULT_RUNTIME_CONFIG;
    this.ui = options.ui ?? EMPTY_UI;
    this.input = new InputManager(this.canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      this.config.camera.fov,
      1,
      this.config.camera.near,
      this.config.camera.far,
    );
    this.camera.position.fromArray(this.config.camera.position);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.config.renderer.antialias,
      alpha: this.config.renderer.alpha,
      powerPreference: this.config.renderer.powerPreference,
    });
    this.renderer.setClearColor(this.config.clearColor);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.timer = new THREE.Timer();
    this.timer.connect(document);

    this.resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(this.handleResize);
    this.resizeObserver?.observe(this.canvas);
    window.addEventListener('resize', this.handleResize);
  }

  public get state(): typeof this.lifecycle {
    return this.lifecycle;
  }

  public async start(): Promise<void> {
    if (this.lifecycle === 'disposed') {
      throw new Error('Cannot start a disposed runtime.');
    }
    if (this.lifecycle === 'running') {
      return;
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    this.stopRequested = false;
    this.timer.reset();
    this.startPromise = this.initialize();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  public stop(): void {
    if (this.lifecycle !== 'running' && this.lifecycle !== 'starting') {
      return;
    }
    this.cancelAnimationFrame();
    this.stopRequested = true;
    this.lifecycle = 'stopped';
    this.ui.setStatus('Runtime stopped');
  }

  public dispose(): void {
    if (this.lifecycle === 'disposed') {
      return;
    }

    this.stop();
    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();
    this.input.detach();
    const context = this.createContext(this.input.getSnapshot());

    for (const feature of this.features) {
      try {
        feature.dispose?.(context);
      } catch (error) {
        this.reportFatalError(error);
      }
    }
    try {
      this.services.clear();
    } catch (error) {
      this.reportFatalError(error);
    }

    this.timer.dispose();
    this.renderer.dispose();
    this.ui.dispose();
    this.lifecycle = 'disposed';
  }

  private async initialize(): Promise<void> {
    this.lifecycle = 'starting';

    try {
      this.ui.fatalError.clear();
      this.ui.loading.begin('Starting runtime…');
      this.ui.setStatus(`Foundation diagnostic shell · ${this.features.length} feature${this.features.length === 1 ? '' : 's'}`);
      this.input.attach();
      this.applyResize();

      const context = this.createContext(this.input.getSnapshot());
      for (const feature of this.features) {
        const initializeFeature = feature.init ?? feature.mount;
        if (!initializeFeature) {
          throw new Error(`Runtime feature "${feature.id}" must provide init or mount.`);
        }
        this.ui.loading.update(`Loading ${feature.id}…`);
        await initializeFeature(context);
        if (this.initializationAborted) {
          return;
        }
      }
      if (this.initializationAborted) {
        return;
      }
      const resizeContext: RuntimeResizeContext = {
        ...this.createContext(this.input.getSnapshot()),
        frame: null,
      };
      for (const feature of this.features) {
        feature.resize?.(resizeContext);
      }
      if (this.initializationAborted) {
        return;
      }
      this.ui.loading.complete('Runtime ready');
      this.lifecycle = 'running';
      this.animationFrame = window.requestAnimationFrame(this.renderFrame);
    } catch (error) {
      if (this.initializationAborted) {
        return;
      }
      this.lifecycle = 'error';
      this.cancelAnimationFrame();
      this.ui.loading.fail('Runtime failed to start');
      this.reportFatalError(error);
    }
  }

  private readonly renderFrame = (timestamp: number): void => {
    if (this.lifecycle !== 'running') {
      return;
    }

    try {
      this.timer.update(timestamp);
      const input = this.input.beginFrame();
      const deltaSeconds = Math.min(this.timer.getDelta(), 0.25);
      const frame: FrameContext = {
        frame: this.frameNumber,
        deltaSeconds,
        elapsedSeconds: this.timer.getElapsed(),
        viewport: this.viewport,
      };
      this.frameNumber += 1;
      const context: RuntimeFrameContext = {
        ...this.createContext(input),
        frame,
      };

      for (const feature of this.features) {
        feature.update?.(context);
      }
      if (this.lifecycle !== 'running') {
        return;
      }
      this.renderer.render(this.scene, this.camera);
      this.animationFrame = window.requestAnimationFrame(this.renderFrame);
    } catch (error) {
      this.lifecycle = 'error';
      this.cancelAnimationFrame();
      this.ui.loading.fail('Runtime stopped after an error');
      this.reportFatalError(error);
    }
  };

  private readonly handleResize = (): void => {
    if (this.lifecycle === 'disposed') {
      return;
    }
    try {
      this.applyResize();
      if (this.lifecycle !== 'running') {
        return;
      }
      const context: RuntimeResizeContext = {
        ...this.createContext(this.input.getSnapshot()),
        frame: null,
      };
      for (const feature of this.features) {
        feature.resize?.(context);
      }
    } catch (error) {
      this.reportFatalError(error);
    }
  };

  private applyResize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(bounds.width || window.innerWidth));
    const height = Math.max(1, Math.floor(bounds.height || window.innerHeight));
    const pixelRatio = Math.min(
      Math.max(window.devicePixelRatio || 1, 1),
      Math.max(this.config.maxPixelRatio, 1),
    );
    this.viewport = { width, height, pixelRatio };
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private createContext(input: RuntimeContext['input']): RuntimeContext {
    return {
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      timer: this.timer,
      config: this.config,
      viewport: this.viewport,
      input,
      services: this.services,
      loading: this.ui.loading,
      fatalError: this.ui.fatalError,
      reportFatalError: this.reportFatalError,
    };
  }

  private readonly reportFatalError = (error: unknown): void => {
    this.ui.fatalError.show(error);
    this.ui.setStatus(`Runtime error · ${errorText(error)}`);
  };

  private get initializationAborted(): boolean {
    return this.stopRequested || this.lifecycle === 'disposed';
  }

  private cancelAnimationFrame(): void {
    if (this.animationFrame !== null) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }
}

export function createRuntime(options: RuntimeOptions): Runtime {
  return new Runtime(options);
}
