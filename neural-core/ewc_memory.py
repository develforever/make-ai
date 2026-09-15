"""
Elastic Weight Consolidation (EWC) Engine & Experience Replay Buffer.
Protects foundational linguistic knowledge against catastrophic forgetting during continual learning.
Mathematical basis:
  L_total(theta) = L_task(theta) + sum_i (lambda / 2 * F_i * (theta_i - theta_{A,i}^*)^2)
"""

import copy
import random
import torch
import torch.nn as nn


class EWC:
    """
    Elastic Weight Consolidation manager:
    Computes diagonal Fisher Information Matrix and penalizes movement of critical weights.
    """

    def __init__(self, model: nn.Module, ewc_lambda: float = 400.0):
        self.model = model
        self.ewc_lambda = ewc_lambda
        # Saved parameter checkpoints: {param_name: tensor}
        self.optimal_params: dict[str, torch.Tensor] = {}
        # Empirical Fisher diagonal: {param_name: tensor}
        self.fisher_matrix: dict[str, torch.Tensor] = {}

    def register_consolidated_task(self, dataloader, criterion, device=None):
        """
        Computes the empirical Fisher Information Matrix on the consolidated core dataset.
        """
        self.model.eval()
        fisher = {}
        for name, param in self.model.named_parameters():
            if param.requires_grad:
                fisher[name] = torch.zeros_like(param.data)
                self.optimal_params[name] = param.data.clone()

        num_samples = 0
        for batch in dataloader:
            if isinstance(batch, (tuple, list)):
                x, y = batch
            else:
                x, y = batch["input"], batch["target"]

            if device:
                x, y = x.to(device), y.to(device)

            self.model.zero_grad()
            output = self.model(x)
            loss = criterion(output, y)
            loss.backward()

            for name, param in self.model.named_parameters():
                if param.requires_grad and param.grad is not None:
                    fisher[name] += (param.grad.data ** 2) * x.size(0)

            num_samples += x.size(0)

        # Normalize across total samples
        for name in fisher:
            self.fisher_matrix[name] = fisher[name] / max(num_samples, 1)

    def penalty(self) -> torch.Tensor:
        """
        Computes the quadratic penalty over parameter drift weighted by Fisher information.
        """
        loss = torch.tensor(0.0, device=next(self.model.parameters()).device)
        if not self.fisher_matrix:
            return loss

        for name, param in self.model.named_parameters():
            if name in self.fisher_matrix and name in self.optimal_params:
                fisher = self.fisher_matrix[name]
                opt = self.optimal_params[name]
                loss += (fisher * (param - opt) ** 2).sum()

        return (self.ewc_lambda / 2.0) * loss

    def get_fisher_diagnostics(self) -> dict:
        """
        Returns statistical summary of Fisher weights for UI telemetry.
        """
        if not self.fisher_matrix:
            return {"status": "uninitialized", "mean_rigidity": 0.0, "max_rigidity": 0.0}

        all_fishers = torch.cat([f.view(-1) for f in self.fisher_matrix.values()])
        return {
            "status": "active",
            "mean_rigidity": float(all_fishers.mean().cpu()),
            "max_rigidity": float(all_fishers.max().cpu()),
            "min_rigidity": float(all_fishers.min().cpu()),
            "histogram": torch.histc(torch.log1p(all_fishers), bins=10).cpu().tolist()
        }


class ReplayBuffer:
    """
    Circular Prioritized Replay Buffer:
    Maintains anchor samples to preserve syntax and conversational grounding during continuous learning.
    """

    def __init__(self, capacity: int = 500):
        self.capacity = capacity
        self.buffer = []
        self.position = 0

    def push(self, sample: dict):
        if len(self.buffer) < self.capacity:
            self.buffer.append(sample)
        else:
            self.buffer[self.position] = sample
        self.position = (self.position + 1) % self.capacity

    def sample(self, batch_size: int) -> list[dict]:
        actual_size = min(len(self.buffer), batch_size)
        return random.sample(self.buffer, actual_size)

    def __len__(self):
        return len(self.buffer)
