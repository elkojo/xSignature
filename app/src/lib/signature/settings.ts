import { DEFAULT_FACE_ID, faceById } from './type/faces';
import { DEFAULT_INK, DEFAULT_SIZE_ID, normalizeHex, sizeById, type SizeId } from './style';

/**
 * The only thing this app remembers.
 *
 * A face, a size and an ink — the shape of the pen, not what was written with
 * it. The name typed and the strokes drawn are never stored, not here and not
 * anywhere else: they exist while the tab is open and then they are gone.
 *
 * Kept in localStorage rather than IndexedDB because it is three short strings
 * and losing them costs three clicks.
 */
export interface Settings {
  readonly faceId: string;
  readonly sizeId: SizeId;
  readonly ink: string;
}

const KEY = 'xsignature.settings';

export const DEFAULT_SETTINGS: Settings = {
  faceId: DEFAULT_FACE_ID,
  sizeId: DEFAULT_SIZE_ID,
  ink: DEFAULT_INK,
};

/**
 * Read the stored settings, keeping only what still makes sense.
 *
 * Every field is checked against what this build actually offers, rather than
 * trusted. Storage survives upgrades: a face that was dropped, an ink that was
 * renamed, or a value someone edited by hand in devtools would otherwise come
 * back as a broken selection with no way to reach it from the UI.
 */
export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Settings {
  if (!storage) return DEFAULT_SETTINGS;

  let raw: string | null = null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    // Storage can be present and still throw — Safari in private mode, or a
    // browser configured to block it. Defaults are a fine answer.
    return DEFAULT_SETTINGS;
  }
  if (!raw) return DEFAULT_SETTINGS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }

  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SETTINGS;
  const stored = parsed as Record<string, unknown>;

  const faceId = typeof stored.faceId === 'string' && faceById(stored.faceId) ? stored.faceId : DEFAULT_FACE_ID;
  const sizeId =
    typeof stored.sizeId === 'string' && sizeById(stored.sizeId).id === stored.sizeId
      ? (stored.sizeId as SizeId)
      : DEFAULT_SIZE_ID;
  const ink = (typeof stored.ink === 'string' && normalizeHex(stored.ink)) || DEFAULT_INK;

  return { faceId, sizeId, ink };
}

export function saveSettings(
  settings: Settings,
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // A full or blocked storage must not break the app. The settings simply do
    // not outlive the tab, which is the behaviour anyone who blocked storage
    // asked for.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
