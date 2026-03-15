<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { createSimulationHost } from '$lib/simulation/host';
  import { getSimulationBySlug } from '$lib/simulation/registry';
  import { createCameraRig, type CameraRig } from '$lib/camera/rig';
  import { makeCameraForMode } from '$lib/camera/math';
  import InspectorPanel from '$lib/ui/InspectorPanel.svelte';
  import DiagnosticsPanel from '$lib/ui/DiagnosticsPanel.svelte';
  import type { CameraMode } from '$lib/camera/types';
  import { DEFAULT_INTEGRATORS, type IntegratorOption } from '$lib/wasm/loader';
  import type { SimParams, SimConfig, Diagnostics } from '$lib/wasm/loader';

  const { data } = $props();
  const slug = $derived(data.slug);
  const sim = $derived(getSimulationBySlug(slug)!);

  let status = $state('booting...');
  let canvas: HTMLCanvasElement | null = null;
  let viewport: HTMLDivElement | null = null;
  let isFullscreen = $state(false);
  const baseParams: SimParams = {
    stiffness: 30,
    damping: 0.2,
    gravity: 9.81,
    restLength: 0.5,
    integrator: 0
  };
  const baseConfig: SimConfig = { particleCount: 16, initialTheta: 0, initialPhi: 0.4 };
  let params: SimParams = $state({ ...baseParams });
  let config: SimConfig = $state({ ...baseConfig });

  let mode: CameraMode = $state('orbit');
  let camera = $state(makeCameraForMode('orbit'));
  let locked = $state(false);

  let host: ReturnType<typeof createSimulationHost> | null = null;
  let detachCamera: (() => void) | null = null;
  let diagnostics: Diagnostics | null = $state(null);
  let integrators: IntegratorOption[] = $state(DEFAULT_INTEGRATORS);
  let renderFps = $state(60);
  let fixedDt = $state(1 / 120);
  let timeMode: 'fixed' | 'dynamic' = $state('dynamic');
  let isInteracting = $state(false);
  const controls = $derived(sim.controls ?? []);
  let lastSlug = $state('');

  let rig: CameraRig | null = null;

  $effect(() => {
    if (slug === lastSlug) return;
    lastSlug = slug;
    params = { ...baseParams, ...(sim.defaults?.params ?? {}) };
    config = { ...baseConfig, ...(sim.defaults?.config ?? {}) };
    const nextMode = sim.camera.default;
    mode = nextMode;
    camera = makeCameraForMode(nextMode);
    renderFps = sim.defaults?.renderFps ?? 60;
    fixedDt = sim.defaults?.fixedDt ?? 1 / 120;
    timeMode = sim.defaults?.timeMode ?? 'dynamic';
  });

  const createRig = () => {
    if (rig) return rig;
    rig = createCameraRig({
      profile: sim.camera,
      getCamera: () => camera,
      setCamera: (next) => {
        camera = next;
      },
      getMode: () => mode,
      setMode: (next) => {
        mode = next;
      },
      onLockChange: (value) => {
        locked = value;
      },
      moveSpeed: 2.5
    });
    return rig;
  };

  const startRuntime = async () => {
    if (!canvas || !rig) return;
    if (!host) {
      host = createSimulationHost({
        canvas,
        descriptor: sim,
        cameraRig: rig,
        onStatus: (value) => {
          status = value;
        },
        onDiagnostics: (next) => {
          diagnostics = next;
        },
        renderFps,
        fixedDt,
        timeMode
      });
    }
    await host.start({ params, config });
    host.setRenderFps(renderFps);
    host.setFixedDt(fixedDt);
    host.setTimeMode(timeMode);
    host.setPaused(isInteracting);
    const runtime = host.getRuntime();
    diagnostics = runtime ? runtime.diagnostics() : null;
    integrators = runtime ? runtime.getIntegrators() : DEFAULT_INTEGRATORS;
  };

  const stopRuntime = () => {
    host?.stop();
  };

  const applyDefaults = () => {
    const nextParams = { ...baseParams, ...(sim.defaults?.params ?? {}) };
    const nextConfig = { ...baseConfig, ...(sim.defaults?.config ?? {}) };
    const nextRenderFps = sim.defaults?.renderFps ?? 60;
    const nextFixedDt = sim.defaults?.fixedDt ?? 1 / 120;
    const nextTimeMode = sim.defaults?.timeMode ?? 'dynamic';
    params = nextParams;
    config = nextConfig;
    renderFps = nextRenderFps;
    fixedDt = nextFixedDt;
    timeMode = nextTimeMode;
    localStorage.setItem(`sim:${slug}:renderFps`, `${renderFps}`);
    localStorage.setItem(`sim:${slug}:fixedDt`, `${fixedDt}`);
    localStorage.setItem(`sim:${slug}:timeMode`, timeMode);
    host?.setParams(nextParams);
    host?.setConfig(nextConfig);
    host?.setRenderFps(nextRenderFps);
    host?.setFixedDt(nextFixedDt);
    host?.setTimeMode(nextTimeMode);
  };

  const resetAll = () => {
    const nextMode = mode;
    if (rig) {
      rig.setMode(nextMode);
    } else {
      mode = nextMode;
    }
    applyDefaults();
    void startRuntime();
  };

  const updateParams = (next: Partial<SimParams>) => {
    params = { ...params, ...next };
    host?.setParams(params);
  };

  const updateConfig = (next: Partial<SimConfig>) => {
    config = { ...config, ...next };
    host?.setConfig(config);
  };

    const updateRuntime = (key: 'renderFps' | 'fixedDt' | 'timeMode', value: number | string) => {
      if (key === 'renderFps') {
        renderFps = Number(value);
        host?.setRenderFps(renderFps);
        localStorage.setItem(`sim:${slug}:renderFps`, `${renderFps}`);
        return;
      }
      if (key === 'fixedDt') {
        const next = Number(value);
        if (!Number.isFinite(next) || next <= 0 || next > 1) return;
        fixedDt = next;
        host?.setFixedDt(fixedDt);
        localStorage.setItem(`sim:${slug}:fixedDt`, `${fixedDt}`);
        return;
      }
      if (key === 'timeMode') {
        timeMode = value === 'dynamic' ? 'dynamic' : 'fixed';
        host?.setTimeMode(timeMode);
        localStorage.setItem(`sim:${slug}:timeMode`, timeMode);
      }
    };

  onMount(() => {
    if (!browser) return;
    if (!canvas) return;
    const fpsKey = `sim:${slug}:renderFps`;
    const storedFps = localStorage.getItem(fpsKey);
    if (storedFps) {
      const parsed = Number(storedFps);
      if (Number.isFinite(parsed)) {
        renderFps = parsed;
      }
    }
    const dtKey = `sim:${slug}:fixedDt`;
    const storedDt = localStorage.getItem(dtKey);
    if (storedDt) {
      const parsed = Number(storedDt);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1) {
        fixedDt = parsed;
      }
    }
    const modeKey = `sim:${slug}:timeMode`;
    const storedMode = localStorage.getItem(modeKey);
    if (storedMode === 'dynamic' || storedMode === 'fixed') {
      timeMode = storedMode;
    }
    rig = createRig();
    detachCamera = rig.attach({ canvas });
    void startRuntime();
    const onFullscreenChange = () => {
      isFullscreen = document.fullscreenElement === viewport;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) {
        return;
      }
      if (event.key.toLowerCase() !== 'f') return;
      event.preventDefault();
      void toggleFullscreen();
    };
    const onReset = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) {
        return;
      }
      if (event.key.toLowerCase() !== 'r') return;
      event.preventDefault();
      resetAll();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keydown', onReset);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keydown', onReset);
      detachCamera?.();
      stopRuntime();
    };
  });

  const toggleFullscreen = async () => {
    if (!browser || !viewport) return;
    if (document.fullscreenElement === viewport) {
      await document.exitFullscreen();
      return;
    }
    await viewport.requestFullscreen();
  };
