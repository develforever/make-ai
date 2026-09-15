import { browserStore } from './storage';
import { browserOpenRouter, type ChatMessage } from './openRouter';
import { browserSandbox } from './sandbox';
import type { ExtractedFact } from '../types';
import { DEFAULT_CLIENT_CONFIG } from './config';

export class BrowserMemoryWorker {
  private isProcessing = false;

  public async extractAndLearn(
    userMessage: string,
    assistantReply: string,
    sourceMessageId?: number
  ): Promise<ExtractedFact[]> {
    if (this.isProcessing) {
      return [];
    }

    const isPaused = (await browserStore.getSetting('orchestrator_paused')) === 'true';
    if (isPaused) {
      await browserStore.logOrchestrator('MemoryWorker', 'skip', 'paused', 'Pętla douczania wstrzymana');
      return [];
    }

    const cleanUser = userMessage.trim();
    if (cleanUser.length < 5 || /^(cześć|hej|siema|ok|dobra|dzięki|super|jasne|aha|pa)$/i.test(cleanUser)) {
      return [];
    }

    this.isProcessing = true;

    try {
      const apiKey = await browserOpenRouter.getApiKey();

      // Tryb 1: Jeśli mamy klucz OpenRouter, używamy dedykowanego modelu ekstrakcji
      if (apiKey) {
        const extractionPrompt: ChatMessage[] = [
          {
            role: 'system',
            content: `Jesteś wyspecjalizowanym modułem ekstrakcji wiedzy długoterminowej (Cognitive Memory Extractor).
Twoim zadaniem jest wyciągnięcie z wypowiedzi użytkownika trwałych faktów, które model powinien ZAPAMIĘTAĆ na zawsze.

Kategorie:
- 'user_profile': fakty o użytkowniku (imię, zawód, rodzina, zwierzęta, gdzie mieszka, co robi).
- 'preference': preferencje, upodobania, antypatie użytkownika.
- 'correction': sytuacja, gdy użytkownik poprawia błąd asystenta lub uczy go nowej reguły ("Nie, X to Y", "od teraz pamiętaj, że...").
- 'world_knowledge': unikalne definicje, fakty techniczne lub fakty o świecie przekazane przez użytkownika.

Zasady:
1. Zwróć WYŁĄCZNIE czysty JSON w postaci tablicy obiektów. Żadnego tekstu przed ani po.
2. Jeśli w wypowiedzi nie ma żadnych trwałych faktów do zapamiętania, zwróć pustą tablicę [].
3. Format każdego elementu:
{
  "category": "user_profile" | "preference" | "correction" | "world_knowledge",
  "subject": "np. Użytkownik, Pies użytkownika, Projekt X",
  "predicate": "np. mieszka w, ma na imię, jest, lubi, poprawił",
  "object": "np. Gdańsk, Borys, architektem, programowanie w Rust",
  "confidence": 0.95
}`
          },
          {
            role: 'user',
            content: `Wypowiedź użytkownika: "${userMessage}"\nOdpowiedź asystenta: "${assistantReply}"`
          }
        ];

        const extractionModel =
          (await browserStore.getSetting('extraction_model')) || DEFAULT_CLIENT_CONFIG.DEFAULT_EXTRACTION_MODEL;

        const result = await browserOpenRouter.chatCompletion(
          extractionPrompt,
          extractionModel,
          'worker_memory_extraction',
          0.1
        );

        let jsonStr = result.content.trim();
        if (jsonStr.startsWith('```json')) {
          jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '').trim();
        } else if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '').trim();
        }

        const facts: ExtractedFact[] = JSON.parse(jsonStr);
        if (Array.isArray(facts) && facts.length > 0) {
          for (const fact of facts) {
            if (fact.subject && fact.predicate && fact.object) {
              await browserStore.saveLearnedFact(
                fact.category || 'world_knowledge',
                fact.subject,
                fact.predicate,
                fact.object,
                fact.confidence || 1.0,
                sourceMessageId
              );
            }
          }

          await browserStore.logOrchestrator(
            'MemoryWorker',
            'learned_facts',
            'success',
            `Zapisano ${facts.length} faktów w IndexedDB: ${facts.map((f) => `${f.subject} ${f.predicate} ${f.object}`).join('; ')}`
          );
          return facts;
        }
      } else {
        // Tryb 2: Tryb piaskownicy (Sandbox Heuristic Extraction)
        const heuristicFacts = browserSandbox.extractHeuristicFacts(userMessage);
        if (heuristicFacts.length > 0) {
          for (const fact of heuristicFacts) {
            await browserStore.saveLearnedFact(
              fact.category,
              fact.subject,
              fact.predicate,
              fact.object,
              fact.confidence || 0.95,
              sourceMessageId
            );
          }

          await browserStore.logOrchestrator(
            'MemoryWorker',
            'learned_facts_sandbox',
            'success',
            `[Tryb Sandbox] Zapisano ${heuristicFacts.length} faktów w IndexedDB`
          );
          return heuristicFacts;
        }
      }

      return [];
    } catch (err: any) {
      console.warn('[BrowserMemoryWorker] Błąd ekstrakcji:', err.message);
      await browserStore.logOrchestrator('MemoryWorker', 'extraction_error', 'failed', err.message);
      return [];
    } finally {
      this.isProcessing = false;
    }
  }
}

export const browserMemoryWorker = new BrowserMemoryWorker();
