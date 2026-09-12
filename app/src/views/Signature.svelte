<script lang="ts">
  /**
   * "Signature image" — type a name, style it, take the file.
   *
   * The app is self-contained: it talks to no server and to no other app. What
   * it produces is an image file and nothing more; the notice below says so,
   * and that notice is not decoration — it is the one honest thing on a screen
   * that could otherwise be mistaken for something with legal weight.
   *
   * No geometry happens in this file. It reads a name and some settings, asks
   * lib/signature for outlines, and hands the same outlines to the SVG writer
   * and the rasterizer.
   */
  import { untrack } from 'svelte';
  import type SignaturePad from 'signature_pad';

  import { createPad, fitPad, inkFrom, padHasPressure, undoStroke } from '../lib/signature/draw/pad';
  import { outlineInk } from '../lib/signature/draw/outline';
  import { downloadBlob, downloadText, fileNameFor } from '../lib/signature/download';
  import { boundsHeight, boundsWidth, pathBounds } from '../lib/signature/export/bounds';
  import { pngSize, toPng } from '../lib/signature/export/raster';
  import { toSvg } from '../lib/signature/export/svg';
  import type { PathCommand } from '../lib/signature/path';
  import { loadSettings, saveSettings } from '../lib/signature/settings';
  import { INKS, SIZES, normalizeHex, sizeById } from '../lib/signature/style';
  import { unsupportedCharacters } from '../lib/signature/type/coverage';
  import { FACES, faceById } from '../lib/signature/type/faces';
  import { loadFace } from '../lib/signature/type/font';
  import { textToPath } from '../lib/signature/type/text-to-path';

  const PADDING = 0.08;
  const SCALE = 2;

  const stored = loadSettings();

  type Mode = 'type' | 'draw';
  let mode = $state<Mode>('type');

  let name = $state('');

  let canvas = $state<HTMLCanvasElement | null>(null);
  let pad: SignaturePad | null = null;

  /**
   * The drawn outline, recomputed whenever the pad changes.
   *
   * Held as state rather than derived from the pad, because the pad is a plain
   * object that knows nothing about reactivity: there is no signal to depend
   * on, and inventing one would mean a dependency that reads as a mistake.
   * This is the honest version — the events that change the drawing are the
   * events that update this.
   */
  let drawn = $state<PathCommand[]>([]);
  let hasStrokes = $state(false);
  /** True once a stylus has reported pressure that actually varies. */
  let usingPressure = $state(false);
  let faceId = $state(stored.faceId);
  let sizeId = $state(stored.sizeId);
  let ink = $state(stored.ink);
  let hexDraft = $state(stored.ink);
  let hexRejected = $state(false);

  /** A dark backdrop for the preview, because white ink on white shows nothing. */
  let darkStage = $state(false);

  let font = $state<Awaited<ReturnType<typeof loadFace>> | null>(null);
  let fontError = $state('');
  let saving = $state(false);
  let saveError = $state('');

  const face = $derived(faceById(faceId) ?? FACES[0]);
  const size = $derived(sizeById(sizeId));

  // The chosen face is the only thing here that can be slow or fail. Everything
  // downstream is synchronous maths on its outlines.
  $effect(() => {
    const wanted = face;
    let cancelled = false;
    font = null;
    fontError = '';
    loadFace(wanted)
      .then((loaded) => {
        if (!cancelled) font = loaded;
      })
      .catch((e: unknown) => {
        if (!cancelled) fontError = e instanceof Error ? e.message : String(e);
      });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    saveSettings({ faceId, sizeId, ink });
  });

  // The pad lives as long as its canvas, and only as long as its canvas.
  //
  // `ink` is read untracked deliberately. Reading it normally would make the
  // colour a dependency of this effect, so choosing a different ink would tear
  // the pad down and build a new one — wiping the drawing. That failed
  // quietly rather than loudly: the preview went on showing the old signature
  // from state while the canvas underneath was blank and the next stroke
  // started from nothing. The colour is applied by the effect below instead,
  // which is the only thing that should react to it.
  $effect(() => {
    const element = canvas;
    if (!element) return;

    const created = createPad(element, { penColor: untrack(() => ink) });
    pad = created;
    fitPad(created, element);

    const onStroke = () => refreshDrawing();
    created.addEventListener('endStroke', onStroke);

    const resize = new ResizeObserver(() => {
      fitPad(created, element);
      refreshDrawing();
    });
    resize.observe(element);

    return () => {
      resize.disconnect();
      created.removeEventListener('endStroke', onStroke);
      created.off();
      pad = null;
    };
  });

  // Keep the live ink the colour it will be exported in.
  $effect(() => {
    if (pad) pad.penColor = ink;
  });

  function refreshDrawing() {
    drawn = pad ? outlineInk(inkFrom(pad)) : [];
    hasStrokes = !!pad && !pad.isEmpty();
    usingPressure = !!pad && padHasPressure(pad);
  }

  function clearDrawing() {
    pad?.clear();
    refreshDrawing();
  }

  function undoLast() {
    if (pad) undoStroke(pad);
    refreshDrawing();
  }

  const trimmed = $derived(name.trim());

  const commands = $derived<PathCommand[]>(
    mode === 'draw'
      ? drawn
      : font && trimmed
        ? textToPath(font, trimmed, { fontSize: size.fontSize })
        : [],
  );

  // A face asked for a glyph it lacks draws an empty box and reports nothing.
  // Letting that reach the export would hand someone a picture of rectangles
  // and call it their signature.
  const missing = $derived(
    mode === 'type' && font && trimmed ? unsupportedCharacters(font, trimmed) : [],
  );

  // Null rather than an empty box when there is no ink: a name of nothing but
  // spaces draws nothing, and there is no meaningful size for nothing.
  const bounds = $derived(pathBounds(commands));
  const svg = $derived(bounds ? toSvg(commands, { padding: PADDING, color: ink }) : null);
  const png = $derived(
    bounds ? pngSize(commands, { padding: PADDING, color: ink, scale: SCALE }) : null,
  );

  function pickHex(value: string) {
    hexDraft = value;
    const parsed = normalizeHex(value);
    hexRejected = value.trim() !== '' && parsed === null;
    if (parsed) ink = parsed;
  }

  function pickInk(hex: string) {
    ink = hex;
    hexDraft = hex;
    hexRejected = false;
  }

  async function savePng() {
    if (!bounds) return;
    saving = true;
    saveError = '';
    try {
      const blob = await toPng(commands, { padding: PADDING, color: ink, scale: SCALE });
      if (blob) downloadBlob(blob, fileNameFor(mode === 'draw' ? '' : trimmed, 'png'));
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function saveSvg() {
    if (svg) downloadText(svg, fileNameFor(mode === 'draw' ? '' : trimmed, 'svg'), 'image/svg+xml');
  }
</script>

<section class="product-view">
  <div class="workspace">
    <div class="page-head">
      <div>
        <h1>Make a signature image</h1>
        <p>
          Type your name in a handwriting face and export a transparent PNG or a vector SVG. It is
          a picture of a signature, not a signature.
        </p>
      </div>
      <span class="secure-note">Processed in this browser</span>
    </div>

    <div class="flow-shell">
      <div class="flow-main">
        <div class="stepper">
          <button class="step active" disabled>1 Create</button>
          <button class="step" class:active={!!bounds} disabled>2 Style</button>
          <button class="step" class:active={!!bounds} disabled>3 Export</button>
        </div>

        <div class="flow-panel">
          <h2 class="panel-title">Type a name, or draw one</h2>
          <p class="panel-copy">
            Either way the result becomes the same kind of outline, so the PNG and the SVG are the
            same picture. Nothing you type or draw is sent anywhere, and none of it is kept when
            you close the page.
          </p>

          <div class="mode-tabs" role="tablist" aria-label="How to make the signature">
            <button
              type="button"
              role="tab"
              class="mode-tab"
              class:selected={mode === 'type'}
              aria-selected={mode === 'type'}
              onclick={() => (mode = 'type')}
            >
              Type
            </button>
            <button
              type="button"
              role="tab"
              class="mode-tab"
              class:selected={mode === 'draw'}
              aria-selected={mode === 'draw'}
              onclick={() => (mode = 'draw')}
            >
              Draw
            </button>
          </div>

          {#if mode === 'type'}
            <div class="field">
              <label for="signature-name">Name</label>
              <input
                id="signature-name"
                class="input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                bind:value={name}
                placeholder="Ada Lovelace"
              />
            </div>
          {:else}
            <div class="field">
              <span class="field-label">Sign here</span>
              <!--
                touch-action is set on the element by signature_pad itself, so a
                finger draws instead of scrolling the page.
              -->
              <canvas
                bind:this={canvas}
                class="pad"
                class:dark={darkStage}
                aria-label="Drawing area"
              ></canvas>
              <div class="pad-tools">
                <span class="field-help">
                  {usingPressure
                    ? 'Stylus pressure is being used: press harder for a heavier line.'
                    : 'Mouse, finger or stylus. The line thickens where you slow down.'}
                </span>
                <span class="pad-buttons">
                  <button type="button" class="stage-toggle" disabled={!hasStrokes} onclick={undoLast}>
                    Undo stroke
                  </button>
                  <button type="button" class="stage-toggle" disabled={!hasStrokes} onclick={clearDrawing}>
                    Clear
                  </button>
                </span>
              </div>
            </div>
          {/if}

          <div class="ink-stage" class:dark={darkStage}>
            {#if mode === 'type' && fontError}
              <p class="empty-ink">{fontError}</p>
            {:else if mode === 'type' && !font}
              <p class="empty-ink">Loading {face.name}…</p>
            {:else if !bounds}
              <p class="empty-ink">
                {mode === 'draw'
                  ? 'What you draw above appears here, trimmed and ready to export.'
                  : 'Your signature appears here as you type.'}
              </p>
            {:else}
              <!--
                Generated by toSvg from outlines this app computed; the only
                attribute carrying outside input is the colour, which that
                function escapes and normalizeHex has already vetted. The typed
                name never reaches the markup as text — by the time it gets
                here it is path data.
              -->
              {@html svg}
            {/if}
          </div>

          <div class="stage-tools">
            <span class="stage-hint">Checks show where the image is transparent.</span>
            <button
              type="button"
              class="stage-toggle"
              aria-pressed={darkStage}
              onclick={() => (darkStage = !darkStage)}
            >
              {darkStage ? 'On light' : 'On dark'}
            </button>
          </div>

          {#if bounds && png}
            <div class="ink-facts">
              <span>
                Ink <strong>{Math.round(boundsWidth(bounds))} × {Math.round(boundsHeight(bounds))}</strong>
              </span>
              <span>PNG <strong>{png.width} × {png.height}</strong> at {SCALE}×</span>
              <span>SVG <strong>{((svg?.length ?? 0) / 1024).toFixed(1)} kB</strong> vector</span>
            </div>
          {/if}

          {#if missing.length}
            <div class="notice warn">
              <strong>{face.name} cannot draw {missing.map((c) => `"${c}"`).join(', ')}.</strong>
              {missing.length === 1 ? 'It comes out as an empty box.' : 'They come out as empty boxes.'}
              Another face may have the glyph — the notes beside each one say which are limited.
            </div>
          {/if}
        </div>

        <div class="flow-panel">
          <h2 class="panel-title">Style it</h2>
          <p class="panel-copy">
            {mode === 'type'
              ? 'Size sets the em size the glyphs are laid out at, so a large signature is drawn large rather than magnified.'
              : 'A drawn signature carries its own size and weight, so only the ink applies here.'}
            Your choices are remembered; what you write is not.
          </p>

          {#if mode === 'type'}
          <div class="field">
            <span class="field-label">Face</span>
            <div class="face-grid">
              {#each FACES as option}
                <button
                  type="button"
                  class="face-option"
                  class:selected={option.id === faceId}
                  aria-pressed={option.id === faceId}
                  onclick={() => (faceId = option.id)}
                >
                  <strong>{option.name}</strong>
                  <span>{option.note}</span>
                </button>
              {/each}
            </div>
          </div>

          <div class="field">
            <span class="field-label">Size</span>
            <div class="choice-row">
              {#each SIZES as option}
                <button
                  type="button"
                  class="choice"
                  class:selected={option.id === sizeId}
                  aria-pressed={option.id === sizeId}
                  onclick={() => (sizeId = option.id)}
                >
                  {option.label}
                </button>
              {/each}
            </div>
          </div>

          {/if}

          <div class="field">
            <span class="field-label">Ink</span>
            <div class="swatches">
              {#each INKS as option}
                <button
                  type="button"
                  class="swatch"
                  class:selected={option.hex === ink}
                  style="--swatch: {option.hex}"
                  aria-pressed={option.hex === ink}
                  aria-label={option.name}
                  title={option.name}
                  onclick={() => pickInk(option.hex)}
                ></button>
              {/each}
            </div>

            <div class="hex-row">
              <label for="signature-hex">Or a hex colour</label>
              <input
                id="signature-hex"
                class="input hex-input"
                class:bad={hexRejected}
                type="text"
                autocomplete="off"
                spellcheck="false"
                inputmode="text"
                maxlength="7"
                value={hexDraft}
                oninput={(e) => pickHex(e.currentTarget.value)}
                placeholder="#1f3a68"
              />
            </div>
            {#if hexRejected}
              <p class="field-help">
                Not a hex colour. Use three or six digits, like #abc or #1f3a68.
              </p>
            {/if}
          </div>
        </div>

        <div class="flow-panel">
          <h2 class="panel-title">Export it</h2>
          <p class="panel-copy">
            Both files are drawn from the same outlines, so they are the same picture. The PNG has
            a transparent background; the SVG contains paths only, so it opens correctly anywhere
            — {mode === 'type'
              ? `with or without ${face.name} installed`
              : 'at any size, without turning into a blurry bitmap'}.
          </p>

          <div class="flow-actions">
            <button class="button ghost-dark" disabled={!svg} onclick={saveSvg}>Save SVG</button>
            <button class="button dark" disabled={!bounds || saving} onclick={savePng}>
              {saving ? 'Rendering…' : 'Save PNG'}
            </button>
          </div>

          {#if saveError}
            <div class="notice bad"><strong>Could not make the PNG.</strong> {saveError}</div>
          {/if}
        </div>

        <!--
          Read this wording as load-bearing: it is what keeps a decorative image
          from being mistaken for a qualified electronic signature. It names the
          limit and stops there — it sends nobody anywhere, because this app
          reaches nothing outside itself.
        -->
        <div class="notice warn">
          <strong>This is an image, not an electronic signature.</strong>
          It proves nothing about who made it — anyone who has the file can put it on any document.
          Use it for letterheads, email footers and form fields, not as evidence that you signed
          something.
        </div>
      </div>

      <aside class="side-card">
        <h3>What you get</h3>
        <p>Two files of the same signature, drawn from the same outlines.</p>
        <div class="side-list">
          <div>A PNG with a transparent background</div>
          <div>An SVG made of paths — no font needed to open it</div>
          <div>Nothing uploaded: no server, no account, no analytics</div>
          <div>Works offline once the page has loaded</div>
        </div>
      </aside>
    </div>
  </div>
</section>
