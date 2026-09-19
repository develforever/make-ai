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

export interface KanPolicyDecision {
  expertIndex: number;
  expertName: string;
  confidence: number;
  temperatureMod: number;
  memoryTopK: number;
  ethicsWeight: number;
}

export interface RewardFeedback {
  query: string;
  responseLength: number;
  userSatisfaction: number;
  tokenCostUsd: number;
  factualConsistency: number;
}

export interface DreamConsolidationResult {
  synthesizedAxiom: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

