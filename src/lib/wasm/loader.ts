import {
  BUFFER_COLORS,
  BUFFER_INDICES,
  BUFFER_NORMALS,
  BUFFER_POSITIONS,
  BUFFER_RENDER_PACKET,
  BUFFER_SPRING_POSITIONS,
  BUFFER_UVS,
  BUFFER_VELOCITIES,
  getBufferLayouts,
  setBufferLayouts,
  type BufferLayout,
  type RenderBuffer
} from '$lib/renderer/packet';
import { base } from '$app/paths';

export type SimulationRuntime = {
  step(dt: number, substeps: number): void;
  getPositions(): Float32Array;
  getBuffer(bufferId: number): RenderBuffer;
  getRenderPacket?(): Uint32Array;
  getIntegrators(): IntegratorOption[];
  setParams(params: Partial<SimParams>): void;
  setConfig?(config: Partial<SimConfig>): void;
  diagnostics(): Diagnostics;
  destroy(): void;
};

export type IntegratorOption = {
  id: number;
  name: string;
};

export const DEFAULT_INTEGRATORS: IntegratorOption[] = [
  { id: 0, name: 'Velocity Verlet' },
  { id: 1, name: 'Symplectic Euler' },
  { id: 2, name: 'RK4' }
];

export type SimParams = {
  stiffness: number;
  damping: number;
  gravity: number;
  restLength: number;
  integrator?: number;
};

export type SimConfig = {
  particleCount: number;
  initialTheta: number;
  initialPhi: number;
};

export type Diagnostics = {
  kineticEnergy: number;
  potentialEnergy: number;
  springPotential: number;
  totalEnergy: number;
  constraintRms: number;
  solverIterations: number;
  stepTimeMs: number;
};

let wasmModulePromise: Promise<any | null> | null = null;

export async function loadWasmModule(): Promise<any | null> {
  if (wasmModulePromise) {
    return wasmModulePromise;
  }
  wasmModulePromise = (async () => {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      const wasmBase = base || '';
      const wasmJsUrlMod: any = await import(/* @vite-ignore */ `${wasmBase}/wasm/physics.js?url`).catch(() => null);
      const wasmJsUrl = wasmJsUrlMod?.default;
      if (!wasmJsUrl) {
        return null;
      }
      const modFactory: any = (await import(/* @vite-ignore */ wasmJsUrl)).default;
      if (typeof modFactory !== 'function') {
        return null;
      }
      const module = await modFactory({
        locateFile: (path: string) => `${wasmBase}/wasm/${path}`
      });
      return module ?? null;
    } catch (err) {
      console.warn('Failed to load Emscripten module', err);
      return null;
    }
  })();
  return wasmModulePromise;
}

/**
 * Try to load the real WASM runtime; fall back to a lightweight JS simulation.
 */
export async function createSimulationRuntime(): Promise<SimulationRuntime> {
  try {
    const module = await loadWasmModule();
    const wasmRuntime = module ? await createWasmRuntime(module) : null;
    if (wasmRuntime) return wasmRuntime;
  } catch (err) {
    console.info('WASM runtime unavailable, using JS fallback', err);
  }
  return createJsFallback();
}

