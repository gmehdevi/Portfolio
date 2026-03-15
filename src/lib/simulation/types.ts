import type { RenderData } from '$lib/renderer';
import type { CameraProfile } from '$lib/camera/types';
import type { SimConfig, SimParams, SimulationRuntime } from '$lib/wasm/loader';

export type ControlOption = {
  label: string;
  value: number | string;
};

export type ControlTarget = 'params' | 'config' | 'runtime';

export type RangeControl = {
  type: 'range';
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  visibleWhen?: ControlVisibility;
};

export type NumberControl = {
  type: 'number';
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  visibleWhen?: ControlVisibility;
};

export type SelectControl = {
  type: 'select';
  key: string;
  label: string;
  options: ControlOption[] | 'integrators' | 'renderFps' | 'timeMode';
  visibleWhen?: ControlVisibility;
};

export type ControlDescriptor = RangeControl | NumberControl | SelectControl;

export type ControlVisibility = {
  target?: ControlTarget;
  key: string;
  value: number | string;
};

export type ControlGroup = {
  title?: string;
  target: ControlTarget;
  controls: ControlDescriptor[];
};

export type SimulationControls = ControlGroup[];

export type SimulationDefaults = {
  params?: SimParams;
  config?: SimConfig;
  renderFps?: number;
  fixedDt?: number;
  timeMode?: 'fixed' | 'dynamic';
};

export type SimulationView = {
  fovY?: number;
  near?: number;
  far?: number;
};

export type SimulationDescriptor = {
  slug: string;
  name: string;
  description: string;
  tags?: string[];
  camera: CameraProfile;
  defaults?: SimulationDefaults;
  controls?: SimulationControls;
  view?: SimulationView;
  createRuntime: () => Promise<SimulationRuntime>;
  getRenderData: (runtime: SimulationRuntime, previous?: RenderData) => RenderData;
};
