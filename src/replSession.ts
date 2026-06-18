import * as vscode from 'vscode';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as crypto from 'crypto';

// ─── ReplSession ──────────────────────────────────────────────────────────────
// Keeps a single Julia process alive for the VS Code session.
// Code is sent via stdin; output is read until a unique end-sentinel appears.
// This eliminates the ~2-3s Julia startup cost on every Run Block.

const STARTUP_CODE = `
# Disable output truncation so previews are complete
Base.display_size() = (24, 200)

# Silence Pkg precompile noise during sessions
ENV["JULIA_PKG_PRECOMPILE_AUTO"] = "0"

# Helper the extension uses to detect missing packages
function __sciml_pkg_status__(pkgs)
    import Pkg
    installed = keys(Pkg.project().dependencies)
    for pkg in pkgs
        if !(pkg in installed)
            println("__sciml_missing__:", pkg)
        end
    end
end
println("__sciml_ready__")
`;

export class ReplSession {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private ready = false;
  private queue: Array<{ code: string; resolve: (v: string) => void; reject: (e: Error) => void }> = [];
  private running = false;
  private outputBuffer = '';
  private stderrBuffer = '';
  private currentSentinel = '';
  private currentResolve: ((v: string) => void) | undefined;
  private currentReject: ((e: Error) => void) | undefined;
  private startPromise: Promise<void> | undefined;
  private onLineCallback: ((line: string) => void) | undefined;

  private get juliaPath(): string {
    return vscode.workspace.getConfiguration('sciml').get('juliaPath') ?? 'julia';
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise((resolve, reject) => {
      const proc = spawn(this.juliaPath, ['--startup-file=no', '--color=no', '-i'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      proc.on('error', (err) => {
        this.ready = false;
        reject(err);
      });

      let bootBuffer = '';
      const onBoot = (chunk: Buffer) => {
        bootBuffer += chunk.toString();
        if (bootBuffer.includes('__sciml_ready__')) {
          proc.stdout.off('data', onBoot);
          proc.stdout.on('data', (d: Buffer) => this.handleOutput(d));
          this.proc = proc;
          this.ready = true;
          resolve();
        }
      };

      proc.stdout.on('data', onBoot);
      proc.stderr.on('data', (d: Buffer) => {
        this.stderrBuffer += d.toString();
        // Forward progress sentinels to the current onLine callback
        if (this.onLineCallback) {
          for (const line of d.toString().split('\n')) {
            if (line.trim()) this.onLineCallback(line);
          }
        }
      });

      proc.on('close', () => {
        this.ready = false;
        this.proc = undefined;
        this.startPromise = undefined;
        if (this.currentReject) {
          this.currentReject(new Error('Julia REPL session closed unexpectedly'));
          this.currentReject = undefined;
        }
      });

      // Send startup code
      proc.stdin.write(STARTUP_CODE + '\n');

      // Timeout if Julia never becomes ready
      const timeout = setTimeout(() => reject(new Error('Julia REPL failed to start')), 30_000);
      this.startPromise?.then(() => clearTimeout(timeout)).catch(() => clearTimeout(timeout));
    });
    return this.startPromise;
  }

  isReady(): boolean {
    return this.ready && this.proc !== undefined;
  }

  dispose() {
    this.proc?.stdin.end();
    this.proc?.kill();
    this.proc = undefined;
    this.ready = false;
    this.startPromise = undefined;
  }

  restart(): Promise<void> {
    this.dispose();
    return this.start();
  }

  // ─── Code execution ─────────────────────────────────────────────────────────

  exec(code: string, timeoutMs = 60_000, onLine?: (line: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ code, resolve, reject });
      this.onLineCallback = onLine;
      this.drainQueue(timeoutMs);
    });
  }

  private drainQueue(timeoutMs: number) {
    if (this.running || this.queue.length === 0 || !this.ready) return;
    const { code, resolve, reject } = this.queue.shift()!;
    this.running = true;
    this.outputBuffer = '';
    this.stderrBuffer = '';

    // Unique sentinel marks end of this execution
    this.currentSentinel = `__sciml_end_${crypto.randomBytes(8).toString('hex')}__`;
    this.currentResolve = (out) => {
      clearTimeout(timer);
      this.running = false;
      resolve(out);
      this.drainQueue(timeoutMs);
    };
    this.currentReject = (err) => {
      clearTimeout(timer);
      this.running = false;
      reject(err);
      this.drainQueue(timeoutMs);
    };

    const timer = setTimeout(() => {
      this.currentReject?.(new Error(`Julia timed out after ${timeoutMs / 1000}s`));
      this.currentReject = undefined;
      this.currentResolve = undefined;
    }, timeoutMs);

    // Wrap in try/catch so errors surface via the sentinel mechanism
    const wrapped = `
try
${code}
catch __sciml_err__
  println(stderr, "ERROR: ", sprint(showerror, __sciml_err__))
end
println("${this.currentSentinel}")
flush(stdout)
`;
    this.proc!.stdin.write(wrapped + '\n');
  }

  private handleOutput(chunk: Buffer) {
    const text = chunk.toString();
    this.outputBuffer += text;

    // Emit lines to progress callback
    if (this.onLineCallback) {
      for (const line of text.split('\n')) {
        if (line.trim()) this.onLineCallback(line);
      }
    }

    if (this.currentSentinel && this.outputBuffer.includes(this.currentSentinel)) {
      // Extract output before the sentinel
      const out = this.outputBuffer
        .split(this.currentSentinel)[0]
        .replace(/^julia>\s*/gm, '')   // strip REPL prompts
        .trim();

      const hadError = this.stderrBuffer.includes('ERROR:');
      if (hadError) {
        const errLine = this.stderrBuffer
          .split('\n')
          .find((l) => l.startsWith('ERROR:')) ?? this.stderrBuffer.trim();
        this.currentReject?.(new Error(errLine));
      } else {
        this.currentResolve?.(out || '(no output)');
      }

      this.currentResolve = undefined;
      this.currentReject = undefined;
      this.outputBuffer = '';
      this.stderrBuffer = '';
    }
  }
}
