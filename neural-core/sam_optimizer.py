"""
Sharpness-Aware Minimization (SAM) Optimizer Wrapper.
Simultaneously minimizes loss value and loss sharpness to seek flat minima in non-convex loss landscapes.
Mathematical basis:
  min_w max_{||epsilon|| <= rho} L(w + epsilon)
"""

import torch


class SAM(torch.optim.Optimizer):
    def __init__(self, params, base_optimizer_cls, rho: float = 0.05, adaptive: bool = False, **kwargs):
        assert rho >= 0.0, f"Invalid rho, should be non-negative: {rho}"
        defaults = dict(rho=rho, adaptive=adaptive, **kwargs)
        super(SAM, self).__init__(params, defaults)

        self.base_optimizer = base_optimizer_cls(self.param_groups, **kwargs)
        self.param_groups = self.base_optimizer.param_groups
        self.defaults.update(self.base_optimizer.defaults)

    @torch.no_grad()
    def first_step(self, zero_grad: bool = False):
        """
        Step 1: Ascends to the worst-case local perturbation point w + epsilon.
        """
        grad_norm = self._grad_norm()
        for group in self.param_groups:
            scale = group["rho"] / (grad_norm + 1e-12)

            for p in group["params"]:
                if p.grad is None:
                    continue
                self.state[p]["old_p"] = p.data.clone()
                e_w = (torch.pow(p, 2) if group["adaptive"] else 1.0) * p.grad * scale.to(p)
                p.add_(e_w)  # Climb to local ascent

        if zero_grad:
            self.zero_grad()

    @torch.no_grad()
    def second_step(self, zero_grad: bool = False):
        """
        Step 2: Restores weights w and performs optimizer update using gradient from ascent point.
        """
        for group in self.param_groups:
            for p in group["params"]:
                if p.grad is None:
                    continue
                p.data = self.state[p]["old_p"]  # Restore original parameter

        self.base_optimizer.step()

        if zero_grad:
            self.zero_grad()

    @torch.no_grad()
    def step(self, closure=None):
        """
        Standard step wrapper when closure is provided.
        """
        assert closure is not None, "SAM requires a closure that re-evaluates the model"
        closure = torch.enable_grad()(closure)

        loss = closure()
        self.first_step(zero_grad=True)
        closure()
        self.second_step()
        return loss

    def _grad_norm(self):
        shared_device = self.param_groups[0]["params"][0].device
        stack = []
        for group in self.param_groups:
            for p in group["params"]:
                if p.grad is not None:
                    factor = torch.abs(p) if group["adaptive"] else 1.0
                    stack.append((factor * p.grad).norm(p=2).to(shared_device))
        norm = torch.norm(torch.stack(stack), p=2)
        return norm

    def load_state_dict(self, state_dict):
        super().load_state_dict(state_dict)
        self.base_optimizer.param_groups = self.param_groups
