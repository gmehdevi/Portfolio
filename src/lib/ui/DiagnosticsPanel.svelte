<script lang="ts">
  import { onMount } from 'svelte';
  import type { Diagnostics } from '$lib/wasm/loader';

  type Props = {
    diagnostics?: Diagnostics | null;
    sampleCount?: number;
    sampleRate?: number;
    resetKey?: string | number;
  };

  type Normalization = 'absolute' | 'delta' | 'per-particle';
  type MetricKey = keyof Diagnostics;

  type MetricDef = {
    key: MetricKey;
    label: string;
    color: string;
    normalize: boolean;
    graph: boolean;
    digits?: number;
  };

  const props = $props<Props>();
  const diagnostics = $derived(props.diagnostics ?? null);
  const sampleCount = $derived(props.sampleCount ?? 1);
  const sampleRate = $derived(props.sampleRate && props.sampleRate > 0 ? props.sampleRate : 60);
  const resetKey = $derived(props.resetKey);

  const graphKeys = ['kineticEnergy', 'potentialEnergy', 'springPotential', 'totalEnergy', 'constraintRms'] as const;
  type GraphKey = typeof graphKeys[number];
  type GraphMetricDef = MetricDef & { key: GraphKey };

  const metricDefs: MetricDef[] = [
    { key: 'kineticEnergy', label: 'Energy (K)', color: '#7dd3fc', normalize: true, graph: true },
    { key: 'potentialEnergy', label: 'Energy (G)', color: '#fbbf24', normalize: true, graph: true },
    { key: 'springPotential', label: 'Energy (S)', color: '#f472b6', normalize: true, graph: true },
    { key: 'totalEnergy', label: 'Energy (T)', color: '#34d399', normalize: true, graph: true },
    { key: 'constraintRms', label: 'Constraint RMS', color: '#a5b4fc', normalize: false, graph: true, digits: 4 }
  ];

  const graphDefs = metricDefs.filter((metric): metric is GraphMetricDef => metric.graph);

  const timeWindowOptions = [5, 10, 30, 60];
  let timeWindowSec = $state(10);
  let overlay = $state(false);

  let capacity = 240;
  let historyValues: Record<GraphKey, Float64Array> = {
    kineticEnergy: new Float64Array(capacity),
    potentialEnergy: new Float64Array(capacity),
    springPotential: new Float64Array(capacity),
    totalEnergy: new Float64Array(capacity),
    constraintRms: new Float64Array(capacity)
  };
  let historyTimes = new Float64Array(capacity);

  let historyCount = 0;
  let historyCursor = 0;

  let normalization = $state<Normalization>('absolute');
  let canvasRefs: Array<HTMLCanvasElement | null> = [];
  let expanded = $state<Record<GraphKey, boolean>>({
    kineticEnergy: false,
    potentialEnergy: false,
    springPotential: false,
    totalEnergy: false,
    constraintRms: false
  });
  let panelCollapsed = $state(true);
  let overlayCanvas: HTMLCanvasElement | null = null;
  let mounted = false;
  let drawPending = false;

  type HoverInfo = {
    key: GraphKey | 'overlay';
    x: number;
    y: number;
    time: number;
    value?: number;
    values?: Record<GraphKey, number>;
  };
  let hover = $state<HoverInfo | null>(null);

  const fmt = (value: number | undefined, digits = 3) => {
    if (value === undefined || Number.isNaN(value)) return '—';
    return value.toFixed(digits);
  };

  const getFirstIndex = () => {
    if (historyCount === 0) return 0;
    return (historyCursor - historyCount + capacity) % capacity;
  };

  const normalizeValue = (def: MetricDef, raw: number, baseline: number) => {
    let value = raw;
    if (def.normalize) {
      if (normalization === 'delta') {
        value -= baseline;
      }
      if (normalization === 'per-particle') {
        value /= Math.max(1, sampleCount);
      }
    }
    return value;
  };

  const resizeHistory = (nextCapacity: number) => {
    if (nextCapacity === capacity) return;
    const keep = Math.min(historyCount, nextCapacity);
    const startIdx = (historyCursor - keep + capacity) % capacity;
    const nextValues: Record<GraphKey, Float64Array> = {
      kineticEnergy: new Float64Array(nextCapacity),
      potentialEnergy: new Float64Array(nextCapacity),
      springPotential: new Float64Array(nextCapacity),
      totalEnergy: new Float64Array(nextCapacity),
      constraintRms: new Float64Array(nextCapacity)
    };
    const nextTimes = new Float64Array(nextCapacity);
    for (let i = 0; i < keep; i++) {
      const idx = (startIdx + i) % capacity;
      nextValues.kineticEnergy[i] = historyValues.kineticEnergy[idx];
      nextValues.potentialEnergy[i] = historyValues.potentialEnergy[idx];
      nextValues.springPotential[i] = historyValues.springPotential[idx];
      nextValues.totalEnergy[i] = historyValues.totalEnergy[idx];
      nextValues.constraintRms[i] = historyValues.constraintRms[idx];
      nextTimes[i] = historyTimes[idx];
    }
    historyValues = nextValues;
    historyTimes = nextTimes;
    capacity = nextCapacity;
    historyCount = keep;
    historyCursor = keep % capacity;
  };

  const getWindowSpan = () => {
    if (historyCount === 0) return null;
    const lastIdx = (historyCursor - 1 + capacity) % capacity;
    const endTime = historyTimes[lastIdx];
    const minTime = endTime - timeWindowSec;
    const firstIdx = getFirstIndex();
    let startIdx = firstIdx;
    let count = historyCount;
    for (let i = 0; i < historyCount; i++) {
      const idx = (firstIdx + i) % capacity;
      if (historyTimes[idx] >= minTime) {
        startIdx = idx;
        count = historyCount - i;
        break;
      }
    }
    const startTime = historyTimes[startIdx];
    return { startIdx, count, startTime, endTime };
  };

  const getGraphStats = (def: GraphMetricDef) => {
    const window = getWindowSpan();
    if (!window || window.count === 0) return null;
    const key = def.key;
    const values = historyValues[key];
    const baseline = def.normalize ? values[window.startIdx] : 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < window.count; i++) {
      const idx = (window.startIdx + i) % capacity;
      const v = normalizeValue(def, values[idx], baseline);
      if (!Number.isFinite(v)) continue;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    const lastIdx = (window.startIdx + window.count - 1) % capacity;
    const last = normalizeValue(def, values[lastIdx], baseline);
    return { min, max, last };
  };

  const toggleGraph = (key: GraphKey) => {
    expanded = { ...expanded, [key]: !expanded[key] };
    if (mounted) {
      requestAnimationFrame(resizeCanvases);
    }
  };

  const togglePanel = () => {
    panelCollapsed = !panelCollapsed;
    if (panelCollapsed) {
      hover = null;
    } else if (mounted) {
      requestAnimationFrame(resizeCanvases);
    }
  };

  const toggleOverlay = () => {
    overlay = !overlay;
    hover = null;
    if (mounted) {
      requestAnimationFrame(resizeCanvases);
    }
  };

  const currentValue = (def: GraphMetricDef) => {
    const raw = diagnostics?.[def.key];
    if (raw === undefined || raw === null || Number.isNaN(raw)) return undefined;
    const window = getWindowSpan();
    const baseline = def.normalize && window ? historyValues[def.key][window.startIdx] : 0;
    return normalizeValue(def, raw, baseline);
  };

  const pushSample = (sample: Diagnostics) => {
    const idx = historyCursor;
    historyTimes[idx] = performance.now() * 0.001;
    historyValues.kineticEnergy[idx] = sample.kineticEnergy;
    historyValues.potentialEnergy[idx] = sample.potentialEnergy;
    historyValues.springPotential[idx] = sample.springPotential;
    historyValues.totalEnergy[idx] = sample.totalEnergy;
    historyValues.constraintRms[idx] = sample.constraintRms;
    historyCursor = (historyCursor + 1) % capacity;
    historyCount = Math.min(historyCount + 1, capacity);
  };

  const requestDraw = () => {
    if (!mounted) return;
    if (drawPending) return;
    drawPending = true;
    requestAnimationFrame(() => {
      drawPending = false;
      drawGraphs();
    });
  };

  const drawGraphs = () => {
    if (!mounted) return;
    if (panelCollapsed) return;
    const window = getWindowSpan();
    if (!window || window.count < 2) return;
    if (overlay) {
      drawOverlay(window);
      return;
    }
    graphDefs.forEach((def, index) => {
      const canvas = canvasRefs[index];
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);
      drawSeries(ctx, def, window);
    });
  };

  const resizeCanvases = () => {
    const dpr = window.devicePixelRatio || 1;
    canvasRefs.forEach((canvas) => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    });
    if (overlayCanvas) {
      const rect = overlayCanvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (overlayCanvas.width !== width || overlayCanvas.height !== height) {
        overlayCanvas.width = width;
        overlayCanvas.height = height;
      }
    }
    requestDraw();
  };

  const bindCanvas = (node: HTMLCanvasElement, params: { index: number }) => {
    canvasRefs[params.index] = node;
    if (mounted) {
      resizeCanvases();
    }
    return {
      destroy() {
        if (canvasRefs[params.index] === node) {
          canvasRefs[params.index] = null;
        }
      }
    };
  };

  const bindOverlay = (node: HTMLCanvasElement) => {
    overlayCanvas = node;
    if (mounted) {
      resizeCanvases();
    }
    return {
      destroy() {
        if (overlayCanvas === node) {
          overlayCanvas = null;
        }
      }
    };
  };

  const clearHover = () => {
    hover = null;
  };

  const setHover = (event: MouseEvent, def?: GraphMetricDef) => {
    const canvas = event.currentTarget as HTMLCanvasElement | null;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const window = getWindowSpan();
    if (!window || window.count < 2) {
      hover = null;
      return;
    }
    const t = Math.min(1, Math.max(0, x / Math.max(1, rect.width)));
    const sampleIdx = Math.round(t * (window.count - 1));
    const dataIdx = (window.startIdx + sampleIdx) % capacity;
    const rowRect = (canvas.parentElement as HTMLElement | null)?.getBoundingClientRect();
    const relX = rowRect ? event.clientX - rowRect.left : x;
    const relY = rowRect ? event.clientY - rowRect.top : y;
    if (!def) {
      const values: Record<GraphKey, number> = {
        kineticEnergy: 0,
        potentialEnergy: 0,
        springPotential: 0,
        totalEnergy: 0,
        constraintRms: 0
      };
      for (const series of graphDefs) {
        const raw = historyValues[series.key][dataIdx];
        const baseline = series.normalize ? historyValues[series.key][window.startIdx] : 0;
        values[series.key] = normalizeValue(series, raw, baseline);
      }
      hover = {
        key: 'overlay',
        x: relX,
        y: relY,
        time: historyTimes[dataIdx],
        values
      };
      return;
    }
    const raw = historyValues[def.key][dataIdx];
    const baseline = def.normalize ? historyValues[def.key][window.startIdx] : 0;
    hover = {
      key: def.key,
      x: relX,
      y: relY,
      time: historyTimes[dataIdx],
      value: normalizeValue(def, raw, baseline)
    };
  };

  const drawGrid = (ctx: CanvasRenderingContext2D, width: number, height: number, min: number, max: number) => {
    const pad = 4;
    const w = width - pad * 2;
    const h = height - pad * 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i <= 3; i++) {
      const x = pad + (w * i) / 4;
      ctx.moveTo(x, pad);
      ctx.lineTo(x, pad + h);
    }
    for (let i = 1; i <= 3; i++) {
      const y = pad + (h * i) / 4;
      ctx.moveTo(pad, y);
      ctx.lineTo(pad + w, y);
    }
    ctx.stroke();
    if (min < 0 && max > 0) {
      const t = (0 - min) / (max - min);
      const y = pad + h * (1 - t);
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.35)';
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(pad + w, y);
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawAxisLabels = (ctx: CanvasRenderingContext2D, width: number, height: number, min: number, max: number) => {
    ctx.save();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(max.toFixed(2), 6, 6);
    ctx.textBaseline = 'bottom';
    ctx.fillText(min.toFixed(2), 6, height - 4);
    if (min < 0 && max > 0) {
      const t = (0 - min) / (max - min);
      const y = 4 + (height - 8) * (1 - t);
      ctx.textBaseline = 'middle';
      ctx.fillText('0', 6, y);
    }
    ctx.restore();
  };

  const drawSeries = (ctx: CanvasRenderingContext2D, def: GraphMetricDef, window: { startIdx: number; count: number }) => {
    const values = historyValues[def.key];
    let min = Infinity;
    let max = -Infinity;
    const baseline = def.normalize ? values[window.startIdx] : 0;
    for (let i = 0; i < window.count; i++) {
      const idx = (window.startIdx + i) % capacity;
      const v = normalizeValue(def, values[idx], baseline);
      if (!Number.isFinite(v)) continue;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    if (Math.abs(max - min) < 1e-6) {
      max += 1;
      min -= 1;
    }
    const pad = 4;
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const w = width - pad * 2;
    const h = height - pad * 2;
    drawGrid(ctx, width, height, min, max);
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < window.count; i++) {
      const idx = (window.startIdx + i) % capacity;
      const v = normalizeValue(def, values[idx], baseline);
      const x = pad + (w * i) / Math.max(1, window.count - 1);
      const t = (v - min) / (max - min);
      const y = pad + h * (1 - t);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    drawAxisLabels(ctx, width, height, min, max);
  };

  const drawOverlay = (window: { startIdx: number; count: number }) => {
    const canvas = overlayCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    let min = Infinity;
    let max = -Infinity;
    for (const def of graphDefs) {
      const values = historyValues[def.key];
      const baseline = def.normalize ? values[window.startIdx] : 0;
      for (let i = 0; i < window.count; i++) {
        const idx = (window.startIdx + i) % capacity;
        const v = normalizeValue(def, values[idx], baseline);
        if (!Number.isFinite(v)) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    if (Math.abs(max - min) < 1e-6) {
      max += 1;
      min -= 1;
    }
    const pad = 4;
    const w = width - pad * 2;
    const h = height - pad * 2;
    drawGrid(ctx, width, height, min, max);
    for (const def of graphDefs) {
      const values = historyValues[def.key];
      const baseline = def.normalize ? values[window.startIdx] : 0;
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < window.count; i++) {
        const idx = (window.startIdx + i) % capacity;
        const v = normalizeValue(def, values[idx], baseline);
        const x = pad + (w * i) / Math.max(1, window.count - 1);
        const t = (v - min) / (max - min);
        const y = pad + h * (1 - t);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    drawAxisLabels(ctx, width, height, min, max);
  };

  const resetHistory = () => {
    historyCount = 0;
    historyCursor = 0;
  };

  onMount(() => {
    mounted = true;
    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);
    return () => {
      mounted = false;
      window.removeEventListener('resize', resizeCanvases);
    };
  });

  $effect(() => {
    if (!mounted || !diagnostics) return;
    pushSample(diagnostics);
    requestDraw();
  });

  $effect(() => {
    if (!mounted) return;
    normalization;
    sampleCount;
    overlay;
    timeWindowSec;
    requestDraw();
  });

  $effect(() => {
    const nextCapacity = Math.max(60, Math.ceil(timeWindowSec * sampleRate));
    resizeHistory(nextCapacity);
    if (mounted) {
      requestDraw();
    }
  });

  $effect(() => {
    resetKey;
    resetHistory();
    hover = null;
    requestDraw();
  });
</script>

<div class="diagnostics">
  <div class="header" role="button" tabindex="0" onclick={togglePanel} onkeydown={(event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      togglePanel();
    }
  }}>
    <h3>Diagnostics</h3>
    {#if !panelCollapsed}
      <div class="header-controls">
        <div class="control-group">
          <label for="diag-norm">Scale</label>
          <select id="diag-norm" bind:value={normalization} onclick={(event) => event.stopPropagation()}>
            <option value="absolute">Absolute</option>
            <option value="delta">Δ start</option>
            <option value="per-particle">Per particle</option>
          </select>
        </div>
        <div class="control-group">
          <label for="diag-window">Window</label>
          <select
            id="diag-window"
            value={timeWindowSec}
            onclick={(event) => event.stopPropagation()}
            onchange={(event) => {
              const next = Number((event.currentTarget as HTMLSelectElement).value);
              if (Number.isFinite(next)) {
                timeWindowSec = next;
              }
            }}
          >
            {#each timeWindowOptions as seconds}
              <option value={seconds}>{seconds}s</option>
            {/each}
          </select>
        </div>
        <button
          type="button"
          class="overlay-toggle"
          class:active={overlay}
          onclick={(event) => {
            event.stopPropagation();
            toggleOverlay();
          }}
        >
          Overlay {overlay ? 'On' : 'Off'}
        </button>
      </div>
    {/if}
    <span class="collapse-indicator">{panelCollapsed ? '▼' : '▲'}</span>
  </div>

  {#if !panelCollapsed}
    <div class="graphs">
      {#if overlay}
        <div class="graph-row overlay">
          <div class="graph-label">
            <span>Overlay</span>
            <div class="overlay-legend">
              {#each graphDefs as def}
                <span class="legend-item">
                  <span class="dot" style={`background:${def.color}`}></span>
                  {def.label}
                </span>
              {/each}
            </div>
          </div>
          <canvas
            class="spark overlay"
            use:bindOverlay
            onmousemove={(event) => setHover(event)}
            onmouseleave={clearHover}
          ></canvas>
          {#if hover?.key === 'overlay'}
            {@const windowSpan = getWindowSpan()}
            <div class="tooltip" style={`left:${hover.x}px; top:${hover.y}px;`}>
              <div class="tooltip-time">
                t={windowSpan ? (hover.time - windowSpan.startTime).toFixed(2) : '—'}s
              </div>
              {#each graphDefs as def}
                <div class="tooltip-row">
                  <span class="dot" style={`background:${def.color}`}></span>
                  <span>{def.label}:</span>
                  <span class="value">{fmt(hover.values?.[def.key], def.digits ?? 3)}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        {#each graphDefs as def, index}
          <div
            class="graph-row"
            class:expanded={expanded[def.key]}
            role="button"
            tabindex="0"
            onclick={() => toggleGraph(def.key)}
            onkeydown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleGraph(def.key);
              }
            }}
          >
            <div class="graph-label">
              <span>{def.label}</span>
              <div class="graph-actions">
                <span class="value">
                  {diagnostics ? fmt(currentValue(def), def.digits ?? 3) : '—'}
                </span>
              </div>
            </div>
            {#if expanded[def.key]}
              {@const stats = getGraphStats(def)}
              <div class="graph-stats">
                <span>Min: {stats ? fmt(stats.min, def.digits ?? 3) : '—'}</span>
                <span>Max: {stats ? fmt(stats.max, def.digits ?? 3) : '—'}</span>
                <span>Last: {stats ? fmt(stats.last, def.digits ?? 3) : '—'}</span>
              </div>
            {/if}
            <canvas
              class="spark"
              use:bindCanvas={{ index }}
              onmousemove={(event) => setHover(event, def)}
              onmouseleave={clearHover}
            ></canvas>
            {#if hover?.key === def.key}
              {@const windowSpan = getWindowSpan()}
              <div class="tooltip" style={`left:${hover.x}px; top:${hover.y}px;`}>
                <div class="tooltip-time">
                  t={windowSpan ? (hover.time - windowSpan.startTime).toFixed(2) : '—'}s
                </div>
                <div class="tooltip-row">
                  <span class="dot" style={`background:${def.color}`}></span>
                  <span>{def.label}:</span>
                  <span class="value">{fmt(hover.value, def.digits ?? 3)}</span>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

    {#if metricDefs.some((m) => !m.graph)}
      <div class="rows">
        {#each metricDefs.filter((m) => !m.graph) as def}
          <div class="row">
            <span>{def.label}</span>
            <span>{diagnostics ? fmt(currentValue(def), def.digits ?? 3) : '—'}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .diagnostics {
    display: grid;
    gap: 0.75rem;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    cursor: pointer;
  }
  .header-controls {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: nowrap;
    color: #94a3b8;
    font-size: 0.75rem;
  }
  .control-group {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .header:focus-visible {
    outline: 2px solid rgba(125, 211, 252, 0.6);
    outline-offset: 2px;
  }
  .diagnostics h3 {
    margin: 0;
    font-size: 0.95rem;
    color: #e2e8f0;
  }
  .control-group select {
    padding: 0.2rem 0.4rem;
    border-radius: 6px;
    border: 1px solid #334155;
    background: #0f172a;
    color: #e2e8f0;
  }
  .overlay-toggle {
    border: 1px solid rgba(148, 163, 184, 0.4);
    background: rgba(15, 23, 42, 0.8);
    color: #e2e8f0;
    border-radius: 999px;
    padding: 0.15rem 0.55rem;
    font-size: 0.7rem;
    cursor: pointer;
  }
  .overlay-toggle:hover {
    background: rgba(30, 41, 59, 0.9);
  }
  .overlay-toggle.active {
    border-color: rgba(56, 189, 248, 0.7);
    color: #38bdf8;
  }
  .collapse-indicator {
    font-size: 0.75rem;
    color: #94a3b8;
  }
  .graphs {
    display: grid;
    gap: 0.65rem;
  }
  .graph-row {
    display: grid;
    gap: 0.35rem;
    cursor: pointer;
    padding: 0.15rem 0;
    border-radius: 8px;
    position: relative;
  }
  .graph-row.overlay {
    cursor: crosshair;
  }
  .graph-row:focus-visible {
    outline: 2px solid rgba(125, 211, 252, 0.6);
    outline-offset: 2px;
  }
  .graph-label {
    display: flex;
    justify-content: space-between;
    font-size: 0.82rem;
    color: #94a3b8;
    gap: 0.5rem;
  }
  .graph-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .graph-label .value {
    color: #e2e8f0;
    font-variant-numeric: tabular-nums;
  }
  .graph-stats {
    display: flex;
    gap: 0.75rem;
    font-size: 0.75rem;
    color: #94a3b8;
  }
  .spark {
    width: 100%;
    height: 56px;
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
  }
  .spark.overlay {
    height: 140px;
  }
  .graph-row.expanded .spark {
    height: 140px;
  }
  .overlay-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
  }
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.7rem;
    color: #94a3b8;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }
  .tooltip {
    position: absolute;
    transform: translate(8px, -8px);
    background: rgba(15, 23, 42, 0.95);
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 8px;
    padding: 0.4rem 0.5rem;
    font-size: 0.7rem;
    color: #e2e8f0;
    pointer-events: none;
    min-width: 120px;
    z-index: 2;
  }
  .tooltip-time {
    color: #94a3b8;
    margin-bottom: 0.25rem;
  }
  .tooltip-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.35rem;
    align-items: center;
    white-space: nowrap;
  }
  .tooltip-row .value {
    font-variant-numeric: tabular-nums;
  }
  .rows {
    display: grid;
    gap: 0.35rem;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.85rem;
    color: #94a3b8;
  }
  .row span:last-child {
    color: #e2e8f0;
    font-variant-numeric: tabular-nums;
  }
</style>
