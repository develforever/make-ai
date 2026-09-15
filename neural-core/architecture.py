"""
Compact Conversational KAN Model Architecture.
Integrates:
  1. Token & Positional Embeddings
  2. SOM Topological Router (Mixture of KAN-Experts)
  3. KAN Residual Blocks with learnable B-splines and Mish
  4. Language Modeling Head
"""

import math
import torch
import torch.nn as nn
import torch.nn.functional as F

from kan_layer import KANLinear, mish
from som_router import SOMRouter


class KANExpert(nn.Module):
    """
    A single micro-expert built with Kolmogorov-Arnold layers and residual connections.
    """

    def __init__(self, hidden_dim: int, grid_size: int = 5, spline_order: int = 3):
        super().__init__()
        self.hidden_dim = hidden_dim
        self.kan1 = KANLinear(hidden_dim, hidden_dim * 2, grid_size=grid_size, spline_order=spline_order)
        self.kan2 = KANLinear(hidden_dim * 2, hidden_dim, grid_size=grid_size, spline_order=spline_order)
        self.norm = nn.LayerNorm(hidden_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Residual non-linear transformation
        residual = x
        h = self.kan1(x)
        h = self.kan2(h)
        return self.norm(residual + h)


class MakeAIKANConversationalModel(nn.Module):
    """
    Full compact neural conversational model incorporating SOM routing and KAN layers.
    """

    def __init__(
        self,
        vocab_size: int = 4096,
        hidden_dim: int = 128,
        max_seq_len: int = 256,
        num_experts: int = 4,
        top_k: int = 2,
        grid_size: int = 5,
        spline_order: int = 3
    ):
        super().__init__()
        self.vocab_size = vocab_size
        self.hidden_dim = hidden_dim
        self.max_seq_len = max_seq_len
        self.num_experts = num_experts

        # 1. Embeddings
        self.tok_embed = nn.Embedding(vocab_size, hidden_dim)
        self.pos_embed = nn.Embedding(max_seq_len, hidden_dim)

        # 2. SOM Router
        self.router = SOMRouter(embed_dim=hidden_dim, num_experts=num_experts, top_k=top_k)

        # 3. Mixture of KAN Experts
        self.experts = nn.ModuleList([
            KANExpert(hidden_dim, grid_size=grid_size, spline_order=spline_order)
            for _ in range(num_experts)
        ])

        # 4. Final Aggregator KAN Layer & LM Head
        self.aggregator = KANLinear(hidden_dim, hidden_dim, grid_size=grid_size, spline_order=spline_order)
        self.ln_f = nn.LayerNorm(hidden_dim)
        self.lm_head = nn.Linear(hidden_dim, vocab_size, bias=False)

        # Weight tying
        self.lm_head.weight = self.tok_embed.weight

    def forward(self, input_ids: torch.Tensor) -> tuple[torch.Tensor, dict]:
        """
        Forward pass:
        input_ids: [batch_size, seq_len]
        Returns:
            logits: [batch_size, seq_len, vocab_size]
            telemetry: Diagnostic information (routing weights, spline profiles)
        """
        b, t = input_ids.size()
        assert t <= self.max_seq_len, f"Sequence length {t} exceeds maximum {self.max_seq_len}"

        # 1. Embeddings
        pos = torch.arange(0, t, dtype=torch.long, device=input_ids.device).unsqueeze(0)
        x = self.tok_embed(input_ids) + self.pos_embed(pos)  # [b, t, hidden_dim]

        # 2. Routing via SOM
        routing_weights, routing_indices, router_aux = self.router(x)  # [b*t, top_k]

        x_flat = x.view(b * t, self.hidden_dim)
        output_flat = torch.zeros_like(x_flat)

        # 3. Dispatched execution through selected KAN experts
        for k in range(routing_weights.size(-1)):
            idx_k = routing_indices[:, k]
            weight_k = routing_weights[:, k].unsqueeze(-1)

            for exp_id, expert in enumerate(self.experts):
                mask = (idx_k == exp_id)
                if mask.any():
                    selected_inputs = x_flat[mask]
                    exp_out = expert(selected_inputs)
                    output_flat[mask] += weight_k[mask] * exp_out

        x_processed = output_flat.view(b, t, self.hidden_dim)

        # 4. Final KAN refinement & projection
        h = self.aggregator(x_processed)
        h = self.ln_f(h)
        logits = self.lm_head(h)

        telemetry = {
            "router": router_aux,
            "sample_spline": self.experts[0].kan1.get_spline_profile(num_points=40),
            "total_params": sum(p.numel() for p in self.parameters() if p.requires_grad)
        }

        return logits, telemetry

    def count_parameters(self) -> dict:
        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        kan_params = sum(
            p.numel() for n, p in self.named_parameters() if "spline" in n or "base_weight" in n
        )
        return {
            "total_parameters": total,
            "trainable_parameters": trainable,
            "kan_spline_parameters": kan_params,
            "hidden_dimension": self.hidden_dim,
            "num_experts": self.num_experts
        }
