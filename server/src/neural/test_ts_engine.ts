/**
 * Integration Test for TypeScript Neural Core Engine
 */

import { SOMRouter } from './SOMRouter.js';
import { KANLayer, mishActivation } from './KANLayer.js';
import { EWCOptimizer } from './EWCOptimizer.js';
import { LocalTeacherLLM } from './LocalTeacherLLM.js';
import { TrainingLoop } from './TrainingLoop.js';

async function runTest() {
  console.log('Testing TypeScript Neural Core...');

  // 1. Test Mish
  const m1 = mishActivation(0);
  const m2 = mishActivation(2.0);
  if (Math.abs(m1) > 1e-4 || m2 <= 0) {
    throw new Error('Mish activation failed verification');
  }
  console.log('✓ Mish Activation verified');

  // 2. Test SOMRouter
  const router = new SOMRouter(32, 4);
  const dummyVec = new Float32Array(32);
  dummyVec[0] = 1.0;
  const bmu = router.route(dummyVec);
  const top2 = router.routeTopK(dummyVec, 2);
  if (top2.indices.length !== 2 || top2.weights.length !== 2) {
    throw new Error('SOMRouter Top-2 failed');
  }
  console.log(`✓ SOMRouter BMU: Expert #${bmu}, Top-2: [${top2.indices.join(', ')}]`);

  // 3. Test KANLayer
  const kanExpert = new KANLayer(32, 16, 5, 3);
  const kanOut = kanExpert.forward(dummyVec);
  if (kanOut.length !== 16 || !Number.isFinite(kanOut[0])) {
    throw new Error('KANLayer forward pass failed');
  }
  console.log(`✓ KANLayer Forward Pass output dim: ${kanOut.length}`);

  // 4. Test EWCOptimizer
  const ewc = new EWCOptimizer();
  const weightMap = new Map<string, Float32Array>();
  weightMap.set('expert_0', kanExpert.baseWeight);
  ewc.computeFisherInformation(weightMap, 16);
  const penaltyZero = ewc.calculateEWCPenalty(weightMap);
  if (Math.abs(penaltyZero) > 1e-4) {
    throw new Error('EWC penalty should be zero for unchanged weights');
  }
  console.log('✓ EWCOptimizer Fisher Matrix registered & zero drift verified');

  // 5. Test TrainingLoop with Distillation & SAM
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
  console.log(`✓ TrainingLoop SAM & Distillation completed ${telemetry.length} steps:`);
  telemetry.forEach((t) => {
    console.log(`   Step ${t.step}: Loss=${t.loss.toFixed(4)}, BMU=Expert #${t.bmuExpert}, TeacherOnline=${t.teacherOnline}`);
  });

  console.log('\nALL TYPESCRIPT NEURAL TESTS PASSED (5/5)');
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
