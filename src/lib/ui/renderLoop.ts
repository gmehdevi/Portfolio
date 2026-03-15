export type RenderLoopOptions = {
  onFrame: (dt: number) => void;
  maxDelta?: number;
};

export function createRenderLoop(options: RenderLoopOptions) {
  let raf = 0;
  let last = 0;
  const maxDelta = options.maxDelta ?? 0.25;

  const frame = () => {
    const now = performance.now();
    const dt = Math.min(maxDelta, (now - last) * 0.001);
    last = now;
    options.onFrame(dt);
    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const stop = () => {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  };

  return {
    start,
    stop,
    isRunning: () => raf !== 0
  };
}
