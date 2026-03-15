# Architecture and System Overview

This document is the canonical overview of how the current systems fit together,
what contracts they rely on, and how to extend them safely.

## Design Principles and Guidelines

- Keep physics authoritative in C++/WASM; JS is orchestration, not simulation.
- Preserve the C ABI; add new functions or buffer IDs instead of changing layouts.
- Keep rendering packet-driven and simulation-agnostic to avoid per-sim render logic.
- Avoid per-frame allocations; reuse typed arrays, packets, and GPU resources.
- Separate simulation stepping from rendering (fixed or dynamic dt, render fps).
- Prefer schema-driven UI controls and data-driven camera profiles.
- Keep input/camera logic centralized (CameraRig) and shared across pages.
- Diagnostics must come from the simulation, not re-derived in JS.
- Favor static hosting and COOP/COEP headers for WASM threads.
- Treat buffer IDs/layouts as shared contracts across C++ and TS.

## Tech Stack

- Frontend: SvelteKit 2, Svelte 5 (runes), Vite 6, TypeScript (strict)
- Rendering: WebGL2, GLSL shaders, packet-driven renderer
- Physics: C++17, CMake, Emscripten (MODULARIZE/EXPORT_ES6/PTHREADS-ready)
- Tooling: Docker + compose, Makefile orchestration
- Static assets: `static/wasm` for physics bundle

## Repository Layout (Key Areas)

- `cpp/core` - C ABI (`sim_api`), sim registry, base simulation utilities
- `cpp/integrators` - integrator implementations and registry
- `cpp/sims` - concrete simulations (pendulum)
- `cpp/math` - minimal vector math
- `src/lib/simulation` - registry, descriptor types, host orchestration
- `src/lib/renderer` - packet schema, WebGL renderer, mesh helpers
- `src/lib/wasm` - loader, ABI wiring, JS fallback runtime
- `src/lib/camera` - camera math + input rig
- `src/lib/ui` - InspectorPanel, DiagnosticsPanel, render loop
- `src/routes/sim/[slug]` - simulation host page
- `src/routes/viewer` - model viewer route
- `src/hooks.server.ts` - COOP/COEP headers for cross-origin isolation
- `static/wasm` - generated physics bundle (JS/WASM/worker)

## High-Level Flow

1) `/sim/[slug]` loads a `SimulationDescriptor` from the registry.
2) `SimulationHost` creates the renderer + runtime and starts the loop.
3) Runtime exposes buffers (positions, render packets, etc.) via C ABI.
4) Renderer consumes a `RenderPacket` plus buffer map and draws.
5) UI controls update params/config through `SimulationRuntime`.
6) Diagnostics are pulled from the simulation and rendered by the UI.

## Simulation System

### SimulationDescriptor and Registry

Defined in `src/lib/simulation/types.ts` and `src/lib/simulation/registry.ts`.
Each sim provides:

- `createRuntime()` for the WASM runtime
- `getRenderData()` to convert buffers -> render packet
- `controls` schema for the inspector
- `defaults` for params/config/time settings
- `camera` profile with allowed modes and auto-framing

Adding a new simulation means adding one entry to the registry with the above.

### SimulationHost

`src/lib/simulation/host.ts` orchestrates:

- Renderer creation and disposal
- Runtime creation, configuration, and step loop
- Fixed vs dynamic time stepping
- Render FPS throttling
- Pausing while users are interacting with controls
- Diagnostics polling and dispatch

This keeps the route component thin and the lifecycle consistent.

### Controls and Defaults

Controls are schema-driven (`ControlGroup` and `ControlDescriptor` in
`src/lib/simulation/types.ts`). The `InspectorPanel` reads the schema and
updates runtime params/config without per-sim UI code.

Resetting uses the defaults stored in the registry and pushes them to the
runtime via `sim_set_params` / `sim_set_config`.

## Physics Core (C++/WASM)

### C ABI

`cpp/core/sim_api.h` exposes the stable ABI used by JS:

- `sim_create`, `sim_destroy`
- `sim_step`
- `sim_get_buffer`, `sim_get_buffer_size`
- `sim_set_params`, `sim_set_config`
- `sim_get_diagnostics`
- Integrator registry exports

