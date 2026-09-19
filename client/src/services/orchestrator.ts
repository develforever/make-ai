import { browserStore } from './storage';
import { browserWikipedia, type WikiSummaryResult } from './wikipedia';
import { browserPersonaWorker } from './personaWorker';
import { browserMemoryWorker } from './memoryWorker';
import { CLIENT_SUPPORTED_MODELS, DEFAULT_CLIENT_CONFIG } from './config';
import type { ExtractedFact, OrchestratorStatus } from '../types';

export class BrowserOrchestrator {
  private isProcessing = false;

  public async getStatus(): Promise<OrchestratorStatus> {
    const isPaused = (await browserStore.getSetting('orchestrator_paused')) === 'true';
    const agentName = (await browserStore.getSetting('agent_name')) || DEFAULT_CLIENT_CONFIG.AGENT_NAME;
    const chatModel = (await browserStore.getSetting('chat_model')) || DEFAULT_CLIENT_CONFIG.DEFAULT_CHAT_MODEL;
    const extractionModel =
      (await browserStore.getSetting('extraction_model')) || DEFAULT_CLIENT_CONFIG.DEFAULT_EXTRACTION_MODEL;
    const logs = await browserStore.getRecentLogs(30);

    return {
      isPaused,
      agentName,
      chatModel,
      extractionModel,
      supportedModels: Object.values(CLIENT_SUPPORTED_MODELS),
      logs
    };
  }

  public async setPause(paused: boolean): Promise<boolean> {
    await browserStore.setSetting('orchestrator_paused', paused ? 'true' : 'false');
    await browserStore.logOrchestrator(
      'Orchestrator',
      'pause_toggle',
      'info',
      paused ? 'Wstrzymano pętlę workerów' : 'Wznowiono pętlę workerów'
    );
    return paused;
  }

  public async updateSettings(settings: {
    agentName?: string;
    chatModel?: string;
    extractionModel?: string;
    useLocalOllama?: boolean;
    localOllamaUrl?: string;
  }): Promise<void> {
    if (settings.agentName) await browserStore.setSetting('agent_name', settings.agentName);
    if (settings.chatModel) await browserStore.setSetting('chat_model', settings.chatModel);
    if (settings.extractionModel) await browserStore.setSetting('extraction_model', settings.extractionModel);
    if (settings.useLocalOllama !== undefined) {
      await browserStore.setSetting('use_local_ollama', settings.useLocalOllama ? 'true' : 'false');
    }
    if (settings.localOllamaUrl) {
      await browserStore.setSetting('local_ollama_url', settings.localOllamaUrl);
    }

    await browserStore.logOrchestrator('Orchestrator', 'settings_update', 'success', JSON.stringify(settings));
  }

