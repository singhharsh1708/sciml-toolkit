import * as vscode from 'vscode';
import { JuliaRunner } from './juliaRunner';
import { BenchmarkPanel } from './benchmarkPanel';
import { EquationPreview } from './equationPreview';
import { registerSnippets } from './snippets';
import { VariableInspector } from './variableInspector';

let runner: JuliaRunner | undefined;

export function activate(context: vscode.ExtensionContext) {
  runner = new JuliaRunner();

  // Register SciML snippet completions
  registerSnippets(context);

  context.subscriptions.push(
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
    })
  );
}

export function deactivate() {
  runner?.dispose();
}
