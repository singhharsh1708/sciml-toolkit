import * as vscode from 'vscode';
import { ReplSession } from './replSession';

// ─── Package auto-installer ───────────────────────────────────────────────────
// Scans the active document for `using X` / `import X` statements,
// checks which packages are missing from the Julia environment,
// and shows a notification offering to install them in one click.

const USING_RE = /^\s*(?:using|import)\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm;

// Packages that ship with Julia base — no install needed
const STDLIB = new Set([
  'Base', 'Core', 'Main', 'Dates', 'LinearAlgebra', 'Random', 'Statistics',
  'Printf', 'Test', 'REPL', 'Logging', 'Pkg', 'InteractiveUtils', 'Markdown',
  'Serialization', 'Sockets', 'Profile', 'FileWatching', 'SHA', 'Unicode',
  'DelimitedFiles', 'SparseArrays', 'SharedArrays', 'Mmap', 'LibGit2',
]);

export function extractUsedPackages(text: string): string[] {
  const pkgs = new Set<string>();
  for (const m of text.matchAll(USING_RE)) {
    for (const raw of m[1].split(',')) {
      const pkg = raw.trim().split('.')[0];  // `Plots.jl` → `Plots`
      if (pkg && !STDLIB.has(pkg)) pkgs.add(pkg);
    }
  }
  return [...pkgs];
}

export class PackageManager {
  private session: ReplSession;
  private lastChecked = new Map<string, number>();   // pkg → timestamp
  private RECHECK_MS = 5 * 60 * 1000;               // re-check at most once per 5 min

  constructor(session: ReplSession) {
    this.session = session;
  }

  // Call after opening / saving a Julia file
  async checkAndOffer(document: vscode.TextDocument): Promise<void> {
    if (!this.session.isReady()) return;

    const pkgs = extractUsedPackages(document.getText());
    if (pkgs.length === 0) return;

    // Filter out recently-checked packages
    const now = Date.now();
    const toCheck = pkgs.filter(
      (p) => !this.lastChecked.has(p) || now - this.lastChecked.get(p)! > this.RECHECK_MS
    );
    if (toCheck.length === 0) return;

    // Ask Julia which ones are actually missing
    const checkCode = `__sciml_pkg_status__(${JSON.stringify(toCheck)})`;
    let output: string;
    try {
      output = await this.session.exec(checkCode, 10_000);
    } catch {
      return;
    }

    const missing = output
      .split('\n')
      .filter((l) => l.startsWith('__sciml_missing__:'))
      .map((l) => l.replace('__sciml_missing__:', '').trim());

    // Mark all checked
    for (const p of toCheck) this.lastChecked.set(p, now);

    if (missing.length === 0) return;

    const label = missing.length === 1
      ? `Install ${missing[0]}`
      : `Install ${missing.length} packages (${missing.join(', ')})`;

    const choice = await vscode.window.showInformationMessage(
      `SciML: missing Julia packages: ${missing.join(', ')}`,
      label,
      'Ignore'
    );

    if (choice !== label) return;

    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    status.text = `$(sync~spin) Installing ${missing.join(', ')}…`;
    status.show();

    try {
      const installCode = `import Pkg; Pkg.add(${JSON.stringify(missing)})`;
      await this.session.exec(installCode, 300_000);
      void vscode.window.showInformationMessage(
        `SciML: installed ${missing.join(', ')} successfully.`
      );
    } catch (err) {
      void vscode.window.showErrorMessage(
        `SciML: package install failed — ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      status.dispose();
    }
  }
}