  /**
   * Wykrywa intencję encyklopedyczną w zapytaniu użytkownika
   */
  private extractWikiSearchTerm(message: string): string | null {
    const clean = message.trim();
    const wikiPatterns = [
      /^(?:co to jest|czym jest|kim jest|kim był|kim była|czym są|co oznacza|wyjaśnij pojęcie|opowiedz o|co wiesz o|jak działa)\s+([^?.,!]+)/i,
      /(?:co to jest|czym jest|kim jest|kim był|kim była|czym są)\s+([^?.,!]+)/i
    ];

    for (const pat of wikiPatterns) {
      const match = clean.match(pat);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return null;
  }

  /**
   * Główny strumień dialogowy z koordynacją workerów w przeglądarce
   */
  public async streamChat(
    userMessage: string,
    callbacks: {
      onWiki?: (wiki: any) => void;
      onDelta?: (chunk: string) => void;
      onLearned?: (facts: ExtractedFact[]) => void;
      onUsage?: (usage: any) => void;
      onError?: (error: string) => void;
      onDone?: () => void;
    },
    sessionId: string = 'default',
    explicitReferencedSessionIds: string[] = []
  ): Promise<void> {
    if (this.isProcessing) {
      callbacks.onError?.('Orkiestrator przetwarza już inne zapytanie.');
      callbacks.onDone?.();
      return;
    }

    this.isProcessing = true;

    try {
      // 1. Wykrywanie i rozwiązywanie odwołań do innych sesji (Cross-Session Context)
      const wikiRegex = /\[\[session:([a-zA-Z0-9_-]+)(?:\|[^\]]+)?\]\]/g;
      const atColonRegex = /@session:([a-zA-Z0-9_-]+)/g;
      const atDirectRegex = /@(session_[a-zA-Z0-9_-]+)/g;
      const refSet = new Set<string>(explicitReferencedSessionIds);
      let match: RegExpExecArray | null;
      while ((match = wikiRegex.exec(userMessage)) !== null) refSet.add(match[1]);
      while ((match = atColonRegex.exec(userMessage)) !== null) refSet.add(match[1]);
      while ((match = atDirectRegex.exec(userMessage)) !== null) refSet.add(match[1]);

      const crossSessionContexts: string[] = [];
      for (const rId of refSet) {
        if (rId === sessionId) continue;
        const s = await browserStore.getSession(rId);
        if (!s) continue;
        const recent = await browserStore.getRecentMessages(6, rId);
        if (recent.length === 0) continue;
        const lines = [
          `[ODWOŁANIE DO POWIĄZANEJ SESJI: "${s.title}"]`,
          s.summary ? `Streszczenie: ${s.summary}` : '',
          `Początek dyskusji: ${recent[0].content.slice(0, 180)}`,
          recent.length > 1 ? `Ostatnie ustalenia: ${recent[recent.length - 1].content.slice(0, 220)}` : ''
        ].filter(Boolean);
        crossSessionContexts.push(lines.join('\n'));
      }

      // 2. Automatyczne nadanie tytułu heurystycznego przy pierwszej wiadomości
      const currentSession = await browserStore.getSession(sessionId);
      if (currentSession && (currentSession.title === 'Nowa rozmowa' || !currentSession.title)) {
        const clean = userMessage
          .replace(/^[#>\s*_-]+/, '')
          .replace(/^(?:proszę|powiedz mi|jak|czym jest|kim jest|co to jest|napisz|wyjaśnij|hej|cześć|witaj)\s+/i, '')
          .trim();
        const cap = clean.charAt(0).toUpperCase() + clean.slice(1);
        const firstLine = cap.split('\n')[0].trim();
        const heuristicTitle = firstLine.length <= 45 ? firstLine : firstLine.slice(0, 42).trim() + '...';
        await browserStore.updateSession(sessionId, { title: heuristicTitle });
      }

      // 3. Zapisz wiadomość użytkownika w IndexedDB
      await browserStore.saveMessage('user', userMessage, undefined, undefined, sessionId);

      // 4. Wikipedia Worker
      let wikiResult: WikiSummaryResult | null = null;
      const wikiTerm = this.extractWikiSearchTerm(userMessage);
      if (wikiTerm) {
        await browserStore.logOrchestrator('WikiWorker', 'search_initiated', 'info', `Term: "${wikiTerm}"`);
        wikiResult = await browserWikipedia.getSummary(wikiTerm);
        if (wikiResult.found) {
          await browserStore.logOrchestrator(
            'WikiWorker',
            'summary_retrieved',
            'success',
            `Title: "${wikiResult.title}" (źródło: ${wikiResult.source})`
          );
          callbacks.onWiki?.({
            title: wikiResult.title,
            summary: wikiResult.summary,
            url: wikiResult.url,
            thumbnailUrl: wikiResult.thumbnailUrl
          });
        }
      }

      // 5. Wnioskowanie i streaming odpowiedzi przez PersonaWorker (Ollama / OpenRouter / Sandbox)
      let fullReply = '';
      const stream = browserPersonaWorker.generateResponseStream({
        userMessage,
        sessionId,
        wikiContext: wikiResult,
        crossSessionContexts
      });

      for await (const chunk of stream) {
        if (chunk.type === 'delta' && chunk.delta) {
          fullReply += chunk.delta;
          callbacks.onDelta?.(chunk.delta);
        } else if (chunk.type === 'usage' && chunk.usage) {
          callbacks.onUsage?.(chunk.usage);
        }
      }

      // 6. Zapisz odpowiedź asystenta w IndexedDB z właściwym modelem (Ollama / OpenRouter / Sandbox)
      const meta = wikiResult?.found ? JSON.stringify({ wiki: wikiResult }) : undefined;
      const modelUsed =
        browserPersonaWorker.getLastUsedModel() ||
        (await browserStore.getSetting('chat_model')) ||
        DEFAULT_CLIENT_CONFIG.DEFAULT_CHAT_MODEL;
      const assistantMsgId = await browserStore.saveMessage('assistant', fullReply, modelUsed, meta, sessionId);

      // 7. Asynchroniczny Memory Worker w tle
      browserMemoryWorker
        .extractAndLearn(userMessage, fullReply, assistantMsgId)
        .then((learnedFacts) => {
          if (learnedFacts && learnedFacts.length > 0) {
            callbacks.onLearned?.(learnedFacts);
          }
        })
        .catch((err) => {
          console.warn('[Orchestrator] Błąd MemoryWorkera w tle:', err);
        });
    } catch (err: any) {
      console.error('[BrowserOrchestrator] Błąd:', err);
      callbacks.onError?.(err.message || 'Wystąpił nieoczekiwany błąd orkiestratora');
    } finally {
      this.isProcessing = false;
      callbacks.onDone?.();
    }
  }
}

export const browserOrchestrator = new BrowserOrchestrator();
