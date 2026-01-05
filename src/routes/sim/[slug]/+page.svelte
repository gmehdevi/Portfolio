<script lang="ts">
  import { onMount } from 'svelte';
  import { createRenderer } from '$lib/renderer';
  import { createSimulationRuntime, type SimParams } from '$lib/wasm/loader';
  import { makeOrbitCamera, makeFlyCamera, viewMatrix, perspective, type CameraState, forward, right, mulMat4 } from '$lib/renderer/camera';

  const { data } = $props();
  const sim = $derived(data.sim);

  let status = $state('booting...');
  let canvas: HTMLCanvasElement | null = null;
  let params: SimParams = $state({
    stiffness: 30,
    damping: 0.2,
    gravity: 9.81,
    restLength: 0.5
  });
  let config = $state({ particleCount: 16, initialAngle: 0.4 });

  let stop: (() => void) | null = null;
  let runtimeRef: Awaited<ReturnType<typeof createSimulationRuntime>> | null = null;
  let camera: CameraState = $state(makeOrbitCamera());
  let mode: 'orbit' | 'fly' = $state('orbit');
  let keys = new Set<string>();

  const translate = (dir: [number, number, number], amt: number) => {
    if (camera.mode !== 'fly') return;
    camera.position = [
      camera.position[0] + dir[0] * amt,
      camera.position[1] + dir[1] * amt,
      camera.position[2] + dir[2] * amt
    ];
  };

  const handleKeyDown = (ev: KeyboardEvent) => {
    const k = ev.key.toLowerCase();
    keys.add(k);
    canvas?.focus();
    if (ev.key === 'f') {
      mode = mode === 'orbit' ? 'fly' : 'orbit';
      camera = mode === 'orbit' ? makeOrbitCamera() : makeFlyCamera();
    }
  };
  const handleKeyUp = (ev: KeyboardEvent) => keys.delete(ev.key.toLowerCase());

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let locked = $state(false);

  const onPointerDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    if (mode === 'fly') {
      (e.currentTarget as HTMLElement).requestPointerLock?.();
    }
  };
  const onPointerUp = () => {
    dragging = false;
    document.exitPointerLock?.();
  };
  const onPointerMove = (e: PointerEvent) => {
    const dx = e.movementX || e.clientX - lastX;
    const dy = e.movementY || e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const sens = 0.004;
    if (mode === 'fly') {
      camera.yaw += dx * sens;
      camera.pitch = Math.max(-1.4, Math.min(1.4, camera.pitch + dy * sens));
    } else if (dragging) {
      camera.yaw += dx * sens;
      camera.pitch = Math.max(-1.4, Math.min(1.4, camera.pitch + dy * sens));
    }
  };
  const onWheel = (e: WheelEvent) => {
    if (camera.mode === 'orbit') {
      camera.distance = Math.max(0.5, camera.distance * (1 + e.deltaY * 0.001));
    }
  };

  const startRuntime = async () => {
    if (!canvas) return;
    const renderer = createRenderer(canvas, 'pendulum');
    const runtime = await createSimulationRuntime();
    runtimeRef = runtime;
    status = 'WASM/JS runtime ready';

    let last = performance.now();
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      const dt = (now - last) * 0.001;
      last = now;
      runtime.step(dt, 2);
      const aspect = canvas.width / Math.max(1, canvas.height);
      const proj = perspective(Math.PI / 3, aspect, 0.01, 200);
      const view = viewMatrix(camera);
      const viewProj = mulMat4(proj, view);
      if (mode === 'fly') {
        const move = 2.5 * (1 / 60);
        const f = forward(camera);
        const r = right(camera);
        if (keys.has('w')) translate(f, move);
        if (keys.has('s')) translate(f, -move);
        if (keys.has('a')) translate(r, -move);
        if (keys.has('d')) translate(r, move);
        if (keys.has('q') || keys.has('shift')) camera.position[1] -= move;
        if (keys.has('e') || keys.has(' ')) camera.position[1] += move;
      }
      renderer.render({ mode: 'pendulum', positions: runtime.getPositions() }, viewProj);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    stop = () => {
      cancelAnimationFrame(raf);
      runtime.destroy();
      renderer.dispose();
      runtimeRef = null;
    };
  };

  const updateParams = () => {
    if (runtimeRef) {
      runtimeRef.setParams(params);
    }
  };

  const updateConfig = () => {
    if (runtimeRef?.setConfig) {
      runtimeRef.setConfig(config);
    }
  };

  // 4x4 multiply: a*b
  </script>

<svelte:head>
  <title>{sim.name} | SimHost</title>
</svelte:head>

<section class="layout">
  <div class="viewport">
    <canvas bind:this={canvas} id="gl-canvas" aria-label="Simulation viewport"></canvas>
    <div class="overlay">
      <div class="label">{sim.name}</div>
      <div class="hint">{status}</div>
    </div>
  </div>
  <aside class="panel">
    <h2>Controls</h2>
    <div class="control">
      <label for="stiffness">Stiffness</label>
      <input id="stiffness" type="range" min="1" max="100" step="1" bind:value={params.stiffness} onchange={updateParams} />
      <span>{params.stiffness.toFixed(1)}</span>
    </div>
    <div class="control">
      <label for="damping">Damping</label>
      <input id="damping" type="range" min="0" max="5" step="0.05" bind:value={params.damping} onchange={updateParams} />
      <span>{params.damping.toFixed(2)}</span>
    </div>
    <div class="control">
      <label for="gravity">Gravity</label>
      <input id="gravity" type="range" min="0" max="20" step="0.1" bind:value={params.gravity} onchange={updateParams} />
      <span>{params.gravity.toFixed(2)}</span>
    </div>
    <div class="control">
      <label for="restlength">Rest Length</label>
      <input id="restlength" type="range" min="0.1" max="2.0" step="0.05" bind:value={params.restLength} onchange={updateParams} />
      <span>{params.restLength.toFixed(2)}</span>
    </div>
    <div class="control">
      <label for="count">Particles</label>
      <input id="count" type="range" min="2" max="64" step="1" bind:value={config.particleCount} onchange={updateConfig} />
      <span>{config.particleCount}</span>
    </div>
    <div class="control">
      <label for="angle">Initial Angle (rad)</label>
      <input id="angle" type="range" min="-1.5" max="1.5" step="0.05" bind:value={config.initialAngle} onchange={updateConfig} />
      <span>{config.initialAngle.toFixed(2)}</span>
    </div>
    <div class="control row">
      <button type="button" onclick={startRuntime}>Restart</button>
      <button type="button" onclick={() => (mode = mode === 'orbit' ? 'fly' : 'orbit')}>
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
  .viewport {
    position: relative;
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid #1f2937;
    background: radial-gradient(circle at 20% 20%, rgba(56, 189, 248, 0.12), rgba(15, 23, 42, 1));
    min-height: 480px;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    background: transparent;
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
  .control label {
    grid-column: 1 / 3;
    font-size: 0.9rem;
    color: #94a3b8;
  }
  .control input[type='range'] {
    grid-column: 1 / 2;
  }
  .control span {
    text-align: right;
    font-family: monospace;
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
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
