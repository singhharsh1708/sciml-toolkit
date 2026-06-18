import * as vscode from 'vscode';
import * as crypto from 'crypto';

export class EquationPreview {
  private static current: EquationPreview | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.context = context;
    panel.onDidDispose(() => { EquationPreview.current = undefined; });
  }

  static show(editor: vscode.TextEditor, context: vscode.ExtensionContext) {
    const equations = extractEquations(editor.document);

    if (EquationPreview.current) {
      EquationPreview.current.panel.reveal(vscode.ViewColumn.Two);
      EquationPreview.current.update(equations);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'scimlEquations',
      'SciML Equations',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        localResourceRoots: [context.extensionUri],
        retainContextWhenHidden: true,
      }
    );

    EquationPreview.current = new EquationPreview(panel, context);
    EquationPreview.current.update(equations);

    const changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === editor.document && EquationPreview.current) {
        EquationPreview.current.update(extractEquations(e.document));
      }
    });
    panel.onDidDispose(() => changeListener.dispose());
  }

  private update(equations: Equation[]) {
    const nonce = crypto.randomBytes(16).toString('hex');
    this.panel.webview.html = buildHtml(equations, nonce, this.panel.webview.cspSource);
  }
}

export interface Equation {
  line: number;
  latex: string;
  display: boolean;   // true = block, false = inline
  source: string;     // raw source text for reference
  context: string;    // surrounding function/struct name
}

// ─── Extraction ─────────────────────────────────────────────────────────────

