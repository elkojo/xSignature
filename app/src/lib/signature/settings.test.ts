import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';

/** A localStorage that lives in the test, and can be made to misbehave. */
function fakeStorage(initial?: string, throws = false) {
  let value = initial ?? null;
  return {
    getItem: () => {
      if (throws) throw new Error('blocked');
      return value;
    },
    setItem: (_k: string, v: string) => {
      if (throws) throw new Error('blocked');
      value = v;
    },
    read: () => value,
  };
}

describe('loadSettings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadSettings(fakeStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults when storage is unavailable', () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults when storage throws', () => {
    // Safari in private mode, or a browser told to block storage. Refusing to
    // store settings must not stop the app from running.
    expect(loadSettings(fakeStorage(undefined, true))).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips what was saved', () => {
    const storage = fakeStorage();
    const settings = { faceId: 'great-vibes', sizeId: 'large' as const, ink: '#7a2230', flourish: true };
    saveSettings(settings, storage);
    expect(loadSettings(storage)).toEqual(settings);
  });

  it('survives a face that no longer exists', () => {
    // Storage outlives builds. A face dropped in a later release would come
    // back as a selection with no matching button.
    const storage = fakeStorage(JSON.stringify({ faceId: 'homemade-apple', sizeId: 'small', ink: '#12130f' }));
    expect(loadSettings(storage).faceId).toBe(DEFAULT_SETTINGS.faceId);
    expect(loadSettings(storage).sizeId).toBe('small');
  });

  it('survives an unknown size', () => {
    const storage = fakeStorage(JSON.stringify({ sizeId: 'enormous' }));
    expect(loadSettings(storage).sizeId).toBe(DEFAULT_SETTINGS.sizeId);
  });

  it('rejects an ink that is not a colour', () => {
    const storage = fakeStorage(JSON.stringify({ ink: 'javascript:alert(1)' }));
    expect(loadSettings(storage).ink).toBe(DEFAULT_SETTINGS.ink);
  });

  it('normalises a stored short hex', () => {
    const storage = fakeStorage(JSON.stringify({ ink: '#ABC' }));
    expect(loadSettings(storage).ink).toBe('#aabbcc');
  });

  it('treats anything but a stored true as no underline', () => {
    // A stray string or number must not switch a decoration on; only the
    // value this app wrote counts.
    for (const raw of ['"yes"', '1', 'null', '"true"']) {
      expect(loadSettings(fakeStorage(JSON.stringify({ flourish: JSON.parse(raw) }))).flourish).toBe(false);
    }
    expect(loadSettings(fakeStorage(JSON.stringify({ flourish: true }))).flourish).toBe(true);
  });

  it('survives corrupt JSON', () => {
    expect(loadSettings(fakeStorage('{not json'))).toEqual(DEFAULT_SETTINGS);
  });

  it('survives a stored value of the wrong shape', () => {
    for (const raw of ['null', '"a string"', '42', '[1,2,3]']) {
      expect(loadSettings(fakeStorage(raw))).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('stores no name and no strokes', () => {
    // The promise: the shape of the pen, never what was written with it.
    const storage = fakeStorage();
    saveSettings({ faceId: 'caveat', sizeId: 'small', ink: '#12130f', flourish: true }, storage);
    const stored = JSON.parse(storage.read()!);
    expect(Object.keys(stored).sort()).toEqual(['faceId', 'flourish', 'ink', 'sizeId']);
  });
});

describe('saveSettings', () => {
  it('does nothing when storage is unavailable', () => {
    expect(() => saveSettings(DEFAULT_SETTINGS, undefined)).not.toThrow();
  });

  it('does not throw when storage refuses', () => {
    expect(() => saveSettings(DEFAULT_SETTINGS, fakeStorage(undefined, true))).not.toThrow();
  });
});
