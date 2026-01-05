// Placeholder worker to satisfy WASM threads layout; actual compute will be provided by the physics build.
self.onmessage = (event) => {
  // Echo back to verify worker wiring in the host.
  self.postMessage({ type: 'worker-ready', payload: event.data ?? null });
};
