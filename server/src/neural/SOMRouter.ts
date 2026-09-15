/**
 * SOMRouter (Faza 2: Implementacja bramkowania SOM Routing).
 * Projects embedding vectors onto a Self-Organizing Map topological lattice,
 * routing tokens to the Best Matching Unit (BMU) expert to enforce sparsity.
 */

export class SOMRouter {
  private weights: Float32Array[]; // Prototypes / centroid vectors

  constructor(private readonly inputDim: number, private readonly numExperts: number) {
    this.weights = [];
    for (let e = 0; e < numExperts; e++) {
      const centroid = new Float32Array(inputDim);
      for (let d = 0; d < inputDim; d++) {
        // Orthogonal initialization
        centroid[d] = (Math.sin(e * 1.5 + d * 0.3) / Math.sqrt(inputDim));
      }
      this.weights.push(centroid);
    }
  }

  public route(input: Float32Array): number {
    return this.findBMU(input);
  }

  public routeTopK(input: Float32Array, k: number = 2): { indices: number[]; weights: number[] } {
    const distances: { index: number; dist: number }[] = [];
    for (let e = 0; e < this.numExperts; e++) {
      const dist = this.euclideanDistance(input, this.weights[e]);
      distances.push({ index: e, dist });
    }

    distances.sort((a, b) => a.dist - b.dist);
    const top = distances.slice(0, k);

    // Softmax over negative distances (Gaussian similarity)
    let sumSim = 0;
    const sims = top.map((t) => {
      const sim = Math.exp(-t.dist * 0.5);
      sumSim += sim;
      return sim;
    });

    return {
      indices: top.map((t) => t.index),
      weights: sims.map((s) => s / sumSim)
    };
  }

  private findBMU(input: Float32Array): number {
    let bestIndex = 0;
    let minDistance = Infinity;

    for (let e = 0; e < this.numExperts; e++) {
      const dist = this.euclideanDistance(input, this.weights[e]);
      if (dist < minDistance) {
        minDistance = dist;
        bestIndex = e;
      }
    }

    return bestIndex;
  }

  private euclideanDistance(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  public getPrototypes(): { expertId: number; coords: number[] }[] {
    return this.weights.map((w, idx) => ({
      expertId: idx,
      coords: Array.from(w.slice(0, 4))
    }));
  }
}
