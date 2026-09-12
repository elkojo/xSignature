import { afterEach, describe, expect, it, vi } from 'vitest';

import { clipboardCanTakeImages, copyImage } from './clipboard';

const original = {
  navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  ClipboardItem: (globalThis as Record<string, unknown>).ClipboardItem,
};

function withClipboard(write: ((items: unknown[]) => Promise<void>) | null) {
  Object.defineProperty(globalThis, 'navigator', {
    value: write ? { clipboard: { write } } : {},
    configurable: true,
    writable: true,
  });
  (globalThis as Record<string, unknown>).ClipboardItem = write
    ? class {
        constructor(readonly items: Record<string, Blob>) {}
      }
    : undefined;
}

afterEach(() => {
  if (original.navigator) Object.defineProperty(globalThis, 'navigator', original.navigator);
  (globalThis as Record<string, unknown>).ClipboardItem = original.ClipboardItem;
});

const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

describe('clipboardCanTakeImages', () => {
  it('is false where the browser has no ClipboardItem', () => {
    withClipboard(null);
    expect(clipboardCanTakeImages()).toBe(false);
  });

  it('is true where it does', () => {
    withClipboard(async () => {});
    expect(clipboardCanTakeImages()).toBe(true);
  });
});

describe('copyImage', () => {
  it('reports success when the write goes through', async () => {
    withClipboard(async () => {});
    expect(await copyImage(png)).toEqual({ ok: true });
  });

  it('passes the blob under its own media type', async () => {
    const write = vi.fn(async () => {});
    withClipboard(write);
    await copyImage(png);
    expect(write).toHaveBeenCalledTimes(1);
    const [[items]] = write.mock.calls as unknown as [[{ items: Record<string, Blob> }[]]];
    expect(Object.keys(items[0].items)).toEqual(['image/png']);
  });

  it('explains itself rather than throwing when there is no clipboard', async () => {
    withClipboard(null);
    const result = await copyImage(png);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/save the file instead/i);
  });

  it('says so when the browser refuses permission', async () => {
    // A denied copy and a click the browser thinks is stale raise the same
    // error, and the advice — try again, or save it — covers both.
    const denied = Object.assign(new Error('nope'), { name: 'NotAllowedError' });
    withClipboard(async () => {
      throw denied;
    });
    const result = await copyImage(png);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/did not allow/i);
  });

  it('never lets an unexpected failure escape', async () => {
    withClipboard(async () => {
      throw new Error('something else entirely');
    });
    await expect(copyImage(png)).resolves.toMatchObject({ ok: false });
  });
});
