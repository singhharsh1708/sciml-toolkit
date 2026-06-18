import * as vscode from 'vscode';
import * as crypto from 'crypto';

export interface Variable {
  name: string;
  type: string;
  size: string;
  preview: string;
}

export class VariableInspector {
  private static current: VariableInspector | undefined;
  private readonly panel: vscode.WebviewPanel;

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    panel.onDidDispose(() => { VariableInspector.current = undefined; });
  }

  static show(context: vscode.ExtensionContext, vars: Variable[]) {
    if (VariableInspector.current) {
      VariableInspector.current.panel.reveal(vscode.ViewColumn.Two, true);
      VariableInspector.current.update(vars);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'scimlVars',
      'SciML Variables',
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [context.extensionUri],
        retainContextWhenHidden: true,
      }
    );

    VariableInspector.current = new VariableInspector(panel);
    VariableInspector.current.update(vars);
  }

  private update(vars: Variable[]) {
    const nonce = crypto.randomBytes(16).toString('hex');
    this.panel.webview.html = buildHtml(vars, nonce, this.panel.webview.cspSource);
  }
}

// ─── Julia code injected after each block run ────────────────────────────────
// Emits all non-core Main bindings in a delimited format.

export const VAR_INSPECT_SUFFIX = `
let
  __skip = Set([:Base, :Core, :Main, :InteractiveUtils, :ans])
  println("__sciml_vars_start__")
  for __name in names(Main, all=false, imported=false)
    __name in __skip && continue
    try
      __val  = getfield(Main, __name)
      __type = string(typeof(__val))
      __sz   = try; string(size(__val)); catch _; "scalar"; end
      __prev = try; repr(__val)[1:min(80, length(repr(__val)))]; catch _; "?"; end
      println(__name, "|||", __type, "|||", __sz, "|||", __prev)
    catch _
    end
  end
  println("__sciml_vars_end__")
end
`;

export function parseVariables(raw: string): Variable[] {
  const block = raw.match(/__sciml_vars_start__\n([\s\S]*?)__sciml_vars_end__/);
  if (!block) return [];
  return block[1]
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, type, size, ...rest] = line.split('|||');
      return { name: name ?? '?', type: type ?? '?', size: size ?? '?', preview: rest.join('|||') };
    });
}

// ─── WebView ──────────────────────────────────────────────────────────────────

function buildHtml(vars: Variable[], nonce: string, cspSource: string): string {
  const rows = vars.length
    ? vars.map((v) => /* html */`
      <tr>
        <td class="name">${escHtml(v.name)}</td>
        <td class="type">${escHtml(v.type)}</td>
        <td class="size">${escHtml(v.size)}</td>
        <td class="preview">${escHtml(v.preview)}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" class="empty">No variables — run a block first.</td></tr>`;

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'unsafe-inline';">
  <title>SciML Variables</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
           background: var(--vscode-editor-background); padding: 12px; margin: 0; font-size: 13px; }
    h2 { color: #4f8cff; font-size: 1em; font-weight: 600; margin: 0 0 10px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 0.75em; text-transform: uppercase;
         letter-spacing: 0.05em; color: var(--vscode-descriptionForeground);
         padding: 4px 8px; border-bottom: 1px solid var(--vscode-widget-border); }
    td { padding: 5px 8px; border-bottom: 1px solid var(--vscode-widget-border);
         vertical-align: top; }
    tr:hover td { background: var(--vscode-list-hoverBackground); }
    .name { font-family: var(--vscode-editor-font-family); font-weight: 600; color: #4f8cff; white-space: nowrap; }
    .type { font-family: var(--vscode-editor-font-family); color: #73c991; white-space: nowrap; font-size: 0.85em; }
    .size { color: var(--vscode-descriptionForeground); white-space: nowrap; font-size: 0.85em; }
    .preview { font-family: var(--vscode-editor-font-family); font-size: 0.82em;
               color: var(--vscode-descriptionForeground); max-width: 260px;
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .empty { color: var(--vscode-descriptionForeground); font-style: italic; text-align: center; padding: 20px; }
  </style>
</head>
<body>
  <h2>Variables (${vars.length})</h2>
  <table>
    <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Value</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