This ABI is intentionally narrow. Use new functions or buffer IDs for extension.

### SimulationBase

`cpp/core/simulation_base.h` centralizes:

- integrator selection and fallback
- fixed substep loop
- diagnostics aggregation (energy, constraints, timings)

Each simulation implements:

- `stepSubstep`
- `computeEnergy`
- `computeConstraintRms`
- buffer getters

### Integrator Registry

Integrators are registered centrally (`cpp/integrators`). Simulations opt into
supported integrators without re-wiring per sim.

### Diagnostics Contract

`cpp/core/types.h` defines a `Diagnostics` struct (double precision) with:

- kineticEnergy, potentialEnergy, springPotential, totalEnergy
- constraintRms, solverIterations, stepTimeMs

These are fetched via `sim_get_diagnostics` and rendered by the UI.

## Renderer System

### Render Packets

Defined in `src/lib/renderer/packet.ts` and used in both JS and WASM:

Header:
```
packet[0] = RENDER_PACKET_MAGIC ('RPKT')
packet[1] = RENDER_PACKET_VERSION
packet[2] = commandCount
packet[3] = baseStride
```

Commands (kind, bufferId, count, aux):

- `CMD_LINES`
- `CMD_SPHERES`
- `CMD_POINTS`
- `CMD_MESH`
- `CMD_INSTANCED_MESH`

Packets allow simulations to describe what to render without touching renderer
code, keeping rendering logic centralized.

### Buffer Layouts

`BUFFER_*` IDs are shared between C++ (`cpp/core/types.h`) and TS
(`src/lib/renderer/packet.ts`). Layouts are declared in TS via `BUFFER_LAYOUTS`
and can be extended to include new attributes.

### WebGL Renderer

`src/lib/renderer/webgl.ts` implements a single packet-driven renderer. It is
the only place that knows how to translate packet commands into GPU draws.

## Camera System

`src/lib/camera` provides:

- `CameraProfile` (default mode, allowed modes, speeds, invertY, auto-frame)
- `CameraRig` (mouse, keyboard, pointer lock, per-frame update)
- shared math helpers (`makeCameraForMode`, `viewProj`)

The rig is shared by sim and viewer routes for consistent interaction.

## Diagnostics UI

`src/lib/ui/DiagnosticsPanel.svelte` provides:

- Collapsible panel (header only when collapsed)
- Gridlines, zero line, axis labels
- Per-graph and overlay plots
- Time-window selection with ring buffer resizing
- Hover tooltips with time/value

The panel takes diagnostics from the runtime and never computes physics values.

## Runtime and Render Loop

`src/lib/ui/renderLoop.ts` provides a single `requestAnimationFrame` loop with
dt clamping. `SimulationHost` uses it to separate simulation stepping from
rendering.

## WASM Loader

`src/lib/wasm/loader.ts`:

- Loads `/wasm/physics.js` (Emscripten MODULARIZE/EXPORT_ES6 output)
- Caches typed array views into HEAP buffers
- Exposes `SimulationRuntime` to the host
- Includes a JS fallback runtime when WASM is unavailable

## Extension Points

### Add a new simulation

1) Implement C++ sim under `cpp/sims`.
2) Register it in `cpp/core/sim_registry.cpp`.
3) Expose buffers via `getBuffer` and `getBufferSize`.
4) Add a `SimulationDescriptor` entry in `src/lib/simulation/registry.ts`.
5) Define controls and defaults in the descriptor.

### Add a new integrator

1) Implement it in `cpp/integrators`.
2) Register it in the integrator registry.
3) Use it via integrator IDs in the UI.

### Add a new render command

1) Extend `packet.ts` with a new command ID.
2) Add rendering logic in `renderer/webgl.ts`.
3) Emit command from WASM or JS packet builder.

## Build and Run

- `make dev` - run Vite dev server via Docker
- `make prod` - run production server
- `make cmake-build` - build C++/WASM bundle inside the container

COOP/COEP headers are enforced in `src/hooks.server.ts`.
