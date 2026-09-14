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
  import { downloadBlob } from '../lib/signature/download';
  import { pathBounds } from '../lib/signature/export/bounds';
  import { layout } from '../lib/signature/export/layout';
  import { toPathData, type PathCommand } from '../lib/signature/path';
  import { INKS } from '../lib/signature/style';
  import { DEFAULT_FACE_ID, FACES, faceById } from '../lib/signature/type/faces';
  import { loadFace } from '../lib/signature/type/font';
  import { textToPath } from '../lib/signature/type/text-to-path';

  /** The margin the signature keeps around its own ink, as on the other screen. */
  const PADDING = 0.08;
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

  let name = $state('');
  let faceId = $state(DEFAULT_FACE_ID);
  let ink = $state<string>(INKS[0].hex);
  let commands = $state<PathCommand[]>([]);

  // The ink is measured once, here, and both the overlay and the stamp use
  // these numbers — so what is dragged on screen is what lands on the page.
  let box = $derived.by(() => {
    const bounds = pathBounds(commands);
    return bounds ? layout(bounds, { padding: PADDING }) : null;
  });

  let pathData = $derived(toPathData(commands));

  $effect(() => {
    const face = faceById(faceId);
    const text = name.trim();
    if (!face || !text) {
      commands = [];
      return;
    }

    let current = true;
    void loadFace(face)
      .then((font) => {
        // A face that arrives after the reader has moved on must not overwrite
        // what they chose in the meantime.
        if (current) commands = textToPath(font, text, { fontSize: 120 });
      })
      .catch(() => {
        if (current) commands = [];
      });
    return () => {
      current = false;
    };
  });

  // ---- step 3: placing it ---------------------------------------------------

  let page = $state(0);
  let preview = $state<{ canvas: HTMLCanvasElement; width: number; height: number } | null>(null);
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
    const canvas = preview?.canvas;
    if (!host || !canvas) return;
    host.replaceChildren(canvas);
  });

  function onPointerDown(event: PointerEvent) {
    if (!rect || !preview) return;
    const surface = event.currentTarget as HTMLElement;
    surface.setPointerCapture(event.pointerId);

    // Where in the signature the pointer took hold, so it does not jump.
    const grabX = event.clientX;
    const grabY = event.clientY;
    const from = { ...at };

    const move = (moved: PointerEvent) => {
      const dx = (moved.clientX - grabX) / preview!.width;
      const dy = (moved.clientY - grabY) / preview!.height;
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
    if (!bytes || !rect || !box || commands.length === 0) return;
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
      applyStamp(fresh.doc, fresh.pages[page], {
        page,
        rect,
        commands,
        width: box.width,
        height: box.height,
        color: ink,
      });

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

  let ready = $derived(Boolean(opened && rect && commands.length > 0));

  /** Where to draw the overlay, in preview pixels. */
  let overlay = $derived.by(() => {
    if (!rect || !preview) return null;
    return fitInside(
      {
        x: rect.x * preview.width,
        y: rect.y * preview.height,
        width: rect.width * preview.width,
        height: rect.height * preview.height,
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
            <h2 class="panel-title">2 · Write the signature</h2>
            <p class="panel-copy">
              The same outlines the signature screen makes, so what goes onto the page is a drawing
              rather than a font the reader may not have.
            </p>

            <div class="field">
              <label for="document-name">Name</label>
              <input
                id="document-name"
                class="input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                bind:value={name}
                placeholder="Ada Lovelace"
              />
            </div>

            <div class="field">
              <span class="field-label">Face</span>
              <div class="face-grid">
                {#each FACES as face}
                  <button
                    type="button"
                    class="face-option"
                    class:selected={faceId === face.id}
                    onclick={() => (faceId = face.id)}
                  >
                    <strong>{face.name}</strong>
                    <span>{face.note}</span>
                  </button>
                {/each}
              </div>
            </div>

            <div class="field">
              <span class="field-label">Ink</span>
              <div class="swatches">
                {#each INKS as colour}
                  <button
                    type="button"
                    class="swatch"
                    class:selected={ink === colour.hex}
                    style="background: {colour.hex}"
                    title={colour.name}
                    aria-label={colour.name}
                    onclick={() => (ink = colour.hex)}
                  ></button>
                {/each}
              </div>
            </div>
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

              {#if overlay && commands.length > 0}
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
                  <svg viewBox="0 0 {box?.width} {box?.height}" aria-hidden="true">
                    <path
                      d={pathData}
                      fill={ink}
                      transform="translate({box?.translateX} {box?.translateY})"
                    />
                  </svg>
                </div>
              {/if}
            </div>

            {#if commands.length === 0}
              <div class="notice">Type a name above and it will appear on the page.</div>
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
          <div>The signature is a vector path, sharp at any zoom and any print size</div>
          <div>Read and written in this browser: no server, no account, no analytics</div>
          <div>A PDF that already carries a digital signature is refused, not broken</div>
          <div>Optionally a timestamp, which sends a 32-byte digest and nothing else</div>
        </div>
      </aside>
    </div>
  </div>
</section>