async function createWasmRuntime(module: any): Promise<SimulationRuntime | null> {
  try {
    if (!module?.cwrap || !module?._malloc) {
      return null;
    }
    // Basic ABI wiring; assumes C functions are exported with these names.
    const sim_create = module.cwrap('sim_create', 'number', ['number', 'number', 'number']);
    const sim_step = module.cwrap('sim_step', null, ['number', 'number', 'number']);
    const sim_destroy = module.cwrap('sim_destroy', null, ['number']);
    const sim_get_buffer = module.cwrap('sim_get_buffer', 'number', ['number', 'number']);
    const sim_get_buffer_size = module.cwrap('sim_get_buffer_size', 'number', ['number', 'number']);
    const sim_set_params = module.cwrap('sim_set_params', null, ['number', 'number', 'number']);
    const sim_set_config = module._sim_set_config ? module.cwrap('sim_set_config', null, ['number', 'number', 'number']) : null;
    const sim_get_diagnostics = module.cwrap('sim_get_diagnostics', null, ['number', 'number']);

    const readCString = (() => {
      const decoder = new TextDecoder('utf-8');
      return (ptr: number) => {
        if (!ptr) return '';
        const heap: Uint8Array = module.HEAPU8;
        let end = ptr;
        while (heap[end] !== 0) end++;
        return decoder.decode(heap.subarray(ptr, end));
      };
    })();

    const syncBufferLayouts = () => {
      if (!module._sim_get_buffer_descriptor || !module.HEAP32) {
        return;
      }
      const sim_get_buffer_descriptor = module.cwrap('sim_get_buffer_descriptor', 'number', ['number', 'number']);
      const ptr = module._malloc(3 * 4);
      let view = new Int32Array(module.HEAP32.buffer, ptr, 3);
      const typeMap: Record<number, BufferLayout['type']> = {
        0: 'f32',
        1: 'u16',
        2: 'u32',
        3: 'u16/u32'
      };
      const ids = [
        BUFFER_POSITIONS,
        BUFFER_VELOCITIES,
        BUFFER_NORMALS,
        BUFFER_INDICES,
        BUFFER_UVS,
        BUFFER_COLORS,
        BUFFER_SPRING_POSITIONS
      ];
      const layouts: Record<number, BufferLayout> = {};
      for (const id of ids) {
        const ok = sim_get_buffer_descriptor(id, ptr);
        if (!ok) continue;
        if (view.buffer !== module.HEAP32.buffer) {
          view = new Int32Array(module.HEAP32.buffer, ptr, 3);
        }
        const components = view[1];
        const type = typeMap[view[2]];
        if (!type || components <= 0) continue;
        layouts[id] = { components, type };
      }
      setBufferLayouts(layouts);
      if (module._free) {
        module._free(ptr);
      }
    };

    const globalIntegratorOptions = (() => {
      if (!module._sim_get_integrator_count || !module._sim_get_integrator_id || !module._sim_get_integrator_name) {
        return DEFAULT_INTEGRATORS;
      }
      const sim_get_integrator_count = module.cwrap('sim_get_integrator_count', 'number', []);
      const sim_get_integrator_id = module.cwrap('sim_get_integrator_id', 'number', ['number']);
      const sim_get_integrator_name = module.cwrap('sim_get_integrator_name', 'number', ['number']);
      const count = sim_get_integrator_count();
      if (!count || count < 1) return DEFAULT_INTEGRATORS;
      const list: IntegratorOption[] = [];
      for (let i = 0; i < count; i++) {
        const id = sim_get_integrator_id(i);
        const namePtr = sim_get_integrator_name(i);
        const name = readCString(namePtr) || `Integrator ${id}`;
        list.push({ id, name });
      }
      return list.length ? list : DEFAULT_INTEGRATORS;
    })();

    const sim_get_integrator_name_by_id = module._sim_get_integrator_name_by_id
      ? module.cwrap('sim_get_integrator_name_by_id', 'number', ['number'])
      : null;
    const nameForIntegrator = (id: number) => {
      if (sim_get_integrator_name_by_id) {
        const namePtr = sim_get_integrator_name_by_id(id);
        const name = readCString(namePtr);
        if (name) return name;
      }
      const fallback = globalIntegratorOptions.find((entry) => entry.id === id);
      return fallback?.name ?? `Integrator ${id}`;
    };

    const getSupportedIntegrators = (handle: number) => {
      if (module._sim_get_supported_integrator_count && module._sim_get_supported_integrator_id) {
        const sim_get_supported_integrator_count = module.cwrap('sim_get_supported_integrator_count', 'number', ['number']);
        const sim_get_supported_integrator_id = module.cwrap('sim_get_supported_integrator_id', 'number', ['number', 'number']);
        const count = sim_get_supported_integrator_count(handle);
        if (!count || count < 1) return globalIntegratorOptions;
        const list: IntegratorOption[] = [];
        for (let i = 0; i < count; i++) {
          const id = sim_get_supported_integrator_id(handle, i);
          if (id < 0) continue;
          list.push({ id, name: nameForIntegrator(id) });
        }
        return list.length ? list : globalIntegratorOptions;
      }
      return globalIntegratorOptions;
    };

    syncBufferLayouts();

    // Create default pendulum (sim_type 0).
    const handle = sim_create(0, 0, 0);
    const integratorOptions = getSupportedIntegrators(handle);
    const renderPacketPtr = () => sim_get_buffer(handle, BUFFER_RENDER_PACKET);

    const emptyFloat = new Float32Array(0);
    const emptyIndices16 = new Uint16Array(0);
    const emptyIndices32 = new Uint32Array(0);
    const emptyPacket = new Uint32Array(0);
    let renderPacketView: Uint32Array | null = null;
    let renderPacketPtrCache = 0;
    let renderPacketSizeCache = 0;
    let heapPacketBuffer: ArrayBuffer | null = null;
    const bufferCache = new Map<number, { ptr: number; size: number; type: 'f32' | 'u16' | 'u32'; heap: ArrayBuffer; view: RenderBuffer }>();

    const refreshPacketView = (ptr: number, size: number) => {
      if (!ptr || size <= 0) return emptyPacket;
      if (heapPacketBuffer !== module.HEAPU32.buffer || ptr !== renderPacketPtrCache || size !== renderPacketSizeCache || !renderPacketView) {
        heapPacketBuffer = module.HEAPU32.buffer;
        renderPacketPtrCache = ptr;
        renderPacketSizeCache = size;
        renderPacketView = new Uint32Array(heapPacketBuffer, ptr, size);
      }
      return renderPacketView;
    };

    const getBuffer = (bufferId: number): RenderBuffer => {
      if (bufferId === BUFFER_RENDER_PACKET) {
        const size = sim_get_buffer_size(handle, BUFFER_RENDER_PACKET);
        const ptr = renderPacketPtr();
        return refreshPacketView(ptr, size);
      }
      const size = sim_get_buffer_size(handle, bufferId);
      const ptr = sim_get_buffer(handle, bufferId);
      const layout = getBufferLayouts()[bufferId];
      let type: 'f32' | 'u16' | 'u32' = 'f32';
      if (layout) {
        if (layout.type === 'u16') {
          type = 'u16';
        } else if (layout.type === 'u32') {
          type = 'u32';
        } else if (layout.type === 'u16/u32') {
          type = size > 65535 ? 'u32' : 'u16';
        }
      }
      if (!ptr || size <= 0) {
        if (type === 'u16') return emptyIndices16;
        if (type === 'u32') return emptyIndices32;
        return emptyFloat;
      }
      const heap = type === 'f32' ? module.HEAPF32.buffer : type === 'u16' ? module.HEAPU16.buffer : module.HEAPU32.buffer;
      const cached = bufferCache.get(bufferId);
      if (!cached || cached.ptr !== ptr || cached.size !== size || cached.type !== type || cached.heap !== heap) {
        let view: RenderBuffer;
        if (type === 'f32') {
          view = new Float32Array(heap, ptr, size);
        } else if (type === 'u16') {
          view = new Uint16Array(heap, ptr, size);
        } else {
          view = new Uint32Array(heap, ptr, size);
        }
        bufferCache.set(bufferId, { ptr, size, type, heap, view });
        return view;
      }
      return cached.view;
    };

    const getPositions = () => {
      return getBuffer(BUFFER_POSITIONS) as Float32Array;
    };
    const getRenderPacket = () => {
      const size = sim_get_buffer_size(handle, BUFFER_RENDER_PACKET);
      const ptr = renderPacketPtr();
      return refreshPacketView(ptr, size);
    };

    const paramsPtr = module._malloc(5 * 4);
    let paramsView = new Float32Array(module.HEAPF32.buffer, paramsPtr, 5);
    const configPtr = module._malloc(3 * 4);
    let configView = new DataView(module.HEAPU8.buffer, configPtr, 3 * 4);
    const diagPtr = module._malloc(7 * 8);
    let diagView = new Float64Array(module.HEAPF64.buffer, diagPtr, 7);
    let heapF64Buffer: ArrayBuffer | null = module.HEAPF64.buffer;
    const refreshAuxViews = () => {
      if (paramsView.buffer !== module.HEAPF32.buffer) {
        paramsView = new Float32Array(module.HEAPF32.buffer, paramsPtr, 5);
      }
      if (configView.buffer !== module.HEAPU8.buffer) {
        configView = new DataView(module.HEAPU8.buffer, configPtr, 3 * 4);
      }
      if (heapF64Buffer !== module.HEAPF64.buffer) {
        heapF64Buffer = module.HEAPF64.buffer;
        diagView = new Float64Array(heapF64Buffer, diagPtr, 7);
      }
    };

    const setParams = (p: Partial<SimParams>) => {
      refreshAuxViews();
      paramsView[0] = p.stiffness ?? 30;
      paramsView[1] = p.damping ?? 0.2;
      paramsView[2] = p.gravity ?? 9.81;
      paramsView[3] = p.restLength ?? 0.5;
      paramsView[4] = p.integrator ?? 0;
      sim_set_params(handle, paramsPtr, paramsView.byteLength);
    };
    const configState: SimConfig = {
      particleCount: 16,
      initialTheta: 0,
      initialPhi: 0.4
    };
    const setConfig = (c: Partial<SimConfig>) => {
      if (!sim_set_config) return;
      refreshAuxViews();
      if (c.particleCount !== undefined) configState.particleCount = Math.max(2, Math.floor(c.particleCount));
      if (c.initialTheta !== undefined) configState.initialTheta = c.initialTheta;
      if (c.initialPhi !== undefined) configState.initialPhi = c.initialPhi;
      configView.setInt32(0, configState.particleCount, true);
      configView.setFloat32(4, configState.initialTheta, true);
      configView.setFloat32(8, configState.initialPhi, true);
      sim_set_config(handle, configPtr, 3 * 4);
    };
    const diagnostics = () => {
      refreshAuxViews();
      sim_get_diagnostics(handle, diagPtr);
      const view = diagView;
      const d: Diagnostics = {
        kineticEnergy: view[0],
        potentialEnergy: view[1],
        springPotential: view[2],
        totalEnergy: view[3],
        constraintRms: view[4],
        solverIterations: view[5],
        stepTimeMs: view[6]
      };
      return d;
    };

    const runtime: SimulationRuntime = {
      step: (dt: number, substeps: number) => sim_step(handle, dt, substeps),
      getPositions,
      getBuffer,
      getRenderPacket,
      getIntegrators: () => integratorOptions,
      setParams,
      setConfig,
      diagnostics,
      destroy: () => {
        sim_destroy(handle);
        module._free(paramsPtr);
        module._free(configPtr);
        module._free(diagPtr);
      }
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
  let initialTheta = 0;
  let initialPhi = 0.4;
  let integrator = 0;

  let positions = new Float32Array(count * 3);
  let velocities = new Float32Array(count * 3);
  let indices = new Uint16Array((count - 1) * 2);
  let springPositions = new Float32Array(0);
  let forces = new Float32Array(count * 3);
  let k1x = new Float32Array(count * 3);
  let k2x = new Float32Array(count * 3);
  let k3x = new Float32Array(count * 3);
  let k4x = new Float32Array(count * 3);
  let k1v = new Float32Array(count * 3);
  let k2v = new Float32Array(count * 3);
  let k3v = new Float32Array(count * 3);
  let k4v = new Float32Array(count * 3);
  let tmpPos = new Float32Array(count * 3);
  let tmpVel = new Float32Array(count * 3);
  const springZigs = 6;
  let springAmplitude = Math.max(0.02, restLength * 0.2);
  let lastStepMs = 0;
  let lastSubsteps = 0;

  const rebuild = () => {
    positions = new Float32Array(count * 3);
    velocities = new Float32Array(count * 3);
    indices = new Uint16Array((count - 1) * 2);
    springPositions = new Float32Array((1 + count * (springZigs + 1)) * 3);
    springAmplitude = Math.max(0.02, restLength * 0.2);
    forces = new Float32Array(count * 3);
    k1x = new Float32Array(count * 3);
    k2x = new Float32Array(count * 3);
    k3x = new Float32Array(count * 3);
    k4x = new Float32Array(count * 3);
    k1v = new Float32Array(count * 3);
    k2v = new Float32Array(count * 3);
    k3v = new Float32Array(count * 3);
    k4v = new Float32Array(count * 3);
    tmpPos = new Float32Array(count * 3);
    tmpVel = new Float32Array(count * 3);
    const sinPhi = Math.sin(initialPhi);
    const cosPhi = Math.cos(initialPhi);
    const cosTheta = Math.cos(initialTheta);
    const sinTheta = Math.sin(initialTheta);
    const dirx = sinPhi * cosTheta;
    const diry = -cosPhi;
    const dirz = sinPhi * sinTheta;
    for (let i = 0; i < count; i++) {
      const dist = restLength * (i + 1);
      positions[i * 3 + 0] = dirx * dist;
      positions[i * 3 + 1] = diry * dist;
      positions[i * 3 + 2] = dirz * dist;
      velocities[i * 3 + 0] = 0;
      velocities[i * 3 + 1] = 0;
      velocities[i * 3 + 2] = 0;
    }
    for (let i = 1; i < count; i++) {
      indices[(i - 1) * 2 + 0] = i - 1;
      indices[(i - 1) * 2 + 1] = i;
    }
    updateSpringPositions();
  };
  rebuild();

  function updateSpringPositions() {
    if (count < 1 || springPositions.length === 0) return;
    let write = 0;
    const push = (x: number, y: number, z: number) => {
      springPositions[write++] = x;
      springPositions[write++] = y;
      springPositions[write++] = z;
    };
    push(0, 0, 0);
    for (let i = 0; i < count; i++) {
      const p0x = i === 0 ? 0 : positions[(i - 1) * 3 + 0];
      const p0y = i === 0 ? 0 : positions[(i - 1) * 3 + 1];
      const p0z = i === 0 ? 0 : positions[(i - 1) * 3 + 2];
      const p1x = positions[i * 3 + 0];
      const p1y = positions[i * 3 + 1];
      const p1z = positions[i * 3 + 2];
      const dx = p1x - p0x;
      const dy = p1y - p0y;
      const dz = p1z - p0z;
      const len = Math.hypot(dx, dy, dz) || 1e-6;
      const dirx = dx / len;
      const diry = dy / len;
      const dirz = dz / len;
      const refx = Math.abs(diry) > 0.9 ? 1 : 0;
      const refy = Math.abs(diry) > 0.9 ? 0 : 1;
      const refz = 0;
      let sidex = diry * refz - dirz * refy;
      let sidey = dirz * refx - dirx * refz;
      let sidez = dirx * refy - diry * refx;
      const sideLen = Math.hypot(sidex, sidey, sidez) || 1e-6;
      sidex /= sideLen;
      sidey /= sideLen;
      sidez /= sideLen;
      for (let k = 1; k <= springZigs; k++) {
        const t = k / (springZigs + 1);
        const sign = k % 2 === 0 ? 1 : -1;
        const bx = p0x + dirx * (len * t) + sidex * springAmplitude * sign;
        const by = p0y + diry * (len * t) + sidey * springAmplitude * sign;
        const bz = p0z + dirz * (len * t) + sidez * springAmplitude * sign;
        push(bx, by, bz);
      }
      push(p1x, p1y, p1z);
    }
  }

  const accumulateForces = (pos: Float32Array, vel: Float32Array) => {
    forces.fill(0);
    for (let i = 0; i < count; i++) {
      forces[i * 3 + 1] -= gravity;
    }
    for (let i = 0; i < count; i++) {
      const i0 = i === 0 ? -1 : (i - 1) * 3;
      const i1 = i * 3;
      const p0x = i === 0 ? 0 : pos[i0];
      const p0y = i === 0 ? 0 : pos[i0 + 1];
      const p0z = i === 0 ? 0 : pos[i0 + 2];
      const dx = pos[i1] - p0x;
      const dy = pos[i1 + 1] - p0y;
      const dz = pos[i1 + 2] - p0z;
      const len = Math.hypot(dx, dy, dz) || 1e-6;
      const dirx = dx / len;
      const diry = dy / len;
      const dirz = dz / len;
      const stretch = len - restLength;
      const fx = -stiffness * stretch * dirx;
      const fy = -stiffness * stretch * diry;
      const fz = -stiffness * stretch * dirz;
      const v0x = i === 0 ? 0 : vel[i0];
      const v0y = i === 0 ? 0 : vel[i0 + 1];
      const v0z = i === 0 ? 0 : vel[i0 + 2];
      const vrel = vel[i1] * dirx + vel[i1 + 1] * diry + vel[i1 + 2] * dirz
        - (v0x * dirx + v0y * diry + v0z * dirz);
      const dfx = -damping * vrel * dirx;
      const dfy = -damping * vrel * diry;
      const dfz = -damping * vrel * dirz;
      forces[i1] += fx + dfx;
      forces[i1 + 1] += fy + dfy;
      forces[i1 + 2] += fz + dfz;
      if (i > 0) {
        forces[i0] -= fx + dfx;
        forces[i0 + 1] -= fy + dfy;
        forces[i0 + 2] -= fz + dfz;
      }
    }
  };

  const integrateSymplectic = (h: number) => {
    accumulateForces(positions, velocities);
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      velocities[idx] += forces[idx] * h;
      velocities[idx + 1] += forces[idx + 1] * h;
      velocities[idx + 2] += forces[idx + 2] * h;
      positions[idx] += velocities[idx] * h;
      positions[idx + 1] += velocities[idx + 1] * h;
      positions[idx + 2] += velocities[idx + 2] * h;
    }
  };

  const integrateVelocityVerlet = (h: number) => {
    const hHalf = h * 0.5;
    accumulateForces(positions, velocities);
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      velocities[idx] += forces[idx] * hHalf;
      velocities[idx + 1] += forces[idx + 1] * hHalf;
      velocities[idx + 2] += forces[idx + 2] * hHalf;
      positions[idx] += velocities[idx] * h;
      positions[idx + 1] += velocities[idx + 1] * h;
      positions[idx + 2] += velocities[idx + 2] * h;
    }
    accumulateForces(positions, velocities);
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      velocities[idx] += forces[idx] * hHalf;
      velocities[idx + 1] += forces[idx + 1] * hHalf;
      velocities[idx + 2] += forces[idx + 2] * hHalf;
    }
  };

  const integrateRk4 = (h: number) => {
    const half = h * 0.5;
    const sixth = h / 6;
    accumulateForces(positions, velocities);
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      k1x[idx] = velocities[idx];
      k1x[idx + 1] = velocities[idx + 1];
      k1x[idx + 2] = velocities[idx + 2];
      k1v[idx] = forces[idx];
      k1v[idx + 1] = forces[idx + 1];
      k1v[idx + 2] = forces[idx + 2];
      tmpPos[idx] = positions[idx] + k1x[idx] * half;
      tmpPos[idx + 1] = positions[idx + 1] + k1x[idx + 1] * half;
      tmpPos[idx + 2] = positions[idx + 2] + k1x[idx + 2] * half;
      tmpVel[idx] = velocities[idx] + k1v[idx] * half;
      tmpVel[idx + 1] = velocities[idx + 1] + k1v[idx + 1] * half;
      tmpVel[idx + 2] = velocities[idx + 2] + k1v[idx + 2] * half;
    }

    accumulateForces(tmpPos, tmpVel);
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      k2x[idx] = tmpVel[idx];
      k2x[idx + 1] = tmpVel[idx + 1];
      k2x[idx + 2] = tmpVel[idx + 2];
      k2v[idx] = forces[idx];
      k2v[idx + 1] = forces[idx + 1];
      k2v[idx + 2] = forces[idx + 2];
      tmpPos[idx] = positions[idx] + k2x[idx] * half;
      tmpPos[idx + 1] = positions[idx + 1] + k2x[idx + 1] * half;
      tmpPos[idx + 2] = positions[idx + 2] + k2x[idx + 2] * half;
      tmpVel[idx] = velocities[idx] + k2v[idx] * half;
      tmpVel[idx + 1] = velocities[idx + 1] + k2v[idx + 1] * half;
      tmpVel[idx + 2] = velocities[idx + 2] + k2v[idx + 2] * half;
    }

    accumulateForces(tmpPos, tmpVel);
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      k3x[idx] = tmpVel[idx];
      k3x[idx + 1] = tmpVel[idx + 1];
      k3x[idx + 2] = tmpVel[idx + 2];
      k3v[idx] = forces[idx];
      k3v[idx + 1] = forces[idx + 1];
      k3v[idx + 2] = forces[idx + 2];
      tmpPos[idx] = positions[idx] + k3x[idx] * h;
      tmpPos[idx + 1] = positions[idx + 1] + k3x[idx + 1] * h;
      tmpPos[idx + 2] = positions[idx + 2] + k3x[idx + 2] * h;
      tmpVel[idx] = velocities[idx] + k3v[idx] * h;
      tmpVel[idx + 1] = velocities[idx + 1] + k3v[idx + 1] * h;
      tmpVel[idx + 2] = velocities[idx + 2] + k3v[idx + 2] * h;
    }

    accumulateForces(tmpPos, tmpVel);
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      k4x[idx] = tmpVel[idx];
      k4x[idx + 1] = tmpVel[idx + 1];
      k4x[idx + 2] = tmpVel[idx + 2];
      k4v[idx] = forces[idx];
      k4v[idx + 1] = forces[idx + 1];
      k4v[idx + 2] = forces[idx + 2];

      positions[idx] += (k1x[idx] + 2 * (k2x[idx] + k3x[idx]) + k4x[idx]) * sixth;
      positions[idx + 1] += (k1x[idx + 1] + 2 * (k2x[idx + 1] + k3x[idx + 1]) + k4x[idx + 1]) * sixth;
      positions[idx + 2] += (k1x[idx + 2] + 2 * (k2x[idx + 2] + k3x[idx + 2]) + k4x[idx + 2]) * sixth;
      velocities[idx] += (k1v[idx] + 2 * (k2v[idx] + k3v[idx]) + k4v[idx]) * sixth;
      velocities[idx + 1] += (k1v[idx + 1] + 2 * (k2v[idx + 1] + k3v[idx + 1]) + k4v[idx + 1]) * sixth;
      velocities[idx + 2] += (k1v[idx + 2] + 2 * (k2v[idx + 2] + k3v[idx + 2]) + k4v[idx + 2]) * sixth;
    }
  };

  const step = (dt: number, substeps: number) => {
    const start = performance.now();
    const h = dt / substeps;
    for (let s = 0; s < substeps; s++) {
      if (integrator === 1) {
        integrateSymplectic(h);
      } else if (integrator === 2) {
        integrateRk4(h);
      } else {
        integrateVelocityVerlet(h);
      }
    }
    updateSpringPositions();
    lastSubsteps = substeps;
    lastStepMs = performance.now() - start;
  };

  const diagnostics = (): Diagnostics => {
    let kinetic = 0;
    let potential = 0;
    let springPotential = 0;
    let constraintSum = 0;
    let constraintCount = 0;
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const vx = velocities[idx];
      const vy = velocities[idx + 1];
      const vz = velocities[idx + 2];
      kinetic += 0.5 * (vx * vx + vy * vy + vz * vz);
      potential += gravity * positions[idx + 1];

      const jdx = i === 0 ? -1 : idx - 3;
      const p0x = i === 0 ? 0 : positions[jdx];
      const p0y = i === 0 ? 0 : positions[jdx + 1];
      const p0z = i === 0 ? 0 : positions[jdx + 2];
      const dx = positions[idx] - p0x;
      const dy = positions[idx + 1] - p0y;
      const dz = positions[idx + 2] - p0z;
      const len = Math.hypot(dx, dy, dz) || 1e-6;
      const stretch = len - restLength;
      constraintSum += stretch * stretch;
      constraintCount += 1;
      springPotential += 0.5 * stiffness * stretch * stretch;
    }
    const constraintRms = constraintCount > 0 ? Math.sqrt(constraintSum / constraintCount) : 0;
    return {
      kineticEnergy: kinetic,
      potentialEnergy: potential,
      springPotential,
      totalEnergy: kinetic + potential + springPotential,
      constraintRms,
      solverIterations: lastSubsteps,
      stepTimeMs: lastStepMs
    };
  };

  const emptyFloat = new Float32Array(0);
  const emptyPacket = new Uint32Array(0);

  return {
    step,
    getPositions: () => positions,
    getBuffer: (bufferId: number) => {
      if (bufferId === BUFFER_POSITIONS) return positions;
      if (bufferId === BUFFER_VELOCITIES) return velocities;
      if (bufferId === BUFFER_INDICES) return indices;
      if (bufferId === BUFFER_SPRING_POSITIONS) return springPositions;
      if (bufferId === BUFFER_RENDER_PACKET) return emptyPacket;
      return emptyFloat;
    },
    getIntegrators: () => DEFAULT_INTEGRATORS,
    setParams: (p: Partial<SimParams>) => {
      if (p.stiffness !== undefined) stiffness = p.stiffness;
      if (p.damping !== undefined) damping = p.damping;
      if (p.gravity !== undefined) gravity = p.gravity;
      if (p.restLength !== undefined) restLength = p.restLength;
      springAmplitude = Math.max(0.02, restLength * 0.2);
      updateSpringPositions();
      if (p.integrator !== undefined) {
        const id = Math.round(p.integrator);
        integrator = id === 1 ? 1 : id === 2 ? 2 : 0;
      }
    },
    setConfig: (c: Partial<SimConfig>) => {
      if (c.particleCount !== undefined) {
        count = Math.max(2, Math.floor(c.particleCount));
      }
      if (c.initialTheta !== undefined) {
        initialTheta = c.initialTheta;
      }
      if (c.initialPhi !== undefined) {
        initialPhi = c.initialPhi;
      }
      rebuild();
    },
    diagnostics,
    destroy: () => {}
  };
}
