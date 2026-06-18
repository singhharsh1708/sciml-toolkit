import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Sentinel emitted by the Julia suffix when a plot was saved
export const PLOT_SENTINEL = '__sciml_plot__:';

// ─── Julia code appended after each block run ────────────────────────────────
// Tries Plots.jl first, then Makie (CairoMakie). Writes PNG to a temp file.

export function buildPlotSuffix(outPath: string): string {
  return `
let
  __path = raw"${outPath}"
  __saved = false

  # Try Plots.jl
  if !__saved
    try
      if isdefined(Main, :Plots) && Plots.current() !== nothing
        Plots.savefig(__path)
        __saved = true
      end
    catch _
    end
  end

  # Try CairoMakie / GLMakie current figure
  if !__saved
    try
      if isdefined(Main, :CairoMakie)
        CairoMakie.save(__path, CairoMakie.current_figure())
        __saved = true
      elseif isdefined(Main, :Makie)
        Makie.save(__path, Makie.current_figure())
        __saved = true
      end
    catch _
    end
  end

  if __saved
    println("${PLOT_SENTINEL}", __path)
  end
end
`;
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export class PlotViewer {
  private static current: PlotViewer | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.context = context;
    panel.onDidDispose(() => { PlotViewer.current = undefined; });
  }

  static show(context: vscode.ExtensionContext, imagePath: string) {
    if (!fs.existsSync(imagePath)) return;

    const panel = PlotViewer.current?.panel ?? vscode.window.createWebviewPanel(
      'scimlPlot',
      'SciML Plot',
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
      {
        enableScripts: false,
        localResourceRoots: [
          vscode.Uri.file(path.dirname(imagePath)),
          context.extensionUri,
        ],
        retainContextWhenHidden: true,
      }
    );

    if (!PlotViewer.current) {
      PlotViewer.current = new PlotViewer(panel, context);
    } else {
      PlotViewer.current.panel.reveal(vscode.ViewColumn.Two, true);
    }

    PlotViewer.current.update(imagePath);
  }

  private update(imagePath: string) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const imgUri = this.panel.webview.asWebviewUri(vscode.Uri.file(imagePath));
    this.panel.webview.html = buildHtml(imgUri.toString(), nonce, this.panel.webview.cspSource);
    this.panel.title = `SciML Plot · ${path.basename(imagePath)}`;
  }
}

// ─── Temp path helper ─────────────────────────────────────────────────────────

export function tempPlotPath(): string {
  return path.join(os.tmpdir(), `sciml_plot_${Date.now()}.png`);
}

// Parse the sentinel from Julia stdout
export function parsePlotPath(raw: string): string | undefined {
  const m = raw.match(/__sciml_plot__:(.+)/);
  return m ? m[1].trim() : undefined;
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function buildHtml(imgUri: string, nonce: string, cspSource: string): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${cspSource} 'unsafe-inline';
             img-src ${cspSource} vscode-resource:;">
  <title>SciML Plot</title>
  <style>
    html, body { margin: 0; padding: 0; background: var(--vscode-editor-background);
                 display: flex; flex-direction: column; height: 100vh; }
    .toolbar { padding: 6px 12px; background: var(--vscode-editor-inactiveSelectionBackground);
               font-family: var(--vscode-font-family); font-size: 0.8em;
               color: var(--vscode-descriptionForeground); display: flex;
               align-items: center; gap: 12px; flex-shrink: 0; }
    .hint { font-style: italic; }
    .img-wrap { flex: 1; overflow: auto; display: flex;
                align-items: center; justify-content: center; padding: 16px; }
    img { max-width: 100%; max-height: 100%; object-fit: contain;
          border-radius: 4px; box-shadow: 0 2px 12px rgba(0,0,0,0.4); }
  </style>
</head>
<body>
  <div class="toolbar">
    <span>📈 SciML Plot</span>
    <span class="hint">Re-run the block to refresh</span>
  </div>
  <div class="img-wrap">
    <img src="${imgUri}" alt="Julia plot output">
  </div>
</body>
</html>`;
}
