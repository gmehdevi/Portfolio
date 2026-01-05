export type SimulationRuntime = {
  step(dt: number, substeps: number): void;
  getPositions(): Float32Array;
  getIndices(): Uint16Array | Uint32Array;
  setParams(params: Partial<SimParams>): void;
  setConfig?(config: Partial<SimConfig>): void;
  diagnostics(): Diagnostics;
  destroy(): void;
};

export type SimParams = {
  stiffness: number;
  damping: number;
  gravity: number;
  restLength: number;
};

export type SimConfig = {
  particleCount: number;
  initialAngle: number;
};

export type Diagnostics = {
  kineticEnergy: number;
  potentialEnergy: number;
  totalEnergy: number;
  constraintRms: number;
  solverIterations: number;
  stepTimeMs: number;
};

/**
 * Try to load the real WASM runtime; fall back to a lightweight JS simulation.
 */
export async function createSimulationRuntime(): Promise<SimulationRuntime> {
  try {
    const wasmRuntime = await loadWasmRuntime();
    if (wasmRuntime) return wasmRuntime;
  } catch (err) {
    console.info('WASM runtime unavailable, using JS fallback', err);
  }
  return createJsFallback();
}

async function loadWasmRuntime(): Promise<SimulationRuntime | null> {
  // Expect an Emscripten-generated module at /wasm/physics.js exporting default factory.
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    // Import the asset URL, then dynamically import the actual module at runtime.
    const wasmJsUrlMod: any = await import('/wasm/physics.js?url').catch(() => null);
    const wasmJsUrl = wasmJsUrlMod?.default;
    if (!wasmJsUrl) {
      return null;
    }
    const modFactory: any = (await import(/* @vite-ignore */ wasmJsUrl)).default;
    const module = await modFactory({
      locateFile: (path: string) => `/wasm/${path}`
    });
    // Basic ABI wiring; assumes C functions are exported with these names.
    const sim_create = module.cwrap('sim_create', 'number', ['number', 'number', 'number']);
    const sim_step = module.cwrap('sim_step', null, ['number', 'number', 'number']);
    const sim_destroy = module.cwrap('sim_destroy', null, ['number']);
    const sim_get_buffer = module.cwrap('sim_get_buffer', 'number', ['number', 'number']);
    const sim_get_buffer_size = module.cwrap('sim_get_buffer_size', 'number', ['number', 'number']);
    const sim_set_params = module.cwrap('sim_set_params', null, ['number', 'number', 'number']);
    const sim_get_diagnostics = module.cwrap('sim_get_diagnostics', null, ['number', 'number']);

    // Create default pendulum (sim_type 0).
    const handle = sim_create(0, 0, 0);
    const positionsPtr = () => sim_get_buffer(handle, 0);
    const indicesPtr = () => sim_get_buffer(handle, 3);

    const getPositions = () => {
      const size = sim_get_buffer_size(handle, 0);
      const view = new Float32Array(module.HEAPF32.buffer, positionsPtr(), size);
      return new Float32Array(view); // copy to avoid shared heap mutation
    };
    const getIndices = () => {
      const size = sim_get_buffer_size(handle, 3);
      const view = new Uint32Array(module.HEAPU32.buffer, indicesPtr(), size / 4);
      return new Uint32Array(view);
    };
    const setParams = (p: Partial<SimParams>) => {
      const buf = new Float32Array([
        p.stiffness ?? 30,
        p.damping ?? 0.2,
        p.gravity ?? 9.81,
        p.restLength ?? 0.5
      ]);
      const ptr = module._malloc(buf.byteLength);
      module.HEAPF32.set(buf, ptr / 4);
      sim_set_params(handle, ptr, buf.byteLength);
      module._free(ptr);
    };
    const diagnostics = () => {
      const out = new Float64Array(4 + 2); // rough size
      const ptr = module._malloc(out.byteLength);
      sim_get_diagnostics(handle, ptr);
      const view = new Float64Array(module.HEAPF64.buffer, ptr, out.length);
      const d: Diagnostics = {
        kineticEnergy: view[0],
        potentialEnergy: view[1],
        totalEnergy: view[2],
        constraintRms: view[3],
        solverIterations: view[4],
        stepTimeMs: view[5]
      };
      module._free(ptr);
      return d;
    };

    const runtime: SimulationRuntime = {
      step: (dt: number, substeps: number) => sim_step(handle, dt, substeps),
      getPositions,
      getIndices,
      setParams,
      diagnostics,
      destroy: () => sim_destroy(handle)
    };
    return runtime;
  } catch (err) {
    console.warn('Failed to load Emscripten runtime', err);
    return null;
  }
}

