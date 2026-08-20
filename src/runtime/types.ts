import type * as THREE from 'three';

export type RuntimeColor = THREE.ColorRepresentation;

export type RuntimeLifecycle = 'idle' | 'starting' | 'running' | 'stopped' | 'disposed' | 'error';

export interface RuntimeCameraConfig {
  readonly fov: number;
  readonly near: number;
  readonly far: number;
  readonly position: readonly [number, number, number];
}

export interface RuntimeRendererConfig {
  readonly antialias: boolean;
  readonly alpha: boolean;
  readonly powerPreference: WebGLPowerPreference;
}

export interface RuntimeConfig {
  readonly clearColor: RuntimeColor;
  readonly maxPixelRatio: number;
  readonly camera: RuntimeCameraConfig;
  readonly renderer: RuntimeRendererConfig;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  clearColor: 0x071321,
  maxPixelRatio: 2,
  camera: {
    fov: 55,
    near: 0.1,
    far: 2_000,
    position: [0, 1.5, 5],
  },
  renderer: {
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  },
};

export interface RuntimeConfigOverrides {
  readonly clearColor?: RuntimeColor;
  readonly maxPixelRatio?: number;
  readonly camera?: Partial<RuntimeCameraConfig> & {
    readonly position?: readonly [number, number, number];
  };
  readonly renderer?: Partial<RuntimeRendererConfig>;
}

export function createRuntimeConfig(overrides: RuntimeConfigOverrides = {}): RuntimeConfig {
  return {
    clearColor: overrides.clearColor ?? DEFAULT_RUNTIME_CONFIG.clearColor,
    maxPixelRatio: overrides.maxPixelRatio ?? DEFAULT_RUNTIME_CONFIG.maxPixelRatio,
    camera: {
      ...DEFAULT_RUNTIME_CONFIG.camera,
      ...overrides.camera,
      position: overrides.camera?.position ?? DEFAULT_RUNTIME_CONFIG.camera.position,
    },
    renderer: {
      ...DEFAULT_RUNTIME_CONFIG.renderer,
      ...overrides.renderer,
    },
  };
}

export interface RuntimeViewport {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export interface FrameContext {
  readonly frame: number;
  readonly deltaSeconds: number;
  readonly elapsedSeconds: number;
  readonly viewport: RuntimeViewport;
}

export interface KeyboardInputSnapshot {
  readonly pressed: ReadonlySet<string>;
  readonly justPressed: ReadonlySet<string>;
  readonly justReleased: ReadonlySet<string>;
}

export interface PointerInputSnapshot {
  readonly pointerId: number | null;
  readonly clientX: number;
  readonly clientY: number;
  readonly x: number;
  readonly y: number;
  readonly normalizedX: number;
  readonly normalizedY: number;
  readonly buttons: number;
  readonly isDown: boolean;
}

export interface InputSnapshot {
  readonly keyboard: KeyboardInputSnapshot;
  readonly pointer: PointerInputSnapshot;
}

export type LoadingPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface LoadingState {
  readonly phase: LoadingPhase;
  readonly message: string;
}

export interface LoadingController {
  readonly state: LoadingState;
  begin(message?: string): void;
  update(message: string): void;
  complete(message?: string): void;
  fail(message: string): void;
}

export interface FatalErrorController {
  show(error: unknown): void;
  clear(): void;
}

export type RuntimeServiceKey<T> = symbol & {
  readonly __serviceType?: T;
};

export interface RuntimeServiceRegistry {
  provide<T>(key: RuntimeServiceKey<T>, service: T, onDispose?: () => void): () => void;
  get<T>(key: RuntimeServiceKey<T>): T | undefined;
  require<T>(key: RuntimeServiceKey<T>): T;
  remove<T>(key: RuntimeServiceKey<T>): boolean;
  clear(): void;
}

export interface RuntimeContext {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly timer: THREE.Timer;
  readonly config: RuntimeConfig;
  readonly viewport: RuntimeViewport;
  readonly input: InputSnapshot;
  readonly services: RuntimeServiceRegistry;
  readonly loading: LoadingController;
  readonly fatalError: FatalErrorController;
  readonly reportFatalError: (error: unknown) => void;
}

export interface RuntimeFrameContext extends RuntimeContext {
  readonly frame: FrameContext;
}

export interface RuntimeResizeContext extends RuntimeContext {
  readonly frame: FrameContext | null;
}

export interface RuntimeFeature {
  readonly id: string;
  readonly init?: (context: RuntimeContext) => void | Promise<void>;
  readonly mount?: (context: RuntimeContext) => void | Promise<void>;
  readonly update?: (context: RuntimeFrameContext) => void;
  readonly resize?: (context: RuntimeResizeContext) => void;
  readonly dispose?: (context: RuntimeContext) => void;
}

export interface RuntimeUi {
  readonly loading: LoadingController;
  readonly fatalError: FatalErrorController;
  setStatus(message: string): void;
  dispose(): void;
}

export interface RuntimeShellOptions {
  readonly diagnostic?: boolean;
}

export interface RuntimeShell extends RuntimeUi {
  readonly element: HTMLElement;
  readonly canvas: HTMLCanvasElement;
}

export interface RuntimeOptions {
  readonly canvas: HTMLCanvasElement;
  readonly features?: readonly RuntimeFeature[];
  readonly config?: RuntimeConfig;
  readonly ui?: RuntimeUi;
}
