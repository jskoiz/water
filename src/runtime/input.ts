import type {
  InputSnapshot,
  KeyboardInputSnapshot,
  PointerInputSnapshot,
} from './types';

const EMPTY_SET = new Set<string>();

function createKeyboardSnapshot(
  pressed: ReadonlySet<string>,
  justPressed: ReadonlySet<string>,
  justReleased: ReadonlySet<string>,
): KeyboardInputSnapshot {
  return {
    pressed,
    justPressed,
    justReleased,
  };
}

function createPointerSnapshot(canvas: HTMLCanvasElement): PointerInputSnapshot {
  const rect = canvas.getBoundingClientRect();
  return {
    pointerId: null,
    clientX: rect.left,
    clientY: rect.top,
    x: 0,
    y: 0,
    normalizedX: -1,
    normalizedY: 1,
    buttons: 0,
    isDown: false,
  };
}

export class InputManager {
  private readonly canvas: HTMLCanvasElement;
  private readonly pressedKeys = new Set<string>();
  private previousPressedKeys = new Set<string>();
  private pointer: PointerInputSnapshot;
  private snapshot: InputSnapshot;
  private attached = false;

  public constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.pointer = createPointerSnapshot(canvas);
    this.snapshot = {
      keyboard: createKeyboardSnapshot(EMPTY_SET, EMPTY_SET, EMPTY_SET),
      pointer: this.pointer,
    };
  }

  public attach(): void {
    if (this.attached) {
      return;
    }

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
    this.attached = true;
  }

  public detach(): void {
    if (!this.attached) {
      return;
    }

    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    this.clearKeys();
    this.pointer = createPointerSnapshot(this.canvas);
    this.snapshot = {
      keyboard: createKeyboardSnapshot(EMPTY_SET, EMPTY_SET, EMPTY_SET),
      pointer: this.pointer,
    };
    this.attached = false;
  }

  public beginFrame(): InputSnapshot {
    const justPressed = new Set<string>();
    const justReleased = new Set<string>();

    for (const code of this.pressedKeys) {
      if (!this.previousPressedKeys.has(code)) {
        justPressed.add(code);
      }
    }
    for (const code of this.previousPressedKeys) {
      if (!this.pressedKeys.has(code)) {
        justReleased.add(code);
      }
    }

    const pressed = new Set(this.pressedKeys);
    this.previousPressedKeys = pressed;
    this.snapshot = {
      keyboard: createKeyboardSnapshot(pressed, justPressed, justReleased),
      pointer: this.pointer,
    };
    return this.snapshot;
  }

  public getSnapshot(): InputSnapshot {
    return this.snapshot;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.pressedKeys.add(event.code);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.code);
  };

  private readonly handleWindowBlur = (): void => {
    this.clearKeys();
    this.pointer = {
      ...this.pointer,
      buttons: 0,
      isDown: false,
      pointerId: null,
    };
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.updatePointer(event, true);
    this.canvas.focus({ preventScroll: true });
    if (this.canvas.setPointerCapture) {
      this.canvas.setPointerCapture(event.pointerId);
    }
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.updatePointer(event, this.pointer.isDown);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    this.updatePointer(event, false);
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    this.updatePointer(event, false);
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  };

  private readonly handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private updatePointer(event: PointerEvent, isDown: boolean): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    this.pointer = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x,
      y,
      normalizedX: (x / width) * 2 - 1,
      normalizedY: 1 - (y / height) * 2,
      buttons: event.buttons,
      isDown,
    };
  }

  private clearKeys(): void {
    this.pressedKeys.clear();
    this.previousPressedKeys.clear();
  }
}
