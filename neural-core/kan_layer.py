"""
Kolmogorov-Arnold Network (KAN) Layer Implementation with B-splines and Mish Activation.
Mathematical basis:
  y_i = sum_j ( w_base * Mish(x_j) + w_spline * sum_k (c_{i,j,k} * B_k(x_j)) )
"""

import math
import torch
import torch.nn as nn
import torch.nn.functional as F


def mish(x: torch.Tensor) -> torch.Tensor:
    """Mish activation function: x * tanh(ln(1 + e^x))"""
    return x * torch.tanh(F.softplus(x))


def b_splines(x: torch.Tensor, grid: torch.Tensor, spline_order: int = 3) -> torch.Tensor:
    """
    Computes B-spline basis functions using the Cox-de Boor recursion formula.
    Args:
        x: Input tensor of shape [batch_size, in_features]
        grid: Grid knots tensor of shape [in_features, grid_size + 2 * spline_order + 1]
        spline_order: Polynomial order of the spline (default: 3, cubic spline)
    Returns:
        bases: Shape [batch_size, in_features, grid_size + spline_order]
    """
    x = x.unsqueeze(-1)  # [batch, in_features, 1]
    grid = grid.unsqueeze(0)  # [1, in_features, num_knots]

    # Order 0 basis
    bases = ((x >= grid[..., :-1]) & (x < grid[..., 1:])).to(x.dtype)

    # Cox-de Boor recursion for higher orders
    for k in range(1, spline_order + 1):
        left_denom = grid[..., k:-1] - grid[..., : -(k + 1)]
        right_denom = grid[..., k + 1 :] - grid[..., 1:-k]

        # Prevent division by zero
        left_factor = torch.where(left_denom != 0, (x - grid[..., : -(k + 1)]) / left_denom, torch.zeros_like(x))
        right_factor = torch.where(right_denom != 0, (grid[..., k + 1 :] - x) / right_denom, torch.zeros_like(x))

        bases = left_factor * bases[..., :-1] + right_factor * bases[..., 1:]

    return bases


class KANLinear(nn.Module):
    """
    KAN Linear Layer:
    Replaces dense weight matrices with learnable non-linear univariate functions on edges.
    """

    def __init__(
        self,
        in_features: int,
        out_features: int,
        grid_size: int = 5,
        spline_order: int = 3,
        scale_noise: float = 0.1,
        scale_base: float = 1.0,
        scale_spline: float = 1.0,
        grid_range: tuple = (-1.0, 1.0)
    ):
        super().__init__()
        self.in_features = in_features
        self.out_features = out_features
        self.grid_size = grid_size
        self.spline_order = spline_order
        self.scale_base = scale_base
        self.scale_spline = scale_spline

        # 1. Base weights for Mish activation path
        self.base_weight = nn.Parameter(torch.empty(out_features, in_features))

        # 2. Spline coefficients tensor [out_features, in_features, grid_size + spline_order]
        num_splines = grid_size + spline_order
        self.spline_weight = nn.Parameter(torch.empty(out_features, in_features, num_splines))
        self.spline_scaler = nn.Parameter(torch.ones(out_features, in_features))

        # 3. Knots grid buffer
        h = (grid_range[1] - grid_range[0]) / grid_size
        grid = torch.linspace(
            grid_range[0] - spline_order * h,
            grid_range[1] + spline_order * h,
            grid_size + 2 * spline_order + 1,
            dtype=torch.float32
        )
        # Replicate grid for all input features
        self.register_buffer("grid", grid.unsqueeze(0).repeat(in_features, 1))

        self.reset_parameters(scale_noise)

    def reset_parameters(self, scale_noise: float = 0.1):
        # Xavier/Kaiming initialization for base weights
        nn.init.kaiming_uniform_(self.base_weight, a=math.sqrt(5) * self.scale_base)

        # Initialize spline coefficients with small noise
        noise = (torch.rand(self.out_features, self.in_features, self.grid_size + self.spline_order) - 0.5) * scale_noise
        self.spline_weight.data.copy_(noise)
        nn.init.ones_(self.spline_scaler)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass:
        x: [batch_size, in_features] or [..., in_features]
        """
        orig_shape = x.shape
        x_2d = x.reshape(-1, self.in_features)

        # Path 1: Base Mish transformation
        base_output = F.linear(mish(x_2d), self.base_weight)

        # Path 2: B-spline non-linear edge transformation
        # bases: [batch_size, in_features, num_splines]
        bases = b_splines(x_2d, self.grid, self.spline_order)

        # Scaled spline weights: [out_features, in_features, num_splines]
        eff_spline_weight = self.spline_weight * self.spline_scaler.unsqueeze(-1)

        # Tensor contraction: y_spline[b, o] = sum_{i, k} bases[b, i, k] * eff_spline_weight[o, i, k]
        spline_output = torch.einsum("bik,oik->bo", bases, eff_spline_weight)

        # Total output
        output = base_output + spline_output

        # Reshape to original batch dimensions if necessary
        if len(orig_shape) > 2:
            output = output.view(*orig_shape[:-1], self.out_features)

        return output

    def get_spline_profile(self, num_points: int = 50) -> dict:
        """
        Extracts discretized 1D spline curves for inspection and UI visualization.
        """
        with torch.no_grad():
            x_eval = torch.linspace(-1.0, 1.0, num_points, device=self.grid.device)
            # Eval on single feature dimension
            x_test = x_eval.unsqueeze(1).repeat(1, self.in_features)
            bases = b_splines(x_test, self.grid, self.spline_order)
            eff_spline = self.spline_weight * self.spline_scaler.unsqueeze(-1)
            # Sample curve for the first input-output edge
            sample_curve = torch.einsum("bk,k->b", bases[:, 0, :], eff_spline[0, 0, :])
            return {
                "x": x_eval.cpu().tolist(),
                "y": sample_curve.cpu().tolist(),
                "in_features": self.in_features,
                "out_features": self.out_features,
                "grid_size": self.grid_size
            }
