import './runtime/styles.css';

import {
  createRuntime,
  createRuntimeShell,
  DEFAULT_RUNTIME_CONFIG,
} from './runtime';

function bootstrap(): void {
  const container = document.querySelector<HTMLElement>('#app');
  if (!container) {
    document.body.textContent = 'Runtime mount point is missing.';
    return;
  }

  const shell = createRuntimeShell(container);
  let runtime: ReturnType<typeof createRuntime> | null = null;

  try {
    runtime = createRuntime({
      canvas: shell.canvas,
      config: DEFAULT_RUNTIME_CONFIG,
      features: [],
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
