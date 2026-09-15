"""
Model Exporter & Telemetry Generator for MakeAI Frontend Integration.
Exports:
  1. KAN Spline profiles & curves
  2. SOM Topological clustering coordinates
  3. Fisher Rigidity histogram
  4. Static JSON telemetry for Fastify & React Canvas Visualizer
"""

import json
import os
import torch
from architecture import MakeAIKANConversationalModel
from distill_train import run_training_simulation


def export_telemetry_for_frontend():
    print("Simulating neural training and capturing KAN telemetry...")
    train_results = run_training_simulation(num_steps=12, hidden_dim=64, vocab_size=512)

    model = MakeAIKANConversationalModel(
        vocab_size=512,
        hidden_dim=64,
        max_seq_len=32,
        num_experts=4,
        top_k=2
    )

    # Sample input for forward telemetry
    sample_input = torch.randint(0, 512, (2, 16))
    with torch.no_grad():
        logits, telemetry = model(sample_input)

    # Extract spline profiles from experts
    expert_splines = []
    for i, expert in enumerate(model.experts):
        prof = expert.kan1.get_spline_profile(num_points=60)
        prof["expert_id"] = i
        prof["title"] = f"Ekspert KAN #{i+1} (B-spline Layer 1)"
        expert_splines.append(prof)

    # Aggregator spline
    agg_spline = model.aggregator.get_spline_profile(num_points=60)
    agg_spline["expert_id"] = "aggregator"
    agg_spline["title"] = "Warstwa Końcowa Agregatora (B-spline)"
    expert_splines.append(agg_spline)

    # SOM Prototypes 2D projection (PCA or first 2 dimensions)
    prototypes = model.router.prototypes.detach()
    # Simple 2D projection
    som_coords = []
    for k in range(prototypes.size(0)):
        vec = prototypes[k]
        som_coords.append({
            "expert_id": k,
            "name": f"Mikro-Ekspert #{k+1}",
            "x": float(vec[0].item()),
            "y": float(vec[1].item()),
            "norm": float(torch.norm(vec).item())
        })

    telemetry_payload = {
        "status": "ready",
        "architecture": "Kolmogorov-Arnold Network (KAN) + SOM Router + EWC",
        "activation_function": "Mish: x * tanh(ln(1 + e^x))",
        "spline_degree": 3,
        "grid_size": 5,
        "model_summary": model.count_parameters(),
        "som_topological_map": som_coords,
        "spline_profiles": expert_splines,
        "fisher_diagnostics": train_results.get("fisher_diagnostics", {}),
        "distillation_metrics": {
            "initial_loss": train_results.get("initial_loss"),
            "final_loss": train_results.get("final_loss"),
            "loss_history": train_results.get("loss_progression")
        }
    }

    # Save to neural-core
    out_dir = os.path.dirname(__file__)
    out_path = os.path.join(out_dir, "kan_telemetry.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(telemetry_payload, f, indent=2, ensure_ascii=False)
    print(f"Exported telemetry to {out_path}")

    # Copy to server public / client public for direct web access
    client_public_path = os.path.abspath(os.path.join(out_dir, "..", "client", "public", "kan_telemetry.json"))
    with open(client_public_path, "w", encoding="utf-8") as f:
        json.dump(telemetry_payload, f, indent=2, ensure_ascii=False)
    print(f"Copied telemetry to {client_public_path}")

    return telemetry_payload


if __name__ == "__main__":
    export_telemetry_for_frontend()
