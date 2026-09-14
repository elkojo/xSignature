<script lang="ts">
  /**
   * Reading a PDF back: what does it claim, and does the claim hold?
   *
   * The counterpart to the timestamp on the signing screen, and it exists
   * because an app that can make a thing nobody can check has not really made
   * anything. It works on any PDF, not only the ones this app produced.
   *
   * The screen is careful about the difference between what it checked and what
   * it did not. It can say the file has not changed and the token is sound; it
   * cannot say the authority deserves to be believed, and it does not imply it.
   */
  import { checkTimestamps, type CheckedTimestamp } from '../lib/document/verify/verify';

  let fileName = $state('');
  let fileSize = $state(0);
  let checking = $state(false);
  let checked = $state<CheckedTimestamp[] | null>(null);
  let error = $state('');
  let over = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function take(file: File | undefined) {
    if (!file) return;
    fileName = file.name;
    checked = null;
    error = '';
    checking = true;

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      fileSize = bytes.length;
      if (!looksLikePdf(bytes)) {
        error = 'This is not a PDF. Only a PDF can carry a timestamp of this kind.';
        return;
      }
      checked = await checkTimestamps(bytes);
    } catch {
      error = 'This file could not be read. It may be damaged, or only partly downloaded.';
    } finally {
      checking = false;
    }
  }

  function looksLikePdf(bytes: Uint8Array): boolean {
    return [0x25, 0x50, 0x44, 0x46, 0x2d].every((byte, index) => bytes[index] === byte);
  }

  function clear() {
    checked = null;
    error = '';
    fileName = '';
    if (fileInput) fileInput.value = '';
  }

  /** UTC, spelled out. A timestamp in local time invites reading it as local. */
  function when(time: Date): string {
    return `${time.toISOString().replace('T', ' ').replace('.000Z', '')} UTC`;
  }
</script>

<section class="product-view">
  <div class="workspace">
    <div class="page-head">
      <div>
        <h1>Check a PDF</h1>
        <p>
          See whether a PDF carries a timestamp, and whether it still matches the document. The
          file is read in this browser and never sent anywhere.
        </p>
      </div>
      <span class="secure-note">Processed in this browser</span>
    </div>

    <div class="flow-shell">
      <div class="flow-main">
        <div class="flow-panel">
          <h2 class="panel-title">Open a PDF</h2>
          <p class="panel-copy">
            Any PDF, not only one made here. Nothing is uploaded and nothing is fetched — the whole
            check runs on this device, on the file's own bytes.
          </p>

          {#if fileName && !error}
            <div class="picked">
              <div class="picked-name">{fileName}</div>
              <div class="picked-facts">
                {#if checking}
                  Checking…
                {:else if checked}
                  {checked.length === 0
                    ? 'No timestamp or signature found'
                    : `${checked.length} found`}
                {/if}
              </div>
            </div>
            <div class="action-group">
              <button class="button secondary small" type="button" onclick={clear}>
                Check a different file
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
                <strong>Drop a PDF here</strong>
                <div class="drop-hint">or click to choose one</div>
              </div>
              <input
                bind:this={fileInput}
                type="file"
                accept=".pdf"
                onchange={(event) => void take(event.currentTarget.files?.[0])}
              />
            </label>
          {/if}

          {#if error}
            <div class="notice bad"><strong>Cannot check this one.</strong> {error}</div>
            <div class="action-group">
              <button class="button secondary small" type="button" onclick={clear}>
                Try another file
              </button>
            </div>
          {/if}
        </div>

        {#if checked && checked.length === 0 && !error}
          <div class="flow-panel">
            <h2 class="panel-title">Nothing to check</h2>
            <p class="panel-copy">
              This PDF carries no timestamp and no digital signature. That is not a fault — most
              PDFs do not. It means there is nothing in the file that says when it existed, so
              nothing here can be confirmed or contradicted.
            </p>
            <p class="panel-copy">
              A picture of a signature on a page is not something that can be checked: it is ink on
              a page like any other, and it leaves no trace of who put it there.
            </p>
          </div>
        {/if}

        {#each checked ?? [] as result, index}
          <div class="flow-panel">
            <h2 class="panel-title">
              {result.isTimestamp ? 'Timestamp' : 'Signature'}{(checked?.length ?? 0) > 1
                ? ` ${index + 1}`
                : ''}
            </h2>

            {#if result.verdict === 'intact'}
              <div class="notice ok">
                <strong>The document has not changed since it was stamped.</strong>
                The bytes here are the bytes the timestamp was taken over.
              </div>
            {:else if result.verdict === 'altered'}
              <div class="notice bad">
                <strong>This document has been changed.</strong>
                {result.detail}
              </div>
            {:else if result.verdict === 'broken'}
              <div class="notice bad"><strong>The token does not hold up.</strong> {result.detail}</div>
            {:else}
              <div class="notice warn">
                <strong>Could not read it.</strong>
                {result.detail}
              </div>
            {/if}

            <div class="facts">
              {#if result.time}
                <div><span>Stated time</span><strong>{when(result.time)}</strong></div>
              {/if}
              {#if result.signedBy}
                <div><span>Signed by</span><strong>{result.signedBy}</strong></div>
              {/if}
              {#if result.policy}
                <div><span>Policy</span><code>{result.policy}</code></div>
              {/if}
              <div>
                <span>Covers</span>
                <strong>
                  {#if result.coversToEndOfFile}
                    <!--
                      The raw figure is smaller than the file and reads as though
                      the timestamp only reached part of it. What it does not
                      include is the token's own bytes, which cannot sign
                      themselves.
                    -->
                    the whole document, apart from the timestamp's own {(
                      fileSize - result.covers
                    ).toLocaleString()} bytes
                  {:else}
                    {result.covers.toLocaleString()} of {fileSize.toLocaleString()} bytes — not to the
                    end of the file
                  {/if}
                </strong>
              </div>
            </div>

            {#if !result.coversToEndOfFile}
              <div class="notice warn">
                <strong>Something was added after this was stamped.</strong>
                The timestamp does not reach the end of the file, so part of what you would see on
                opening it is not covered by anything above.
              </div>
            {/if}

            <!--
              The limit of the check, next to the check rather than in a footnote.
              Saying "verified" without this would be the dishonest version.
            -->
            <div class="notice">
              <strong>What this does not tell you.</strong>
              Whether <em>{result.signedBy ?? 'that signer'}</em> is who they say they are, and
              whether anyone should believe them, is not checked here — that needs a list of trusted
              authorities kept up to date against revocations, which this app has no way to do
              offline. Open the file in a PDF reader for that judgement. The name above is read
              straight out of the token and is not vouched for.
            </div>
          </div>
        {/each}
      </div>

      <aside class="side-card">
        <h3>What is checked</h3>
        <p>Two things, both on this device.</p>
        <div class="side-list">
          <div>That the document still matches the timestamp, byte for byte</div>
          <div>That the token's own signature holds against the certificate in it</div>
          <div>Whether anything was appended after the stamp was made</div>
        </div>
        <p class="side-foot">
          Not checked: whether the authority is trustworthy. That needs a trust store and a
          network, and belongs in a PDF reader.
        </p>
      </aside>
    </div>
  </div>
</section>
