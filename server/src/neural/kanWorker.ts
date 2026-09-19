/**
 * KAN Worker Thread (Filar 4: Izolacja obliczeń numerycznych KAN w dedykowanym workerze).
 * Executes computationally intensive B-splines, SOM routing, EWC Fisher calculations,
 * and SAM optimization outside the main Node.js event loop.
 * Upgraded to KAN-Cognitive Core v2 with SemanticEncoder, Policy Evaluation,
 * Reinforcement Reward Feedback, and Dream Consolidation.
 */

import { parentPort } from 'node:worker_threads';
import { SOMRouter } from './SOMRouter.js';
import { KANLayer } from './KANLayer.js';
import { EWCOptimizer } from './EWCOptimizer.js';
import { LocalTeacherLLM } from './LocalTeacherLLM.js';
import { TrainingLoop } from './TrainingLoop.js';
import { SemanticEncoder } from './SemanticEncoder.js';
import { KanPolicyDecision, RewardFeedback, DreamConsolidationResult } from './types.js';

if (!parentPort) {
  throw new Error('kanWorker must be executed as a Worker thread');
}

// Expert specialization specifications
const EXPERT_SPECS = [
  { name: 'General & Conversational Synthesis', baseEthics: 0.5, defaultTopK: 5 },
  { name: 'Fact Retrieval & Epistemic Verification', baseEthics: 0.3, defaultTopK: 8 },
  { name: 'Ethics, Alignment & Safety Guard', baseEthics: 0.95, defaultTopK: 4 },
  { name: 'Algorithmic & Code Reasoning', baseEthics: 0.25, defaultTopK: 6 }
];

// Inicjalizacja modułów sieci KAN w dedykowanym wątku
const router = new SOMRouter(32, 4);
const experts = [
  new KANLayer(32, 16, 5, 3),
  new KANLayer(32, 16, 5, 3),
  new KANLayer(32, 16, 5, 3),
  new KANLayer(32, 16, 5, 3)
];
const aggregator = new KANLayer(16, 64, 5, 3);
const teacher = new LocalTeacherLLM();
const ewc = new EWCOptimizer();
const trainingLoop = new TrainingLoop(router, experts, aggregator, teacher, ewc);

// Telemetry counters
const telemetry = {
  totalForwardPasses: 0,
  totalPolicyEvaluations: 0,
  totalRewardsApplied: 0,
  totalDreamConsolidations: 0,
  lastRewardLoss: 0,
  lastConsolidationConfidence: 0,
  lastPolicyConfidence: 0
};

/**
 * Extracts deterministic relation triplet for dream consolidation.
 */
function extractRelationTriple(factA: string, factB: string): { subject: string; predicate: string; object: string; synthesizedAxiom: string } {
  const splitRelation = (text: string): { subj: string; pred: string; obj: string } => {
    const clean = text.trim().replace(/[.,;!?]+$/, '');
    const relationRegex = /\b(jest|to|emituje|stymuluje|powoduje|zawiera|posiada|wpływa na|zwiększa|zmniejsza|oznacza|is|causes|stimulates|emits|contains|has|leads to|results in)\b/i;
    const match = clean.match(relationRegex);
    if (match && match.index !== undefined) {
      const subj = clean.substring(0, match.index).trim();
      const pred = match[1].trim();
      const obj = clean.substring(match.index + match[0].length).trim();
      return { subj, pred, obj };
    }
    const words = clean.split(/\s+/);
    if (words.length >= 3) {
      return { subj: words[0], pred: words.slice(1, words.length - 1).join(' '), obj: words[words.length - 1] };
    }
    return { subj: clean, pred: 'powiązane z', obj: clean };
  };

  const tripleA = splitRelation(factA);
  const tripleB = splitRelation(factB);

  const normAObj = tripleA.obj.toLowerCase();
  const normBSubj = tripleB.subj.toLowerCase();

  // Transitive logic deduction: A -> B and B -> C implies A -> C
  if (normAObj.length > 0 && normBSubj.length > 0 && (normAObj.includes(normBSubj) || normBSubj.includes(normAObj))) {
    const subject = tripleA.subj || factA;
    const predicate = `pośrednio ${tripleB.pred || 'determinuje'}`;
    const object = tripleB.obj || factB;
    return {
      subject,
      predicate,
      object,
      synthesizedAxiom: `${subject} ${predicate} ${object}`
    };
  }

  const subject = tripleA.subj || factA.split(/\s+/)[0] || 'Aksjomat';
  const predicate = tripleB.pred || tripleA.pred || 'koreluje z';
  const object = tripleB.obj || factB;
  return {
    subject,
    predicate,
    object,
    synthesizedAxiom: `${subject} ${predicate} ${object}`
  };
}

