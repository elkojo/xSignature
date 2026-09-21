<script lang="ts">
  /**
   * The shell: top bar, paper working surface, footer. It holds the chrome that
   * is the same on every screen, and routes. Everything the app actually does
   * lives in the view it renders.
   */
  import Signature from './views/Signature.svelte';
  import { NAV, ROUTES, titleFor, type View } from './nav';

  /**
   * The document screen is fetched when it is first opened, not before.
   *
   * It carries a PDF writer and a PDF renderer between them, which together
   * are several times the size of everything else in the app. Someone who came
   * for a signature PNG should not download a PDF toolchain to get one, so the
   * import stays dynamic — and the promise is kept so that returning to the
   * screen does not ask for it again.
   */
  let documentView: ReturnType<typeof importDocument> | null = null;
  const importDocument = () => import('./views/Document.svelte').then((module) => module.default);
  const loadDocument = () => (documentView ??= importDocument());

  /** Checking a PDF needs the same tools, and is fetched the same way. */
  let checkView: ReturnType<typeof importCheck> | null = null;
  const importCheck = () => import('./views/Check.svelte').then((module) => module.default);
  const loadCheck = () => (checkView ??= importCheck());

  function viewFromHash(): View {
    const raw = location.hash.replace(/^#\/?/, '');
    return (ROUTES as readonly string[]).includes(raw) ? (raw as View) : 'signature';
  }

  let view = $state<View>(viewFromHash());

  function go(next: View) {
    view = next;
    history.replaceState(null, '', `#/${next}`);
    scrollTo({ top: 0 });
  }

  // The tab is the only label some people see when several are open, and a
  // second screen made the static one in index.html wrong half the time.
  $effect(() => {
    document.title = titleFor(view);
  });

  $effect(() => {
    const onHash = () => (view = viewFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  });
</script>

<header class="topbar">
  <div class="nav">
    <button class="brand" onclick={() => go('signature')}>
      <span class="brand-mark"><span>xS</span></span>
      <span>xSignature</span>
    </button>

    <nav class="main-nav">
      {#each NAV as item}
        <button
          class="nav-link"
          aria-current={view === item.id ? 'page' : undefined}
          onclick={() => go(item.id)}
        >
          {item.label}
        </button>
      {/each}
    </nav>
  </div>
</header>

{#snippet loading()}
  <section class="product-view">
    <div class="workspace"><p>Loading the document tools…</p></div>
  </section>
{/snippet}

{#snippet unavailable()}
  <section class="product-view">
    <div class="workspace">
      <div class="notice bad">
        The document tools could not be loaded. If you are offline and have not opened this screen
        before, they are not in the cache yet.
      </div>
    </div>
  </section>
{/snippet}

<main>
  {#if view === 'check'}
    {#await loadCheck()}
      {@render loading()}
    {:then CheckView}
      <CheckView />
    {:catch}
      {@render unavailable()}
    {/await}
  {:else if view === 'document'}
    {#await loadDocument()}
      {@render loading()}
    {:then DocumentView}
      <DocumentView />
    {:catch}
      {@render unavailable()}
    {/await}
  {:else}
    <Signature />
  {/if}
</main>

<footer class="site">
  <div>
    The name you type, the strokes you draw, the documents you open and any key file you use stay
    on this device. The only thing this app ever sends is a 32-byte digest, when you ask it for a
    timestamp, and it says so before it does. xSignature is free and open source under the
    <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">
      AGPL-3.0</a
    >. It makes signature pictures, which prove nothing, and — if you bring a certificate — real
    signatures, which prove who signed and that nothing changed. It never makes qualified ones.
    <!--
      Inside the footer's own div rather than beside it: `footer.site > div`
      carries the padding, and a second child would repeat all of it. So a
      deployed build can say which one it is — without this, checking that a
      release reached the site meant grepping the bundle for a sentence that
      had changed, which works and is a poor substitute for the build saying so.
    -->
    <div class="site-version">Version {__APP_VERSION__}</div>
  </div>
</footer>
