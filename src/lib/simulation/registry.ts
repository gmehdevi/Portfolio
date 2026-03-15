import { createSimulationRuntime } from '$lib/wasm/loader';
import { buildLineSpherePacket, BUFFER_POSITIONS, BUFFER_SPRING_POSITIONS } from '$lib/renderer/packet';
import type { SimulationDescriptor } from './types';

const simulations: SimulationDescriptor[] = [
  {
    slug: 'pendulum',
    name: '3D Elastic Pendulum',
    description: 'Chain of masses with configurable stiffness, damping, and gravity.',
    tags: ['constraints', 'springs', 'verlet'],
    camera: {
      default: 'orbit',
      allowed: ['orbit', 'fly'],
      invertY: true,
      autoFrame: { enabled: true, padding: 2.0 }
    },
    defaults: {
      params: {
        stiffness: 30,
        damping: 0.2,
        gravity: 9.81,
        restLength: 0.5,
        integrator: 0
      },
      config: {
        particleCount: 16,
        initialTheta: 0,
        initialPhi: 0.4
      },
      renderFps: 60,
      fixedDt: 1 / 120,
      timeMode: 'dynamic'
    },
    controls: [
      {
        title: 'Simulation',
        target: 'params',
        controls: [
          { type: 'range', key: 'stiffness', label: 'Stiffness', min: 1, max: 100, step: 1, format: (v) => v.toFixed(1) },
          { type: 'range', key: 'damping', label: 'Damping', min: 0, max: 5, step: 0.05, format: (v) => v.toFixed(2) },
          { type: 'range', key: 'gravity', label: 'Gravity', min: 0, max: 20, step: 0.1, format: (v) => v.toFixed(2) },
          { type: 'range', key: 'restLength', label: 'Rest Length', min: 0.1, max: 2, step: 0.05, format: (v) => v.toFixed(2) },
          { type: 'select', key: 'integrator', label: 'Integrator', options: 'integrators' }
        ]
      },
      {
        title: 'Setup',
        target: 'config',
        controls: [
          { type: 'range', key: 'particleCount', label: 'Particles', min: 2, max: 64, step: 1, format: (v) => `${Math.round(v)}` },
          { type: 'range', key: 'initialTheta', label: 'Initial Theta (rad)', min: -Math.PI, max: Math.PI, step: 0.01, format: (v) => v.toFixed(2) },
          { type: 'range', key: 'initialPhi', label: 'Initial Phi (rad)', min: -Math.PI, max: Math.PI, step: 0.01, format: (v) => v.toFixed(2) }
        ]
      },
      {
        title: 'Runtime',
        target: 'runtime',
        controls: [
          { type: 'select', key: 'renderFps', label: 'Render FPS', options: 'renderFps' },
          { type: 'select', key: 'timeMode', label: 'Time Mode', options: 'timeMode' },
          {
            type: 'number',
            key: 'fixedDt',
            label: 'Physics dt (s)',
            min: 0.0001,
            max: 1,
            step: 0.0001,
            format: (v) => v.toFixed(4),
            visibleWhen: { target: 'runtime', key: 'timeMode', value: 'fixed' }
          }
        ]
      }
    ],
    view: {
      fovY: Math.PI / 3,
      near: 0.01,
      far: 200
    },
    createRuntime: () => createSimulationRuntime(),
    getRenderData: (runtime, previous) => {
      const positions = runtime.getPositions();
      const count = Math.floor(positions.length / 3);
      const springPositions = runtime.getBuffer(BUFFER_SPRING_POSITIONS);
      const springCount = springPositions instanceof Float32Array ? Math.floor(springPositions.length / 3) : 0;
      const wasmPacket = runtime.getRenderPacket ? runtime.getRenderPacket() : null;
      const packet = wasmPacket && wasmPacket.length >= 4
        ? wasmPacket
        : buildLineSpherePacket(
            springCount > 0 ? springCount : count,
            0.15,
            previous?.packet,
            { lineBufferId: springCount > 0 ? BUFFER_SPRING_POSITIONS : BUFFER_POSITIONS, sphereBufferId: BUFFER_POSITIONS }
          );
      if (previous) {
        previous.packet = packet;
        previous.buffers[BUFFER_POSITIONS] = positions;
        if (springPositions instanceof Float32Array) {
          previous.buffers[BUFFER_SPRING_POSITIONS] = springPositions;
        }
        return previous;
      }
      return {
        mode: 'packet',
        packet,
        buffers: {
          [BUFFER_POSITIONS]: positions,
          ...(springPositions instanceof Float32Array ? { [BUFFER_SPRING_POSITIONS]: springPositions } : {})
        }
      };
    }
  }
];

export function listSimulations(): SimulationDescriptor[] {
  return simulations;
}

export function getSimulationBySlug(slug: string): SimulationDescriptor | undefined {
  return simulations.find((sim) => sim.slug === slug);
}
