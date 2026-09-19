/**
 * MakeAI Neural Core - TypeScript Runtime & Distillation Bridge
 * Implements the 5-phase blueprint from the Gemini architecture session:
 *   1. LocalTeacherLLM (Ollama teacher distillation)
 *   2. SOMRouter (Topological Best Matching Unit routing)
 *   3. KANLayer (Cubic B-splines on edges with Mish)
 *   4. EWCOptimizer & ReplayBuffer (Continual Learning & Fisher Matrix)
 *   5. TrainingLoop (Sharpness-Aware Minimization & Knowledge Distillation)
 */

export * from './types.js';
export * from './SemanticEncoder.js';
export * from './LocalTeacherLLM.js';
export * from './SOMRouter.js';
export * from './KANLayer.js';
export * from './EWCOptimizer.js';
export * from './TrainingLoop.js';
export * from './kanService.js';

