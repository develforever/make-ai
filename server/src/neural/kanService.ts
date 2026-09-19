/**
 * KAN Service (Filar 4: Asynchroniczny most komunikacyjny z worker threadem KAN).
 * Provides a clean Promise-based interface to dispatch tensor operations to the dedicated
 * worker thread, keeping the event loop 100% responsive.
 */

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { TrainingStepTelemetry } from './TrainingLoop.js';
import {
  FisherDiagnostic,
  KanPolicyDecision,
  RewardFeedback,
  DreamConsolidationResult
} from './types.js';

export interface KanForwardResult {
  logits: number[];
  bmu: number;
  routeIndices: number[];
  routeWeights: number[];
  expertOutput: number[];
}

export interface KanDiagnostics {
  fisher: any;
  expertCount: number;
  teacherOnline: boolean;
  inputDim: number;
  hiddenDim: number;
  outputDim: number;
  telemetry?: {
    totalForwardPasses: number;
    totalPolicyEvaluations: number;
    totalRewardsApplied: number;
    totalDreamConsolidations: number;
    lastRewardLoss: number;
    lastConsolidationConfidence: number;
    lastPolicyConfidence: number;
  };
}

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (err: any) => void;
  timeout: NodeJS.Timeout;
}

function resolveWorkerPath(): { path: string; execArgv: string[] } {
  const currentFile = fileURLToPath(import.meta.url);
  const dir = path.dirname(currentFile);
  const tsWorker = path.join(dir, 'kanWorker.ts');
  const jsWorker = path.join(dir, 'kanWorker.js');

  if (currentFile.endsWith('.ts') || fs.existsSync(tsWorker)) {
    return {
      path: tsWorker,
      execArgv: ['--import', 'tsx']
    };
  }

  return {
    path: jsWorker,
    execArgv: []
  };
}

export class KanService {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private isTerminated = false;

  private getWorker(): Worker {
    if (this.worker && !this.isTerminated) {
      return this.worker;
    }

    this.isTerminated = false;
    const { path: workerPath, execArgv } = resolveWorkerPath();
    this.worker = new Worker(workerPath, { execArgv });

    this.worker.on('message', (response: any) => {
      if (!response || !response.id) return;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);
        if (response.success) {
          pending.resolve(response.data !== undefined ? response.data : true);
        } else {
          pending.reject(new Error(response.error || 'Błąd wątku KAN'));
        }
      }
    });

    this.worker.on('error', (err) => {
      console.error('[KanService] Błąd wątku roboczego:', err);
      for (const [id, pending] of this.pendingRequests.entries()) {
        clearTimeout(pending.timeout);
        pending.reject(err);
      }
      this.pendingRequests.clear();
    });

    this.worker.on('exit', (code) => {
      if (code !== 0 && !this.isTerminated) {
        console.warn(`[KanService] Wątek KAN zakończył działanie z kodem ${code}`);
      }
      this.worker = null;
    });

    return this.worker;
  }

  public async request<T = any>(type: string, payload: any = {}, timeoutMs: number = 30000): Promise<T> {
    const worker = this.getWorker();
    const id = `kan_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`[KanService] Upłynął limit czasu żądania (${type}) po ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      worker.postMessage({ id, type, ...payload });
    });
  }

  public async ping(): Promise<boolean> {
    const res = await this.request('ping', {}, 5000);
    return res !== undefined;
  }

  public async forward(input: Float32Array | number[]): Promise<KanForwardResult> {
    const arr = Array.from(input);
    return this.request<KanForwardResult>('forward', { input: arr });
  }

  public async trainStep(batch: string[]): Promise<TrainingStepTelemetry[]> {
    return this.request<TrainingStepTelemetry[]>('train_step', { batch });
  }

  public async computeFisher(sampleCount: number = 16): Promise<FisherDiagnostic> {
    return this.request<FisherDiagnostic>('compute_fisher', { sampleCount });
  }

  public async getDiagnostics(): Promise<KanDiagnostics> {
    return this.request<KanDiagnostics>('get_diagnostics');
  }

  public async evaluatePolicy(text: string): Promise<KanPolicyDecision> {
    return this.request<KanPolicyDecision>('evaluate_policy', { text });
  }

  public async applyReward(feedback: RewardFeedback): Promise<{ success: boolean; loss: number }> {
    return this.request<{ success: boolean; loss: number }>('apply_reward', { feedback });
  }

  public async consolidateFacts(factA: string, factB: string): Promise<DreamConsolidationResult | null> {
    return this.request<DreamConsolidationResult | null>('dream_consolidation', { factA, factB });
  }

  public async terminate(): Promise<void> {
    if (this.worker) {
      this.isTerminated = true;
      for (const [id, pending] of this.pendingRequests.entries()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('KanService został zatrzymany'));
      }
      this.pendingRequests.clear();
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

export const kanService = new KanService();
