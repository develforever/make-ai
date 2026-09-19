import { database } from '../db/database.js';
import { costGuard } from '../services/costGuard.js';
import { wikiWorker } from '../workers/wikiWorker.js';
import { personaWorker } from '../workers/personaWorker.js';
import { memoryWorker, ExtractedFact } from '../workers/memoryWorker.js';
import { WikiSummaryResult } from '../services/wikipedia.js';
import { kanService } from '../neural/index.js';
import { KanPolicyDecision } from '../neural/types.js';
import { dreamConsolidator } from '../services/dreamConsolidator.js';

export interface OrchestrationTurnResult {
  stream: AsyncGenerator<{ chunk: string; done: boolean; usage?: any }>;
  wikiContext: WikiSummaryResult | null;
  kanPolicy: KanPolicyDecision | null;
  onComplete: (fullReply: string, explicitCostUsd?: number) => Promise<ExtractedFact[]>;
}

export class OrchestratorEngine {
  public async isPaused(): Promise<boolean> {
    return (await database.getSetting('orchestrator_paused')) === 'true';
  }

  public async setPaused(paused: boolean): Promise<void> {
    await database.setSetting('orchestrator_paused', paused ? 'true' : 'false');
    await database.logOrchestrator('Orchestrator', paused ? 'pause' : 'resume', 'success', `Stan orkiestratora zmieniony na: ${paused ? 'PAUZA' : 'AKTYWNY'}`);
  }

