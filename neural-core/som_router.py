"""
Self-Organizing Map (SOM) Router for Dynamic Mixture-of-Experts (MoE) Routing.
Assigns tokens or sequence embeddings to specialized KAN micro-experts based on topological clustering.
"""

import math
import torch
import torch.nn as nn
import torch.nn.functional as F


class SOMRouter(nn.Module):
    """
    SOM-based topological gating mechanism:
    Maps latent embeddings to a discrete set of K expert units.
    """

    def __init__(
        self,
        embed_dim: int,
        num_experts: int = 4,
        top_k: int = 2,
        sigma: float = 1.0,
        learning_rate_som: float = 0.05
    ):
        super().__init__()
        self.embed_dim = embed_dim
        self.num_experts = num_experts
        self.top_k = min(top_k, num_experts)
        self.sigma = sigma
        self.lr_som = learning_rate_som

        # Codebook prototypes for each expert: [num_experts, embed_dim]
        # Initialized uniformly on unit sphere
        prototypes = torch.randn(num_experts, embed_dim)
        prototypes = F.normalize(prototypes, p=2, dim=-1)
        self.prototypes = nn.Parameter(prototypes)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, dict]:
        """
        Args:
            x: Input embeddings [batch_size, seq_len, embed_dim] or [batch_size, embed_dim]
        Returns:
            top_weights: Softmax weights of selected experts [batch, top_k]
            top_indices: Indices of selected experts [batch, top_k]
            aux_info: Diagnostic telemetry (expert usage, routing entropy)
        """
        orig_shape = x.shape
        x_flat = x.reshape(-1, self.embed_dim)  # [N, embed_dim]

        # 1. Compute squared Euclidean distance to each expert prototype
        # ||x - w_k||^2 = ||x||^2 - 2 x w_k^T + ||w_k||^2
        x_norm_sq = torch.sum(x_flat ** 2, dim=-1, keepdim=True)  # [N, 1]
        w_norm_sq = torch.sum(self.prototypes ** 2, dim=-1, keepdim=True).t()  # [1, K]
        cross_term = torch.matmul(x_flat, self.prototypes.t())  # [N, K]

        dist_sq = F.relu(x_norm_sq - 2 * cross_term + w_norm_sq)  # [N, K]

        # 2. Gaussian topological activation kernel
        # g_k = exp(-dist_sq / (2 * sigma^2))
        raw_affinity = torch.exp(-dist_sq / (2 * (self.sigma ** 2) + 1e-6))
        all_weights = raw_affinity / (torch.sum(raw_affinity, dim=-1, keepdim=True) + 1e-8)

        # 3. Top-K Sparsification
        top_weights, top_indices = torch.topk(all_weights, self.top_k, dim=-1)
        # Re-normalize Top-K weights
        top_weights = top_weights / (torch.sum(top_weights, dim=-1, keepdim=True) + 1e-8)

        # 4. Expert load telemetry
        with torch.no_grad():
            expert_histogram = torch.bincount(top_indices.reshape(-1), minlength=self.num_experts)
            usage_ratios = (expert_histogram.float() / top_indices.numel()).cpu().tolist()

        aux_info = {
            "num_experts": self.num_experts,
            "top_k": self.top_k,
            "expert_usage": usage_ratios,
            "mean_entropy": float(-torch.sum(all_weights.detach() * torch.log(all_weights.detach() + 1e-8), dim=-1).mean().cpu())
        }

        return top_weights, top_indices, aux_info
