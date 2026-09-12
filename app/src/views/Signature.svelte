<script lang="ts">
  /**
   * "Signature image" — make a picture of a signature, in three steps: create
   * it, style it, export it.
   *
   * The module imports nothing from the notarization side. What it produces is
   * an image file and nothing more; the notice below says so, and that notice
   * is not decoration — it is the one thing on this screen that protects the
   * rest of the product.
   *
   * The panels are the shell only at this point. Their controls arrive with the
   * path pipeline in lib/signature/, and the stepper starts moving with them.
   */
</script>

<section class="product-view">
  <div class="workspace">
    <div class="page-head">
      <div>
        <h1>Make a signature image</h1>
        <p>
          Type your name in a handwriting face, or draw it, and export a transparent PNG or a
          vector SVG. It is a picture of a signature, not a signature.
        </p>
      </div>
      <span class="secure-note">Processed in this browser</span>
    </div>

    <div class="flow-shell">
      <div class="flow-main">
        <div class="stepper">
          <button class="step active" disabled>1 Create</button>
          <button class="step" disabled>2 Style</button>
          <button class="step" disabled>3 Export</button>
        </div>

        <div class="flow-panel">
          <h2 class="panel-title">Type a name, or draw one</h2>
          <p class="panel-copy">
            Typing sets your name in a handwriting face. Drawing takes it from your mouse, finger
            or stylus. Either way the result becomes the same set of outlines, so the PNG and the
            SVG are the same shape.
          </p>
        </div>

        <!--
          The boundary between this module and xNotary's signing work. Read the
          wording as load-bearing: it is what keeps a decorative image from
          being mistaken for a qualified electronic signature. Inside xNotary
          the link below is `go('attest')` rather than an absolute URL.
        -->
        <div class="notice warn">
          <strong>This is an image, not an electronic signature.</strong>
          It proves nothing about who made it — anyone with the file can put it on any document. To
          prove who signed a document, use
          <a href="https://xnotary.digital/#/attest" target="_blank" rel="noopener noreferrer">
            Signatures</a
          >.
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
