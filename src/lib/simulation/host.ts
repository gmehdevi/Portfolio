import { createRenderer } from '$lib/renderer';
import type { RenderData, Renderer } from '$lib/renderer';
import type { SimulationDescriptor } from './types';
import type { SimulationRuntime, SimParams, SimConfig, Diagnostics } from '$lib/wasm/loader';
import type { CameraRig } from '$lib/camera/rig';
import { createRenderLoop } from '$lib/ui/renderLoop';

export type SimulationHostOptions = {
  canvas: HTMLCanvasElement;
  descriptor: SimulationDescriptor;
  cameraRig: CameraRig;
  onStatus?: (status: string) => void;
  onDiagnostics?: (diagnostics: Diagnostics) => void;
  fixedDt?: number;
  maxSubsteps?: number;
  renderFps?: number;
  timeMode?: 'fixed' | 'dynamic';
};

export type SimulationHostStartOptions = {
  params?: SimParams;
  config?: SimConfig;
};

export function createSimulationHost(options: SimulationHostOptions) {
  const { canvas, descriptor, cameraRig } = options;
  let fixedDt = options.fixedDt ?? 1 / 120;
  const maxSubsteps = options.maxSubsteps ?? 4;
  let timeMode: 'fixed' | 'dynamic' = options.timeMode ?? 'dynamic';
  let renderInterval = options.renderFps && options.renderFps > 0 ? 1 / options.renderFps : 0;
  let renderAccumulator = 0;

  let renderer: Renderer | null = null;
  let runtime: SimulationRuntime | null = null;
  let loop: ReturnType<typeof createRenderLoop> | null = null;
  let accumulator = 0;
  let renderData: RenderData | null = null;
  let paused = false;

  const start = async (init?: SimulationHostStartOptions) => {
    stop();
    options.onStatus?.('initializing renderer...');
    renderer = createRenderer(canvas);
    options.onStatus?.('loading runtime...');
    runtime = await descriptor.createRuntime();
    if (init?.params) {
      runtime.setParams(init.params);
    }
    if (init?.config && runtime.setConfig) {
      runtime.setConfig(init.config);
    }
    if (descriptor.camera.autoFrame?.enabled !== false && cameraRig.frame) {
      const positions = runtime.getPositions();
      cameraRig.frame(positions, descriptor.camera.targetIds, descriptor.camera.autoFrame?.padding);
    }
    options.onStatus?.('running');

    accumulator = 0;
    renderAccumulator = 0;
    loop = createRenderLoop({
      onFrame: (dt: number) => {
        if (!runtime || !renderer) return;
        if (!paused) {
          if (timeMode === 'fixed') {
            accumulator += dt;
            if (renderInterval > 0) {
              renderAccumulator += dt;
            }
            let steps = 0;
            while (accumulator >= fixedDt && steps < maxSubsteps) {
              steps++;
              accumulator -= fixedDt;
            }
            if (steps > 0) {
              runtime.step(fixedDt * steps, steps);
            }
          } else {
            if (renderInterval > 0) {
              renderAccumulator += dt;
            }
            if (dt > 0) {
              runtime.step(dt, 1);
            }
          }
        } else if (renderInterval > 0) {
          renderAccumulator += dt;
        }

        cameraRig.update(dt);
        const shouldRender = renderInterval <= 0 || renderAccumulator >= renderInterval;
        if (shouldRender) {
          if (renderInterval > 0) {
            renderAccumulator = renderAccumulator % renderInterval;
          }
          const aspect = canvas.width / Math.max(1, canvas.height);
          const view = descriptor.view;
          const viewProj = cameraRig.viewProj(
            aspect,
            view?.near ?? 0.01,
            view?.far ?? 200,
            view?.fovY ?? Math.PI / 3
          );
          renderData = descriptor.getRenderData(runtime, renderData ?? undefined);
          renderer.render(renderData, viewProj);
          options.onDiagnostics?.(runtime.diagnostics());
        }
      }
    });
    loop.start();
  };

  const stop = () => {
    loop?.stop();
    loop = null;
    runtime?.destroy();
    runtime = null;
    renderer?.dispose();
    renderer = null;
    renderData = null;
  };

  const setParams = (params: Partial<SimParams>) => {
    runtime?.setParams(params);
  };

  const setConfig = (config: Partial<SimConfig>) => {
    if (runtime?.setConfig) {
      runtime.setConfig(config);
    }
  };

  const setRenderFps = (fps: number) => {
    renderInterval = fps > 0 ? 1 / fps : 0;
    renderAccumulator = 0;
  };

  const setTimeMode = (mode: 'fixed' | 'dynamic') => {
    timeMode = mode;
    accumulator = 0;
    renderAccumulator = 0;
  };

  const setFixedDt = (dt: number) => {
    const next = Number(dt);
    if (!Number.isFinite(next) || next <= 0) return;
    fixedDt = next;
    accumulator = Math.min(accumulator, fixedDt);
  };

  const setPaused = (value: boolean) => {
    paused = value;
    accumulator = 0;
  };

  return {
    start,
    stop,
    setParams,
    setConfig,
    setRenderFps,
    setTimeMode,
    setFixedDt,
    setPaused,
    getRuntime: () => runtime,
    getRenderer: () => renderer
  };
}
