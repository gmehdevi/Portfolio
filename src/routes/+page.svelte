<script lang="ts">
  import { base } from '$app/paths';
  import { listSimulations } from '$lib/simulation/registry';

  const sims = listSimulations();
  const hrefFor = (path: string) => `${base}${path}`;
</script>

<section class="hero">
  <div>
    <p class="eyebrow">Client-side Physics</p>
    <h1>Simulation Gallery Host</h1>
    <p class="lede">
      WebGL renderer + WASM physics with deterministic stepping. Pick a simulation to launch the host.
    </p>
  </div>
</section>

<section class="grid">
  {#each sims as sim}
    <a class="card" href={hrefFor(`/sim/${sim.slug}`)}>
      <div class="title">{sim.name}</div>
      <p>{sim.description}</p>
    </a>
  {/each}
  <a class="card" href={hrefFor('/viewer')}>
    <div class="title">Model Viewer</div>
    <p>Test renderer with a sphere and camera controls.</p>
  </a>
  <div class="card muted">
    <div class="title">Planetary Gravity</div>
    <p>Queued — will add N-body gravity next.</p>
  </div>
  <div class="card muted">
    <div class="title">Cloth 3D</div>
    <p>Queued — XPBD constraints on a grid mesh.</p>
  </div>
</section>

<style>
  .hero {
    padding: 2rem 0;
  }
  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.75rem;
    color: #38bdf8;
    margin-bottom: 0.25rem;
  }
  h1 {
    margin: 0.1rem 0 0.5rem;
    font-size: 2.25rem;
  }
  .lede {
    margin: 0;
    color: #cbd5e1;
    max-width: 720px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 1rem;
    margin-top: 1.5rem;
  }
  .card {
    padding: 1rem;
    border: 1px solid #1f2937;
    border-radius: 12px;
    background: linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.7));
    color: inherit;
    text-decoration: none;
    transition: transform 160ms ease, border-color 160ms ease;
  }
  .card:hover {
    transform: translateY(-4px);
    border-color: #38bdf8;
  }
  .card.muted {
    opacity: 0.6;
  }
  .title {
    font-weight: 700;
    margin-bottom: 0.25rem;
  }
  p {
    margin: 0;
  }
</style>
