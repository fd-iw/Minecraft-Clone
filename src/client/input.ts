/** Keyboard/mouse state with edge-triggered presses and accumulated mouse motion. */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly buttons = [false, false, false];
  private readonly buttonPressed = [false, false, false];
  private dx = 0;
  private dy = 0;
  private wheel = 0;
  /** When false (e.g. menus open) game input is ignored, but tracking continues. */
  enabled = true;
  readonly usePointerLock: boolean;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly target: HTMLElement,
    opts: { pointerLock: boolean },
  ) {
    this.usePointerLock = opts.pointerLock;
    const on = <K extends keyof WindowEventMap>(
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      t: EventTarget = window,
    ) => {
      t.addEventListener(type, fn as EventListener, { passive: false });
      this.cleanup.push(() => t.removeEventListener(type, fn as EventListener));
    };
    on('keydown', (e) => {
      if (isTyping(e)) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      // Keep browser shortcuts (Ctrl+W, F3 search...) from firing while playing.
      if (this.enabled && (e.code.startsWith('F') || e.ctrlKey || e.code === 'Space' || e.code === 'Tab'))
        e.preventDefault();
    });
    on('keyup', (e) => {
      this.down.delete(e.code);
    });
    on('blur', () => {
      this.down.clear();
      this.buttons.fill(false);
    });
    on('mousemove', (e) => {
      if (!this.enabled || !this.isLocked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    on('mousedown', (e) => {
      if (!this.enabled || e.target !== this.target) return;
      if (this.usePointerLock && !this.isLocked) {
        this.lock();
        return;
      }
      if (e.button < 3) {
        this.buttons[e.button] = true;
        this.buttonPressed[e.button] = true;
      }
      e.preventDefault();
    });
    on('mouseup', (e) => {
      if (e.button < 3) this.buttons[e.button] = false;
    });
    on('wheel', (e) => {
      if (!this.enabled || !this.isLocked) return;
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    });
    on('contextmenu', (e) => e.preventDefault());
  }

  get isLocked(): boolean {
    return !this.usePointerLock || document.pointerLockElement === this.target;
  }

  lock(): void {
    if (!this.usePointerLock) return;
    try {
      const p = this.target.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Some browsers reject when called outside a user gesture; the next click retries.
    }
  }

  unlock(): void {
    if (this.usePointerLock && document.pointerLockElement) document.exitPointerLock();
    this.buttons.fill(false);
  }

  isDown(code: string): boolean {
    return this.enabled && this.down.has(code);
  }

  /** True once per physical key press. */
  consumePress(code: string): boolean {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  clearPresses(): void {
    this.pressed.clear();
    this.buttonPressed.fill(false);
  }

  mouseButton(i: number): boolean {
    return this.enabled && this.isLocked && this.buttons[i];
  }

  consumeClick(i: number): boolean {
    const p = this.buttonPressed[i];
    this.buttonPressed[i] = false;
    return p && this.enabled;
  }

  consumeMouse(): [number, number] {
    const r: [number, number] = [this.dx, this.dy];
    this.dx = 0;
    this.dy = 0;
    return r;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Test hook: simulate a mouse click. */
  simulateClick(button: number): void {
    this.buttonPressed[button] = true;
  }

  dispose(): void {
    for (const c of this.cleanup) c();
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}
