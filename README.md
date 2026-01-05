# Physics Simulation Engine (WASM-ready core) + SvelteKit Host

This repository starts the client-side physics engine described in Documents A and B. It now also scaffolds the SvelteKit/WebGL host with COOP/COEP headers required for WASM + threads. All Node dependency management is containerized via Docker/Compose—no local `npm install` is required.

## Layout
- `cpp/core` — C ABI surface (`sim_api`), simulation registry, shared types, and simulation base class.
- `cpp/math` — Minimal vector math (`Vec3`) for dynamics.
- `cpp/integrators` — Velocity Verlet implementation used by the pendulum.
- `cpp/sims` — Simulation implementations; currently the 3D elastic pendulum (`SIM_PENDULUM_3D`).
- `CMakeLists.txt` — Builds a static library `physics` (C++17, warnings on by default).
- `src/` — SvelteKit host scaffolding with COOP/COEP headers, gallery page, and simulation route. `src/lib/renderer/webgl.ts` draws a GPU shader test; `src/lib/wasm/loader.ts` pulls stub WASM + worker.
- `static/wasm` — Stubbed `physics.wasm`, `physics.js`, and `physics.worker.js` to exercise COOP/COEP + WebGL without the full engine build.
- `Dockerfile`, `compose.yml`, `Makefile` — Dev/prod workflows for the host (container-only dependency management).

## Building (native)
```bash
cmake -S . -B build
cmake --build build
```
The output static library is placed under `build/`. Emscripten builds can reuse the same CMake targets with an em++ toolchain; the code avoids platform-specific dependencies.

## SvelteKit host (WASM ready, Svelte 5 + Vite 6)
- `src/hooks.server.ts` sets `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, and `Cross-Origin-Resource-Policy: same-origin` for cross-origin isolation (required for WASM threads/SharedArrayBuffer).
- `src/routes/+layout.svelte` provides the shell; `/` lists simulations; `/sim/[slug]` hosts the WebGL canvas stub for the pendulum, loads stub WASM/worker, and renders a GPU gradient via WebGL2.
- Svelte 5 + Kit 2: `svelte.config.js` enables runes; Kit auto-generates `.svelte-kit/tsconfig.json` (no manual tsconfig needed).
- To run locally (containerized): `make dev` (compose `dev` service) serves Vite on `5173` with node_modules in a named volume; `make prod` serves `node build` on `3000`.

## Container workflows
- `make dev` / `docker compose -f compose.yml up dev`: dev server at `5173`, uses named volume `physics-sim-host_node_modules`; no host installs.
- `make prod` / `docker compose -f compose.yml up prod`: production server at `3000`.
- `.dockerignore` keeps build context lean; production image reuses `node_modules` from the deps stage.

## C ABI (per Document B)
- `int sim_create(int sim_type, const void* config, int config_size);`
- `void sim_step(int handle, double dt, int substeps);`
- `void sim_destroy(int handle);`
- `float* sim_get_buffer(int handle, int buffer_id);`
- `int sim_get_buffer_size(int handle, int buffer_id);`
- `void sim_set_params(int handle, const void* params, int size);`
- `void sim_get_diagnostics(int handle, Diagnostics* out);`

Buffer IDs follow Document B (`0` positions, `1` velocities, `2` normals placeholder, `3` indices as floats). `Diagnostics` reports energies, constraint RMS, solver iterations, and step time (ms).

## Pendulum configuration
`sim_create` accepts an optional `PendulumConfig` (matches `sim_pendulum3d.cpp`):
```cpp
struct PendulumConfig {
  int particleCount;  // >= 2
  float restLength;   // meters between masses
  float mass;         // per-mass weight
  float stiffness;    // spring constant
  float damping;      // link damping along the chain
  float gravity;      // positive magnitude, acts downward
};
```
`sim_set_params` uses the same layout to update stiffness/damping/gravity/restLength at runtime.

## Next steps
- Add more simulations (planetary, cloth, SPH) using the same registry path.
- Wire the C ABI into the SvelteKit/WebGL host and stream buffers into WebGL renderer (instancing/lines/meshes).
- Expand buffer descriptors (normals/colors/debug buffers) to cover renderer needs.