/**
 * Simple JS fallback: damped pendulum chain with velocity Verlet.
 */
function createJsFallback(): SimulationRuntime {
  let count = 16;
  let stiffness = 30;
  let damping = 0.2;
  let gravity = 9.81;
  let restLength = 0.5;
  let initialAngle = 0.4;

  let positions = new Float32Array(count * 3);
  let velocities = new Float32Array(count * 3);
  let indices = new Uint16Array((count - 1) * 2);

  const rebuild = () => {
    positions = new Float32Array(count * 3);
    velocities = new Float32Array(count * 3);
    indices = new Uint16Array((count - 1) * 2);
    for (let i = 0; i < count; i++) {
      const angle = i === 0 ? 0 : initialAngle;
      positions[i * 3 + 0] = Math.sin(angle) * restLength * i;
      positions[i * 3 + 1] = -Math.cos(angle) * restLength * i;
      positions[i * 3 + 2] = 0;
      velocities[i * 3 + 0] = 0;
      velocities[i * 3 + 1] = 0;
      velocities[i * 3 + 2] = 0;
    }
    for (let i = 1; i < count; i++) {
      indices[(i - 1) * 2 + 0] = i - 1;
      indices[(i - 1) * 2 + 1] = i;
    }
  };
  rebuild();

  const step = (dt: number, substeps: number) => {
    const h = dt / substeps;
    for (let s = 0; s < substeps; s++) {
      // gravity + spring forces
      for (let i = 1; i < count; i++) {
        velocities[i * 3 + 1] -= gravity * h;
      }
      for (let i = 1; i < count; i++) {
        const i0 = (i - 1) * 3;
        const i1 = i * 3;
        const dx = positions[i1] - positions[i0];
        const dy = positions[i1 + 1] - positions[i0 + 1];
        const dz = positions[i1 + 2] - positions[i0 + 2];
        const len = Math.hypot(dx, dy, dz) || 1e-6;
        const dirx = dx / len;
        const diry = dy / len;
        const dirz = dz / len;
        const stretch = len - restLength;
        const fx = -stiffness * stretch * dirx;
        const fy = -stiffness * stretch * diry;
        const fz = -stiffness * stretch * dirz;
        const vrel = velocities[i1] * dirx + velocities[i1 + 1] * diry + velocities[i1 + 2] * dirz
          - (velocities[i0] * dirx + velocities[i0 + 1] * diry + velocities[i0 + 2] * dirz);
        const dfx = -damping * vrel * dirx;
        const dfy = -damping * vrel * diry;
        const dfz = -damping * vrel * dirz;
        velocities[i1] += (fx + dfx) * h;
        velocities[i1 + 1] += (fy + dfy) * h;
        velocities[i1 + 2] += (fz + dfz) * h;
        velocities[i0] -= (fx + dfx) * h;
        velocities[i0 + 1] -= (fy + dfy) * h;
        velocities[i0 + 2] -= (fz + dfz) * h;
      }
      // integrate
      for (let i = 1; i < count; i++) {
        positions[i * 3 + 0] += velocities[i * 3 + 0] * h;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * h;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * h;
      }
      // pin root
      positions[0] = 0;
      positions[1] = 0;
      positions[2] = 0;
      velocities[0] = velocities[1] = velocities[2] = 0;
    }
  };

  const diagnostics = (): Diagnostics => ({
    kineticEnergy: 0,
    potentialEnergy: 0,
    totalEnergy: 0,
    constraintRms: 0,
    solverIterations: 0,
    stepTimeMs: 0
  });

  return {
    step,
    getPositions: () => positions,
    getIndices: () => indices,
    setParams: (p: Partial<SimParams>) => {
      if (p.stiffness !== undefined) stiffness = p.stiffness;
      if (p.damping !== undefined) damping = p.damping;
      if (p.gravity !== undefined) gravity = p.gravity;
      if (p.restLength !== undefined) restLength = p.restLength;
    },
    setConfig: (c: Partial<SimConfig>) => {
      if (c.particleCount !== undefined) {
        count = Math.max(2, Math.floor(c.particleCount));
      }
      if (c.initialAngle !== undefined) {
        initialAngle = c.initialAngle;
      }
      rebuild();
    },
    diagnostics,
    destroy: () => {}
  };
}
