<script lang="ts">
  import { onMount } from 'svelte';
  import { createRenderer } from '$lib/renderer';
  import { makeSphere } from '$lib/renderer/mesh';
  import { parseOBJ } from '$lib/renderer/obj';
  import { buildMeshPacket, buildPointPacket, buildSpherePacket, BUFFER_INDICES, BUFFER_NORMALS, BUFFER_POSITIONS, BUFFER_UVS } from '$lib/renderer/packet';
  import { createTextureFromImage } from '$lib/renderer/texture';
  import { createCameraRig, type CameraRig } from '$lib/camera/rig';
  import { makeCameraForMode } from '$lib/camera/math';
  import type { CameraMode } from '$lib/camera/types';
  import { createRenderLoop } from '$lib/ui/renderLoop';

  let canvas: HTMLCanvasElement | null = null;
  let camera = $state(makeCameraForMode('orbit'));
  let mode: CameraMode = $state('orbit');
  let status = $state('booting...');

  const baseSphere = makeSphere(32);
  let positions = $state(baseSphere.positions);
  let normals = $state(baseSphere.normals);
  let uvs = $state<Float32Array | undefined>(baseSphere.uvs);
  let indices = $state(baseSphere.indices);
  let radius = $state(1);
  let texture: WebGLTexture | null = null;
  let rendererRef: ReturnType<typeof createRenderer> | null = null;
  let packetCache: Uint32Array | null = null;
  let shading = $state(1); // 0 unlit, 1 lambert, 2 phong
  let lightYaw = $state(0.8);
  let lightPitch = $state(0.6);
  let locked = $state(false);
  let renderMode = $state<'mesh' | 'points' | 'spheres'>('mesh');

  let detachCamera: (() => void) | null = null;

  let rig: CameraRig | null = null;

  const createRig = () => {
    if (rig) return rig;
    rig = createCameraRig({
      profile: { default: 'orbit', allowed: ['orbit', 'fly'], invertY: true },
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
      moveSpeed: 5
    });
    return rig;
  };

  onMount(() => {
    if (!canvas) return;
    rendererRef = createRenderer(canvas);
    status = 'renderer ready';
    rig = createRig();
    detachCamera = rig.attach({ canvas });
    const loop = createRenderLoop({
      onFrame: (dt) => {
        if (!rig) return;
        rig.update(dt);
        const activeRenderer = rendererRef;
        if (!activeRenderer) return;
        const aspect = canvas.width / Math.max(1, canvas.height);
        const far = Math.max(100, radius * 10);
        const viewProj = rig.viewProj(aspect, 0.01, far);
        const lx = Math.cos(lightPitch) * Math.cos(lightYaw);
        const ly = Math.sin(lightPitch);
        const lz = Math.cos(lightPitch) * Math.sin(lightYaw);
        const count = Math.floor(positions.length / 3);
        if (renderMode === 'mesh') {
          packetCache = buildMeshPacket(indices.length, { previous: packetCache ?? undefined });
          if (packetCache) {
            const buffers: Record<number, Float32Array | Uint16Array | Uint32Array> = {
              [BUFFER_POSITIONS]: positions,
              [BUFFER_NORMALS]: normals,
              [BUFFER_INDICES]: indices
            };
            if (uvs) {
              buffers[BUFFER_UVS] = uvs;
            }
            activeRenderer.render(
              { mode: 'packet', packet: packetCache, buffers, material: { shading, lightDir: [lx, ly, lz], lightColor: [1, 1, 1], texture } },
              viewProj
            );
          }
        } else {
          if (renderMode === 'points') {
            packetCache = buildPointPacket(count, 6.0, packetCache ?? undefined);
          } else {
            packetCache = buildSpherePacket(count, 0.03, packetCache ?? undefined);
          }
          if (packetCache) {
            activeRenderer.render({ mode: 'packet', packet: packetCache, buffers: { [BUFFER_POSITIONS]: positions } }, viewProj);
          }
        }
      }
    });
    loop.start();
    return () => {
      loop.stop();
      detachCamera?.();
      rendererRef?.dispose();
      rendererRef = null;
      packetCache = null;
    };
  });

  const loadObj = async (file: File) => {
    const text = await file.text();
    const parsed = parseOBJ(text);
    // Recenter and scale to unit radius for better z-range
    const bounds = computeBounds(parsed.positions);
    radius = Math.max(bounds.radius, 1);
    const scale = radius > 0 ? 1 / radius : 1;
    const recentered = new Float32Array(parsed.positions.length);
    for (let i = 0; i < parsed.positions.length; i += 3) {
      recentered[i] = (parsed.positions[i] - bounds.center[0]) * scale;
      recentered[i + 1] = (parsed.positions[i + 1] - bounds.center[1]) * scale;
      recentered[i + 2] = (parsed.positions[i + 2] - bounds.center[2]) * scale;
    }
    positions = recentered;
    normals = parsed.normals;
    indices = parsed.indices;
    uvs = parsed.uvs;
    camera = makeCameraForMode(mode);
  };

  const loadTexture = async (file: File) => {
    const data = await file.arrayBuffer();
    const blob = new Blob([data]);
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    const gl = rendererRef?.gl;
    if (gl) {
      if (texture) {
        gl.deleteTexture(texture);
      }
      texture = createTextureFromImage(gl, img);
    }
    URL.revokeObjectURL(url);
  };

  const computeBounds = (pos: Float32Array) => {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    let r = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const dx = pos[i] - cx;
      const dy = pos[i + 1] - cy;
      const dz = pos[i + 2] - cz;
      r = Math.max(r, Math.hypot(dx, dy, dz));
    }
    return { center: [cx, cy, cz] as [number, number, number], radius: r };
  };

