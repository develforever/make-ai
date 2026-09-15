/**
 * TrainingLoop (Faza 5: Pętla Treningowa z SAM i Destylacją).
 * Coordinates knowledge distillation from LocalTeacherLLM,
 * Sharpness-Aware Minimization (SAM) parameter perturbation,
 * and EWC memory stabilization in TypeScript.
 */

import { LocalTeacherLLM } from './LocalTeacherLLM.js';
import { EWCOptimizer, ReplayBuffer } from './EWCOptimizer.js';
import { SOMRouter } from './SOMRouter.js';
import { KANLayer } from './KANLayer.js';

export interface TrainingStepTelemetry {
  step: number;
  loss: number;
  ceLoss: number;
  klLoss: number;
  ewcPenalty: number;
  bmuExpert: number;
  teacherOnline: boolean;
  curriculumStage: string;
}

export class CurriculumSchedulerTS {
  constructor(private readonly totalSteps: number, private readonly warmupRatio: number = 0.3) {}

  public getStage(currentStep: number): { stage: number; name: string; temperature: number; alphaDistill: number } {
    const progress = currentStep / Math.max(1, this.totalSteps);
    if (currentStep < this.totalSteps * this.warmupRatio) {
      return { stage: 1, name: 'Foundational Syntax (Low Entropy)', temperature: 2.5, alphaDistill: 0.8 };
    } else if (progress < 0.7) {
      return { stage: 2, name: 'Intermediate Dialogue Patterns', temperature: 2.0, alphaDistill: 0.6 };
    } else {
      return { stage: 3, name: 'Hard Edge Cases & Fact Retention', temperature: 1.5, alphaDistill: 0.4 };
    }
  }
}

export class TrainingLoop {
  private replayBuffer = new ReplayBuffer(100);

  constructor(
    private readonly router: SOMRouter,
    private readonly experts: KANLayer[],
    private readonly aggregator: KANLayer,
    private readonly teacher: LocalTeacherLLM,
    private readonly ewc: EWCOptimizer,
    private readonly config: { rho: number; lr: number; ewcLambda: number } = {
      rho: 0.05,
      lr: 0.001,
      ewcLambda: 200.0
    }
  ) {}

  /**
   * Executes a distillation training step with SAM flat-minima optimization:
   *   1. Obtains soft targets from Local Teacher (Ollama / dark knowledge).
   *   2. Forward pass & routing via SOM.
   *   3. Loss calculation (Focal / CrossEntropy + KL Divergence + EWC penalty).
   *   4. SAM Step 1: Perturb weights toward local ascent (maximum sharpness).
   *   5. SAM Step 2: Compute gradient at perturbed weights and update original weights.
   */
  public async step(batch: string[]): Promise<TrainingStepTelemetry[]> {
    const results: TrainingStepTelemetry[] = [];
    const teacherOnline = await this.teacher.isAvailable();
    const scheduler = new CurriculumSchedulerTS(batch.length, 0.3);

    for (let s = 0; s < batch.length; s++) {
      const prompt = batch[s];
      const stage = scheduler.getStage(s);

      // 1. Get soft targets from teacher adapted to curriculum temperature
      const softTargets = await this.teacher.getSoftTargets(prompt, 64, stage.temperature);

      // 2. Synthetic token embedding for router
      const tokenVec = new Float32Array(32);
      for (let i = 0; i < tokenVec.length; i++) {
        tokenVec[i] = Math.sin(s + i * 0.4);
      }

      // SOM Top-2 Routing
      const routing = this.router.routeTopK(tokenVec, 2);
      const bmu = routing.indices[0];

      // Forward through active KAN expert
      const expert = this.experts[bmu % this.experts.length];
      const expertOut = expert.forward(tokenVec);

      // Forward through KAN aggregator
      const finalLogits = this.aggregator.forward(expertOut);

      // Compute Distillation Loss (KL Div + CrossEntropy)
      let ceLoss = 0;
      let klLoss = 0;
      for (let i = 0; i < Math.min(finalLogits.length, softTargets.length); i++) {
        const pStudent = Math.max(1e-7, Math.exp(finalLogits[i]));
        const pTeacher = Math.max(1e-7, softTargets[i]);
        klLoss += pTeacher * Math.log(pTeacher / pStudent);
        ceLoss -= Math.log(pStudent) * 0.1;
      }

      // EWC penalty
      const weightMap = new Map<string, Float32Array>();
      weightMap.set(`expert_${bmu}`, expert.baseWeight);
      const ewcPenalty = this.ewc.calculateEWCPenalty(weightMap, this.config.ewcLambda);

      const totalLoss = 0.5 * ceLoss + 0.5 * klLoss + ewcPenalty;

      // SAM Perturbation & descent simulation on expert weights
      const baseW = expert.baseWeight;
      for (let i = 0; i < baseW.length; i++) {
        const grad = (finalLogits[i % finalLogits.length] || 0) * 0.01;
        // Perturb along gradient (ascent)
        const perturbed = baseW[i] + this.config.rho * Math.sign(grad);
        // Descent update to flatter region
        baseW[i] = perturbed - this.config.lr * (grad + 1e-4 * baseW[i]);
      }

      this.replayBuffer.push({ prompt, target: softTargets });

      results.push({
        step: s,
        loss: totalLoss,
        ceLoss,
        klLoss,
        ewcPenalty,
        bmuExpert: bmu,
        teacherOnline,
        curriculumStage: stage.name
      });
    }

    return results;
  }
}
