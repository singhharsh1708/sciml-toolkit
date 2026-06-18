import * as vscode from 'vscode';

// ─── Snippet definitions ──────────────────────────────────────────────────────
// Each entry: trigger prefix → { label, detail, body (snippet string) }

const SCIML_SNIPPETS: Array<{
  prefix: string;
  label: string;
  detail: string;
  body: string;
}> = [
  {
    prefix: 'ode',
    label: 'ODE Problem (SciML)',
    detail: 'ODEProblem + solve with Tsit5',
    body: `using DifferentialEquations

function \${1:f}!(du, u, p, t)
    \${2:# du[1] = ...}
end

u0 = [\${3:1.0}]
tspan = (\${4:0.0}, \${5:10.0})
p = \${6:()}
prob = ODEProblem(\${1:f}!, u0, tspan, p)
sol = solve(prob, Tsit5())
\${0}`,
  },
  {
    prefix: 'sde',
    label: 'SDE Problem (SciML)',
    detail: 'SDEProblem with drift + diffusion',
    body: `using DifferentialEquations

function \${1:drift}!(du, u, p, t)
    \${2:du[1] = -u[1]}
end

function \${3:diffusion}!(du, u, p, t)
    \${4:du[1] = 0.1}
end

u0 = [\${5:1.0}]
tspan = (\${6:0.0}, \${7:10.0})
prob = SDEProblem(\${1:drift}!, \${3:diffusion}!, u0, tspan)
sol = solve(prob, SOSRI())
\${0}`,
  },
  {
    prefix: 'mtk',
    label: 'ModelingToolkit System',
    detail: 'ODESystem via @variables + @equations',
    body: `using ModelingToolkit, DifferentialEquations

@variables t \${1:x}(t) \${2:y}(t)
@parameters \${3:σ}=10 \${4:ρ}=28 \${5:β}=8/3
D = Differential(t)

eqs = [
    D(\${1:x}) ~ \${6:\${3:σ} * (\${2:y} - \${1:x})},
    D(\${2:y}) ~ \${7:\${1:x} * (\${4:ρ} - \${1:x}) - \${2:y}},
]

@named sys = ODESystem(eqs, t)
sys = structural_simplify(sys)

u0 = [\${1:x} => \${8:1.0}, \${2:y} => \${9:0.0}]
tspan = (\${10:0.0}, \${11:10.0})
prob = ODEProblem(sys, u0, tspan)
sol = solve(prob, Tsit5())
\${0}`,
  },
  {
    prefix: 'neural_ode',
    label: 'Neural ODE (Lux + DiffEq)',
    detail: 'NeuralODE with Lux.jl and Optimisers',
    body: `using DifferentialEquations, Lux, Optimisers, Zygote, Random

rng = Random.default_rng()

# Define neural network
nn = Lux.Chain(
    Lux.Dense(\${1:2}, \${2:32}, tanh),
    Lux.Dense(\${2:32}, \${1:2}),
)
ps, st = Lux.setup(rng, nn)

# ODE via neural network
function neural_f(u, p, t)
    nn(u, p, st)[1]
end

u0 = \${3:Float32[1.0, 0.0]}
tspan = (\${4:0.0f0}, \${5:2.0f0})
prob = ODEProblem(neural_f, u0, tspan, ps)

sol = solve(prob, Tsit5(), saveat=\${6:0.1})
\${0}`,
  },
  {
    prefix: 'bvp',
    label: 'BVP Problem (SciML)',
    detail: 'BVProblem with boundary conditions',
    body: `using BoundaryValueDiffEq

function \${1:bvp_f}!(du, u, p, t)
    \${2:du[1] = u[2]
    du[2] = -u[1]}
end

function \${3:bc}!(residual, u, p, t)
    \${4:residual[1] = u[1][1]    # u(0) = 0
    residual[2] = u[end][1] - 1  # u(1) = 1}
end

tspan = (\${5:0.0}, \${6:1.0})
prob = BVProblem(\${1:bvp_f}!, \${3:bc}!, \${7:[0.0, 1.0]}, tspan)
sol = solve(prob, MIRK4(), dt=\${8:0.05})
\${0}`,
  },
  {
    prefix: 'optim',
    label: 'Optimization Problem (SciML)',
    detail: 'OptimizationProblem with Optim.jl backend',
    body: `using Optimization, OptimizationOptimJL

function \${1:loss}(u, p)
    \${2:sum(abs2, u)}
end

u0 = \${3:zeros(2)}
p  = \${4:nothing}
prob = OptimizationProblem(\${1:loss}, u0, p)
sol  = solve(prob, \${5:LBFGS}())
println("Minimum: ", sol.u, " → ", sol.objective)
\${0}`,
  },
  {
    prefix: 'pinn',
    label: 'Physics-Informed NN (NeuralPDE)',
    detail: 'PINN for a 1-D PDE via NeuralPDE.jl',
    body: `using NeuralPDE, ModelingToolkit, Lux, Optimisers

@variables t x u(..)
Dt = Differential(t); Dx = Differential(x); Dxx = Differential(x)^2

# PDE: ∂u/∂t = κ ∂²u/∂x²
\${1:κ} = \${2:0.1}
eq = Dt(u(t,x)) ~ \${1:κ} * Dxx(u(t,x))

bcs = [
    u(0, x) ~ \${3:sin(π*x)},
    u(t, 0) ~ 0.0,
    u(t, 1) ~ 0.0,
]

domains = [t ∈ (0.0, \${4:1.0}), x ∈ (0.0, 1.0)]

chain = Lux.Chain(Lux.Dense(2, \${5:16}, tanh), Lux.Dense(\${5:16}, 1))
discretization = PhysicsInformedNN(chain, GridTraining(\${6:0.1}))

@named pde_sys = PDESystem(eq, bcs, domains, [t,x], [u(t,x)])
prob = discretize(pde_sys, discretization)
sol  = solve(prob, \${7:Adam(0.01)}, maxiters=\${8:1000})
\${0}`,
  },
  {
    prefix: 'diffeq',
    label: 'Full DiffEq Workflow',
    detail: 'Define, solve, and plot an ODE system',
    body: `using DifferentialEquations, Plots

# ── System ──────────────────────────────────────────
function \${1:system}!(du, u, p, t)
    \${2:a}, \${3:b} = p
    \${4:du[1] = \${2:a} * u[1]
    du[2] = \${3:b} * u[2]}
end

# ── Setup ────────────────────────────────────────────
u0     = [\${5:1.0, 0.5}]
tspan  = (\${6:0.0}, \${7:10.0})
p      = (\${8:-0.5, -1.0})
prob   = ODEProblem(\${1:system}!, u0, tspan, p)

# ── Solve ────────────────────────────────────────────
sol = solve(prob, \${9:Tsit5}(), saveat=\${10:0.1})
println("Final state: ", sol.u[end])

# ── Plot ─────────────────────────────────────────────
plot(sol, xlabel="t", ylabel="u", title="\${1:system}")
\${0}`,
  },
];

// ─── Provider ────────────────────────────────────────────────────────────────

export class SciMLCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const linePrefix = document.lineAt(position).text.slice(0, position.character);

    // Only trigger on a fresh word (not inside a string or comment in most cases)
    const word = linePrefix.match(/\b(\w+)$/)?.[1] ?? '';
    if (!word) return [];

    return SCIML_SNIPPETS
      .filter((s) => s.prefix.startsWith(word))
      .map((s) => {
        const item = new vscode.CompletionItem(s.prefix, vscode.CompletionItemKind.Snippet);
        item.label = s.prefix;
        item.detail = s.label;
        item.documentation = new vscode.MarkdownString(`**${s.label}**\n\n${s.detail}`);
        item.insertText = new vscode.SnippetString(s.body);
        item.sortText = `0_${s.prefix}`;  // float to top of list
        return item;
      });
  }
}

export function registerSnippets(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'julia' },
      new SciMLCompletionProvider(),
      // trigger on any letter — VS Code calls us on normal typing too
    )
  );
}
