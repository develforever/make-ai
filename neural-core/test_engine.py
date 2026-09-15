"""
Comprehensive Test Suite for Neural Core Engine.
Verifies:
  1. KANLayer: B-splines, Mish, gradient flow
  2. SOMRouter: Topological distance, Top-K gating
  3. EWC: Fisher Information Matrix & quadratic penalty
  4. SAM: Two-step perturbation and update
  5. Full Conversational Model Integration
"""

import unittest
import torch
import torch.nn as nn
import torch.nn.functional as F

from kan_layer import KANLinear, mish, b_splines
from som_router import SOMRouter
from ewc_memory import EWC
from sam_optimizer import SAM
from architecture import MakeAIKANConversationalModel


class TestNeuralEngine(unittest.TestCase):

    def test_01_mish_activation(self):
        """Mish should be smooth, continuous, and pass zero through."""
        x = torch.tensor([-2.0, 0.0, 2.0], requires_grad=True)
        y = mish(x)
        self.assertAlmostEqual(y[1].item(), 0.0, places=5)
        # Test gradient propagation
        loss = y.sum()
        loss.backward()
        self.assertIsNotNone(x.grad)
        self.assertTrue(torch.all(torch.isfinite(x.grad)))

    def test_02_kan_linear_layer(self):
        """KANLinear should correctly perform non-linear edge transformations and backprop."""
        batch_size = 4
        in_dim = 8
        out_dim = 16
        layer = KANLinear(in_dim, out_dim, grid_size=5, spline_order=3)

        x = torch.randn(batch_size, in_dim, requires_grad=True)
        out = layer(x)

        self.assertEqual(out.shape, (batch_size, out_dim))
        self.assertTrue(torch.all(torch.isfinite(out)))

        loss = out.sum()
        loss.backward()

        self.assertIsNotNone(layer.base_weight.grad)
        self.assertIsNotNone(layer.spline_weight.grad)
        self.assertTrue(torch.all(torch.isfinite(layer.spline_weight.grad)))

    def test_03_som_router(self):
        """SOMRouter should return valid Top-K normalized gating weights."""
        batch_size = 6
        embed_dim = 16
        num_experts = 4
        top_k = 2

        router = SOMRouter(embed_dim=embed_dim, num_experts=num_experts, top_k=top_k)
        x = torch.randn(batch_size, embed_dim)

        weights, indices, aux = router(x)

        self.assertEqual(weights.shape, (batch_size, top_k))
        self.assertEqual(indices.shape, (batch_size, top_k))
        # Top-K weights should sum to ~1.0
        weight_sums = weights.sum(dim=-1)
        for s in weight_sums:
            self.assertAlmostEqual(s.item(), 1.0, places=4)
        self.assertIn("expert_usage", aux)

    def test_04_ewc_memory(self):
        """EWC should calculate Fisher information and penalize parameter shifts."""
        model = nn.Sequential(nn.Linear(8, 8), nn.ReLU(), nn.Linear(8, 2))
        ewc = EWC(model, ewc_lambda=100.0)

        # Register task with dummy data
        dummy_x = torch.randn(10, 8)
        dummy_y = torch.randint(0, 2, (10,))
        loader = [(dummy_x, dummy_y)]
        criterion = nn.CrossEntropyLoss()

        ewc.register_consolidated_task(loader, criterion)
        self.assertTrue(len(ewc.fisher_matrix) > 0)

        # Initially parameter drift is 0 -> penalty is 0
        self.assertAlmostEqual(ewc.penalty().item(), 0.0, places=5)

        # Perturb a parameter -> penalty should strictly increase
        with torch.no_grad():
            for p in model.parameters():
                p.add_(0.5)

        penalty_val = ewc.penalty().item()
        self.assertGreater(penalty_val, 0.0)

    def test_05_sam_optimizer(self):
        """SAM optimizer should perturb in ascent direction and restore on second step."""
        model = nn.Linear(4, 2)
        optimizer = SAM(model.parameters(), torch.optim.SGD, lr=0.1, rho=0.05)

        x = torch.randn(2, 4)
        y = torch.randn(2, 2)

        # Step 1
        out = model(x)
        loss = F.mse_loss(out, y)
        loss.backward()
        optimizer.first_step(zero_grad=True)

        # Step 2
        out_ascent = model(x)
        loss_ascent = F.mse_loss(out_ascent, y)
        loss_ascent.backward()
        optimizer.second_step(zero_grad=True)

        self.assertTrue(torch.all(torch.isfinite(model.weight)))

    def test_06_full_kan_conversational_model(self):
        """End-to-end integration test of MakeAI KAN conversational architecture."""
        model = MakeAIKANConversationalModel(
            vocab_size=128,
            hidden_dim=32,
            max_seq_len=16,
            num_experts=4,
            top_k=2
        )

        input_ids = torch.randint(0, 128, (2, 8))
        logits, telemetry = model(input_ids)

        self.assertEqual(logits.shape, (2, 8, 128))
        self.assertIn("sample_spline", telemetry)
        self.assertIn("router", telemetry)
        self.assertIn("total_params", telemetry)

        # Verify summary
        summary = model.count_parameters()
        self.assertGreater(summary["kan_spline_parameters"], 0)

    def test_07_precision_ops_and_distillation(self):
        """Verify FocalLoss with OHEM, Orthogonal Regularization, and SWA."""
        from precision_ops import FocalLossOHEM, compute_orthogonal_regularization, StochasticWeightAveraging
        from teacher_client import OllamaTeacherClient

        logits = torch.randn(4, 10, 32, requires_grad=True)
        targets = torch.randint(0, 32, (4, 10))

        # 1. Focal Loss OHEM
        criterion = FocalLossOHEM(gamma=2.0, ohem_ratio=0.5)
        loss = criterion(logits, targets)
        loss.backward()
        self.assertTrue(torch.isfinite(loss))
        self.assertIsNotNone(logits.grad)

        # 2. Orthogonal Regularization
        toy_model = nn.Sequential(nn.Linear(16, 16))
        toy_model[0].base_weight = nn.Parameter(torch.eye(16))
        ortho = compute_orthogonal_regularization(toy_model, beta=1.0)
        self.assertAlmostEqual(ortho.item(), 0.0, places=4)

        # 3. SWA
        swa = StochasticWeightAveraging(toy_model)
        toy_model[0].base_weight.data += 1.0
        swa.update()
        self.assertEqual(swa.n_models, 1)

        # 4. Teacher client fallback
        teacher = OllamaTeacherClient()
        soft = teacher.generate_soft_targets(2, 4, 32)
        self.assertEqual(soft.shape, (2, 4, 32))


if __name__ == "__main__":
    unittest.main()

