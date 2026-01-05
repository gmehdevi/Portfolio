<script lang="ts">
  import { onMount } from 'svelte';
  import { createRenderer } from '$lib/renderer';
  import { makeSphere } from '$lib/renderer/mesh';
  import { parseOBJ } from '$lib/renderer/obj';
  import { makeOrbitCamera, makeFlyCamera, viewMatrix, perspective, type CameraState, forward, right, mulMat4 } from '$lib/renderer/camera';

  let canvas: HTMLCanvasElement | null = null;
  let viewportEl: HTMLDivElement | null = null;
  let camera: CameraState = $state(makeOrbitCamera());
  let mode: 'orbit' | 'fly' = $state('orbit');
  let status = $state('booting...');

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  let positions = $state(makeSphere(32).positions);
  let normals = $state(makeSphere(32).normals);
  let uvs = $state<Float32Array | undefined>(makeSphere(32).uvs);
  let indices = $state(makeSphere(32).indices);
  let radius = $state(1);
  let texture: WebGLTexture | null = null;
  let rendererRef: ReturnType<typeof createRenderer> | null = null;
  let keys = new Set<string>();
  let shading = $state(1); // 0 unlit, 1 lambert, 2 phong
  let lightYaw = $state(0.8);
  let lightPitch = $state(0.6);
  let locked = $state(false);

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

  let stop: (() => void) | null = null;

  onMount(() => {
    if (!canvas) return;
    const renderer = createRenderer(canvas, 'mesh');
    rendererRef = renderer;
    status = 'renderer ready';
    let raf = 0;
    const loop = () => {
      const aspect = canvas.width / Math.max(1, canvas.height);
      const far = Math.max(100, radius * 10);
      const proj = perspective(Math.PI / 3, aspect, 0.01, far);
      const view = viewMatrix(camera);
      const viewProj = mulMat4(proj, view);
      if (mode === 'fly') {
        const move = 5 * (1 / 60);
        const f = forward(camera);
        const r = right(camera);
        if (keys.has('w')) translate(f, move);
        if (keys.has('s')) translate(f, -move);
        if (keys.has('a')) translate(r, -move);
        if (keys.has('d')) translate(r, move);
        if (keys.has('q') || keys.has('shift')) camera.position[1] -= move;
        if (keys.has('e') || keys.has(' ')) camera.position[1] += move;
      }
      renderer.render({ mode: 'mesh', positions, normals, indices, uvs, texture }, viewProj);
      const lx = Math.cos(lightPitch) * Math.cos(lightYaw);
      const ly = Math.sin(lightPitch);
      const lz = Math.cos(lightPitch) * Math.sin(lightYaw);
      renderer.render({ mode: 'mesh', positions, normals, indices, uvs, texture, shading, lightDir: [lx, ly, lz], lightColor: [1, 1, 1] }, viewProj);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('wheel', onWheel, { passive: true });
    const onLockChange = () => {
      locked = document.pointerLockElement === canvas;
      if (!locked) dragging = false;
    };
    document.addEventListener('pointerlockchange', onLockChange);
    stop = () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      rendererRef = null;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('wheel', onWheel);
      document.removeEventListener('pointerlockchange', onLockChange);
    };
    return stop;
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
    camera = mode === 'orbit' ? makeOrbitCamera() : makeFlyCamera();
  };

  const loadTexture = async (file: File) => {
    const data = await file.arrayBuffer();
    const blob = new Blob([data]);
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    if (rendererRef) {
      const gl = (rendererRef as any).gl as WebGL2RenderingContext | undefined;
      if (gl) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        texture = tex;
      }
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
    <button type="button" onclick={() => { mode = mode === 'orbit' ? 'fly' : 'orbit'; camera = mode === 'orbit' ? makeOrbitCamera() : makeFlyCamera(); }}>
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
