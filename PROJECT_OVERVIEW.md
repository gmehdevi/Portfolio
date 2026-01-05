# Project Overview

## Purpose
Client-side physics simulation host with WebGL rendering and WASM physics core. Goals:
- Full browser execution (no backend compute), static-host friendly.
- Modular simulations (pendulum, particles, n-body, fluids, OBJ viewer).
- Deterministic stepping and reproducible runs.
- Extensible renderer and input system for future domains.

## Tech Stack
- **Frontend:** SvelteKit 2, Svelte 5 (runes), Vite 6, TypeScript (strict), GLSL shaders, WebGL2.
- **UI/Styling:** CSS (no runtime CSS-in-JS), minimalist components.
- **Physics Core:** C++17, CMake, Emscripten (MODULARIZE/EXPORT_ES6/PTHREADS-ready), exposes stable C ABI (`sim_*`).
- **Containers/Tooling:** Dockerfile (Node 20), docker compose, Makefile orchestrating CMake + dev/prod services.
- **Assets:** Static `/wasm` for engine bundle, `/static/.well-known` for devtools silence, shaders under `src/lib/renderer/shaders`.

Justification: SvelteKit keeps hydration cost low and supports static hosting; WebGL2 guarantees broad support; C++/Emscripten delivers high-performance physics with threads/SharedArrayBuffer when COOP/COEP headers are set. Docker ensures reproducible builds without host installs.

## Current Features
- Gallery and sim routes; pendulum sim with runtime param updates.
- Renderer abstraction (`createRenderer`) with modes (pendulum, mesh/obj, particles placeholder) and shared WebGL pipelines.
- Model viewer: OBJ + texture load in-browser, shading selection (unlit/Lambert/Phong), adjustable light direction, orbit/fly cameras with pointer lock for fly mode.
- Camera controls: orbit (drag + wheel), fly (WASD + space/shift, pointer lock), configurable far plane per model.
- WASM loader with JS fallback; security headers for COOP/COEP.

## Future Work
- **Engine:** Add planetary n-body, cloth, fluid (SPH) sims; diagnostics buffers (energy, constraints) for plotting; multi-threaded builds via Emscripten PThreads.
- **Renderer:** Dedicated pipelines for particles (point/instanced spheres), fluid (screen-space splat/blur), instanced shapes for performance; texture/material library; postprocessing toggles.
- **UI:** Inspector panels, camera profiles per sim, diagnostics charts, record/replay, preset management.
- **Assets:** OBJ/GLTF loader with tolerant parsing and optional compression; texture drop-in with caching.
- **Build:** Bundle real `physics.js/wasm/worker` into `static/wasm`; CI to build wasm + run lint/tests; optional CDN for assets.

## Generalization & Efficiency
- Renderer decoupled via `RenderData` union; adding modes doesn’t alter callers.
- Shared camera math and pointer-lock fly mode to keep input consistent across viewers/sims.
- Shaders modularized; materials selected via uniforms (shading mode, light dir/color); texture optional to reduce state changes.
- Physics ABI stable; simulations registered via factory for lazy loading.
- Containers cache node_modules and build outputs in volumes; `fclean` removes images to simulate fresh environment.

## Implementation Notes
- WebGL2 only (for compatibility); compute-style work should be minimized or approximated via instancing until WebGPU is considered.
- Pointer lock only in fly mode; orbit remains free cursor.
- OBJ parser is tolerant (ignores malformed lines, generates normals/uvs if absent); recenter/scale on load to stabilize camera and clip planes.
- Far plane adapts to model radius in viewer; pendulum uses fixed far with headroom.
