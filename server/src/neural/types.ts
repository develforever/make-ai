/**
 * TypeScript Data Structures & Interfaces for MakeAI KAN Architecture
 * As specified in the Gemini Architectural Blueprint.
 */

export interface NetworkConfig {
  vocabSize: number;
  embeddingDim: number;
  expertsCount: number;
  learningRate: number;
  ewcLambda: number; // Hiperparametr dla Elastic Weight Consolidation
}

export interface ForwardResult {
  logits: Float32Array;
  routeIndices: number[];
  hiddenStates: Float32Array[];
}

export interface SplineGridConfig {
  gridSize: number;
  splineOrder: number;
  gridRange: [number, number];
}

export interface FisherDiagnostic {
  meanRigidity: number;
  maxRigidity: number;
  status: 'active' | 'uninitialized';
}
