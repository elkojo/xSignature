<script lang="ts">
  /**
   * "Signature image" — type a name, look at it, take the file.
   *
   * The app is self-contained: it talks to no server and to no other app. What
   * it produces is an image file and nothing more; the notice below says so,
   * and that notice is not decoration — it is the one honest thing on a screen
   * that could otherwise be mistaken for something with legal weight.
   *
   * No geometry happens in this file. It reads a name, asks lib/signature for
   * outlines, and hands the same outlines to the SVG writer and the rasterizer.
   */
  import { downloadBlob, downloadText, fileNameFor } from '../lib/signature/download';
  import { boundsHeight, boundsWidth, pathBounds } from '../lib/signature/export/bounds';
  import { pngSize, toPng } from '../lib/signature/export/raster';
  import { toSvg } from '../lib/signature/export/svg';
  import { unsupportedCharacters } from '../lib/signature/type/coverage';
  import { FACES } from '../lib/signature/type/faces';
  import { loadFace } from '../lib/signature/type/font';
  import { textToPath } from '../lib/signature/type/text-to-path';
  import type { PathCommand } from '../lib/signature/path';

  /** One face and one colour for now; the rest of the controls come next. */
  const face = FACES[0];
  const INK = '#10201a';
  const FONT_SIZE = 120;
  const PADDING = 0.08;
  const SCALE = 2;

  let name = $state('');
  let font = $state<Awaited<ReturnType<typeof loadFace>> | null>(null);
  let fontError = $state('');
  let saving = $state(false);
  let saveError = $state('');

  // Loading the face is the only thing here that can be slow or fail, and it
  // happens once. Everything downstream is synchronous maths on its outlines.
  $effect(() => {
    let cancelled = false;
    loadFace(face)
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

  const trimmed = $derived(name.trim());

  // A face asked for a glyph it lacks draws an empty box and reports nothing.
  // Letting that reach the export would hand someone a picture of rectangles
  // and call it their signature.
  const missing = $derived(font && trimmed ? unsupportedCharacters(font, trimmed) : []);

  const commands = $derived<PathCommand[]>(
    font && trimmed ? textToPath(font, trimmed, { fontSize: FONT_SIZE }) : [],
  );

  // Null rather than an empty box when there is no ink: a name of nothing but
  // spaces draws nothing, and there is no meaningful size for nothing.
  const ink = $derived(pathBounds(commands));

  const svg = $derived(ink ? toSvg(commands, { padding: PADDING, color: INK }) : null);

  const size = $derived(
    ink ? pngSize(commands, { padding: PADDING, color: INK, scale: SCALE }) : null,
  );

  async function savePng() {
    if (!ink) return;
    saving = true;
    saveError = '';
    try {
      const blob = await toPng(commands, { padding: PADDING, color: INK, scale: SCALE });
      if (blob) downloadBlob(blob, fileNameFor(trimmed, 'png'));
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function saveSvg() {
    if (!svg) return;
    downloadText(svg, fileNameFor(trimmed, 'svg'), 'image/svg+xml');
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
          <button class="step" class:active={!!ink} disabled>2 Export</button>
        </div>

        <div class="flow-panel">
          <h2 class="panel-title">Type a name</h2>
          <p class="panel-copy">
            The name is set in {face.name} and converted to outlines here, on this device. It is
            never sent anywhere, and it is not saved when you close the page.
          </p>

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

          <div class="ink-stage">
            {#if fontError}
              <p class="empty-ink">{fontError}</p>
            {:else if !font}
              <p class="empty-ink">Loading {face.name}…</p>
            {:else if !ink}
              <p class="empty-ink">Your signature appears here as you type.</p>
            {:else}
              <!--
                Generated by toSvg from outlines this app computed; the only
                attribute carrying outside input is the colour, which that
                function escapes. The typed name never reaches the markup as
                text — by the time it gets here it is path data.
              -->
              {@html svg}
            {/if}
          </div>

          {#if ink && size}
            <div class="ink-facts">
              <span>Ink <strong>{Math.round(boundsWidth(ink))} × {Math.round(boundsHeight(ink))}</strong></span>
              <span>PNG <strong>{size.width} × {size.height}</strong> at {SCALE}×</span>
              <span>SVG <strong>{((svg?.length ?? 0) / 1024).toFixed(1)} kB</strong> vector, no font needed</span>
            </div>
          {/if}

          {#if missing.length}
            <div class="notice warn">
              <strong>{face.name} cannot draw {missing.map((c) => `"${c}"`).join(', ')}.</strong>
              {missing.length === 1 ? 'It comes out as an empty box.' : 'They come out as empty boxes.'}
              This face covers Latin, including accented letters; it has no glyphs for other
              scripts.
            </div>
          {/if}

          <div class="flow-actions">
            <button class="button ghost-dark" disabled={!svg} onclick={saveSvg}>
              Save SVG
            </button>
            <button class="button dark" disabled={!ink || saving} onclick={savePng}>
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
