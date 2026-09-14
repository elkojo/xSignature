<script lang="ts">
  /**
   * Signing a document: take a file in, put a signature on it, give a PDF back.
   *
   * The screen holds no geometry. Where the signature lands is a rectangle in
   * fractions of the displayed page, and turning that into marks on the page is
   * `lib/document/place` and `lib/document/stamp` — including the awkward part,
   * which is that a page may be stored rotated and cropped and the reader is
   * dragging a box on neither of those.
   *
   * The preview is drawn by PDF.js and the file is written by the PDF writer,
   * and the two never meet: nothing rasterized for the screen goes into the
   * saved document. What is saved is the original bytes with a path drawn on
   * top, so the text in the document stays text.
   */
  import { openPdf, UnreadablePdf, type OpenPdf } from '../lib/document/pdf/inspect';
  import { renderPage } from '../lib/document/pdf/render';
  import { fitInside, displayedSize } from '../lib/document/place/placement';
  import { applyStamp } from '../lib/document/stamp/stamp';
  import { accept, HEAD_BYTES, type Accepted } from '../lib/document/accept';
  import { markdownToPdf } from '../lib/document/convert/markdown-to-pdf';
  import { textToPdf } from '../lib/document/convert/text-to-pdf';
  import {
    AUTHORITIES,
    authorityById,
    checkAuthorityUrl,
    DEFAULT_AUTHORITY_ID,
  } from '../lib/document/timestamp/authorities';
  import { applyDocTimeStamp, type Outgoing } from '../lib/document/timestamp/apply';
  import type { Timestamp } from '../lib/document/timestamp/response';
  import { applyImageStamp } from '../lib/document/stamp/stamp';
  import {
    looksLikeJpeg,
    looksLikePng,
    readSignatureImage,
    readSignatureSvg,
    UnreadableSignature,
    type Signature,
  } from '../lib/document/signature/read';
  import {
    describeDpi,
    pixelsNeededFor,
    resolutionFor,
  } from '../lib/document/signature/resolution';
  import { downloadBlob } from '../lib/signature/download';
  import { toPathData } from '../lib/signature/path';

  /** How wide the page preview is drawn, in CSS pixels. */
  const PREVIEW_WIDTH = 520;

  // ---- step 1: the document -------------------------------------------------

  let fileName = $state('');
  let verdict = $state<Accepted | null>(null);
  let bytes = $state<Uint8Array | null>(null);
  let opened = $state<OpenPdf | null>(null);
  let openError = $state('');
  /** True when what is being stamped was made here rather than dropped in. */
  let converted = $state(false);
  /** Size of the file as dropped, which is the one the reader recognises. */
  let sourceSize = $state(0);
  let over = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function take(file: File | undefined) {
    if (!file) return;
    reset();
    fileName = file.name;

    const all = new Uint8Array(await file.arrayBuffer());
    sourceSize = all.length;
    verdict = accept(file.name, all.subarray(0, HEAD_BYTES));

    if (verdict.route === 'text') {
      // Laid out here rather than fetched for: plain text has no structure to
      // preserve, so this costs nothing and happens immediately.
      try {
        const source = new TextDecoder().decode(all);
        const isMarkdown = /\.(md|markdown)$/i.test(file.name);
        bytes = isMarkdown
          ? await markdownToPdf(source, { title: file.name })
          : await textToPdf(source, { title: file.name });
        converted = true;
      } catch {
        openError = 'This file could not be laid out as a PDF.';
        return;
      }
    } else if (verdict.route === 'stamp') {
      bytes = all;
    } else {
      return;
    }

    try {
      opened = await openPdf(bytes!);
      page = 0;
    } catch (cause) {
      openError =
        cause instanceof UnreadablePdf
          ? cause.message
          : 'This document could not be opened, and the reason was not one the app recognises.';
    }
  }

  function reset() {
    verdict = null;
    converted = false;
    bytes = null;
    opened = null;
    openError = '';
    preview = null;
    saved = false;
  }

  function startOver() {
    reset();
    fileName = '';
    if (fileInput) fileInput.value = '';
  }

  // ---- step 2: the signature ------------------------------------------------

  /**
   * The signature is made on the other screen and brought here.
   *
   * There was a second, cut-down signature builder on this screen once, which
   * could type a name and nothing else. Taking it out removed the duplication
   * and gained drawn signatures at the same time: whatever the signature screen
   * can make — typed, drawn, any face, any ink — can be pasted here, because
   * what travels is the finished file rather than the controls that made it.
   */
  let signature = $state<Signature | null>(null);
  let signatureName = $state('');
  let signatureError = $state('');
  let signatureInput = $state<HTMLInputElement | null>(null);
  let signatureOver = $state(false);

  /** The ink's own box, whichever flavour arrived. */
  let box = $derived(
    signature
      ? { width: signature.width, height: signature.height }
      : null,
  );

  let pathData = $derived(
    signature?.kind === 'vector' ? toPathData(signature.commands) : '',
  );

  /** Take a signature from a file, a drop or a paste. */
  async function takeSignature(file: File | Blob, name = ''): Promise<void> {
    signatureError = '';
    const bytes = new Uint8Array(await file.arrayBuffer());

    try {
      if (looksLikePng(bytes)) {
        signature = readSignatureImage(bytes, 'image/png');
      } else if (looksLikeJpeg(bytes)) {
        signature = readSignatureImage(bytes, 'image/jpeg');
      } else {
        signature = readSignatureSvg(new TextDecoder().decode(bytes));
      }
      signatureName = name || (file instanceof File ? file.name : 'pasted signature');
    } catch (cause) {
      signature = null;
      signatureName = '';
      signatureError =
        cause instanceof UnreadableSignature
          ? cause.message
          : 'That could not be read as a signature. A PNG or an SVG from the signature screen will work.';
    }
  }

  /**
   * Take whatever the clipboard is offering.
   *
   * An image flavour is preferred when there is one, because a paste carrying
   * both is usually a picture with a filename attached as text. Failing that,
   * text is tried as SVG markup — which is how a signature copied from the
   * other screen arrives, since browsers disagree about carrying SVG as an
   * image.
   */
  async function onPaste(event: ClipboardEvent): Promise<void> {
    const items = [...(event.clipboardData?.items ?? [])];

    const image = items.find((item) => item.type === 'image/png' || item.type === 'image/jpeg');
    if (image) {
      const file = image.getAsFile();
      if (file) {
        event.preventDefault();
        await takeSignature(file, 'pasted image');
        return;
      }
    }

    const text = event.clipboardData?.getData('text/plain')?.trim();
    if (text?.startsWith('<svg') || text?.startsWith('<?xml')) {
      event.preventDefault();
      await takeSignature(new Blob([text]), 'pasted SVG');
    }
  }

  /**
   * A URL for showing the picture, made once per file and given back when it is
   * replaced. Without the revoke every pasted signature leaks its bytes for as
   * long as the page is open.
   */
  let rasterUrl = $state('');
  $effect(() => {
    if (signature?.kind !== 'raster') {
      rasterUrl = '';
      return;
    }
    const url = URL.createObjectURL(new Blob([signature.bytes], { type: signature.type }));
    rasterUrl = url;
    return () => URL.revokeObjectURL(url);
  });

  function clearSignature() {
    signature = null;
    signatureName = '';
    signatureError = '';
    if (signatureInput) signatureInput.value = '';
  }

  // ---- step 3: placing it ---------------------------------------------------

  let page = $state(0);
  let preview = $state<HTMLCanvasElement | null>(null);
  let previewHost = $state<HTMLElement | null>(null);
  let rendering = $state(false);

  /** Top-left corner of the signature, in fractions of the displayed page. */
  let at = $state({ x: 0.55, y: 0.78 });
  /** How much of the page's width the signature spans. */
  let span = $state(0.32);

  let geometry = $derived(opened?.pages[page] ?? null);

  /**
   * The signature's box in fractions of the page.
   *
   * The height follows from the width and the ink's own proportions, so the
   * rectangle handed to the stamp is exactly the one drawn here — no fitting
   * happens twice, and the preview cannot drift from the result.
   */
  let rect = $derived.by(() => {
    if (!box || !geometry) return null;
    const view = displayedSize(geometry);
    const height = ((box.height / box.width) * span * view.width) / view.height;
    return { x: at.x, y: at.y, width: span, height };
  });

  // Keep the signature on the sheet when it is resized near an edge.
  $effect(() => {
    if (!rect) return;
    const x = Math.min(at.x, 1 - rect.width);
    const y = Math.min(at.y, 1 - rect.height);
    if (x !== at.x || y !== at.y) at = { x: Math.max(0, x), y: Math.max(0, y) };
  });

  $effect(() => {
    const source = bytes;
    const which = page;
    if (!source || !opened) return;

    let current = true;
    rendering = true;
    void renderPage(source, which + 1, PREVIEW_WIDTH)
      .then((rendered) => {
        if (current) preview = rendered;
      })
      .catch(() => {
        if (current) openError = 'This PDF opened, but its pages could not be drawn on screen.';
      })
      .finally(() => {
        if (current) rendering = false;
      });
    return () => {
      current = false;
    };
  });

  // Swapping the canvas element in by hand: it is made by the renderer rather
  // than by this template, because PDF.js needs to own the drawing surface.
  $effect(() => {
    const host = previewHost;
    const canvas = preview;
    if (!host || !canvas) return;
    host.replaceChildren(canvas);
  });

  /**
   * How big the page is *on screen*, which is not how big it was drawn.
   *
   * The canvas is rendered at a fixed width for sharpness and then sized by
   * CSS, so on a narrow window it is displayed smaller than it was drawn. Every
   * position here is a fraction of the page, and turning a fraction into pixels
   * has to use the size the reader is actually looking at — measuring against
   * the drawn width instead put the signature in one place on screen and
   * another on the page, which is the one thing this app is built not to do.
   *
   * Observed rather than measured once, so it stays right when the window is
   * resized or the phone is turned.
   */
  let shown = $state<{ width: number; height: number } | null>(null);

  $effect(() => {
    const canvas = preview;
    if (!canvas) {
      shown = null;
      return;
    }

    const measure = () => {
      const box = canvas.getBoundingClientRect();
      if (box.width > 0) shown = { width: box.width, height: box.height };
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  function onPointerDown(event: PointerEvent) {
    if (!rect || !shown) return;
    const surface = event.currentTarget as HTMLElement;
    surface.setPointerCapture(event.pointerId);

    // Where in the signature the pointer took hold, so it does not jump.
    const grabX = event.clientX;
    const grabY = event.clientY;
    const from = { ...at };

    const move = (moved: PointerEvent) => {
      const dx = (moved.clientX - grabX) / shown!.width;
      const dy = (moved.clientY - grabY) / shown!.height;
      at = {
        x: Math.min(Math.max(from.x + dx, 0), 1 - rect!.width),
        y: Math.min(Math.max(from.y + dy, 0), 1 - rect!.height),
      };
    };

    const up = () => {
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', up);
      surface.removeEventListener('pointercancel', up);
    };

    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', up);
    surface.addEventListener('pointercancel', up);
  }

  /** Nudge with the arrow keys, for placement finer than a drag allows. */
  function onOverlayKey(event: KeyboardEvent) {
    if (!rect) return;
    const step = event.shiftKey ? 0.05 : 0.004;
    const by: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = by[event.key];
    if (!delta) return;

    event.preventDefault();
    at = {
      x: Math.min(Math.max(at.x + delta[0], 0), 1 - rect.width),
      y: Math.min(Math.max(at.y + delta[1], 0), 1 - rect.height),
    };
  }

  // ---- the timestamp --------------------------------------------------------

  /**
   * Off, and it stays off until it is asked for.
   *
   * Every other thing this app does runs without a network. This one cannot: a
   * timestamp is somebody else's assertion about when a file existed, so
   * somebody else has to see a digest of it. That is a real departure from the
   * promise the rest of the app makes, so it is never the default and it is
   * never quiet.
   */
  let wantTimestamp = $state(false);
  let authorityId = $state(DEFAULT_AUTHORITY_ID);
  let useCustom = $state(false);
  let customUrl = $state('');
  let customError = $state('');
  let stamped = $state<Timestamp | null>(null);
  let sent = $state<Outgoing | null>(null);
  let timestampError = $state('');

  let authority = $derived(authorityById(authorityId) ?? AUTHORITIES[0]);

  /** The address the request will actually go to, or null if it is not valid. */
  let endpoint = $derived.by(() => {
    if (!useCustom) return authority.url;
    const checked = checkAuthorityUrl(customUrl);
    return 'url' in checked ? checked.url : null;
  });

  // ---- saving ---------------------------------------------------------------

  let saving = $state(false);
  let saved = $state(false);
  let saveError = $state('');

  async function save() {
    if (!bytes || !rect || !box || !signature) return;
    if (wantTimestamp && !endpoint) {
      customError = 'Enter a valid https address, or choose one of the authorities above.';
      return;
    }
    saving = true;
    saveError = '';
    timestampError = '';
    stamped = null;
    sent = null;
    customError = '';
    try {
      // Re-open from the original bytes so that saving twice does not stamp a
      // document that was already stamped.
      const fresh = await openPdf(bytes);

      if (signature!.kind === 'vector') {
        applyStamp(fresh.doc, fresh.pages[page], {
          page,
          rect,
          commands: signature!.commands,
          width: signature!.width,
          height: signature!.height,
          color: signature!.color,
        });
      } else {
        const image =
          signature!.type === 'image/png'
            ? await fresh.doc.embedPng(signature!.bytes)
            : await fresh.doc.embedJpg(signature!.bytes);
        applyImageStamp(fresh.doc, fresh.pages[page], {
          page,
          rect,
          image,
          width: signature!.width,
          height: signature!.height,
        });
      }

      const out = await fresh.doc.save();

      if (!wantTimestamp) {
        downloadBlob(new Blob([out], { type: 'application/pdf' }), signedName());
        saved = true;
        return;
      }

      // If the authority cannot be reached, the document is still perfectly
      // good — it simply has no timestamp on it. Saying so and offering it is
      // better than failing the whole save for the optional half of it.
      try {
        const result = await applyDocTimeStamp(out, endpoint!, {
          onOutgoing: (outgoing) => (sent = outgoing),
        });
        stamped = result.timestamp;
        downloadBlob(new Blob([result.bytes], { type: 'application/pdf' }), signedName());
        saved = true;
      } catch (cause) {
        timestampError =
          cause instanceof Error
            ? cause.message
            : 'The timestamp could not be fetched, and the reason was not one the app recognises.';
        downloadBlob(new Blob([out], { type: 'application/pdf' }), signedName());
        saved = true;
      }
    } catch {
      saveError = 'The signed PDF could not be written. The document may be damaged.';
    } finally {
      saving = false;
    }
  }

  /** Written out plainly, because a wall of hex is not a disclosure. */
  function groupHex(hex: string): string {
    return (hex.match(/.{1,8}/g) ?? []).join(' ');
  }

  function signedName(): string {
    const base = fileName.replace(/\.pdf$/i, '');
    return `${base || 'document'}-signed.pdf`;
  }

  let ready = $derived(Boolean(opened && rect && signature));

  /**
   * How the placed picture works out in dots per inch.
   *
   * Only meaningful for a raster: outlines have no resolution to run out of.
   * Measured against the width it is actually placed at, so the answer changes
   * as the size slider moves rather than being a property of the file alone.
   */
  let placedResolution = $derived.by(() => {
    if (!signature || signature.kind !== 'raster' || !rect || !geometry) return null;
    const view = displayedSize(geometry);
    return resolutionFor(signature.width, rect.width * view.width);
  });

  let neededPixels = $derived.by(() => {
    if (!rect || !geometry) return 0;
    return pixelsNeededFor(rect.width * displayedSize(geometry).width);
  });

  /** Where to draw the overlay, in the pixels the page is shown at. */
  let overlay = $derived.by(() => {
    if (!rect || !shown) return null;
    return fitInside(
      {
        x: rect.x * shown.width,
        y: rect.y * shown.height,
        width: rect.width * shown.width,
        height: rect.height * shown.height,
      },
      box?.width ?? 1,
      box?.height ?? 1,
    );
  });

  function readableSize(value: number): string {
    if (value < 1024) return `${value} bytes`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} kB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<!--
  Paste is caught on the window rather than on the drop zone, because a reader
  who has just copied a signature will press Ctrl+V wherever they happen to be
  looking, not after clicking a particular box first.
-->
<svelte:window onpaste={(event) => void onPaste(event)} />

<section class="product-view">
  <div class="workspace">
    <div class="page-head">
      <div>
        <h1>Put a signature on a document</h1>
        <p>
          Open a PDF, place your signature on it and save the result. The file is read in this
          browser and never sent anywhere.
        </p>
      </div>
      <span class="secure-note">Processed in this browser</span>
    </div>

    <div class="flow-shell">
      <div class="flow-main">
        <div class="flow-panel">
          <h2 class="panel-title">1 · Choose a document</h2>
          <p class="panel-copy">
            A PDF can be stamped straight away. Plain text and Markdown are laid out here in a
            moment, on this device. Nothing else is read: a word processor's own Save As or Print
            to PDF will do a better job of its formatting than anything this page could.
          </p>

          {#if verdict}
            <div class="picked">
              <div class="picked-name">{fileName}</div>
              <div class="picked-facts">
                {verdict.format} · {readableSize(sourceSize)}{#if opened} · {opened.pages
                    .length} page{opened.pages.length === 1 ? '' : 's'}{/if}{#if converted} · laid
                  out here as a PDF{/if}
              </div>
            </div>

            {#if openError}
              <div class="notice bad"><strong>Cannot use this file.</strong> {openError}</div>
            {:else if verdict.route === 'text'}
              <div class="notice ok">
                <strong>Laid out as a PDF.</strong>
                Set here with the fonts every PDF reader already has, so nothing was downloaded and
                nothing was sent anywhere. It is a plain setting of the document rather than
                typesetting — check it reads the way you want before signing it.
              </div>
            {:else if verdict.route === 'reject'}
              <div class="notice bad"><strong>Cannot read this one.</strong> {verdict.reason}</div>
            {/if}

            <div class="action-group">
              <button class="button secondary small" type="button" onclick={startOver}>
                Choose a different file
              </button>
            </div>
          {:else}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <label
              class="dropzone"
              class:over
              ondragover={(event) => {
                event.preventDefault();
                over = true;
              }}
              ondragleave={() => (over = false)}
              ondrop={(event) => {
                event.preventDefault();
                over = false;
                void take(event.dataTransfer?.files?.[0]);
              }}
            >
              <div>
                <div class="file-icon" aria-hidden="true">PDF</div>
                <strong>Drop a document here</strong>
                <div class="drop-hint">or click to choose one — PDF, plain text or Markdown</div>
              </div>
              <input
                bind:this={fileInput}
                type="file"
                accept=".pdf,.txt,.text,.log,.md,.markdown"
                onchange={(event) => void take(event.currentTarget.files?.[0])}
              />
            </label>
          {/if}
        </div>

        {#if opened}
          <div class="flow-panel">
            <h2 class="panel-title">2 · Bring in a signature</h2>
            <p class="panel-copy">
              Paste one with <kbd>Ctrl</kbd>+<kbd>V</kbd>, drop the file here, or choose it. Make
              one on the <a href="#/signature">signature screen</a> first and copy or save it from
              there — typed or drawn, either works.
            </p>

            {#if signature}
              <div class="picked">
                <div class="picked-name">{signatureName}</div>
                <div class="picked-facts">
                  {#if signature.kind === 'vector'}
                    SVG · outlines · sharp at any size
                  {:else}
                    {signature.type === 'image/png' ? 'PNG' : 'JPEG'} · {signature.width}×{signature.height}
                    {#if placedResolution} · about {describeDpi(placedResolution.dpi)} as placed{/if}
                  {/if}
                </div>
              </div>

              <div class="signature-preview" class:checks={signature.kind === 'raster'}>
                {#if signature.kind === 'vector'}
                  <svg viewBox="0 0 {signature.width} {signature.height}" aria-label="The signature">
                    <path d={pathData} fill={signature.color} />
                  </svg>
                {:else}
                  <img src={rasterUrl} alt="The signature" />
                {/if}
              </div>

              {#if signature.kind === 'raster' && !signature.hasAlpha}
                <!--
                  The one failure that looks fine on screen and wrong on paper:
                  a JPEG has no transparency, so it lands as a solid rectangle
                  over whatever the document says underneath it.
                -->
                <div class="notice bad">
                  <strong>This picture has no transparent background.</strong>
                  It will cover the document with a solid rectangle wherever it is placed. Use a PNG
                  from the signature screen, which keeps its background transparent.
                </div>
              {:else if placedResolution?.sharpness === 'soft'}
                <div class="notice warn">
                  <strong>Small for the size it is placed at.</strong>
                  About {describeDpi(placedResolution.dpi)} where it sits now, which will look soft
                  in print. Make it smaller on the page, or copy it again at 4× from the signature
                  screen — around {neededPixels.toLocaleString()} pixels wide would print cleanly
                  here.
                </div>
              {/if}

              <div class="action-group">
                <button class="button secondary small" type="button" onclick={clearSignature}>
                  Use a different signature
                </button>
              </div>
            {:else}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <label
                class="dropzone compact"
                class:over={signatureOver}
                ondragover={(event) => {
                  event.preventDefault();
                  signatureOver = true;
                }}
                ondragleave={() => (signatureOver = false)}
                ondrop={(event) => {
                  event.preventDefault();
                  signatureOver = false;
                  const file = event.dataTransfer?.files?.[0];
                  if (file) void takeSignature(file);
                }}
              >
                <div>
                  <strong>Paste, drop or choose a signature</strong>
                  <div class="drop-hint">PNG or SVG — from the signature screen or anywhere else</div>
                </div>
                <input
                  bind:this={signatureInput}
                  type="file"
                  accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
                  onchange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void takeSignature(file);
                  }}
                />
              </label>
            {/if}

            {#if signatureError}
              <div class="notice bad"><strong>Cannot use that one.</strong> {signatureError}</div>
            {/if}
          </div>

          <div class="flow-panel">
            <h2 class="panel-title">3 · Place it, and save</h2>
            <p class="panel-copy">
              Drag the signature to where it goes. Arrow keys nudge it; hold shift to move further.
            </p>

            {#if opened.pages.length > 1}
              <div class="field">
                <label for="document-page">Page</label>
                <select
                  id="document-page"
                  class="input"
                  bind:value={page}
                >
                  {#each opened.pages as _, index}
                    <option value={index}>Page {index + 1} of {opened.pages.length}</option>
                  {/each}
                </select>
              </div>
            {/if}

            <div class="field">
              <label for="document-span">Size</label>
              <input
                id="document-span"
                class="slider"
                type="range"
                min="0.08"
                max="0.8"
                step="0.01"
                bind:value={span}
              />
            </div>

            <div class="sheet">
              {#if rendering && !preview}
                <p class="panel-copy">Drawing the page…</p>
              {/if}
              <div class="sheet-stage" bind:this={previewHost}></div>

              {#if overlay && signature}
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <div
                  class="overlay"
                  role="button"
                  tabindex="0"
                  aria-label="Signature position — drag, or use the arrow keys"
                  style="left: {overlay.x}px; top: {overlay.y}px; width: {overlay.width}px; height: {overlay.height}px"
                  onpointerdown={onPointerDown}
                  onkeydown={onOverlayKey}
                >
                  {#if signature.kind === 'vector'}
                    <!--
                      No transform: toSvg bakes its offset into the path data,
                      so what came back is already in the box the viewBox
                      describes — the same space the stamp draws it in.
                    -->
                    <svg viewBox="0 0 {signature.width} {signature.height}" aria-hidden="true">
                      <path d={pathData} fill={signature.color} />
                    </svg>
                  {:else}
                    <img src={rasterUrl} alt="" />
                  {/if}
                </div>
              {/if}
            </div>

            {#if !signature}
              <div class="notice">Bring in a signature above and it will appear on the page.</div>
            {/if}

            <div class="field timestamp-field">
              <label class="check">
                <input type="checkbox" bind:checked={wantTimestamp} />
                <span>
                  <strong>Add a timestamp</strong>
                  <span class="check-note">
                    Records that this exact file existed at a particular time. It records nothing
                    about who made it.
                  </span>
                </span>
              </label>
            </div>

            {#if wantTimestamp}
              <!--
                The one place in this app where something leaves the device. It
                is stated before it happens, in full, rather than explained
                afterwards in a changelog.
              -->
              <div class="notice warn">
                <strong>This sends one request off your device.</strong>
                It is the only one the app makes, and a timestamp cannot work without
                it: somebody independent has to see the file's fingerprint and sign it,
                or the time means nothing.
                <span class="outgoing-list">
                  <span><strong>What goes:</strong> 32 bytes — the SHA-256 of the finished PDF</span>
                  <span><strong>What does not:</strong> the document, your name, the signature</span>
                  <span
                    ><strong>Where:</strong>
                    <code>{endpoint ?? 'nowhere — the address below is not valid'}</code></span
                  >
                </span>
                A digest cannot be turned back into the file it came from, so the authority
                learns that something existed, not what.
              </div>

              <div class="field">
                <span class="field-label">Authority</span>
                <div class="authority-list">
                  {#each AUTHORITIES as option}
                    <button
                      type="button"
                      class="face-option"
                      class:selected={!useCustom && authorityId === option.id}
                      onclick={() => {
                        useCustom = false;
                        authorityId = option.id;
                      }}
                    >
                      <strong>{option.name}</strong>
                      <span>{option.note}</span>
                    </button>
                  {/each}
                  <button
                    type="button"
                    class="face-option"
                    class:selected={useCustom}
                    onclick={() => (useCustom = true)}
                  >
                    <strong>Another one</strong>
                    <span>Your own authority, if it allows requests from a browser</span>
                  </button>
                </div>
              </div>

              {#if useCustom}
                <div class="field">
                  <label for="tsa-url">Timestamp authority address</label>
                  <input
                    id="tsa-url"
                    class="input"
                    type="url"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="https://tsa.example.org/tsr"
                    bind:value={customUrl}
                  />
                  <p class="field-note">
                    Most authorities refuse requests that come from a web page, and there is
                    nothing this app can do about that from inside a browser. If one does not
                    work, that is usually why.
                  </p>
                </div>
              {:else if !authority.adobeTrusted}
                <div class="notice">
                  Acrobat will not recognise {authority.signedBy}'s certificate and will say the
                  timestamp is of unknown origin. The token is still a real timestamp and any tool
                  with {authority.signedBy}'s published certificate can check it.
                </div>
              {/if}

              {#if customError}
                <div class="notice bad">{customError}</div>
              {/if}
            {/if}

            {#if saveError}
              <div class="notice bad">{saveError}</div>
            {:else if saved}
              {#if timestampError}
                <div class="notice bad">
                  <strong>Saved, without a timestamp.</strong>
                  {timestampError} The PDF was written anyway, with the signature on it.
                </div>
              {:else if stamped}
                <div class="notice ok">
                  <strong>Saved, and timestamped.</strong>
                  {authority.signedBy} states that this exact file existed at
                  <strong>{stamped.time.toISOString().replace('T', ' ').replace('.000Z', ' UTC')}</strong>.
                  It states nothing about who made it, and neither does the file.
                  {#if sent}
                    <span class="outgoing-list">
                      <span><strong>Sent:</strong> <code>{groupHex(sent.digestHex)}</code></span>
                      <span><strong>To:</strong> <code>{sent.url}</code></span>
                    </span>
                  {/if}
                </div>
              {:else}
                <div class="notice ok">
                  <strong>Saved.</strong>
                  The original document is untouched — what was written is a copy with the signature
                  drawn on it.
                </div>
              {/if}
            {/if}

            <div class="action-group">
              <button
                class="button dark small"
                type="button"
                disabled={!ready || saving}
                onclick={() => void save()}
              >
                {saving ? 'Writing…' : wantTimestamp ? 'Save, and timestamp' : 'Save signed PDF'}
              </button>
            </div>
          </div>
        {/if}

        <!--
          The same limit as on the other screen, and it has to be said harder
          here: a signature sitting on a contract looks far more like a signed
          contract than a loose PNG ever does.
        -->
        <div class="notice warn">
          <strong>A signature image is not an electronic signature.</strong>
          Putting a picture of your name on a document proves nothing about who put
          it there — anyone who has the image can do the same to any file. Use this for
          letterheads, forms and returning paperwork, not as evidence that you agreed to
          something.
          <br /><br />
          <strong>A timestamp does not change that.</strong>
          It establishes one fact and no others: that this file existed at a particular time.
          It says nothing about who wrote it, who signed it, or whether anyone agreed to
          anything — and a timestamped document with a picture of your name on it is still
          a document with a picture of your name on it.
        </div>
      </div>

      <aside class="side-card">
        <h3>What you get</h3>
        <p>A copy of your document with the signature drawn onto it.</p>
        <div class="side-list">
          <div>The text of the document stays text — it is not flattened to an image</div>
          <div>
            An SVG signature goes on as paths, sharp at any size; a PNG goes on as a picture, and
            the app says whether it is big enough for where you put it
          </div>
          <div>Read and written in this browser: no server, no account, no analytics</div>
          <div>A PDF that already carries a digital signature is refused, not broken</div>
          <div>Optionally a timestamp, which sends a 32-byte digest and nothing else</div>
        </div>
      </aside>
    </div>
  </div>
</section>
