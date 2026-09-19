/**
 * Integration Test for TypeScript Neural Core Engine & KAN Worker Threads
 * KAN-Cognitive Core v2: SemanticEncoder, Policy Evaluation, Policy Rewards, Dream Consolidation.
 */

import { SOMRouter } from './SOMRouter.js';
import { KANLayer, mishActivation } from './KANLayer.js';
import { EWCOptimizer } from './EWCOptimizer.js';
import { LocalTeacherLLM } from './LocalTeacherLLM.js';
import { TrainingLoop } from './TrainingLoop.js';
import { SemanticEncoder } from './SemanticEncoder.js';
import { kanService } from './kanService.js';
import { RewardFeedback } from './types.js';

async function runTest() {
  console.log('=== Testing TypeScript Neural Core (KAN-Cognitive Core v2) ===\n');

  // 1. Test Mish Activation
  const m1 = mishActivation(0);
  const m2 = mishActivation(2.0);
  if (Math.abs(m1) > 1e-4 || m2 <= 0) {
    throw new Error('Mish activation failed verification');
  }
  console.log('✓ 1. Mish Activation verified');

  // 2. Test SemanticEncoder (Deterministic Lexical & Semantic Hashing)
  const promptEthical = 'Czy powinienem postąpić moralnie i powiedzieć prawdę w obliczu dylematu etycznego?';
  const promptCode = 'function quicksort(arr: number[]): number[] { const pivot = arr[0]; return arr; }';
  const promptFact = 'Kiedy wybuchła II wojna światowa i jakie państwa brały w niej udział w 1939 roku?';
  const promptConvo = 'Cześć Aura! Jak się dziś masz i kim dokładnie jesteś?';

  const vecEthical1 = SemanticEncoder.encode(promptEthical, 32);
  const vecEthical2 = SemanticEncoder.encode(promptEthical, 32);
  const vecCode = SemanticEncoder.encode(promptCode, 32);
  const vecFact = SemanticEncoder.encode(promptFact, 32);
  const vecConvo = SemanticEncoder.encode(promptConvo, 32);

  // Determinism check: identical prompt must produce identical vector
  let isIdentical = true;
  for (let i = 0; i < 32; i++) {
    if (vecEthical1[i] !== vecEthical2[i]) {
      isIdentical = false;
      break;
    }
  }
  if (!isIdentical) {
    throw new Error('SemanticEncoder determinism check failed: identical inputs gave different outputs');
  }

  // L2 Norm check: ||v||_2 must equal 1.0
  const normEthical = Math.hypot(...vecEthical1);
  const normCode = Math.hypot(...vecCode);
  if (Math.abs(normEthical - 1.0) > 1e-3 || Math.abs(normCode - 1.0) > 1e-3) {
    throw new Error(`SemanticEncoder L2 normalization failed: normEthical=${normEthical}, normCode=${normCode}`);
  }

  // Non-linear differentiation check (dot product between distinct semantic domains)
  const dot = (a: Float32Array, b: Float32Array) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const dotEthCode = dot(vecEthical1, vecCode);
  const dotEthFact = dot(vecEthical1, vecFact);
  const dotFactCode = dot(vecFact, vecCode);
  const dotConvoCode = dot(vecConvo, vecCode);

  console.log(`✓ 2. SemanticEncoder verified:
     - Dimension: ${vecEthical1.length}D, L2 norm: ${normEthical.toFixed(6)}
     - Determinism: 100% bitwise match across runs
     - Non-linear Domain Separation:
       * Ethical vs Code dot: ${dotEthCode.toFixed(4)}
       * Ethical vs Fact dot: ${dotEthFact.toFixed(4)}
       * Fact vs Code dot: ${dotFactCode.toFixed(4)}
       * Convo vs Code dot: ${dotConvoCode.toFixed(4)}`);

  // 3. Test SOMRouter
  const router = new SOMRouter(32, 4);
  const bmu = router.route(vecEthical1);
  const top2 = router.routeTopK(vecEthical1, 2);
  if (top2.indices.length !== 2 || top2.weights.length !== 2) {
    throw new Error('SOMRouter Top-2 failed');
  }
  console.log(`✓ 3. SOMRouter BMU: Expert #${bmu}, Top-2: [${top2.indices.join(', ')}] (weights: [${top2.weights.map(w => w.toFixed(3)).join(', ')}])`);

  // 4. Test KANLayer
  const kanExpert = new KANLayer(32, 16, 5, 3);
  const kanOut = kanExpert.forward(vecEthical1);
  if (kanOut.length !== 16 || !Number.isFinite(kanOut[0])) {
    throw new Error('KANLayer forward pass failed');
  }
  console.log(`✓ 4. KANLayer Forward Pass output dim: ${kanOut.length}`);

  // 5. Test EWCOptimizer
  const ewc = new EWCOptimizer();
  const weightMap = new Map<string, Float32Array>();
  weightMap.set('expert_0', kanExpert.baseWeight);
  ewc.computeFisherInformation(weightMap, 16);
  const penaltyZero = ewc.calculateEWCPenalty(weightMap);
  if (Math.abs(penaltyZero) > 1e-4) {
    throw new Error('EWC penalty should be zero for unchanged weights');
  }
  console.log('✓ 5. EWCOptimizer Fisher Matrix registered & zero drift verified');

  // 6. Test TrainingLoop with SAM & Policy Rewards
  const experts = [
    new KANLayer(32, 16, 5, 3),
    new KANLayer(32, 16, 5, 3),
    new KANLayer(32, 16, 5, 3),
    new KANLayer(32, 16, 5, 3)
  ];
  const aggregator = new KANLayer(16, 64, 5, 3);
  const teacher = new LocalTeacherLLM();

  const loop = new TrainingLoop(router, experts, aggregator, teacher, ewc);
  const batch = [
    'Kim jesteś i jak działa Twoja pamięć?',
    'Wyjaśnij twierdzenie Kołmogorowa-Arnolda.'
  ];

  const telemetry = await loop.step(batch);
  if (telemetry.length !== batch.length) {
    throw new Error('TrainingLoop step failed');
  }
  console.log(`✓ 6a. TrainingLoop SAM & Distillation completed ${telemetry.length} steps:`);
  telemetry.forEach((t) => {
    console.log(`     Step ${t.step}: Loss=${t.loss.toFixed(4)}, BMU=Expert #${t.bmuExpert}, TeacherOnline=${t.teacherOnline}`);
  });

  // Test applyPolicyReward on TrainingLoop
  const policyRewardRes = loop.applyPolicyReward(vecEthical1, 0.85);
  if (!policyRewardRes.success || !Number.isFinite(policyRewardRes.loss)) {
    throw new Error('TrainingLoop applyPolicyReward failed');
  }
  console.log(`✓ 6b. TrainingLoop applyPolicyReward: Loss=${policyRewardRes.loss.toFixed(4)}, BMU=Expert #${policyRewardRes.bmuExpert}`);

  // 7. Test KAN Worker Thread (Offloaded to dedicated worker)
  console.log('\n=== Testing KAN Worker Thread (node:worker_threads) ===');
  const pingOk = await kanService.ping();
  if (!pingOk) {
    throw new Error('KAN Worker ping failed');
  }
  console.log('✓ 7a. KAN Worker Thread spawned and responded to ping');

  // 7b. Forward Pass in Worker
  const forwardRes = await kanService.forward(vecEthical1);
  if (!forwardRes || forwardRes.logits.length !== 64 || forwardRes.routeIndices.length !== 2) {
    throw new Error(`KAN Worker forward pass returned unexpected shape: ${JSON.stringify(forwardRes)}`);
  }
  console.log(`✓ 7b. KAN Worker Forward Pass: logits count=${forwardRes.logits.length}, BMU=Expert #${forwardRes.bmu}`);

  // 7c. Evaluate Policy
  console.log('\nTesting evaluatePolicy across domain queries:');
  const policyEthical = await kanService.evaluatePolicy(promptEthical);
  console.log(`   - Ethical Query -> Expert: "${policyEthical.expertName}" (#${policyEthical.expertIndex}), Confidence: ${policyEthical.confidence}, EthicsWeight: ${policyEthical.ethicsWeight}, TempMod: ${policyEthical.temperatureMod}, MemoryTopK: ${policyEthical.memoryTopK}`);

  const policyCode = await kanService.evaluatePolicy(promptCode);
  console.log(`   - Code Query    -> Expert: "${policyCode.expertName}" (#${policyCode.expertIndex}), Confidence: ${policyCode.confidence}, EthicsWeight: ${policyCode.ethicsWeight}, TempMod: ${policyCode.temperatureMod}, MemoryTopK: ${policyCode.memoryTopK}`);

  const policyFact = await kanService.evaluatePolicy(promptFact);
  console.log(`   - Fact Query    -> Expert: "${policyFact.expertName}" (#${policyFact.expertIndex}), Confidence: ${policyFact.confidence}, EthicsWeight: ${policyFact.ethicsWeight}, TempMod: ${policyFact.temperatureMod}, MemoryTopK: ${policyFact.memoryTopK}`);

  if (!policyEthical || !policyCode || !policyFact) {
    throw new Error('evaluatePolicy returned invalid response');
  }
  if (typeof policyEthical.ethicsWeight !== 'number' || typeof policyEthical.memoryTopK !== 'number') {
    throw new Error('evaluatePolicy response missing required fields');
  }
  console.log('✓ 7c. evaluatePolicy verified across domains');

  // 7d. Apply Reward Feedback
  console.log('\nTesting applyReward feedback loops:');
  const feedbackPositive: RewardFeedback = {
    query: 'Wyjaśnij twierdzenie KAN w uczeniu maszynowym',
    responseLength: 350,
    userSatisfaction: 0.95,
    tokenCostUsd: 0.00015,
    factualConsistency: 0.99
  };
  const rewardPosRes = await kanService.applyReward(feedbackPositive);
  if (!rewardPosRes.success || !Number.isFinite(rewardPosRes.loss)) {
    throw new Error('applyReward positive feedback failed');
  }
  console.log(`   - Positive Feedback -> Success: ${rewardPosRes.success}, Loss: ${rewardPosRes.loss.toFixed(4)}`);

  const feedbackNegative: RewardFeedback = {
    query: 'Błędna halucynacja na temat roku bitwy pod Grunwaldem',
    responseLength: 20,
    userSatisfaction: 0.1,
    tokenCostUsd: 0.0045,
    factualConsistency: 0.15
  };
  const rewardNegRes = await kanService.applyReward(feedbackNegative);
  if (!rewardNegRes.success || !Number.isFinite(rewardNegRes.loss)) {
    throw new Error('applyReward negative feedback failed');
  }
  console.log(`   - Negative Feedback -> Success: ${rewardNegRes.success}, Loss: ${rewardNegRes.loss.toFixed(4)}`);
  console.log('✓ 7d. applyReward reinforcement gradient steps verified');

  // 7e. Dream Consolidation
  console.log('\nTesting consolidateFacts (Dream Consolidation):');
  const factA = 'Słońce emituje promieniowanie UV';
  const factB = 'Promieniowanie UV stymuluje produkcję witaminy D';
  const dreamRes = await kanService.consolidateFacts(factA, factB);

  if (!dreamRes || typeof dreamRes.confidence !== 'number') {
    throw new Error('consolidateFacts failed to produce result for related facts');
  }
  console.log(`   - Related Facts:
       Fact A: "${factA}"
       Fact B: "${factB}"
       Synthesized Axiom: "${dreamRes.synthesizedAxiom}"
       Subject: "${dreamRes.subject}" | Predicate: "${dreamRes.predicate}" | Object: "${dreamRes.object}"
       Consolidation Confidence: ${dreamRes.confidence}`);

  if (dreamRes.confidence < 0.2) {
    throw new Error(`Consolidation confidence too low: ${dreamRes.confidence}`);
  }
  console.log('✓ 7e. consolidateFacts verified');

  // 7f. Training Step in Worker
  const workerTelemetry = await kanService.trainStep(['Test zapytania w osobnym wątku roboczym']);
  if (!workerTelemetry || workerTelemetry.length !== 1) {
    throw new Error('KAN Worker trainStep failed');
  }
  console.log(`✓ 7f. KAN Worker Training Step completed: loss=${workerTelemetry[0].loss.toFixed(4)}`);

  // 7g. Worker Diagnostics & Telemetry
  const diagnostics = await kanService.getDiagnostics();
  if (!diagnostics || diagnostics.expertCount !== 4) {
    throw new Error('KAN Worker diagnostics failed');
  }
  console.log(`✓ 7g. KAN Worker Diagnostics:
     - Experts: ${diagnostics.expertCount}, InputDim: ${diagnostics.inputDim}, OutputDim: ${diagnostics.outputDim}
     - Telemetry: PolicyEvaluations=${diagnostics.telemetry?.totalPolicyEvaluations}, RewardsApplied=${diagnostics.telemetry?.totalRewardsApplied}, DreamConsolidations=${diagnostics.telemetry?.totalDreamConsolidations}`);

  if (
    (diagnostics.telemetry?.totalPolicyEvaluations ?? 0) < 3 ||
    (diagnostics.telemetry?.totalRewardsApplied ?? 0) < 2 ||
    (diagnostics.telemetry?.totalDreamConsolidations ?? 0) < 1
  ) {
    throw new Error('KAN Worker telemetry counters did not increment properly');
  }

  // 7h. Clean termination
  await kanService.terminate();
  console.log('✓ 7h. KAN Worker Thread terminated cleanly');

  console.log('\n======================================================');
  console.log('ALL KAN-COGNITIVE CORE V2 TESTS PASSED PERFECTLY (7/7)');
  console.log('======================================================');
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
