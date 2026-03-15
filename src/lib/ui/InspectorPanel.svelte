<script lang="ts">
  import type { ControlGroup, ControlDescriptor, ControlOption } from '$lib/simulation/types';
  import type { IntegratorOption, SimConfig, SimParams } from '$lib/wasm/loader';

  type RuntimeState = {
    renderFps: number;
    fixedDt: number;
    timeMode: 'fixed' | 'dynamic';
    integrators: IntegratorOption[];
  };

  type Props = {
    controls: ControlGroup[];
    params: SimParams;
    config: SimConfig;
    runtime: RuntimeState;
    onParamsChange: (next: Partial<SimParams>) => void;
    onConfigChange: (next: Partial<SimConfig>) => void;
    onRuntimeChange: (key: keyof RuntimeState, value: number | string) => void;
    onInteractionChange?: (active: boolean) => void;
  };

  const {
    controls,
    params,
    config,
    runtime,
    onParamsChange,
    onConfigChange,
    onRuntimeChange,
    onInteractionChange
  } = $props<Props>();

  const renderFpsOptions: ControlOption[] = [
    { label: 'Uncapped', value: 0 },
    { label: '30', value: 30 },
    { label: '60', value: 60 },
    { label: '90', value: 90 },
    { label: '120', value: 120 }
  ];
  const timeModeOptions: ControlOption[] = [
    { label: 'Fixed', value: 'fixed' },
    { label: 'Dynamic', value: 'dynamic' }
  ];

  const getValue = (target: ControlGroup['target'], key: string) => {
    if (target === 'params') return (params as Record<string, number | string | undefined>)[key];
    if (target === 'config') return (config as Record<string, number | string | undefined>)[key];
    return (runtime as Record<string, number | string | undefined>)[key];
  };

  const getOptions = (control: ControlDescriptor): ControlOption[] => {
    if (control.type !== 'select') return [];
    if (control.options === 'integrators') {
      return runtime.integrators.map((option) => ({ label: option.name, value: option.id }));
    }
    if (control.options === 'renderFps') {
      return renderFpsOptions;
    }
    if (control.options === 'timeMode') {
      return timeModeOptions;
    }
    return control.options;
  };

  const formatValue = (control: ControlDescriptor, value: number) => {
    if ((control.type === 'range' || control.type === 'number') && control.format) {
      return control.format(value);
    }
    return `${value}`;
  };

  const setValue = (target: ControlGroup['target'], key: string, value: number | string) => {
    if (target === 'params') {
      onParamsChange({ [key]: value } as Partial<SimParams>);
      return;
    }
    if (target === 'config') {
      onConfigChange({ [key]: value } as Partial<SimConfig>);
      return;
    }
    onRuntimeChange(key as keyof RuntimeState, value);
  };

  const isVisible = (target: ControlGroup['target'], control: ControlDescriptor) => {
    const rule = control.visibleWhen;
    if (!rule) return true;
    const ruleTarget = rule.target ?? target;
    return getValue(ruleTarget, rule.key) === rule.value;
  };

  const setInteracting = (active: boolean) => {
    onInteractionChange?.(active);
  };
</script>

{#each controls as group, groupIndex}
  <div class="section">
    {#if group.title}
      <h3>{group.title}</h3>
    {/if}
    {#each group.controls as control, controlIndex}
      {@const controlId = `control-${groupIndex}-${controlIndex}-${control.key}`}
      {#if isVisible(group.target, control)}
        <div class="control">
          <label for={controlId}>{control.label}</label>
        {#if control.type === 'range'}
          {@const value = Number(getValue(group.target, control.key) ?? 0)}
          <input
            id={controlId}
            type="range"
            min={control.min}
            max={control.max}
            step={control.step ?? 0.01}
            value={value}
            onfocus={() => setInteracting(true)}
            onblur={() => setInteracting(false)}
            onpointerdown={() => setInteracting(true)}
            onpointerup={() => setInteracting(false)}
            onpointercancel={() => setInteracting(false)}
            onchange={(event) => {
              const next = Number((event.currentTarget as HTMLInputElement).value);
              setValue(group.target, control.key, next);
            }}
          />
          <span>{formatValue(control, value)}</span>
        {:else if control.type === 'number'}
          {@const value = Number(getValue(group.target, control.key) ?? 0)}
          <input
            id={controlId}
            type="number"
            min={control.min}
            max={control.max}
            step={control.step ?? 0.0001}
            value={value}
            onfocus={() => setInteracting(true)}
            onblur={() => setInteracting(false)}
            onchange={(event) => {
              const raw = (event.currentTarget as HTMLInputElement).value;
              const next = Number(raw);
              if (!Number.isFinite(next)) return;
              if (next < control.min || next > control.max) return;
              setValue(group.target, control.key, next);
            }}
          />
        {:else if control.type === 'select'}
          {@const value = getValue(group.target, control.key) ?? ''}
          <select
              id={controlId}
              value={value}
              onfocus={() => setInteracting(true)}
              onblur={() => setInteracting(false)}
              onchange={(event) => {
                const raw = (event.currentTarget as HTMLSelectElement).value;
                const numeric = Number(raw);
                const next = Number.isFinite(numeric) ? numeric : raw;
                setValue(group.target, control.key, next);
              }}
            >
              {#each getOptions(control) as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
{/each}

<style>
  .section {
    margin-bottom: 1rem;
  }
  h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1rem;
    color: #e2e8f0;
  }
  .control {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.25rem 0.5rem;
    align-items: center;
    margin-bottom: 0.75rem;
  }
  .control label {
    grid-column: 1 / 3;
    font-size: 0.9rem;
    color: #94a3b8;
  }
  .control input[type='range'] {
    grid-column: 1 / 2;
  }
  .control input[type='number'] {
    grid-column: 1 / 3;
    padding: 0.3rem 0.5rem;
    border-radius: 6px;
    border: 1px solid #334155;
    background: #0f172a;
    color: #e2e8f0;
    font-family: monospace;
  }
  .control select {
    grid-column: 1 / 3;
    padding: 0.3rem 0.5rem;
    border-radius: 6px;
    border: 1px solid #334155;
    background: #0f172a;
    color: #e2e8f0;
  }
  .control span {
    text-align: right;
    font-family: monospace;
  }
</style>
