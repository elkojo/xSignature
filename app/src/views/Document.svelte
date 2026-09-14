<script lang="ts">
  /**
   * Signing a document: take a file in, put a signature on it, give a PDF
   * back. This screen is being built in stages, and today it does the first
   * one — work out what the file is and what it would take to stamp it.
   *
   * Reading the file is deliberately shallow. Eight bytes are enough to tell a
   * PDF from everything else, and knowing that before anything else happens is
   * what lets the reader be told the cost up front: a PDF is stamped by code
   * already on the page, and anything else needs a converter that is a large
   * download.
   */
  import { accept, HEAD_BYTES, type Accepted } from '../lib/document/accept';

  interface Chosen {
    name: string;
    size: number;
    verdict: Accepted;
  }

  let chosen = $state<Chosen | null>(null);
  let over = $state(false);
  let input = $state<HTMLInputElement | null>(null);

  async function take(file: File | undefined) {
    if (!file) return;
    const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
    chosen = { name: file.name, size: file.size, verdict: accept(file.name, head) };
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    over = false;
    void take(event.dataTransfer?.files?.[0]);
  }

  function clear() {
    chosen = null;
    if (input) input.value = '';
  }

  /** Sizes the way a file manager writes them, not in raw bytes. */
  function readableSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<section class="product-view">
  <div class="workspace">
    <div class="page-head">
      <div>
        <h1>Put a signature on a document</h1>
        <p>
          Open a document, place your signature on it and save the result as a PDF. The file is
          read in this browser and never sent anywhere.
        </p>
      </div>
      <span class="secure-note">Processed in this browser</span>
    </div>

    <div class="flow-shell">
      <div class="flow-main">
        <div class="flow-panel">
          <h2 class="panel-title">Choose a document</h2>
          <p class="panel-copy">
            A PDF can be stamped straight away. Word, OpenDocument, Markdown and the rest have to
            be converted to a PDF first, which needs a converter this page does not carry — it is
            fetched only if you ask for it, and the size is stated before it starts.
          </p>

          {#if chosen}
            <div class="picked">
              <div class="picked-name">{chosen.name}</div>
              <div class="picked-facts">
                {chosen.verdict.format} · {readableSize(chosen.size)}
              </div>
            </div>

            {#if chosen.verdict.route === 'stamp'}
              <div class="notice ok">
                <strong>Ready to stamp.</strong>
                This is already a PDF, so nothing has to be converted and nothing has to be downloaded.
              </div>
            {:else if chosen.verdict.route === 'convert'}
              <div class="notice">
                <strong>Needs converting first.</strong>
                {chosen.verdict.format} is not a PDF, so it has to be laid out as one before a signature
                can go on it.
              </div>
            {:else}
              <div class="notice bad">
                <strong>Cannot read this one.</strong>
                {chosen.verdict.reason}
              </div>
            {/if}

            <div class="action-group">
              <button class="button secondary small" type="button" onclick={clear}>
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
              ondrop={onDrop}
            >
              <div>
                <div class="file-icon" aria-hidden="true">PDF</div>
                <strong>Drop a document here</strong>
                <div class="drop-hint">or click to choose one — PDF, Word, OpenDocument, Markdown, plain text</div>
              </div>
              <input
                bind:this={input}
                type="file"
                accept=".pdf,.docx,.odt,.rtf,.md,.markdown,.txt,.html,.htm,.epub,.tex,.rst,.org,.adoc"
                onchange={(event) => void take(event.currentTarget.files?.[0])}
              />
            </label>
          {/if}
        </div>

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
        </div>
      </div>

      <aside class="side-card">
        <h3>What this screen does</h3>
        <p>Being built in stages. This is what works today.</p>
        <div class="side-list">
          <div>Reads the file in this browser — nothing is uploaded</div>
          <div>Tells you whether it can be stamped as-is or needs converting</div>
          <div>Refuses formats it genuinely cannot read, and says why</div>
        </div>
      </aside>
    </div>
  </div>
</section>
