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
  import { clipboardCanTakeImages, copyImage, copySvg } from '../lib/signature/clipboard';
  import { downloadBlob, downloadText, fileNameFor } from '../lib/signature/download';
  import { boundsHeight, boundsWidth, pathBounds } from '../lib/signature/export/bounds';
  import { pngSize, toPng } from '../lib/signature/export/raster';
  import { underlinePath } from '../lib/signature/flourish/underline';
  import { toSvg } from '../lib/signature/export/svg';
  import type { PathCommand } from '../lib/signature/path';
  import { loadSettings, saveSettings } from '../lib/signature/settings';
  import { INKS, SIZES, normalizeHex, sizeById } from '../lib/signature/style';
  import { unsupportedCharacters } from '../lib/signature/type/coverage';
  import { FACES, faceById } from '../lib/signature/type/faces';
  import { loadFace } from '../lib/signature/type/font';
  import { textToPath } from '../lib/signature/type/text-to-path';

  const PADDING = 0.08;

  /**
   * What the PNG comes out as. The multiples are for "bigger, please"; the
   * preset is for a slot of a known size, which is what an email footer or a
   * form field actually is.
   */
  const OUTPUTS = [
    { id: '1x', label: '1×', scale: 1 },
    { id: '2x', label: '2×', scale: 2 },
    { id: '4x', label: '4×', scale: 4 },
    { id: 'preset', label: '800 × 240', fit: { width: 800, height: 240 } },
  ] as const;

  type OutputId = (typeof OUTPUTS)[number]['id'];

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
  let flourish = $state(stored.flourish);
  /**
   * The three panels, and which of them the reader is looking at.
   *
   * xNotary's stepper shows one panel at a time because each of its steps
   * depends on the last: you cannot review a fingerprint before there is a
   * file. Nothing here works that way — the name, the face and the size are
   * all adjusted against the same live preview, and hiding two of them behind
   * a wizard would mean clicking back and forth to change a colour. So all
   * three are on the page, and the stepper becomes what it actually is here: an
   * index of where you are in it, and a way to get somewhere else.
   */
  let panels = $state<(HTMLElement | null)[]>([null, null, null]);
  let activeStep = $state(0);

  let outputId = $state<OutputId>('2x');
  let opaque = $state(false);
  let copied = $state('');
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
  /**
   * Whatever went wrong last, as a heading and a sentence.
   *
   * Both parts are set where the failure happens. A fixed heading was wrong the
   * moment a second action could fail: a refused SVG copy reported "Could not
   * make the PNG", which is a confident answer to a question nobody asked.
   */
  let problem = $state<{ title: string; detail: string } | null>(null);

  const output = $derived(OUTPUTS.find((o) => o.id === outputId) ?? OUTPUTS[1]);
  const canCopy = clipboardCanTakeImages();

  /** One description of the PNG, so the preview, the save and the copy agree. */
  const pngOptions = $derived({
    padding: PADDING,
    color: ink,
    ...('scale' in output ? { scale: output.scale } : { fit: output.fit }),
    ...(opaque ? { background: '#ffffff' } : {}),
  });

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
    saveSettings({ faceId, sizeId, ink, flourish });
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

  /**
   * Ctrl+Z, or Cmd+Z, undoes the last stroke.
   *
   * The only shortcut here, and only while drawing. Claiming keys an app does
   * not need is a good way to break someone's browser habits; undo is the one
   * people will reach for without thinking, because every other drawing
   * surface they have used has it.
   *
   * Shift+Ctrl+Z is left alone rather than swallowed: that is redo everywhere
   * else, and this has none, so it should do nothing rather than the opposite
   * of what was asked.
   */
  /** Whichever panel has most recently passed under the top bar. */
  function updateActiveStep() {
    // At the very bottom, the last panel is what you are reading whether or not
    // it ever reached the top of the window — a short final section cannot be
    // scrolled up any further, so measuring its position would leave the step
    // before it marked for good.
    const remaining = document.documentElement.scrollHeight - scrollY - innerHeight;
    if (remaining < 80) {
      activeStep = panels.length - 1;
      return;
    }

    // Comfortably below the sticky header, so a panel counts as current once
    // its heading is properly on screen rather than grazing the bar.
    const line = 140;
    let current = 0;
    panels.forEach((element, index) => {
      if (element && element.getBoundingClientRect().top <= line) current = index;
    });
    activeStep = current;
  }

  function goToStep(index: number) {
    panels[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Confirmation of a copy describes the file as it was at that moment. Once
  // the signature changes it is about something that no longer exists, so it
  // goes rather than sitting there reassuring the reader about the wrong thing.
  $effect(() => {
    void commands.length;
    copied = '';
  });

  // Measure once the panels exist, and again whenever the page's height changes
  // under us. A browser restores the scroll position on reload, so the first
  // measurement cannot wait for someone to scroll; and showing a preview or a
  // notice moves every panel below it without any scrolling at all.
  $effect(() => {
    void commands.length;
    void mode;
    updateActiveStep();
  });

  function onKeydown(event: KeyboardEvent) {
    if (mode !== 'draw' || !hasStrokes) return;
    if (event.key !== 'z' && event.key !== 'Z') return;
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;

    // Never take the key away from a field someone is typing in.
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]')) return;

    event.preventDefault();
    undoLast();
  }

  const trimmed = $derived(name.trim());

  /** The signature itself, before anything is added under it. */
  const signature = $derived<PathCommand[]>(
    mode === 'draw'
      ? drawn
      : font && trimmed
        ? textToPath(font, trimmed, { fontSize: size.fontSize })
        : [],
  );

  // Measured against the signature alone, then appended. Deriving the flourish
  // from bounds that already included it would make it grow every time it was
  // recomputed.
  const signatureBounds = $derived(pathBounds(signature));

  const commands = $derived<PathCommand[]>(
    flourish && signatureBounds
      ? [...signature, ...underlinePath(signatureBounds)]
      : signature,
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
  const png = $derived(bounds ? pngSize(commands, pngOptions) : null);

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
    problem = null;
    try {
      const blob = await toPng(commands, pngOptions);
      if (blob) downloadBlob(blob, fileNameFor(mode === 'draw' ? '' : trimmed, 'png'));
    } catch (e) {
      problem = { title: 'Could not make the PNG.', detail: e instanceof Error ? e.message : String(e) };
    } finally {
      saving = false;
    }
  }

  async function copyPng() {
    if (!bounds) return;
    saving = true;
    problem = null;
    copied = '';
    try {
      const blob = await toPng(commands, pngOptions);
      if (!blob) return;
      const result = await copyImage(blob);
      if (result.ok) copied = `PNG copied — ${png?.width} × ${png?.height}, ready to paste.`;
      else problem = { title: 'Could not copy the PNG.', detail: result.reason };
    } catch (e) {
      problem = { title: 'Could not copy the PNG.', detail: e instanceof Error ? e.message : String(e) };
    } finally {
      saving = false;
    }
  }

  async function copySvgMarkup() {
    if (!svg) return;
    problem = null;
    copied = '';
    const result = await copySvg(svg);
    if (result.ok) copied = 'SVG copied — paste as a picture, or as markup into an editor.';
    else problem = { title: 'Could not copy the SVG.', detail: result.reason };
  }

  function saveSvg() {
    if (!svg) return;
    problem = null;
    downloadText(svg, fileNameFor(mode === 'draw' ? '' : trimmed, 'svg'), 'image/svg+xml');
  }
</script>

<svelte:window onkeydown={onKeydown} onscroll={updateActiveStep} onresize={updateActiveStep} />

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
          {#each ['1 Create', '2 Style', '3 Export'] as label, index}
            <button
              class="step"
              class:active={activeStep === index}
              aria-current={activeStep === index ? 'step' : undefined}
              onclick={() => goToStep(index)}
            >
              {label}
            </button>
          {/each}
        </div>

        <div class="flow-panel" bind:this={panels[0]}>
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
              <span>PNG <strong>{png.width} × {png.height}</strong></span>
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

        <div class="flow-panel" bind:this={panels[1]}>
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
            <span class="field-label">Underline</span>
            <div class="choice-row">
              <button
                type="button"
                class="choice"
                class:selected={!flourish}
                aria-pressed={!flourish}
                onclick={() => (flourish = false)}
              >
                None
              </button>
              <button
                type="button"
                class="choice"
                class:selected={flourish}
                aria-pressed={flourish}
                onclick={() => (flourish = true)}
              >
                Flourish
              </button>
            </div>
            <p class="field-help">
              A drawn stroke rather than a ruled line: thin at both ends, heavier where a hand
              would bear down, and lifting away at the finish.
            </p>
          </div>

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

        <div class="flow-panel" bind:this={panels[2]}>
          <h2 class="panel-title">Export it</h2>
          <p class="panel-copy">
            Both files are drawn from the same outlines, so they are the same picture. The PNG has
            a transparent background; the SVG contains paths only, so it opens correctly anywhere
            — {mode === 'type'
              ? `with or without ${face.name} installed`
              : 'at any size, without turning into a blurry bitmap'}.
          </p>

          <div class="field">
            <span class="field-label">PNG size</span>
            <div class="choice-row">
              {#each OUTPUTS as option}
                <button
                  type="button"
                  class="choice"
                  class:selected={option.id === outputId}
                  aria-pressed={option.id === outputId}
                  onclick={() => ((outputId = option.id), (copied = ''))}
                >
                  {option.label}
                </button>
              {/each}
            </div>
            <p class="field-help">
              The multiples enlarge the signature as it is. The preset fits it inside a box of
              exactly that many pixels, centred, keeping its proportions — for a slot whose size is
              already decided.
            </p>
          </div>

          <div class="field">
            <span class="field-label">Background</span>
            <div class="choice-row">
              <button
                type="button"
                class="choice"
                class:selected={!opaque}
                aria-pressed={!opaque}
                onclick={() => ((opaque = false), (copied = ''))}
              >
                Transparent
              </button>
              <button
                type="button"
                class="choice"
                class:selected={opaque}
                aria-pressed={opaque}
                onclick={() => ((opaque = true), (copied = ''))}
              >
                White
              </button>
            </div>
            <p class="field-help">
              Transparent is what you usually want. Choose white for the tools that draw an alpha
              channel as a black rectangle. The SVG is unaffected either way.
            </p>
          </div>

          <!--
            Saving is the main path and copying the alternative, so the weight
            separates those rather than separating the two formats. Within each
            pair SVG and PNG look identical, because here they are equal
            choices rather than a main one and an extra.
          -->
          <div class="flow-actions">
            <span class="action-group">
              <button class="button dark" disabled={!svg} onclick={saveSvg}>Save SVG</button>
              <button class="button dark" disabled={!bounds || saving} onclick={savePng}>
                {saving ? 'Rendering…' : 'Save PNG'}
              </button>
            </span>
            {#if canCopy}
              <span class="action-group">
                <button class="button ghost-dark" disabled={!svg} onclick={copySvgMarkup}>
                  Copy SVG
                </button>
                <button class="button ghost-dark" disabled={!bounds || saving} onclick={copyPng}>
                  Copy PNG
                </button>
              </span>
            {/if}
          </div>

          {#if copied}
            <div class="notice ok">{copied}</div>
          {/if}

          {#if problem}
            <div class="notice bad"><strong>{problem.title}</strong> {problem.detail}</div>
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