parentPort.on('message', async (msg: any) => {
  if (!msg || !msg.id) return;

  try {
    switch (msg.type) {
      case 'ping': {
        parentPort!.postMessage({ id: msg.id, type: 'pong', success: true, data: { pong: true } });
        break;
      }

      case 'forward': {
        telemetry.totalForwardPasses++;
        const inputVec = new Float32Array(msg.input);
        const routing = router.routeTopK(inputVec, 2);
        const bmu = routing.indices[0];

        const expert = experts[bmu % experts.length];
        const expertOut = expert.forward(inputVec);
        const logits = aggregator.forward(expertOut);

        parentPort!.postMessage({
          id: msg.id,
          type: 'forward_result',
          success: true,
          data: {
            logits: Array.from(logits),
            bmu,
            routeIndices: routing.indices,
            routeWeights: routing.weights,
            expertOutput: Array.from(expertOut)
          }
        });
        break;
      }

      case 'evaluate_policy': {
        telemetry.totalPolicyEvaluations++;
        let vec: Float32Array;
        if (msg.embedding && Array.isArray(msg.embedding) && msg.embedding.length > 0) {
          vec = new Float32Array(msg.embedding);
        } else {
          vec = SemanticEncoder.encode(msg.text || '', 32);
        }

        const routing = router.routeTopK(vec, 2);
        const bmu = routing.indices[0];
        const expert = experts[bmu % experts.length];
        const expertOut = expert.forward(vec);
        const logits = aggregator.forward(expertOut);

        const spec = EXPERT_SPECS[bmu % EXPERT_SPECS.length];

        const rawConf = routing.weights[0] ?? 0.5;
        const confidence = parseFloat(Math.max(0.1, Math.min(0.99, rawConf)).toFixed(4));

        const logit0 = logits[0] || 0;
        const sig0 = 1.0 / (1.0 + Math.exp(-logit0));
        const temperatureMod = parseFloat((0.15 + 0.85 * sig0).toFixed(3));

        const logit1 = logits[1] || 0;
        const sig1 = 1.0 / (1.0 + Math.exp(-logit1));
        const memoryTopK = Math.max(3, Math.min(12, Math.round(3 + (spec.defaultTopK - 3) + 4 * (sig1 - 0.5))));

        const logit2 = logits[2] || 0;
        const sig2 = 1.0 / (1.0 + Math.exp(-logit2));
        const ethicsWeight = parseFloat(
          Math.max(0.0, Math.min(1.0, 0.6 * spec.baseEthics + 0.4 * sig2)).toFixed(3)
        );

        const policyDecision: KanPolicyDecision = {
          expertIndex: bmu,
          expertName: spec.name,
          confidence,
          temperatureMod,
          memoryTopK,
          ethicsWeight
        };

        telemetry.lastPolicyConfidence = confidence;

        parentPort!.postMessage({
          id: msg.id,
          type: 'evaluate_policy_result',
          success: true,
          data: policyDecision
        });
        break;
      }

      case 'apply_reward': {
        const feedback: RewardFeedback = msg.feedback;
        if (!feedback || typeof feedback !== 'object') {
          throw new Error('Nieprawidłowy format feedbacku w apply_reward');
        }

        const emb = SemanticEncoder.encode(feedback.query || '', 32);

        // Normalize metrics into scalar reward in [-1, 1]
        const satNorm = Math.max(-1, Math.min(1, (feedback.userSatisfaction - 0.5) * 2));
        const factNorm = Math.max(-1, Math.min(1, (feedback.factualConsistency - 0.5) * 2));
        const costBonus = Math.max(-0.25, Math.min(0.25, (0.0005 - (feedback.tokenCostUsd || 0)) * 50));
        const len = feedback.responseLength || 0;
        const lengthScore = len > 10 && len < 2500 ? 0.1 : -0.15;

        const rawReward = 0.5 * satNorm + 0.35 * factNorm + costBonus + lengthScore;
        const scalarReward = Math.max(-1.0, Math.min(1.0, rawReward));

        const stepResult = trainingLoop.applyPolicyReward(emb, scalarReward);

        telemetry.totalRewardsApplied++;
        telemetry.lastRewardLoss = stepResult.loss;

        parentPort!.postMessage({
          id: msg.id,
          type: 'apply_reward_result',
          success: true,
          data: {
            success: true,
            loss: stepResult.loss,
            bmuExpert: stepResult.bmuExpert,
            reward: scalarReward
          }
        });
        break;
      }

      case 'dream_consolidation': {
        telemetry.totalDreamConsolidations++;
        const embA = SemanticEncoder.encode(msg.factA || '', 32);
        const embB = SemanticEncoder.encode(msg.factB || '', 32);

        const combined = new Float32Array(32);
        let dotSim = 0;
        for (let i = 0; i < 32; i++) {
          combined[i] = (embA[i] + embB[i]) * 0.5;
          dotSim += embA[i] * embB[i];
        }

        let sumSq = 0;
        for (let i = 0; i < 32; i++) sumSq += combined[i] * combined[i];
        const norm = Math.sqrt(sumSq);
        if (norm > 1e-9) {
          for (let i = 0; i < 32; i++) combined[i] /= norm;
        }

        const routing = router.routeTopK(combined, 2);
        const bmu = routing.indices[0];
        const expertOut = experts[bmu % experts.length].forward(combined);
        const logits = aggregator.forward(expertOut);

        let energy = 0;
        for (let i = 0; i < logits.length; i++) {
          energy += Math.abs(logits[i]);
        }
        const meanEnergy = energy / Math.max(1, logits.length);

        const synergy = 0.5 * Math.max(0, dotSim) + 0.5 * Math.tanh(meanEnergy);
        const confidence = parseFloat(Math.min(0.99, Math.max(0.01, synergy)).toFixed(4));
        telemetry.lastConsolidationConfidence = confidence;

        let consolidationResult: DreamConsolidationResult | null = null;
        if (confidence >= 0.20) {
          const triple = extractRelationTriple(msg.factA || '', msg.factB || '');
          consolidationResult = {
            synthesizedAxiom: triple.synthesizedAxiom,
            subject: triple.subject,
            predicate: triple.predicate,
            object: triple.object,
            confidence
          };
        }

        parentPort!.postMessage({
          id: msg.id,
          type: 'dream_consolidation_result',
          success: true,
          data: consolidationResult
        });
        break;
      }

      case 'train_step': {
        const batch: string[] = msg.batch || [];
        const trainTelemetry = await trainingLoop.step(batch);
        parentPort!.postMessage({
          id: msg.id,
          type: 'train_step_result',
          success: true,
          data: trainTelemetry
        });
        break;
      }

      case 'compute_fisher': {
        const weightMap = new Map<string, Float32Array>();
        experts.forEach((exp, idx) => {
          weightMap.set(`expert_${idx}`, exp.baseWeight);
        });
        weightMap.set('aggregator', aggregator.baseWeight);
        ewc.computeFisherInformation(weightMap, msg.sampleCount || 16);
        const diag = ewc.getDiagnostics();
        parentPort!.postMessage({
          id: msg.id,
          type: 'compute_fisher_result',
          success: true,
          data: diag
        });
        break;
      }

      case 'get_diagnostics': {
        const teacherOnline = await teacher.isAvailable();
        const diag = ewc.getDiagnostics();
        parentPort!.postMessage({
          id: msg.id,
          type: 'diagnostics_result',
          success: true,
          data: {
            fisher: diag,
            expertCount: experts.length,
            teacherOnline,
            inputDim: 32,
            hiddenDim: 16,
            outputDim: 64,
            telemetry: { ...telemetry }
          }
        });
        break;
      }

      default: {
        parentPort!.postMessage({
          id: msg.id,
          type: 'unknown_type',
          success: false,
          error: `Nieznany typ wiadomości: ${msg.type}`
        });
      }
    }
  } catch (err: any) {
    parentPort!.postMessage({
      id: msg.id,
      type: `${msg.type}_error`,
      success: false,
      error: err.message || String(err)
    });
  }
});
