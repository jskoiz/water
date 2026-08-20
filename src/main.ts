import './runtime/styles.css';

import { createOceanFeature } from './features/ocean';
import { createRaftFeature } from './features/raft';
import {
  createRuntime,
  createRuntimeConfig,
  createRuntimeShell,
} from './runtime';

const WATER_RUNTIME_CONFIG = createRuntimeConfig({
  clearColor: 0x44717d,
  maxPixelRatio: 1.5,
  camera: {
    fov: 52,
    near: 0.1,
    far: 2_000,
    position: [0, 4.5, 9.5],
  },
});

function bootstrap(): void {
  const container = document.querySelector<HTMLElement>('#app');
  if (!container) {
    document.body.textContent = 'Runtime mount point is missing.';
    return;
  }

  const shell = createRuntimeShell(container, { diagnostic: false });
  let runtime: ReturnType<typeof createRuntime> | null = null;

  try {
    runtime = createRuntime({
      canvas: shell.canvas,
      config: WATER_RUNTIME_CONFIG,
      features: [createOceanFeature(), createRaftFeature()],
      ui: shell,
    });
    void runtime.start().catch((error: unknown) => {
      shell.fatalError.show(error);
      shell.setStatus('Runtime error');
    });
  } catch (error) {
    shell.fatalError.show(error);
    shell.setStatus('Runtime error');
  }

  window.addEventListener('pagehide', () => {
    runtime?.dispose();
  }, { once: true });
}

bootstrap();
