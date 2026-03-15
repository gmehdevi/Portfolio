<script lang="ts">
  import { base } from '$app/paths';
  const { children } = $props();
</script>

<svelte:head>
  <title>Physics Simulation Gallery</title>
</svelte:head>

<div class="page">
  <header class="topbar">
    <div class="brand">SimHost</div>
    <nav class="nav">
      <a href={`${base}/`}>Gallery</a>
    </nav>
  </header>
  <main>
    {@render children?.()}
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: Inter, system-ui, -apple-system, sans-serif;
    background: #0d1117;
    color: #e5e7eb;
  }
  .page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid #1f2937;
    background: rgba(15, 23, 42, 0.85);
  }
  .brand {
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .nav a {
    color: #cbd5e1;
    text-decoration: none;
    margin-left: 1rem;
  }
  .nav a:hover {
    color: #fff;
  }
  main {
    flex: 1;
    padding: 1.5rem;
  }
</style>
