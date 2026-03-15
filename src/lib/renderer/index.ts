import { initPacketRenderer } from './webgl';
import type { PacketMaterial, RenderBufferMap, RenderPacket } from './packet';

export type RenderData =
  | { mode: 'packet'; packet: RenderPacket; buffers: RenderBufferMap; material?: PacketMaterial };

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
export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const r = initPacketRenderer(canvas);
  return {
    render: (data, viewProj) => {
      if (data.mode === 'packet') {
        r.render(data.packet, data.buffers, viewProj, data.material);
      }
    },
    resize: r.resize,
    dispose: r.dispose,
    gl: r.gl
  };
}