  /**
   * Główna pętla orkiestracji pojedynczej tury dialogu z routingiem KAN-Cognitive Core v2
   */
  public async executeStep(
    userMessage: string,
    sessionId: string = 'default',
    explicitReferencedSessionIds: string[] = []
  ): Promise<OrchestrationTurnResult> {
    // Rejestracja aktywności użytkownika w celu wstrzymania cyklu konsolidacji wiedzy w tle
    dreamConsolidator.notifyUserActivity();

    const budget = await costGuard.getStatus();
    if (!budget.canProceed) {
      throw new Error(`KRYTYCZNE OGRANICZENIE BUDŻETU: Pozostało zaledwie $${budget.remainingBudgetUsd} USD. Dalsza inferencja została wstrzymana w celu ochrony środków.`);
    }

    // 0. Ewaluacja polityki dynamicznego routingu KAN przed generowaniem promptu i selekcją pamięci
    const kanPolicy = await kanService.evaluatePolicy(userMessage).catch((err) => {
      console.warn('KAN Policy error:', err);
      return null;
    });

    if (kanPolicy) {
      await database.logOrchestrator(
        'KANRouter',
        'policy_evaluated',
        'success',
        `Ekspert: ${kanPolicy.expertName} (#${kanPolicy.expertIndex}), Pewność: ${kanPolicy.confidence}, TopK: ${kanPolicy.memoryTopK}, Etyka: ${kanPolicy.ethicsWeight}`
      );
    }

    // 1. Wykrywanie i rozwiązywanie odwołań do innych sesji (Cross-Session Context)
    const { sessionResolver } = await import('../services/sessionResolver.js');
    const extractedRefs = sessionResolver.extractReferencedSessionIds(userMessage);
    const allRefIds = Array.from(new Set([...explicitReferencedSessionIds, ...extractedRefs]));
    const validRefIds = allRefIds.filter((id) => id !== sessionId);
    const resolvedRefs = await sessionResolver.resolveSessionContexts(validRefIds, userMessage);
    const crossSessionContexts = resolvedRefs.map((r) => r.contextText);

    // 2. Automatyczne nadanie tytułu heurystycznego przy pierwszej wiadomości
    const currentSession = await database.getSession(sessionId);
    if (currentSession && (currentSession.title === 'Nowa rozmowa' || !currentSession.title)) {
      const heuristicTitle = sessionResolver.generateHeuristicTitle(userMessage);
      await database.updateSession(sessionId, { title: heuristicTitle });
    }

    // 3. Zapisz wiadomość użytkownika do bazy w ramach wskazanej sesji
    const userMsgId = await database.saveMessage('user', userMessage, 0, undefined, undefined, sessionId);
    await database.logOrchestrator('Orchestrator', 'user_message', 'received', `Wiadomość #${userMsgId} w sesji [${sessionId}] przyjęta`);

    // 4. Krok Workera Wikipedii - czy wymagane jest wzbogacenie faktów?
    let wikiContext: WikiSummaryResult | null = null;
    try {
      wikiContext = await wikiWorker.inspectAndFetch(userMessage);
      if (wikiContext && wikiContext.found) {
        await database.logOrchestrator('WikiWorker', 'fetch_wiki', 'success', `Hasło: ${wikiContext.title} (${wikiContext.source})`);
      }
    } catch (e: any) {
      await database.logOrchestrator('WikiWorker', 'fetch_error', 'warning', e.message);
    }

    // 5. Uruchomienie strumienia generowania odpowiedzi przez PersonaWorker z przekazaną polityką KAN
    let capturedCostUsd = 0;
    const rawStream = personaWorker.generateResponseStream({
      userMessage,
      sessionId,
      wikiContext,
      historyLimit: 10,
      crossSessionContexts,
      kanPolicy
    });

    async function* wrappedStream() {
      for await (const chunkData of rawStream) {
        if (chunkData.done && chunkData.usage && typeof chunkData.usage.costUsd === 'number') {
          capturedCostUsd = chunkData.usage.costUsd;
        }
        yield chunkData;
      }
    }

    // 6. Callback po zakończeniu strumieniowania: zapis odpowiedzi, rejestracja nagrody KAN i asynchroniczne douczanie
    const onComplete = async (fullReply: string, explicitCostUsd?: number): Promise<ExtractedFact[]> => {
      const chatModel = (await database.getSetting('chat_model')) || undefined;

      // Przygotowanie metadanych z danymi kanPolicy dla frontendu
      const metadataObj: Record<string, any> = {};
      if (wikiContext?.found) {
        metadataObj.wiki = wikiContext.title;
      }
      if (kanPolicy) {
        metadataObj.kanPolicy = {
          bmuExpert: kanPolicy.expertIndex,
          expertName: kanPolicy.expertName,
          confidence: kanPolicy.confidence,
          ethicsWeight: kanPolicy.ethicsWeight,
          temperatureMod: kanPolicy.temperatureMod,
          memoryTopK: kanPolicy.memoryTopK
        };
      }
      const metadataStr = Object.keys(metadataObj).length > 0 ? JSON.stringify(metadataObj) : undefined;

      // Zapisz odpowiedź asystenta w historii sesji
      const assistantMsgId = await database.saveMessage(
        'assistant',
        fullReply,
        0,
        chatModel,
        metadataStr,
        sessionId
      );

      // Asynchroniczne doprecyzowanie tytułu przez LLM dla nowych sesji
      if (currentSession && (currentSession.message_count <= 2 || currentSession.title === 'Nowa rozmowa')) {
        sessionResolver.refineTitleAsync(sessionId, userMessage, fullReply).catch(() => {});
      }

      // Oblicz metryki nagrody dla uczenia ze wzmocnieniem KAN
      let tokenCostUsd = explicitCostUsd !== undefined ? explicitCostUsd : capturedCostUsd;
      if (tokenCostUsd === 0 && chatModel) {
        const promptTokens = Math.ceil(userMessage.length / 4);
        const completionTokens = Math.ceil(fullReply.length / 4);
        tokenCostUsd = costGuard.calculateCost(chatModel, promptTokens, completionTokens);
      }

      const responseLength = fullReply.length;
      const factualConsistency = (wikiContext && wikiContext.found) ? 1.0 : 0.5;

      // Asynchronicznie (w tle, bez blokowania) wywołaj nagrodę KAN
      kanService.applyReward({
        query: userMessage,
        responseLength,
        userSatisfaction: 1.0,
        tokenCostUsd,
        factualConsistency
      }).catch((rewardErr) => {
        console.warn('KAN applyReward error:', rewardErr);
      });

      // Jeśli orkiestrator nie jest spauzowany, uruchom w tle MemoryWorker
      if (!(await this.isPaused())) {
        try {
          const learned = await memoryWorker.extractAndLearn(userMessage, fullReply, assistantMsgId);
          return learned;
        } catch (err: any) {
          await database.logOrchestrator('MemoryWorker', 'async_error', 'failed', err.message);
          return [];
        }
      } else {
        await database.logOrchestrator('MemoryWorker', 'skip', 'paused', 'Pętla douczania pominięta z powodu pauzy');
        return [];
      }
    };

    return {
      stream: wrappedStream(),
      wikiContext,
      kanPolicy,
      onComplete
    };
  }

  /**
   * Główna pętla orkiestracji pojedynczej tury dialogu (alias dla executeStep)
   */
  public async handleUserMessage(
    userMessage: string,
    sessionId: string = 'default',
    explicitReferencedSessionIds: string[] = []
  ): Promise<OrchestrationTurnResult> {
    return this.executeStep(userMessage, sessionId, explicitReferencedSessionIds);
  }
}

export const orchestrator = new OrchestratorEngine();
