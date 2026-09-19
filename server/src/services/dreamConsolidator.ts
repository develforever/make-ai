/**
 * DreamConsolidator (Filar 5: Autonomiczny cykl konsolidacji wiedzy w czasie bezczynności).
 * Executes autonomous idle knowledge consolidation cycles using Kolmogorov-Arnold Networks (KAN),
 * discovering transitive logical axioms and synthesizing long-term cognitive models without user intervention.
 */

import { database } from '../db/database.js';
import { kanService } from '../neural/kanService.js';

export interface DreamConsolidatorOptions {
  idleThresholdMs?: number;
  checkIntervalMs?: number;
  pairLimitPerCycle?: number;
  minConfidenceThreshold?: number;
}

export interface DreamConsolidatorStatus {
  isRunning: boolean;
  isCycleExecuting: boolean;
  lastUserActivityTime: number;
  idleSeconds: number;
  idleThresholdSeconds: number;
  totalConsolidationsCount: number;
  lastCycleRunTime: number;
}

export class DreamConsolidator {
  private lastUserActivityTime: number = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private isCycleExecuting: boolean = false;

  private idleThresholdMs: number;
  private checkIntervalMs: number;
  private pairLimitPerCycle: number;
  private minConfidenceThreshold: number;

  private totalConsolidationsCount: number = 0;
  private lastCycleRunTime: number = 0;

  constructor(options?: DreamConsolidatorOptions) {
    this.idleThresholdMs = options?.idleThresholdMs ?? 25000; // 25 sekund bezczynności
    this.checkIntervalMs = options?.checkIntervalMs ?? 10000; // sprawdzanie co 10 sekund
    this.pairLimitPerCycle = options?.pairLimitPerCycle ?? 5; // do 5 par per cykl
    this.minConfidenceThreshold = options?.minConfidenceThreshold ?? 0.5; // KAN min confidence
  }

  /**
   * Rejestruje aktywność użytkownika (resetuje licznik bezczynności).
   */
  public notifyUserActivity(): void {
    this.lastUserActivityTime = Date.now();
  }

  /**
   * Konfiguracja progu bezczynności (użyteczna do testów).
   */
  public setIdleThreshold(ms: number): void {
    this.idleThresholdMs = ms;
  }

  /**
   * Uruchamia pętlę monitorowania bezczynności.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.notifyUserActivity();

    this.timer = setInterval(() => {
      this.checkIdleAndRun().catch((err) => {
        console.warn('[DreamConsolidator] Błąd w pętli badania bezczynności:', err);
      });
    }, this.checkIntervalMs);

    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Zatrzymuje pętlę monitorowania.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  /**
   * Okresowe badanie czasu bezczynności i wyzwalanie cyklu konsolidacji.
   */
  private async checkIdleAndRun(): Promise<void> {
    const idleTimeMs = Date.now() - this.lastUserActivityTime;
    if (idleTimeMs >= this.idleThresholdMs) {
      await this.runCycleNow();
    }
  }

  /**
   * Bezpośrednie wykonanie jednego autonomicznego cyklu konsolidacji wiedzy.
   * Zwraca liczbę nowo zsyntetyzowanych aksjomatów.
   */
  public async runCycleNow(): Promise<number> {
    if (this.isCycleExecuting) {
      return 0;
    }

    this.isCycleExecuting = true;
    let synthesizedCount = 0;

    try {
      // 1. Sprawdź, czy orkiestrator nie jest spauzowany
      const isPaused = (await database.getSetting('orchestrator_paused')) === 'true';
      if (isPaused) {
        return 0;
      }

      // 2. Pobierz kandydujące pary faktów z bazy danych
      const pairs = await database.getUnconsolidatedFactPairs(this.pairLimitPerCycle);
      if (!pairs || pairs.length === 0) {
        return 0;
      }

      // 3. Dla każdej pary wywołaj KAN consolidateFacts
      for (const { factA, factB } of pairs) {
        const factAStr = `${factA.subject} ${factA.predicate} ${factA.object}`.trim();
        const factBStr = `${factB.subject} ${factB.predicate} ${factB.object}`.trim();

        try {
          const result = await kanService.consolidateFacts(factAStr, factBStr);
          let axiomId: number | undefined = undefined;

          // 4. Jeśli confidence >= 0.5, utrwal aksjomat w bazie i zaloguj audyt
          if (result && result.confidence >= this.minConfidenceThreshold) {
            axiomId = await database.saveConsolidatedAxiom(result, [factA.id, factB.id]);

            await database.logOrchestrator(
              'DreamConsolidator',
              'axiom_synthesized',
              'success',
              `Syntetyzowano aksjomat [ID: ${axiomId}, Conf: ${result.confidence}]: "${result.synthesizedAxiom}" z faktów #${factA.id} ("${factAStr}") i #${factB.id} ("${factBStr}")`
            );

            this.totalConsolidationsCount++;
            synthesizedCount++;
          }

          // 5. Zarejestruj zbadaną parę, by nie badać jej ponownie w najbliższym czasie
          await database.recordEvaluatedPair(
            factA.id,
            factB.id,
            result?.confidence ?? 0,
            axiomId
          );
        } catch (pairErr: any) {
          console.warn(`[DreamConsolidator] Błąd ewaluacji pary faktów #${factA.id} i #${factB.id}:`, pairErr);
        }
      }

      this.lastCycleRunTime = Date.now();
    } finally {
      this.isCycleExecuting = false;
    }

    return synthesizedCount;
  }

  /**
   * Zwraca aktualny stan diagnostyczny i metryki DreamConsolidator.
   */
  public getStatus(): DreamConsolidatorStatus {
    const now = Date.now();
    return {
      isRunning: this.isRunning,
      isCycleExecuting: this.isCycleExecuting,
      lastUserActivityTime: this.lastUserActivityTime,
      idleSeconds: Math.floor((now - this.lastUserActivityTime) / 1000),
      idleThresholdSeconds: Math.floor(this.idleThresholdMs / 1000),
      totalConsolidationsCount: this.totalConsolidationsCount,
      lastCycleRunTime: this.lastCycleRunTime
    };
  }
}

export const dreamConsolidator = new DreamConsolidator();
