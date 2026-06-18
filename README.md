# SciML Toolkit

A VS Code extension for Julia [SciML](https://sciml.ai) users — run code blocks inline, benchmark with `@benchmark`, and preview LaTeX equations from your docstrings.

## Features

### Run Julia Blocks — `Ctrl+Shift+Enter`
Divide your `.jl` file into cells using `##` or `# %%` markers. Place your cursor inside a cell and press `Ctrl+Shift+Enter` to execute it. The result appears inline at the end of the cell.

```julia
## Cell 1
println("Hello from SciML!")   # ▶ Hello from SciML!
```

### Benchmark — `Ctrl+Shift+B`
Wraps the current cell in `BenchmarkTools.@benchmark` and opens a side panel with:
- Median / min / max / mean timing
- Memory and allocation counts
- Histogram of all sample times

```julia
## Cell 2
u = rand(1000); sort(u)    # ▶ median 12.34 μs  allocs 1
```

### Variable Inspector — auto-opens after every Run Block
After every block execution, a side panel pops open showing all live variables in `Main` — name, type, size, and a value preview. No extra command needed.

| Name | Type | Size | Value |
|---|---|---|---|
| `sol` | `ODESolution` | `scalar` | `retcode: Success` |
| `u0` | `Vector{Float64}` | `(3,)` | `[1.0, 0.0, 0.0]` |

### Plot Viewer — auto-opens on plot output
If your block calls `plot(...)` via **Plots.jl** or **CairoMakie**, the output PNG is captured and displayed in a side panel automatically. Re-run the block to refresh it.

### SciML Snippets
Type a prefix and press `Tab` to expand full boilerplate:

| Prefix | Expands to |
|---|---|
| `ode` | `ODEProblem` + `solve` with Tsit5 |
| `sde` | `SDEProblem` with drift + diffusion |
| `mtk` | `ModelingToolkit` `@variables` + `@equations` system |
| `neural_ode` | NeuralODE with Lux.jl |
| `bvp` | `BVProblem` with boundary conditions |
| `optim` | `OptimizationProblem` with Optim.jl |
| `pinn` | Physics-Informed NN via NeuralPDE.jl |
| `diffeq` | Full define → solve → plot workflow |

### Equation Preview — `Ctrl+Shift+M`
Opens a live-updating side panel that renders all LaTeX math found in the file using [KaTeX](https://katex.org). Supports all three SciML/Documenter.jl formats:

````julia
"""
```math
\\frac{\\partial u}{\\partial t} = \\kappa \\nabla^2 u
```
"""

# Inline: $E = mc^2$

# Display: $$\\dot{x} = \\sigma(y - x)$$
````

## Keyboard Shortcuts

| Action | Windows / Linux | Mac |
|---|---|---|
| Run current block | `Ctrl+Shift+Enter` | `Cmd+Shift+Enter` |
| Benchmark current block | `Ctrl+Shift+Alt+B` | `Cmd+Shift+Alt+B` |
| Preview equations | `Ctrl+Shift+M` | `Cmd+Shift+M` |
| Clear all inline outputs | Command Palette → *SciML: Clear All Outputs* | same |

> All commands are only active when a `.jl` file is open in the editor.
>
> **Keybinding conflicts:** `Ctrl+Shift+M` (Preview Equations) overlaps VS Code's built-in **Toggle Minimap** shortcut. If it doesn't fire, open *Keyboard Shortcuts* (`Ctrl+K Ctrl+S`) and rebind either command.

## Requirements

- Julia 1.6 or later on your `PATH` (or configure `sciml.juliaPath`)
- `BenchmarkTools.jl` — auto-installed on first benchmark run if missing

## Settings

| Setting | Default | Description |
|---|---|---|
| `sciml.juliaPath` | `"julia"` | Path to the Julia executable |
| `sciml.useExistingRepl` | `true` | Prefer the active julia-vscode REPL over a subprocess |
| `sciml.startupTimeout` | `30` | Seconds before a Julia subprocess is killed |

## Coexistence with julia-vscode

SciML Toolkit detects the official [Julia extension](https://marketplace.visualstudio.com/items?itemName=julialang.language-julia) and routes `Run Block` through its REPL when available (so your environment and loaded packages are shared). Inline output decorations are positioned to avoid conflicting with julia-vscode's own inline results.

## License

MIT © Harsh Singh
