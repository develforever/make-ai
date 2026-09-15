/**
 * KANLayer (Faza 3: Budowa rdzenia KAN - Kolmogorov-Arnold Network).
 * Implements non-linear activation functions on graph edges using cubic B-splines
 * and smooth Mish activation instead of rigid node activations.
 */

export function mishActivation(x: number): number {
  return x * Math.tanh(Math.log(1 + Math.exp(Math.max(-20, Math.min(20, x)))));
}

export class KANLayer {
  private inDim: number;
  private outDim: number;
  private gridSize: number;
  private splineOrder: number;

  // Base weights for residual Mish activation
  public baseWeight: Float32Array;
  // Spline coefficients for edge polynomials
  public splineCoeffs: Float32Array;
  // Knot vector for B-splines
  private grid: Float32Array;

  constructor(inDim: number, outDim: number, gridSize: number = 5, splineOrder: number = 3) {
    this.inDim = inDim;
    this.outDim = outDim;
    this.gridSize = gridSize;
    this.splineOrder = splineOrder;

    // Allocate base weights [outDim * inDim]
    this.baseWeight = new Float32Array(outDim * inDim);
    const scale = Math.sqrt(2.0 / (inDim + outDim));
    for (let i = 0; i < this.baseWeight.length; i++) {
      this.baseWeight[i] = (Math.random() * 2 - 1) * scale;
    }

    // Allocate spline coefficients [outDim * inDim * (gridSize + splineOrder)]
    const numCoeffsPerEdge = gridSize + splineOrder;
    this.splineCoeffs = new Float32Array(outDim * inDim * numCoeffsPerEdge);
    for (let i = 0; i < this.splineCoeffs.length; i++) {
      this.splineCoeffs[i] = (Math.random() * 2 - 1) * 0.1;
    }

    // Uniform grid points from -1.0 to +1.0
    const numKnots = gridSize + 2 * splineOrder + 1;
    this.grid = new Float32Array(numKnots);
    const step = 2.0 / gridSize;
    const start = -1.0 - splineOrder * step;
    for (let i = 0; i < numKnots; i++) {
      this.grid[i] = start + i * step;
    }
  }

  /**
   * Forward pass:
   *   y_j = sum_i [ baseWeight_{ji} * Mish(x_i) + sum_p coeff_{jip} * B_p(x_i) ]
   */
  public forward(input: Float32Array): Float32Array {
    const output = new Float32Array(this.outDim);
    const numCoeffsPerEdge = this.gridSize + this.splineOrder;

    for (let j = 0; j < this.outDim; j++) {
      let acc = 0;
      for (let i = 0; i < this.inDim; i++) {
        const x = input[i] || 0;
        // 1. Base Mish component
        const base = this.baseWeight[j * this.inDim + i] * mishActivation(x);

        // 2. Approximate cubic B-spline response
        const splineSum = this.evalSplineEdge(x, j, i, numCoeffsPerEdge);

        acc += base + splineSum;
      }
      output[j] = acc;
    }

    return output;
  }

  private evalSplineEdge(x: number, j: number, i: number, numCoeffs: number): number {
    let sum = 0;
    const baseOffset = (j * this.inDim + i) * numCoeffs;
    // Cubic bell-shaped basis approximation around knot intervals
    for (let p = 0; p < numCoeffs; p++) {
      const knot = this.grid[p + 1] || 0;
      const dist = Math.abs(x - knot);
      const basis = dist < 1.0 ? 0.5 * (1 + Math.cos(Math.PI * dist)) : 0;
      sum += this.splineCoeffs[baseOffset + p] * basis;
    }
    return sum;
  }
}