export function extractEquations(doc: vscode.TextDocument): Equation[] {
  const equations: Equation[] = [];
  const text = doc.getText();
  const lines = text.split('\n');

  // 1. ```math ... ``` fenced blocks  (Documenter.jl / SciML standard)
  const mathFenceRe = /```math\n([\s\S]+?)\n```/gm;
  for (const m of text.matchAll(mathFenceRe)) {
    const lineNum = text.slice(0, m.index).split('\n').length;
    equations.push({
      line: lineNum,
      latex: m[1].trim(),
      display: true,
      source: m[0].slice(0, 60),
      context: getContextForOffset(lines, lineNum - 1),
    });
  }

  // 2. Display math  $$...$$  (single or multi-line comments)
  const displayDollarRe = /\$\$([\s\S]+?)\$\$/gm;
  for (const m of text.matchAll(displayDollarRe)) {
    const lineNum = text.slice(0, m.index).split('\n').length;
    if (!alreadyCovered(equations, lineNum)) {
      equations.push({
        line: lineNum,
        latex: m[1].trim(),
        display: true,
        source: m[0].slice(0, 60),
        context: getContextForOffset(lines, lineNum - 1),
      });
    }
  }

  // 3. Inline math  $...$  inside comment lines (avoid interpolation in code)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isCommentOrDocstring(line)) continue;

    const inlineRe = /(?<!\$)\$([^$\n]{1,120}?)\$(?!\$)/g;
    for (const m of line.matchAll(inlineRe)) {
      if (!alreadyCovered(equations, i + 1)) {
        equations.push({
          line: i + 1,
          latex: m[1],
          display: false,
          source: line.trim().slice(0, 80),
          context: getContextForOffset(lines, i),
        });
      }
    }

    // 4. Julia ``...`` inline math in docstrings — only when content looks mathematical
    const backtickRe = /``([^`\n]{1,120}?)``/g;
    for (const m of line.matchAll(backtickRe)) {
      if (looksLikeMath(m[1]) && !alreadyCovered(equations, i + 1)) {
        equations.push({
          line: i + 1,
          latex: juliaToLatex(m[1]),
          display: false,
          source: line.trim().slice(0, 80),
          context: getContextForOffset(lines, i),
        });
      }
    }
  }

  return equations.sort((a, b) => a.line - b.line);
}

function isCommentOrDocstring(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('#') || t.startsWith('"""') || t.startsWith("'''");
}

function looksLikeMath(s: string): boolean {
  return /[+\-*/^=<>\\]|\\[a-zA-Z]|_[a-zA-Z0-9]|\^[a-zA-Z0-9]/.test(s);
}

function alreadyCovered(eqs: Equation[], line: number): boolean {
  return eqs.some((e) => Math.abs(e.line - line) <= 1);
}

function getContextForOffset(lines: string[], idx: number): string {
  for (let j = idx - 1; j >= Math.max(0, idx - 8); j--) {
    const t = lines[j].trim();
    if (/^(function|struct|mutable struct|macro|abstract type|primitive type)\s/.test(t)) {
      return t.replace(/^(function|struct|mutable struct|macro)\s+/, '').split('(')[0].slice(0, 50);
    }
  }
  return '';
}

// ─── Julia → LaTeX normalisation ────────────────────────────────────────────
// Covers the SciML-common operators identified in research

function juliaToLatex(s: string): string {
  return s
    // Operators
    .replace(/\bsqrt\((.+?)\)/g, '\\sqrt{$1}')
    .replace(/\babs\((.+?)\)/g, '\\left|$1\\right|')
    // Superscripts and subscripts (single char)
    .replace(/\^(\w)/g, '^{$1}')
    .replace(/(\w)_(\w)/g, '$1_{$2}')
    // Derivatives notation: du/dt → \frac{du}{dt}
    .replace(/\bd([a-zA-Z]+)\/d([a-zA-Z]+)\b/g, '\\frac{d$1}{d$2}')
    // Greek letters (SciML-common)
    .replace(/\balpha\b/g, '\\alpha').replace(/\bbeta\b/g, '\\beta')
    .replace(/\bgamma\b/g, '\\gamma').replace(/\bdelta\b/g, '\\delta')
    .replace(/\bepsilon\b/g, '\\epsilon').replace(/\btheta\b/g, '\\theta')
    .replace(/\blambda\b/g, '\\lambda').replace(/\bmu\b/g, '\\mu')
    .replace(/\bnu\b/g, '\\nu').replace(/\bxi\b/g, '\\xi')
    .replace(/\bpi\b/g, '\\pi').replace(/\brho\b/g, '\\rho')
    .replace(/\bsigma\b/g, '\\sigma').replace(/\btau\b/g, '\\tau')
    .replace(/\bphi\b/g, '\\phi').replace(/\bpsi\b/g, '\\psi')
    .replace(/\bomega\b/g, '\\omega').replace(/\bOmega\b/g, '\\Omega')
    .replace(/\bLambda\b/g, '\\Lambda').replace(/\bGamma\b/g, '\\Gamma')
    // SciML operators
    .replace(/\bodot\b/g, '\\odot')
    .replace(/\bnabla\b/g, '\\nabla')
    .replace(/\bpartial\b/g, '\\partial')
    .replace(/\binfty\b/g, '\\infty')
    .replace(/\bleq\b/g, '\\leq').replace(/\bgeq\b/g, '\\geq')
    .replace(/\bcdot\b/g, '\\cdot').replace(/\btimes\b/g, '\\times')
    // dot notation for ODE: ẋ written as x'  →  \dot{x}
    .replace(/([a-zA-Z])'(?=[^'])/g, '\\dot{$1}')
    // Multiplication: * → \cdot (only between terms, not inside words)
    .replace(/(\w)\s*\*\s*(\w)/g, '$1 \\cdot $2');
}

// ─── HTML / WebView ──────────────────────────────────────────────────────────

function buildHtml(equations: Equation[], nonce: string, cspSource: string): string {
  const count = equations.length;
  const items = count
    ? equations.map((eq) => {
        const badge = eq.display ? 'block' : 'inline';
        return /* html */`
      <div class="eq-card">
        <div class="eq-meta">
          <span class="line-badge">L${eq.line}</span>
          <span class="mode-badge ${badge}">${badge}</span>
          ${eq.context ? `<span class="ctx">${escapeHtml(eq.context)}</span>` : ''}
        </div>
        <div class="eq-render" data-latex="${escapeAttr(eq.latex)}" data-display="${eq.display}"></div>
        <div class="eq-source">${escapeHtml(eq.source)}</div>
      </div>`;
      }).join('\n')
    : `<div class="empty">
        <p>No equations found in this file.</p>
        <p>SciML supports three formats:</p>
        <pre>\`\`\`math\n\\\\frac{du}{dt} = f(u,p,t)\n\`\`\`</pre>
        <pre># $$E = mc^2$$</pre>
        <pre># Solves \\$\\\\nabla^2 u = 0\\$</pre>
       </div>`;

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             script-src 'nonce-${nonce}' https://cdn.jsdelivr.net;
             style-src ${cspSource} 'unsafe-inline' https://cdn.jsdelivr.net;
             font-src https://cdn.jsdelivr.net data:;">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <title>SciML Equations</title>
  <style>
    :root { --accent: #4f8cff; }
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
           background: var(--vscode-editor-background); padding: 16px; margin: 0; }
    h2 { color: var(--accent); margin: 0 0 4px; font-size: 1em; font-weight: 600; }
    .subtitle { font-size: 0.78em; color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
    .eq-card { background: var(--vscode-editor-inactiveSelectionBackground);
               border-radius: 6px; padding: 12px 14px; margin-bottom: 10px;
               border-left: 3px solid var(--accent); }
    .eq-meta { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
    .line-badge { font-size: 0.72em; background: var(--vscode-badge-background);
                  color: var(--vscode-badge-foreground); border-radius: 3px; padding: 1px 5px; }
    .mode-badge { font-size: 0.72em; border-radius: 3px; padding: 1px 5px; }
    .mode-badge.block { background: #1e4976; color: #8ec8f6; }
    .mode-badge.inline { background: #1e3b1e; color: #73c991; }
    .ctx { font-family: var(--vscode-editor-font-family); font-size: 0.78em;
           color: var(--vscode-descriptionForeground); }
    .eq-render { padding: 10px 4px; overflow-x: auto; min-height: 1.5em; }
    .eq-source { font-family: var(--vscode-editor-font-family); font-size: 0.75em;
                 color: var(--vscode-descriptionForeground); margin-top: 8px;
                 border-top: 1px solid var(--vscode-widget-border); padding-top: 6px;
                 white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .eq-error { color: var(--vscode-errorForeground); font-size: 0.82em; font-style: italic; }
    .empty { color: var(--vscode-descriptionForeground); }
    .empty pre { background: var(--vscode-editor-inactiveSelectionBackground);
                 padding: 8px; border-radius: 4px; font-size: 0.82em; margin: 6px 0; }
  </style>
</head>
<body>
  <h2>Equations</h2>
  <div class="subtitle">${count} found — updates live as you type</div>
  ${items}
  <script nonce="${nonce}">
    document.querySelectorAll('.eq-render').forEach(el => {
      const latex = el.dataset.latex;
      const display = el.dataset.display === 'true';
      try {
        katex.render(latex, el, {
          displayMode: display,
          throwOnError: false,
          trust: false,
          macros: {
            '\\R': '\\mathbb{R}',
            '\\N': '\\mathbb{N}',
            '\\C': '\\mathbb{C}',
            '\\norm': '\\left\\|#1\\right\\|',
          }
        });
      } catch (e) {
        el.innerHTML = '<span class="eq-error">⚠ ' + e.message + '</span>';
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
