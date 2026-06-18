import * as vscode from 'vscode';
import { JuliaRunner } from './juliaRunner';
import { BenchmarkPanel } from './benchmarkPanel';
import { EquationPreview } from './equationPreview';
import { registerSnippets } from './snippets';
import { VariableInspector } from './variableInspector';
import { PackageManager } from './packageManager';
import { PlotViewer, tempPlotPath } from './plotViewer';

let runner: JuliaRunner | undefined;
let pkgManager: PackageManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  runner = new JuliaRunner();
  pkgManager = new PackageManager(runner.session);

  // Register SciML snippet completions
  registerSnippets(context);

  // Start REPL session eagerly when a Julia file is open
  const startSessionIfNeeded = () => {
    if (!runner!.session.isReady()) {
      void runner!.session.start().then(() => {
        // Check packages once session is ready
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.languageId === 'julia') {
          void pkgManager!.checkAndOffer(editor.document);
        }
      }).catch(() => { /* Julia not found — commands will fall back to subprocess */ });
    }
  };

  // Start when any Julia file is opened or becomes active
  if (vscode.window.activeTextEditor?.document.languageId === 'julia') {
    startSessionIfNeeded();
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document.languageId === 'julia') {
        startSessionIfNeeded();
        void pkgManager!.checkAndOffer(editor.document);
      }
    }),

    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === 'julia') {
        void pkgManager!.checkAndOffer(doc);
      }
    }),

    vscode.commands.registerCommand('sciml.runBlock', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) runner?.runBlock(editor, context);
    }),

    vscode.commands.registerCommand('sciml.runBenchmark', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) runner?.runBenchmark(editor, context);
    }),

    vscode.commands.registerCommand('sciml.previewEquations', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) EquationPreview.show(editor, context);
    }),

    vscode.commands.registerCommand('sciml.clearOutputs', () => {
      runner?.clearDecorations();
    }),

    vscode.commands.registerCommand('sciml.showVariables', () => {
      VariableInspector.show(context, []);
    }),

    vscode.commands.registerCommand('sciml.plotVariable', async (varName: string) => {
      if (!runner!.session.isReady()) {
        void vscode.window.showWarningMessage('SciML: no active Julia session — run a block first.');
        return;
      }
      const plotPath = tempPlotPath();
      const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
      status.text = `$(sync~spin) SciML: plotting ${varName}…`;
      status.show();
      try {
        const code = `
import Plots
Plots.plot(${varName})
Plots.savefig(raw"${plotPath}")
println("__sciml_plot__:${plotPath}")
`;
        await runner!.session.exec(code, 30_000);
        PlotViewer.show(context, plotPath);
      } catch (err) {
        void vscode.window.showErrorMessage(`SciML: plot failed — ${err}`);
      } finally {
        status.dispose();
      }
    }),

    vscode.commands.registerCommand('sciml.restartRepl', async () => {
      const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
      status.text = '$(sync~spin) SciML: Restarting Julia session…';
      status.show();
      try {
        await runner!.session.restart();
        void vscode.window.showInformationMessage('SciML: Julia session restarted.');
      } catch (err) {
        void vscode.window.showErrorMessage(`SciML: restart failed — ${err}`);
      } finally {
        status.dispose();
      }
    })
  );
}

export function deactivate() {
  runner?.dispose();
}
