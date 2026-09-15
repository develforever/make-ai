"""
Knowledge Distillation & Continual Training Pipeline for MakeAI KAN Model.
Integrates:
  1. Teacher Logits Distillation (KL-Divergence)
  2. SAM (Sharpness-Aware Minimization) Optimization
  3. EWC Consolidation Step
"""

import json
import os
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, TensorDataset

from architecture import MakeAIKANConversationalModel
from sam_optimizer import SAM
from ewc_memory import EWC, ReplayBuffer


class DistillationLoss(nn.Module):
    """
    Combined Soft-Target Distillation Loss + Cross Entropy:
      L = (1 - alpha) * L_CE(student, y) + alpha * T^2 * KL(softmax(teacher/T) || softmax(student/T))
    """

    def __init__(self, temperature: float = 2.0, alpha: float = 0.7):
        super().__init__()
        self.temperature = temperature
        self.alpha = alpha
        self.ce = nn.CrossEntropyLoss()
        self.kl = nn.KLDivLoss(reduction="batchmean")

    def forward(self, student_logits: torch.Tensor, teacher_logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        b, t, v = student_logits.size()
        s_flat = student_logits.view(-1, v)
        t_flat = teacher_logits.view(-1, v)
        y_flat = targets.view(-1)

        # 1. Hard Cross Entropy
        loss_ce = self.ce(s_flat, y_flat)

        # 2. Soft KL-Divergence
        p_teacher = F.softmax(t_flat / self.temperature, dim=-1)
        log_p_student = F.log_softmax(s_flat / self.temperature, dim=-1)
        loss_kl = self.kl(log_p_student, p_teacher) * (self.temperature ** 2)

        return (1.0 - self.alpha) * loss_ce + self.alpha * loss_kl


def run_training_simulation(
    num_steps: int = 15,
    vocab_size: int = 256,
    seq_len: int = 16,
    batch_size: int = 4,
    hidden_dim: int = 64
) -> dict:
    """
    Simulates distillation training loop using synthetic teacher distributions,
    verifying SAM optimizer updates and EWC consolidation.
    """
    device = torch.device("cpu")
    model = MakeAIKANConversationalModel(
        vocab_size=vocab_size,
        hidden_dim=hidden_dim,
        max_seq_len=seq_len,
        num_experts=4,
        top_k=2
    ).to(device)

    # SAM optimizer with AdamW as base
    base_optimizer = torch.optim.AdamW
    optimizer = SAM(model.parameters(), base_optimizer, lr=1e-3, rho=0.05, weight_decay=1e-4)
    criterion = DistillationLoss(temperature=2.0, alpha=0.6)

    # Replay buffer & EWC
    replay_buffer = ReplayBuffer(capacity=50)
    ewc = EWC(model, ewc_lambda=200.0)

    # Synthetic conversational batches
    history_losses = []

    for step in range(num_steps):
        # Generate synthetic input & target
        inputs = torch.randint(0, vocab_size, (batch_size, seq_len), device=device)
        targets = torch.randint(0, vocab_size, (batch_size, seq_len), device=device)
        # Synthetic teacher logits (e.g. from local Ollama teacher)
        with torch.no_grad():
            teacher_logits = torch.randn(batch_size, seq_len, vocab_size, device=device)

        # First forward-backward pass (Ascent step in SAM)
        model.zero_grad()
        student_logits, telemetry = model(inputs)
        loss = criterion(student_logits, teacher_logits, targets) + ewc.penalty()
        loss.backward()
        optimizer.first_step(zero_grad=True)

        # Second forward-backward pass (Gradient at perturbed point)
        student_logits_ascent, _ = model(inputs)
        loss_ascent = criterion(student_logits_ascent, teacher_logits, targets) + ewc.penalty()
        loss_ascent.backward()
        optimizer.second_step(zero_grad=True)

        history_losses.append(float(loss.item()))
        replay_buffer.push({"input": inputs.cpu(), "target": targets.cpu()})

    # Consolidate foundational knowledge via Fisher Information Matrix
    sample_inputs = torch.randint(0, vocab_size, (8, seq_len), device=device)
    sample_targets = torch.randint(0, vocab_size, (8, seq_len), device=device)
    dummy_loader = DataLoader(TensorDataset(sample_inputs, sample_targets), batch_size=4)

    def simple_loss(out, y):
        if isinstance(out, tuple):
            out = out[0]
        return F.cross_entropy(out.view(-1, vocab_size), y.view(-1))

    ewc.register_consolidated_task(dummy_loader, simple_loss, device=device)
    fisher_stats = ewc.get_fisher_diagnostics()

    checkpoint_dir = os.path.join(os.path.dirname(__file__), "checkpoints")
    os.makedirs(checkpoint_dir, exist_ok=True)
    checkpoint_path = os.path.join(checkpoint_dir, "kan_conversational.pt")
    torch.save({
        "model_state": model.state_dict(),
        "fisher_matrix": ewc.fisher_matrix,
        "config": model.count_parameters()
    }, checkpoint_path)

    return {
        "final_loss": history_losses[-1],
        "initial_loss": history_losses[0],
        "loss_progression": history_losses,
        "checkpoint_path": checkpoint_path,
        "fisher_diagnostics": fisher_stats,
        "model_summary": model.count_parameters()
    }


if __name__ == "__main__":
    print("Running training and distillation simulation...")
    results = run_training_simulation(num_steps=10)
    print(json.dumps(results, indent=2))
