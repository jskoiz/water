import type {
  FatalErrorController,
  LoadingController,
  LoadingPhase,
  LoadingState,
  RuntimeShell,
  RuntimeShellOptions,
} from './types';

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'The runtime could not start.';
}

class DomLoadingController implements LoadingController {
  private readonly element: HTMLElement;
  private currentState: LoadingState = {
    phase: 'idle',
    message: '',
  };

  public constructor(element: HTMLElement) {
    this.element = element;
    this.render();
  }

  public get state(): LoadingState {
    return this.currentState;
  }

  public begin(message = 'Starting runtime…'): void {
    this.setState('loading', message);
  }

  public update(message: string): void {
    this.setState('loading', message);
  }

  public complete(message = 'Runtime ready'): void {
    this.setState('ready', message);
  }

  public fail(message: string): void {
    this.setState('error', message);
  }

  private setState(phase: LoadingPhase, message: string): void {
    this.currentState = { phase, message };
    this.render();
  }

  private render(): void {
    this.element.textContent = this.currentState.message;
    this.element.dataset.phase = this.currentState.phase;
    this.element.hidden = this.currentState.phase === 'ready' || this.currentState.phase === 'idle';
  }
}

class DomFatalErrorController implements FatalErrorController {
  private readonly element: HTMLElement;

  public constructor(element: HTMLElement) {
    this.element = element;
  }

  public show(error: unknown): void {
    const message = errorMessage(error);
    this.element.textContent = `Runtime error: ${message}`;
    this.element.hidden = false;
    console.error(error);
  }

  public clear(): void {
    this.element.textContent = '';
    this.element.hidden = true;
  }
}

export function createRuntimeShell(
  container: HTMLElement,
  options: RuntimeShellOptions = {},
): RuntimeShell {
  const showDiagnostic = options.diagnostic ?? true;
  const element = document.createElement('main');
  element.className = 'runtime-shell';

  const canvas = document.createElement('canvas');
  canvas.className = 'runtime-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Water runtime canvas');

  const diagnostic = document.createElement('aside');
  diagnostic.className = 'runtime-diagnostic';
  diagnostic.setAttribute('aria-label', 'Runtime diagnostics');
  diagnostic.textContent = 'Foundation diagnostic shell';

  const status = document.createElement('p');
  status.className = 'runtime-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const loadingElement = document.createElement('div');
  loadingElement.className = 'runtime-loading';
  loadingElement.setAttribute('role', 'status');
  loadingElement.setAttribute('aria-live', 'polite');

  const fatalElement = document.createElement('div');
  fatalElement.className = 'runtime-fatal';
  fatalElement.setAttribute('role', 'alert');
  fatalElement.hidden = true;

  if (showDiagnostic) {
    diagnostic.append(status);
  }
  element.append(canvas, ...(showDiagnostic ? [diagnostic] : []), loadingElement, fatalElement);
  container.replaceChildren(element);

  const loading = new DomLoadingController(loadingElement);
  const fatalError = new DomFatalErrorController(fatalElement);

  return {
    element,
    canvas,
    loading,
    fatalError,
    setStatus(message: string): void {
      status.textContent = message;
    },
    dispose(): void {
      element.remove();
    },
  };
}
