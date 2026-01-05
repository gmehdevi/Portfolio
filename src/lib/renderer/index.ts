import { initLineRenderer, initMeshRenderer, initPendulumRenderer } from './webgl';

export type RenderMode = 'pendulum' | 'mesh' | 'particles' | 'nbody' | 'fluid' | 'obj';

export type RenderData =
  | { mode: 'pendulum'; positions: Float32Array }
  | { mode: 'mesh'; positions: Float32Array; normals: Float32Array; indices: Uint16Array | Uint32Array; uvs?: Float32Array; texture?: WebGLTexture | null; shading?: number; lightDir?: [number, number, number]; lightColor?: [number, number, number] }
  | { mode: 'particles'; positions: Float32Array }
  | { mode: 'nbody'; positions: Float32Array }
  | { mode: 'fluid'; positions: Float32Array }
  | { mode: 'obj'; positions: Float32Array; normals: Float32Array; indices: Uint16Array | Uint32Array; uvs?: Float32Array; texture?: WebGLTexture | null; shading?: number; lightDir?: [number, number, number]; lightColor?: [number, number, number] };

export type Renderer = {
  render: (data: RenderData, viewProj: Float32Array) => void;
  resize: () => void;
  dispose: () => void;
  gl?: WebGL2RenderingContext;
};

/**
 * Centralized renderer factory so modes can be swapped without touching callers.
 * Unimplemented modes currently fall back to mesh/line renderers.
 */
export function createRenderer(canvas: HTMLCanvasElement, mode: RenderMode): Renderer {
  if (mode === 'pendulum') {
    const r = initPendulumRenderer(canvas);
    return {
      render: (data, viewProj) => {
        if (data.mode === 'pendulum') {
          r.render(data.positions, viewProj);
        }
      },
      resize: r.resize,
      dispose: r.dispose,
      gl: r.gl
    };
  }

  if (mode === 'mesh' || mode === 'obj') {
    const r = initMeshRenderer(canvas);
    return {
      render: (data, viewProj) => {
        if (data.mode === 'mesh' || data.mode === 'obj') {
          r.render(
            data.positions,
            data.normals,
            data.indices,
            viewProj,
            data.uvs,
            data.texture ?? null,
            data.shading ?? 1,
            data.lightDir ?? [0.2, 0.9, 0.3],
            data.lightColor ?? [1, 1, 1]
          );
        }
      },
      resize: r.resize,
      dispose: r.dispose,
      gl: r.gl
    };
  }

  // Fallback: simple line renderer for particles/nbody/fluid until dedicated pipelines are added.
  const r = initLineRenderer(canvas);
  return {
    render: (data, viewProj) => {
      if (data.mode === 'particles' || data.mode === 'nbody' || data.mode === 'fluid') {
        r.render(data.positions, viewProj);
      }
    },
    resize: r.resize,
    dispose: r.dispose,
    gl: r.gl
  };
}
