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
from precision_ops import FocalLossOHEM, compute_orthogonal_regularization, StochasticWeightAveraging
from teacher_client import OllamaTeacherClient


class EnhancedDistillationLoss(nn.Module):
    """
    Combined Soft-Target Distillation Loss + Focal Loss with OHEM:
      L = (1 - alpha) * L_Focal(student, y) + alpha * T^2 * KL(softmax(teacher/T) || softmax(student/T))
    """

    def __init__(self, temperature: float = 2.0, alpha: float = 0.6, gamma: float = 2.0, ohem_ratio: float = 0.35):
        super().__init__()
        self.temperature = temperature
        self.alpha = alpha
        self.focal = FocalLossOHEM(gamma=gamma, ohem_ratio=ohem_ratio)
        self.kl = nn.KLDivLoss(reduction="batchmean")

    def forward(self, student_logits: torch.Tensor, teacher_logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        b, t, v = student_logits.size()
        s_flat = student_logits.view(-1, v)
        t_flat = teacher_logits.view(-1, v)

        # 1. Focal Loss with OHEM for hard conversational tokens
        loss_focal = self.focal(student_logits, targets)

        # 2. Soft Dark Knowledge transfer via KL-Divergence
        p_teacher = F.softmax(t_flat / self.temperature, dim=-1)
        log_p_student = F.log_softmax(s_flat / self.temperature, dim=-1)
        loss_kl = self.kl(log_p_student, p_teacher) * (self.temperature ** 2)

        return (1.0 - self.alpha) * loss_focal + self.alpha * loss_kl


def run_training_simulation(
    num_steps: int = 15,
    vocab_size: int = 256,
    seq_len: int = 16,
    batch_size: int = 4,
    hidden_dim: int = 64
) -> dict:
    """
    Simulates distillation training loop with SAM, EWC, Focal Loss/OHEM,
    Orthogonal Regularization, SWA, and Ollama Teacher Client.
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
    criterion = EnhancedDistillationLoss(temperature=2.0, alpha=0.6, gamma=2.0, ohem_ratio=0.35)

    # Stochastic Weight Averaging (SWA)
    swa = StochasticWeightAveraging(model)

    # Teacher Client (Ollama or mathematical fallback)
    teacher = OllamaTeacherClient()

    # Replay buffer & EWC
    replay_buffer = ReplayBuffer(capacity=50)
    ewc = EWC(model, ewc_lambda=200.0)

    history_losses = []

    for step in range(num_steps):
        inputs = torch.randint(0, vocab_size, (batch_size, seq_len), device=device)
        targets = torch.randint(0, vocab_size, (batch_size, seq_len), device=device)

        # Teacher soft targets
        with torch.no_grad():
            teacher_logits = teacher.generate_soft_targets(batch_size, seq_len, vocab_size, device=device)

        # First forward-backward pass (Ascent step in SAM)
        model.zero_grad()
        student_logits, _ = model(inputs)
        loss = criterion(student_logits, teacher_logits, targets) + ewc.penalty() + compute_orthogonal_regularization(model, beta=1e-4)
        loss.backward()
        optimizer.first_step(zero_grad=True)

        # Second forward-backward pass (Gradient at perturbed point)
        student_logits_ascent, _ = model(inputs)
        loss_ascent = criterion(student_logits_ascent, teacher_logits, targets) + ewc.penalty() + compute_orthogonal_regularization(model, beta=1e-4)
        loss_ascent.backward()
        optimizer.second_step(zero_grad=True)

        # SWA: accumulate weights in second half of training
        if step >= num_steps // 2:
            swa.update()

        history_losses.append(float(loss.item()))
        replay_buffer.push({"input": inputs.cpu(), "target": targets.cpu()})

    # Apply SWA weights to model
    swa.apply_to_model()

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
        "model_summary": model.count_parameters(),
        "swa_models_accumulated": swa.n_models,
        "teacher_online": teacher.is_connected
    }


if __name__ == "__main__":
    print("Running training and distillation simulation...")
    results = run_training_simulation(num_steps=10)
    print(json.dumps(results, indent=2))

