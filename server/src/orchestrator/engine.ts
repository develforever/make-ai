import { database } from '../db/database.js';
import { costGuard } from '../services/costGuard.js';
import { wikiWorker } from '../workers/wikiWorker.js';
import { personaWorker } from '../workers/personaWorker.js';
import { memoryWorker, ExtractedFact } from '../workers/memoryWorker.js';
import { WikiSummaryResult } from '../services/wikipedia.js';

export interface OrchestrationTurnResult {
  stream: AsyncGenerator<{ chunk: string; done: boolean; usage?: any }>;
  wikiContext: WikiSummaryResult | null;
  onComplete: (fullReply: string) => Promise<ExtractedFact[]>;
}

export class OrchestratorEngine {
  public isPaused(): boolean {
    return database.getSetting('orchestrator_paused') === 'true';
  }

  public setPaused(paused: boolean): void {
    database.setSetting('orchestrator_paused', paused ? 'true' : 'false');
    database.logOrchestrator('Orchestrator', paused ? 'pause' : 'resume', 'success', `Stan orkiestratora zmieniony na: ${paused ? 'PAUZA' : 'AKTYWNY'}`);
  }

  /**
   * Główna pętla orkiestracji pojedynczej tury dialogu
   */
  public async handleUserMessage(
    userMessage: string,
    sessionId: string = 'default',
    explicitReferencedSessionIds: string[] = []
  ): Promise<OrchestrationTurnResult> {
    const budget = costGuard.getStatus();
    if (!budget.canProceed) {
      throw new Error(`KRYTYCZNE OGRANICZENIE BUDŻETU: Pozostało zaledwie $${budget.remainingBudgetUsd} USD. Dalsza inferencja została wstrzymana w celu ochrony środków.`);
    }

    // 1. Wykrywanie i rozwiązywanie odwołań do innych sesji (Cross-Session Context)
    const { sessionResolver } = await import('../services/sessionResolver.js');
    const extractedRefs = sessionResolver.extractReferencedSessionIds(userMessage);
    const allRefIds = Array.from(new Set([...explicitReferencedSessionIds, ...extractedRefs]));
    const validRefIds = allRefIds.filter((id) => id !== sessionId);
    const resolvedRefs = sessionResolver.resolveSessionContexts(validRefIds);
    const crossSessionContexts = resolvedRefs.map((r) => r.contextText);

    // 2. Automatyczne nadanie tytułu heurystycznego przy pierwszej wiadomości
    const currentSession = database.getSession(sessionId);
    if (currentSession && (currentSession.title === 'Nowa rozmowa' || !currentSession.title)) {
      const heuristicTitle = sessionResolver.generateHeuristicTitle(userMessage);
      database.updateSession(sessionId, { title: heuristicTitle });
    }

    // 3. Zapisz wiadomość użytkownika do bazy w ramach wskazanej sesji
    const userMsgId = database.saveMessage('user', userMessage, 0, undefined, undefined, sessionId);
    database.logOrchestrator('Orchestrator', 'user_message', 'received', `Wiadomość #${userMsgId} w sesji [${sessionId}] przyjęta`);

    // 4. Krok Workera Wikipedii - czy wymagane jest wzbogacenie faktów?
    let wikiContext: WikiSummaryResult | null = null;
    try {
      wikiContext = await wikiWorker.inspectAndFetch(userMessage);
      if (wikiContext && wikiContext.found) {
        database.logOrchestrator('WikiWorker', 'fetch_wiki', 'success', `Hasło: ${wikiContext.title} (${wikiContext.source})`);
      }
    } catch (e: any) {
      database.logOrchestrator('WikiWorker', 'fetch_error', 'warning', e.message);
    }

    // 5. Uruchomienie strumienia generowania odpowiedzi przez PersonaWorker
    const stream = personaWorker.generateResponseStream({
      userMessage,
      sessionId,
      wikiContext,
      historyLimit: 10,
      crossSessionContexts
    });

    // 6. Callback po zakończeniu strumieniowania: zapis odpowiedzi i asynchroniczne douczanie
    const onComplete = async (fullReply: string): Promise<ExtractedFact[]> => {
      // Zapisz odpowiedź asystenta w historii sesji
      const assistantMsgId = database.saveMessage(
        'assistant',
        fullReply,
        0,
        database.getSetting('chat_model') || undefined,
        wikiContext?.found ? JSON.stringify({ wiki: wikiContext.title }) : undefined,
        sessionId
      );

      // Asynchroniczne doprecyzowanie tytułu przez LLM dla nowych sesji
      if (currentSession && (currentSession.message_count <= 2 || currentSession.title === 'Nowa rozmowa')) {
        sessionResolver.refineTitleAsync(sessionId, userMessage, fullReply).catch(() => {});
      }

      // Jeśli orkiestrator nie jest spauzowany, uruchom w tle MemoryWorker
      if (!this.isPaused()) {
        try {
          const learned = await memoryWorker.extractAndLearn(userMessage, fullReply, assistantMsgId);
          return learned;
        } catch (err: any) {
          database.logOrchestrator('MemoryWorker', 'async_error', 'failed', err.message);
          return [];
        }
      } else {
        database.logOrchestrator('MemoryWorker', 'skip', 'paused', 'Pętla douczania pominięta z powodu pauzy');
        return [];
      }
    };

    return {
      stream,
      wikiContext,
      onComplete
    };
  }
}

export const orchestrator = new OrchestratorEngine();
