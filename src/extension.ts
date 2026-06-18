import * as vscode from 'vscode';
import { JuliaRunner } from './juliaRunner';
import { BenchmarkPanel } from './benchmarkPanel';
import { EquationPreview } from './equationPreview';

let runner: JuliaRunner | undefined;

export function activate(context: vscode.ExtensionContext) {
  runner = new JuliaRunner();

  context.subscriptions.push(
    vscode.commands.registerCommand('sciml.runBlock', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) runner?.runBlock(editor);
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
    })
  );
}

export function deactivate() {
  runner?.dispose();
}
