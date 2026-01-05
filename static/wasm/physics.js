// Minimal stub loader for testing COOP/COEP + wasm fetch.
export async function initPhysics() {
  const source = fetch('/wasm/physics.wasm');
  if (WebAssembly.instantiateStreaming) {
    const { instance } = await WebAssembly.instantiateStreaming(source, {});
    return instance;
  }
  const buf = await (await source).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(buf, {});
  return instance;
}
