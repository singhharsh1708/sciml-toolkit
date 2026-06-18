import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { BenchmarkResult } from './juliaRunner';

export class BenchmarkPanel {
  private static current: BenchmarkPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    panel.onDidDispose(() => { BenchmarkPanel.current = undefined; });
  }

  static show(context: vscode.ExtensionContext, result: BenchmarkResult, label: string) {
    if (BenchmarkPanel.current) {
      BenchmarkPanel.current.panel.reveal(vscode.ViewColumn.Two);
      BenchmarkPanel.current.render(result, label);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'scimlBenchmark',
      'SciML Benchmark',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        localResourceRoots: [context.extensionUri],
        retainContextWhenHidden: true,
      }
    );

    BenchmarkPanel.current = new BenchmarkPanel(panel);
    BenchmarkPanel.current.render(result, label);
  }

  private render(result: BenchmarkResult, label: string) {
    const nonce = crypto.randomBytes(16).toString('hex');
    this.panel.webview.html = buildHtml(result, label, nonce, this.panel.webview.cspSource);
  }
}

// ─── Julia script that produces structured output ───────────────────────────
// Called by juliaRunner.runBenchmark() — outputs key=value lines BenchmarkTools
// Trial text format, easily parseable without JSON.jl dependency.

export function buildBenchmarkScript(code: string): string {
  // We emit a structured block the parser can reliably extract.
  // All time values from BenchmarkTools are in nanoseconds (Float64).
  return `
import Pkg
try
  using BenchmarkTools
catch
  Pkg.add("BenchmarkTools")
  using BenchmarkTools
end

let
  local b = @benchmark begin
    ${code}
  end samples=200 evals=1

  println("__sciml_bench_start__")
  println("median_ns=", median(b).time)
  println("min_ns=",    minimum(b).time)
  println("max_ns=",    maximum(b).time)
  println("mean_ns=",   mean(b).time)
  println("memory=",    b.memory)
  println("allocs=",    b.allocs)
  println("samples=",   length(b.times))
  println("times=",     join(b.times, ","))
  println("__sciml_bench_end__")
end
`;
}

export function parseBenchmarkOutput(raw: string): BenchmarkResult {
  const block = raw.match(/__sciml_bench_start__\n([\s\S]+?)__sciml_bench_end__/);
  const src = block ? block[1] : raw;

  const num = (key: string): number => {
    const m = src.match(new RegExp(`${key}=([\\d.e+\\-]+)`));
    return m ? parseFloat(m[1]) : 0;
  };

  const timesRaw = src.match(/times=([\d.,e+\-]+)/)?.[1] ?? '';
  const times = timesRaw.split(',').map(Number).filter((n) => !isNaN(n) && n > 0);

  return {
    median_ns: num('median_ns'),
    min_ns: num('min_ns'),
    max_ns: num('max_ns'),
    mean_ns: num('mean_ns'),
    memory: num('memory'),
    allocs: num('allocs'),
    samples: num('samples'),
    times,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatNs(ns: number): string {
  if (ns < 1_000) return `${ns.toFixed(1)} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} μs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
  return `${(ns / 1_000_000_000).toFixed(2)} s`;
}

function formatBytes(b: number): string {
  if (b === 0) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

// ─── WebView HTML ─────────────────────────────────────────────────────────────

function buildHtml(r: BenchmarkResult, label: string, nonce: string, cspSource: string): string {
  // Histogram: 20 equal-width buckets over [min, max]
  const buckets = 20;
  const lo = Math.min(...r.times);
  const hi = Math.max(...r.times);
  const step = (hi - lo) / buckets || 1;
  const counts = Array<number>(buckets).fill(0);
  for (const t of r.times) {
    const idx = Math.min(Math.floor((t - lo) / step), buckets - 1);
    counts[idx]++;
  }
  const bucketLabels = counts.map((_, i) => formatNs(lo + i * step));

  const chartJson = JSON.stringify({ labels: bucketLabels, counts });
  const stats = [
    { value: formatNs(r.median_ns), label: 'Median' },
    { value: formatNs(r.min_ns),    label: 'Min' },
    { value: formatNs(r.max_ns),    label: 'Max' },
    { value: formatNs(r.mean_ns),   label: 'Mean' },
    { value: formatBytes(r.memory), label: 'Memory' },
    { value: r.allocs.toLocaleString(), label: 'Allocs' },
    { value: r.samples.toLocaleString(), label: 'Samples' },
  ];

  const statCards = stats.map((s) => /* html */`
    <div class="stat-card">
      <div class="stat-value">${s.value}</div>
      <div class="stat-label">${s.label}</div>
    </div>`).join('');

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             script-src 'nonce-${nonce}' https://cdn.jsdelivr.net;
             style-src ${cspSource} 'unsafe-inline';
             img-src ${cspSource} data:;">
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <title>SciML Benchmark</title>
  <style>
    :root { --accent: #4f8cff; }
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
           background: var(--vscode-editor-background); padding: 16px; margin: 0; }
    h2 { color: var(--accent); font-size: 1em; font-weight: 600; margin: 0 0 4px; }
    .label { font-family: var(--vscode-editor-font-family); font-size: 0.82em;
             color: var(--vscode-descriptionForeground); margin-bottom: 16px;
             white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 20px; }
    .stat-card { background: var(--vscode-editor-inactiveSelectionBackground);
                 border-radius: 6px; padding: 10px; text-align: center; }
    .stat-value { font-size: 1.1em; font-weight: 700; color: var(--accent); }
    .stat-label { font-size: 0.7em; color: var(--vscode-descriptionForeground); margin-top: 3px; }
    .section-title { font-size: 0.8em; color: var(--vscode-descriptionForeground);
                     margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
    canvas { max-height: 200px; }
  </style>
</head>
<body>
  <h2>Benchmark Results</h2>
  <div class="label">${escapeHtml(label)}</div>
  <div class="stats-grid">${statCards}</div>
  <div class="section-title">Time distribution (${r.samples} samples)</div>
  <canvas id="chart"></canvas>
  <script nonce="${nonce}">
    const d = ${chartJson};
    const isDark = document.body.classList.contains('vscode-dark') ||
                   document.body.dataset.vscodeThemeKind === 'vscode-dark' ||
                   window.matchMedia('(prefers-color-scheme: dark)').matches;
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    const labelColor = isDark ? '#aaa' : '#555';
    new Chart(document.getElementById('chart').getContext('2d'), {
      type: 'bar',
      data: {
        labels: d.labels,
        datasets: [{
          label: 'Samples',
          data: d.counts,
          backgroundColor: 'rgba(79,140,255,0.55)',
          borderColor: 'rgba(79,140,255,0.9)',
          borderWidth: 1,
          borderRadius: 2,
        }]
      },
      options: {
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { maxRotation: 45, font: { size: 10 }, color: labelColor },
            grid: { color: gridColor },
          },
          y: {
            beginAtZero: true,
            ticks: { color: labelColor },
            grid: { color: gridColor },
            title: { display: true, text: 'Count', color: labelColor },
          }
        }
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
