## Cell 1 — Lorenz ODE  (Ctrl+Shift+Enter to run)
# Lorenz attractor equations:
# $$\dot{x} = \sigma(y - x), \quad \dot{y} = x(\rho - z) - y, \quad \dot{z} = xy - \beta z$$

function lorenz!(du, u, p, t)
    σ, ρ, β = p
    du[1] = σ * (u[2] - u[1])
    du[2] = u[1] * (ρ - u[3]) - u[2]
    du[3] = u[1] * u[2] - β * u[3]
end

println("Lorenz system defined: σ=$(10), ρ=$(28), β=$(8/3)")

## Cell 2 — Benchmark the RHS  (Ctrl+Shift+B)
# Cost of one RHS evaluation:

u = [1.0, 0.0, 0.0]; du = similar(u); p = (10.0, 28.0, 8/3); t = 0.0
lorenz!(du, u, p, t)   # benchmark this

## Cell 3 — Equation preview demo  (Ctrl+Shift+M to open preview panel)

"""
    heat_eq(u, Δx, κ)

Solves the 1-D heat equation:

```math
\\frac{\\partial u}{\\partial t} = \\kappa \\nabla^2 u
```

with diffusivity ``\\kappa > 0`` and spatial step ``\\Delta x``.
The discrete Laplacian is approximated as:

```math
\\nabla^2 u_i \\approx \\frac{u_{i+1} - 2u_i + u_{i-1}}{(\\Delta x)^2}
```
"""
function heat_eq(u, Δx, κ)
    n = length(u)
    du = similar(u)
    for i in 2:n-1
        du[i] = κ * (u[i+1] - 2u[i] + u[i-1]) / Δx^2
    end
    du[1] = du[end] = 0.0
    du
end

## Cell 4 — Neural ODE energy functional
# Energy: $E[u] = \frac{1}{2}\int_\Omega |\nabla u|^2 \, d\Omega$
# Gradient flow: $\frac{\partial u}{\partial t} = -\nabla E[u]$

println("All cells loaded. Open preview with Ctrl+Shift+M")
