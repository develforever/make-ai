"""
Precision Optimization Pillars for MakeAI Neural Core:
  1. Focal Loss with Online Hard Example Mining (OHEM)
  2. Orthogonal Regularization (Feature Disentanglement)
  3. Stochastic Weight Averaging (SWA)
"""

import copy
import torch
import torch.nn as nn
import torch.nn.functional as F


class FocalLossOHEM(nn.Module):
    """
    Focal Loss with Online Hard Example Mining (OHEM).
    Focuses updates on the top-k% hardest tokens (highest loss),
    preventing parameter saturation on trivial syntax patterns.
    """

    def __init__(self, gamma: float = 2.0, ohem_ratio: float = 0.35, ignore_index: int = -100):
        super().__init__()
        self.gamma = gamma
        self.ohem_ratio = ohem_ratio
        self.ignore_index = ignore_index

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        """
        logits: [B, T, V] or [N, V]
        targets: [B, T] or [N]
        """
        v = logits.size(-1)
        logits_flat = logits.view(-1, v)
        targets_flat = targets.view(-1)

        valid_mask = targets_flat != self.ignore_index
        if not valid_mask.any():
            return torch.tensor(0.0, device=logits.device, requires_grad=True)

        logits_valid = logits_flat[valid_mask]
        targets_valid = targets_flat[valid_mask]

        # Standard cross-entropy per sample (unreduced)
        ce_loss = F.cross_entropy(logits_valid, targets_valid, reduction="none")

        # Compute probability of target class
        p = torch.exp(-ce_loss)

        # Focal scaling: (1 - p_t)^gamma
        focal_loss = ((1.0 - p) ** self.gamma) * ce_loss

        # OHEM: Select hardest examples (top ohem_ratio)
        num_samples = focal_loss.size(0)
        k = max(1, int(num_samples * self.ohem_ratio))

        topk_losses, _ = torch.topk(focal_loss, k=k, largest=True)
        return topk_losses.mean()


def compute_orthogonal_regularization(model: nn.Module, beta: float = 1e-4) -> torch.Tensor:
    """
    Penalizes non-orthogonal weight matrices:
      L_ortho = beta * sum_l ||W_l^T @ W_l - I||_F^2
    Forces expert representation channels to remain non-redundant.
    """
    device = next(model.parameters()).device
    ortho_loss = torch.tensor(0.0, device=device)

    for name, param in model.named_parameters():
        if "base_weight" in name and param.ndim == 2:
            out_dim, in_dim = param.shape
            w = param
            if out_dim > in_dim:
                wtw = torch.matmul(w.t(), w)
                eye = torch.eye(in_dim, device=device)
            else:
                wtw = torch.matmul(w, w.t())
                eye = torch.eye(out_dim, device=device)

            diff = wtw - eye
            ortho_loss = ortho_loss + torch.norm(diff, p="fro") ** 2

    return beta * ortho_loss


class StochasticWeightAveraging:
    """
    Stochastic Weight Averaging (SWA) tracks a running arithmetic average
    of model weights over the late optimization trajectory to smooth decision boundaries.
    """

    def __init__(self, model: nn.Module):
        self.model = model
        self.swa_weights = {}
        self.n_models = 0
        for name, param in model.named_parameters():
            if param.requires_grad:
                self.swa_weights[name] = param.detach().clone()

    def update(self) -> None:
        """Accumulate current weights into SWA average."""
        self.n_models += 1
        alpha = 1.0 / self.n_models
        for name, param in self.model.named_parameters():
            if param.requires_grad and name in self.swa_weights:
                self.swa_weights[name].lerp_(param.detach(), alpha)

    def apply_to_model(self) -> None:
        """Copy accumulated SWA weights into the target model."""
        with torch.no_grad():
            for name, param in self.model.named_parameters():
                if name in self.swa_weights:
                    param.copy_(self.swa_weights[name])


class CurriculumScheduler:
    """
    Curriculum Learning:
    Gradually shifts training data complexity from foundational syntax (low entropy, simple)
    to high-ambiguity conversational reasoning (high entropy, difficult) across training steps.
    """

    def __init__(self, total_steps: int, warmup_ratio: float = 0.3):
        self.total_steps = total_steps
        self.warmup_steps = int(total_steps * warmup_ratio)

    def get_stage(self, current_step: int) -> dict:
        progress = current_step / max(1, self.total_steps)
        if current_step < self.warmup_steps:
            return {
                "stage": 1,
                "name": "Foundational Syntax (Low Entropy)",
                "temp": 2.5,  # Smoother dark knowledge
                "ohem_ratio": 0.5,  # Broad token learning
                "alpha_distill": 0.8
            }
        elif progress < 0.7:
            return {
                "stage": 2,
                "name": "Intermediate Dialogue Patterns",
                "temp": 2.0,
                "ohem_ratio": 0.35,
                "alpha_distill": 0.6
            }
        else:
            return {
                "stage": 3,
                "name": "Hard Edge Cases & Fact Retention",
                "temp": 1.5,
                "ohem_ratio": 0.25,  # Focus on top 25% hardest tokens
                "alpha_distill": 0.4
            }

