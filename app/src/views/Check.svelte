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
  import { checkSignatures, type CheckedSignature } from '../lib/document/verify/verify';

  let fileName = $state('');
  let fileSize = $state(0);
  let checking = $state(false);
  let checked = $state<CheckedSignature[] | null>(null);
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
      checked = await checkSignatures(bytes);
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
                <strong>
                  The document has not changed since it was {result.isTimestamp
                    ? 'stamped'
                    : 'signed'}.
                </strong>
                The bytes here are the bytes it was taken over.
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
                <div>
                  <span>{result.isTimestamp ? 'Stated time' : "Signer's own clock"}</span>
                  <strong>{when(result.time)}</strong>
                </div>
              {/if}
              {#if result.reason}
                <div><span>Reason</span><strong>{result.reason}</strong></div>
              {/if}
              {#if result.location}
                <div><span>Location</span><strong>{result.location}</strong></div>
              {/if}
              {#if result.signedBy}
                <div><span>Signed by</span><strong>{result.signedBy}</strong></div>
              {/if}
              {#if result.policy}
                <div><span>Policy</span><code>{result.policy}</code></div>
              {/if}
              {#if result.timestamp}
                <div>
                  <span>Timestamped</span>
                  <strong>
                    {when(result.timestamp.time)}{result.timestamp.signedBy
                      ? ` by ${result.timestamp.signedBy}`
                      : ''}
                  </strong>
                </div>
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
                    the whole document, apart from its own {(
                      fileSize - result.covers
                    ).toLocaleString()} bytes
                  {:else}
                    {result.covers.toLocaleString()} of {fileSize.toLocaleString()} bytes — not to the
                    end of the file
                  {/if}
                </strong>
              </div>
            </div>

            {#if !result.isTimestamp && result.certificateCount > 0}
              <!--
                Whether the signature brought the certificates a reader needs to
                trace it. This is the half the recipient cares about, and the
                half a leaf-only key file leaves out.
              -->
              {#if result.chain.length > 0}
                <div class="notice ok">
                  <strong>It carries the certificates above it.</strong>
                  <span class="outgoing-list">
                    {#each result.chain as link}
                      <span>
                        {link.holds ? '✓' : '✗'}
                        <strong>{link.subject}</strong> signed by <strong>{link.issuer}</strong>
                        {link.holds ? '' : ' — but that signature does not hold'}
                      </span>
                    {/each}
                  </span>
                  Each of those was checked against the next, which is arithmetic. Whether the
                  authority at the top deserves to be believed is the judgement below.
                </div>
              {:else}
                <div class="notice warn">
                  <strong>This signature carries no issuer certificates.</strong>
                  Only the signer's own. There is nothing here to trace it back through, so unless
                  your PDF reader already holds {result.signedBy ?? 'that authority'}'s issuer, it
                  will show a name it cannot check. That is a fault in how the document was signed,
                  not in the signature — the bytes are still intact.
                </div>
              {/if}
            {/if}

            {#if result.claims && !result.isTimestamp}
              <!--
                The certificate's own statements, kept carefully apart from the
                app's findings. "This certificate declares itself qualified" is
                a fact about the file; "this signature is qualified" is a
                judgement, and not one this app is entitled to make.
              -->
              <div class="notice">
                <strong>What the certificate says about itself.</strong>
                {#if result.claims.qualified}
                  It declares that it is a <em>qualified certificate</em> under eIDAS{result.claims
                    .purpose === 'signature'
                    ? ', issued to a person for signing'
                    : result.claims.purpose === 'seal'
                      ? ', issued to an organisation for sealing'
                      : ''}.
                  {#if result.claims.onQualifiedDevice}
                    It also declares that the private key is held on a qualified signature
                    creation device.
                  {:else}
                    It does <strong>not</strong> declare that the private key is held on a
                    qualified signature creation device — and a qualified electronic signature
                    needs both. On that reading this is an advanced signature made with a
                    qualified certificate, which is a real thing and not the same thing.
                  {/if}
                {:else}
                  It makes no claim to being a qualified certificate under eIDAS.
                  {#if result.claims.purpose === 'website'}
                    It declares itself a website certificate, which is not meant for signing
                    documents at all.
                  {/if}
                {/if}
                {#if result.claims.limit}
                  It declares a transaction limit of {result.claims.limit.value.toLocaleString()}
                  {result.claims.limit.currency}.
                {/if}
                <br /><br />
                These are the certificate authority's statements, read out of the certificate.
                Nothing here checks whether they are true — that is the same judgement as below,
                and needs the same trusted list this app does not have.
              </div>

              {#if result.claims.keyUsage.stated && !result.claims.keyUsage.digitalSignature && !result.claims.keyUsage.nonRepudiation}
                <div class="notice warn">
                  <strong>This certificate was not issued for signing.</strong>
                  Its key usage permits neither digital signature nor non-repudiation, so whatever
                  it was meant for, it was not this. The signature above is still mathematically
                  sound; a reader that enforces key usage will reject it anyway.
                </div>
              {/if}
            {/if}

            {#if result.timestamp && !result.timestamp.coversSignature}
              <!--
                A token attached to a signature it does not describe would read
                as corroboration and be none, which is worth saying loudly.
              -->
              <div class="notice bad">
                <strong>The timestamp inside this signature is not for this signature.</strong>
                It is a real token from a real authority, but what it attests to is some other
                signature. Treat the time above as meaning nothing here.
              </div>
            {:else if result.timestamp}
              <div class="notice ok">
                <strong>The time on this signature is not the signer's own.</strong>
                {result.timestamp.signedBy ?? 'An authority'} saw this signature and dated it, so
                the time does not rest on the signer's computer. Whether that authority is worth
                believing is, like the signer's identity, a question for your PDF reader.
              </div>
            {/if}

            {#if !result.coversToEndOfFile}
              <div class="notice warn">
                <strong>
                  Something was added after this was {result.isTimestamp ? 'stamped' : 'signed'}.
                </strong>
                It does not reach the end of the file, so part of what you would see on opening it
                is not covered by anything above. That is normal when a document was signed and
                then timestamped, and it is also how a document is made to show one thing while
                being signed as another — so it is worth knowing which of the two happened here.
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
              {#if !result.isTimestamp}
                Anything under Reason or Location was typed by whoever signed. The signature stops
                anyone else altering it; nothing makes it true.
              {/if}
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
