export interface Settings {
  renderDistance: number;
  fov: number;
  /** Mouse sensitivity, 0..1 (0.5 = default). */
  sensitivity: number;
  viewBobbing: boolean;
  invertY: boolean;
}

const KEY = 'stratavale.settings';

export const DEFAULT_SETTINGS: Settings = {
  renderDistance: 8,
  fov: 70,
  sensitivity: 0.5,
  viewBobbing: true,
  invertY: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Storage unavailable (private mode) or corrupt: fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Non-fatal.
  }
}