</script>

<svelte:head>
  <title>{sim.name} | SimHost</title>
</svelte:head>

<section class="layout">
  <div class="main">
    <div class="viewport" bind:this={viewport}>
      <canvas bind:this={canvas} id="gl-canvas" aria-label="Simulation viewport"></canvas>
      <div class="viewport-actions">
        <button type="button" class="ghost" onclick={toggleFullscreen}>
          {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
      </div>
      <div class="overlay">
        <div class="label">{sim.name}</div>
        <div class="hint">{status}{locked ? ' (Pointer lock: Esc to exit)' : ''}</div>
      </div>
    </div>
    <div class="diagnostics-panel">
      <DiagnosticsPanel
        {diagnostics}
        sampleCount={config.particleCount}
        sampleRate={renderFps > 0 ? renderFps : 60}
        resetKey={slug}
      />
    </div>
  </div>
  <aside class="panel">
    <h2>Controls</h2>
    <p class="keymap">
      Keys: C toggle camera, F fullscreen, R reset. Fly: click viewport, WASD, Q/E or Space/Shift.
    </p>
    <InspectorPanel
      {controls}
      {params}
      {config}
      runtime={{ renderFps, fixedDt, timeMode, integrators }}
      onParamsChange={updateParams}
      onConfigChange={updateConfig}
      onRuntimeChange={updateRuntime}
      onInteractionChange={(active) => {
        isInteracting = active;
        host?.setPaused(active);
      }}
    />
    <div class="control row">
      <button type="button" onclick={resetAll}>Restart</button>
      <button type="button" onclick={() => rig?.toggleMode()}>
        Camera: {mode}
      </button>
    </div>
  </aside>
</section>

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 1rem;
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    height: 100%;
  }
  .viewport {
    position: relative;
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid #1f2937;
    background: radial-gradient(circle at 20% 20%, rgba(56, 189, 248, 0.12), rgba(15, 23, 42, 1));
    min-height: 480px;
    flex: 1 1 auto;
  }
  :global(.viewport:fullscreen) {
    border-radius: 0;
    border: none;
    width: 100%;
    height: 100%;
  }
  :global(.viewport:fullscreen canvas) {
    height: 100%;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    background: transparent;
  }
  .viewport-actions {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    z-index: 2;
  }
  .overlay {
    position: absolute;
    bottom: 0;
    width: 100%;
    padding: 0.75rem 1rem;
    background: linear-gradient(180deg, rgba(15, 23, 42, 0) 0%, rgba(15, 23, 42, 0.8) 100%);
    color: #cbd5e1;
  }
  .label {
    font-weight: 700;
    margin-bottom: 0.15rem;
  }
  .hint {
    font-size: 0.9rem;
    color: #94a3b8;
  }
  .panel {
    border: 1px solid #1f2937;
    border-radius: 12px;
    padding: 1rem;
    background: rgba(30, 41, 59, 0.75);
  }
  .keymap {
    margin: 0 0 0.75rem 0;
    font-size: 0.8rem;
    color: #94a3b8;
    line-height: 1.4;
  }
  .diagnostics-panel {
    border: 1px solid #1f2937;
    border-radius: 12px;
    padding: 0.75rem 1rem 1rem;
    background: rgba(15, 23, 42, 0.7);
  }
  h2 {
    margin-top: 0;
  }
  .control {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.25rem 0.5rem;
    align-items: center;
    margin-bottom: 0.75rem;
  }
  .control.row {
    grid-template-columns: 1fr 1fr;
  }
  button {
    padding: 0.35rem 0.5rem;
    border-radius: 8px;
    border: 1px solid #1f2937;
    background: #0ea5e9;
    color: #0b1021;
    font-weight: 700;
    cursor: pointer;
  }
  button:hover {
    background: #38bdf8;
  }
  .viewport-actions .ghost {
    border-radius: 999px;
    padding: 0.35rem 0.65rem;
    font-size: 0.75rem;
    border: 1px solid rgba(148, 163, 184, 0.5);
    background: rgba(15, 23, 42, 0.85);
    color: #e2e8f0;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.4);
  }
  .viewport-actions .ghost:hover {
    background: rgba(30, 41, 59, 0.95);
  }
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
