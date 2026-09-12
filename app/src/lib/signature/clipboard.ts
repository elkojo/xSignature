/**
 * Put an image on the clipboard, or say plainly why not.
 *
 * More ways to fail than most browser APIs, and none of them the user's fault:
 * the page may not be on a secure origin, the browser may not implement
 * ClipboardItem for images at all, or it may refuse because the click that led
 * here is no longer considered recent. A thrown DOMException tells the user
 * nothing, so each case comes back as a sentence instead.
 *
 * Nothing leaves the device either way. The clipboard is the operating
 * system's, and the bytes written to it are the same bytes the download would
 * have saved.
 */
export type CopyResult = { ok: true } | { ok: false; reason: string };

export function clipboardCanTakeImages(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    typeof ClipboardItem !== 'undefined' &&
    // Safari and Chrome both expose this; a browser without it cannot be asked
    // about image support without trying and failing.
    typeof navigator.clipboard.write === 'function'
  );
}

/** One attempt at a clipboard write, with the failures turned into sentences. */
async function write(entries: Record<string, Blob>): Promise<CopyResult> {
  try {
    await navigator.clipboard.write([new ClipboardItem(entries)]);
    return { ok: true };
  } catch (cause) {
    // NotAllowedError covers both a denied permission and a click the browser
    // no longer considers recent enough to act on.
    const name = cause instanceof Error ? cause.name : '';
    if (name === 'NotAllowedError') {
      return {
        ok: false,
        reason: 'The browser did not allow the copy. Try again, or save the file instead.',
      };
    }
    return { ok: false, reason: 'The copy did not go through. Save the file instead.' };
  }
}

export async function copyImage(blob: Blob): Promise<CopyResult> {
  if (!clipboardCanTakeImages()) {
    return {
      ok: false,
      reason: 'This browser cannot put images on the clipboard. Save the file instead.',
    };
  }

  return write({ [blob.type]: blob });
}

/**
 * Put the SVG on the clipboard as both a picture and its own source.
 *
 * One copy, two audiences, and no way to know in advance which one is pasting:
 * a design tool wants `image/svg+xml` and will place the vector; an editor, a
 * template or a content field wants the markup as text. A clipboard item can
 * carry both at once and let whatever receives it choose, which is better than
 * asking the user to pick a flavour before they know where it is going.
 *
 * Browsers disagree about the image flavour — it was refused outright not long
 * ago — so a refusal falls back to the text alone rather than failing. Markup
 * on the clipboard is still a useful thing to have; nothing is worse than
 * before.
 */
export async function copySvg(markup: string): Promise<CopyResult> {
  if (!clipboardCanTakeImages()) {
    return {
      ok: false,
      reason: 'This browser cannot write to the clipboard. Save the file instead.',
    };
  }

  const both = await write({
    'image/svg+xml': new Blob([markup], { type: 'image/svg+xml' }),
    'text/plain': new Blob([markup], { type: 'text/plain' }),
  });
  if (both.ok) return both;

  return write({ 'text/plain': new Blob([markup], { type: 'text/plain' }) });
}