</script>

<svelte:head>
  <title>Viewer | SimHost</title>
</svelte:head>

<section class="layout">
  <div class="viewport">
    <canvas bind:this={canvas} aria-label="Model viewer" tabindex="0"></canvas>
    <div class="overlay">
      <div class="label">Sphere Viewer</div>
      <div class="hint">Camera mode: {mode} — {status} {locked ? '(Pointer lock: Esc to exit)' : ''}</div>
    </div>
  </div>
  <aside class="panel">
    <h2>Controls</h2>
    <p>Orbit: drag + wheel. Fly: press F then WASD + mouse look.</p>
    <button type="button" onclick={() => rig?.toggleMode()}>
      Toggle Camera ({mode})
    </button>
    <div class="control">
      <label for="obj">Load OBJ</label>
      <input id="obj" type="file" accept=".obj" onchange={(e) => { const f = e.currentTarget.files?.[0]; if (f) loadObj(f); }} />
    </div>
    <div class="control">
      <label for="tex">Load Texture</label>
      <input id="tex" type="file" accept="image/*" onchange={(e) => { const f = e.currentTarget.files?.[0]; if (f) loadTexture(f); }} />
    </div>
    <div class="control">
      <label for="shading">Shading</label>
      <select id="shading" bind:value={shading}>
        <option value={0}>Unlit</option>
        <option value={1}>Lambert</option>
        <option value={2}>Phong</option>
      </select>
    </div>
    <div class="control">
      <label for="rendermode">Render Mode</label>
      <select id="rendermode" bind:value={renderMode}>
        <option value="mesh">Mesh</option>
        <option value="points">Points</option>
        <option value="spheres">Spheres</option>
      </select>
    </div>
    <div class="control">
      <label for="lightyaw">Light Yaw</label>
      <input id="lightyaw" type="range" min="-3.14" max="3.14" step="0.01" bind:value={lightYaw} />
    </div>
    <div class="control">
      <label for="lightpitch">Light Pitch</label>
      <input id="lightpitch" type="range" min="-1.57" max="1.57" step="0.01" bind:value={lightPitch} />
    </div>
  </aside>
</section>

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 1rem;
    min-height: 70vh;
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
  .control {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.25rem;
    margin-top: 0.75rem;
  }
  .control label {
    font-size: 0.9rem;
    color: #94a3b8;
  }
  input[type='file'] {
    color: #cbd5e1;
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
