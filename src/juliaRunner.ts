import * as vscode from 'vscode';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { BenchmarkPanel, buildBenchmarkScript, parseBenchmarkOutput } from './benchmarkPanel';
import { VariableInspector, VAR_INSPECT_SUFFIX, parseVariables } from './variableInspector';
import { PlotViewer, buildPlotSuffix, tempPlotPath, parsePlotPath } from './plotViewer';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BenchmarkResult {
  median_ns: number;
  min_ns: number;
  max_ns: number;
  mean_ns: number;
  memory: number;
  allocs: number;
  samples: number;
  times: number[];
}

// ─── JuliaRunner ──────────────────────────────────────────────────────────────

export class JuliaRunner {
  // We render results as *before-text* decorations on the line AFTER the block
  // end. This avoids colliding with julia-vscode's own after-text decorations
  // on the same range (VS Code only renders one after-text per range).
  private outputDec: vscode.TextEditorDecorationType;
  private errorDec: vscode.TextEditorDecorationType;
  private runningDec: vscode.TextEditorDecorationType;

  constructor() {
    this.outputDec = vscode.window.createTextEditorDecorationType({
      before: {
        contentText: '',
        margin: '0',
      },
      after: {
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        fontStyle: 'italic',
          margin: '0 0 0 3ch',
      },
      isWholeLine: false,
    });

    this.errorDec = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor('editorError.foreground'),
        fontStyle: 'italic',
          margin: '0 0 0 3ch',
      },
      backgroundColor: new vscode.ThemeColor('inputValidation.errorBackground'),
      isWholeLine: true,
    });

    // Spinner shown while Julia is running
    this.runningDec = vscode.window.createTextEditorDecorationType({
      after: {
        contentText: '  ⏳ running…',
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        fontStyle: 'italic',
        },
      isWholeLine: true,
    });
  }

  // ─── Public commands ────────────────────────────────────────────────────────

  async runBlock(editor: vscode.TextEditor, context: vscode.ExtensionContext) {
    const { code, endLine } = this.getBlock(editor);
    if (!code.trim()) {
      void vscode.window.showInformationMessage('SciML: cursor is not inside a code block.');
      return;
    }

    this.setRunning(editor, endLine);
    try {
      const plotPath = tempPlotPath();
      // Append variable inspector + plot capture suffixes
      const fullCode = code + '\n' + VAR_INSPECT_SUFFIX + '\n' + buildPlotSuffix(plotPath);

      const config = vscode.workspace.getConfiguration('sciml');
      const useRepl: boolean = config.get('useExistingRepl') ?? true;
      let output: string;

      if (useRepl && (await this.juliaVscodeReplAvailable())) {
        output = await this.runViaRepl(fullCode);
      } else {
        output = await this.execJulia(fullCode);
      }

      // Show first meaningful output line inline
      const displayLine = output.split('\n')
        .find((l) => l.trim() && !l.startsWith('__sciml_'));
      this.showResult(editor, endLine, displayLine ?? '(no output)', false);

      // Update variable inspector panel
      const vars = parseVariables(output);
      VariableInspector.show(context, vars);

      // Show plot if one was saved
      const pPath = parsePlotPath(output);
      if (pPath) PlotViewer.show(context, pPath);

    } catch (err: unknown) {
      this.showResult(editor, endLine, errorMessage(err), true);
    }
  }

  async runBenchmark(editor: vscode.TextEditor, context: vscode.ExtensionContext) {
    const { code, endLine } = this.getBlock(editor);
    if (!code.trim()) {
      void vscode.window.showInformationMessage('SciML: cursor is not inside a code block.');
      return;
    }

    this.setRunning(editor, endLine);
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    status.text = '$(sync~spin) SciML: Benchmarking…';
    status.show();

    try {
      const script = buildBenchmarkScript(code);
      const raw = await this.execJuliaWithProgress(script, 120_000, (line) => {
        if (line.includes('__sciml_installing__')) {
          status.text = '$(sync~spin) SciML: Installing BenchmarkTools… (first run only)';
        }
      });
      const result = parseBenchmarkOutput(raw);
      const summary = `median ${formatNs(result.median_ns)}  allocs ${result.allocs}`;
      this.showResult(editor, endLine, summary, false);
      BenchmarkPanel.show(context, result, code.trim().split('\n')[0]);
    } catch (err: unknown) {
      this.showResult(editor, endLine, errorMessage(err), true);
    } finally {
      status.dispose();
    }
  }

  clearDecorations() {
    for (const ed of vscode.window.visibleTextEditors) {
      ed.setDecorations(this.outputDec, []);
      ed.setDecorations(this.errorDec, []);
      ed.setDecorations(this.runningDec, []);
    }
  }

  dispose() {
    this.outputDec.dispose();
    this.errorDec.dispose();
    this.runningDec.dispose();
  }

  // ─── Block detection ────────────────────────────────────────────────────────
  // Cells are delimited by `##` or `# %%` (Jupyter-style cell markers).

  private getBlock(editor: vscode.TextEditor): { code: string; startLine: number; endLine: number } {
    const doc = editor.document;
    const cursor = editor.selection.active.line;
    const total = doc.lineCount;

    const isSep = (i: number): boolean => {
      const t = doc.lineAt(i).text.trimStart();
      return t.startsWith('##') || t.startsWith('# %%');
    };

    let start = cursor;
    while (start > 0 && !isSep(start)) start--;
    if (isSep(start)) start++;

    let end = cursor;
    while (end < total - 1 && !isSep(end + 1)) end++;

    const lines: string[] = [];
    for (let i = start; i <= end; i++) lines.push(doc.lineAt(i).text);
    return { code: lines.join('\n'), startLine: start, endLine: end };
  }

  // ─── Decoration helpers ─────────────────────────────────────────────────────

  private setRunning(editor: vscode.TextEditor, line: number) {
    editor.setDecorations(this.outputDec, []);
    editor.setDecorations(this.errorDec, []);
    const range = new vscode.Range(line, 0, line, 0);
    editor.setDecorations(this.runningDec, [{ range }]);
  }

  private showResult(editor: vscode.TextEditor, line: number, text: string, isError: boolean) {
    editor.setDecorations(this.runningDec, []);

    // Truncate to 120 chars to avoid overflowing the editor width
    const display = text.split('\n').find((l) => l.trim()) ?? text;
    const truncated = display.length > 120 ? display.slice(0, 117) + '…' : display;

    const range = new vscode.Range(line, Number.MAX_SAFE_INTEGER, line, Number.MAX_SAFE_INTEGER);
    const opts: vscode.DecorationOptions = {
      range,
      renderOptions: { after: { contentText: `  ▶ ${truncated}` } },
    };

    const dec = isError ? this.errorDec : this.outputDec;
    editor.setDecorations(dec, [opts]);
  }

  // ─── Julia REPL integration ─────────────────────────────────────────────────

  private async juliaVscodeReplAvailable(): Promise<boolean> {
    const ext = vscode.extensions.getExtension('julialang.language-julia');
    return ext !== undefined && ext.isActive;
  }

  private async runViaRepl(code: string): Promise<string> {
    // julia-vscode exposes `julia.executeCode` but doesn't return output to us.
    // Fall back to subprocess so we can capture stdout.
    // This could be improved by hooking into the julia-vscode OutputChannel.
    return this.execJulia(code);
  }

  // ─── Julia subprocess ───────────────────────────────────────────────────────

  // Like execJulia but calls onLine for each stdout line as it arrives,
  // allowing the caller to react to progress sentinels mid-run.
  private execJuliaWithProgress(
    code: string,
    timeoutMs: number,
    onLine: (line: string) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const config = vscode.workspace.getConfiguration('sciml');
      const juliaPath: string = config.get('juliaPath') ?? 'julia';

      const proc: ChildProcessWithoutNullStreams = spawn(juliaPath, [
        '--startup-file=no',
        '--color=no',
        '-e', code,
      ]);

      let stdout = '';
      let stderr = '';
      let lineBuffer = '';

      proc.stdout.on('data', (d: Buffer) => {
        const chunk = d.toString();
        stdout += chunk;
        lineBuffer += chunk;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) onLine(line);
      });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`Julia timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout.trim() || '(no output)');
        } else {
          const errLine = stderr.trim().split('\n').filter(Boolean).pop() ?? stderr.trim();
          reject(new Error(errLine || `Julia exited ${code}`));
        }
      });

      proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
  }

  private execJulia(code: string, timeoutMs = 60_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const config = vscode.workspace.getConfiguration('sciml');
      const juliaPath: string = config.get('juliaPath') ?? 'julia';

      const proc: ChildProcessWithoutNullStreams = spawn(juliaPath, [
        '--startup-file=no',
        '--color=no',
        '-e', code,
      ]);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`Julia timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout.trim() || '(no output)');
        } else {
          // Prefer the last non-empty stderr line (Julia error summary)
          const errLine = stderr.trim().split('\n').filter(Boolean).pop() ?? stderr.trim();
          reject(new Error(errLine || `Julia exited ${code}`));
        }
      });

      proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function formatNs(ns: number): string {
  if (ns < 1_000) return `${ns.toFixed(1)} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} μs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
  return `${(ns / 1_000_000_000).toFixed(2)} s`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
