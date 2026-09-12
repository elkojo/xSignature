<script lang="ts">
  /**
   * The shell: top bar, paper working surface, footer. It holds the chrome that
   * is the same on every screen, and routes. Everything the app actually does
   * lives in the view it renders.
   */
  import Signature from './views/Signature.svelte';
  import { NAV, ROUTES, type View } from './nav';

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

<main>
  <Signature />
</main>

<footer class="site">
  <div>
    The name you type and the strokes you draw stay on this device — there is no server to send
    them to. xSignature is free and open source under the
    <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">
      AGPL-3.0</a
    >. It makes pictures, not electronic signatures.
  </div>
</footer>
