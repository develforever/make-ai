import { openRouterClient, ChatMessage } from '../services/openRouter.js';
import { database } from '../db/database.js';
import { DEFAULT_CONFIG } from '../config.js';

export interface ExtractedFact {
  category: 'user_profile' | 'world_knowledge' | 'correction' | 'preference';
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

export class MemoryWorker {
  private isProcessing = false;

  /**
   * Asynchronicznie ekstrahuje trwałą wiedzę i relacje z ostatniej tury dialogu
   */
  public async extractAndLearn(userMessage: string, assistantReply: string, sourceMessageId?: number): Promise<ExtractedFact[]> {
    if (this.isProcessing) {
      // Zapobiega równoczesnemu wyścigowi wątków w tle
      return [];
    }

    const isPaused = database.getSetting('orchestrator_paused') === 'true';
    if (isPaused) {
      database.logOrchestrator('MemoryWorker', 'skip', 'paused', 'Orkiestrator jest wstrzymany');
      return [];
    }

    // Krótkie wiadomości bezwartościowe informacyjnie pomijamy bez marnowania tokenów
    const cleanUser = userMessage.trim();
    if (cleanUser.length < 5 || /^(cześć|hej|siema|ok|dobra|dzięki|super|jasne|aha|pa)$/i.test(cleanUser)) {
      return [];
    }

    this.isProcessing = true;

    try {
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
2. Jeśli w wypowiedzi nie ma żadnych trwałych faktów do zapamiętania (np. pytanie, powitanie, luźny komentarz), zwróć pustą tablicę [].
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

      const extractionModel = database.getSetting('extraction_model') || DEFAULT_CONFIG.DEFAULT_EXTRACTION_MODEL;
      const result = await openRouterClient.chatCompletion(
        extractionPrompt,
        extractionModel,
        'worker_memory_extraction',
        0.1
      );

      // Wyciągnij JSON z odpowiedzi
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
            database.saveLearnedFact(
              fact.category || 'world_knowledge',
              fact.subject,
              fact.predicate,
              fact.object,
              fact.confidence || 1.0,
              sourceMessageId
            );
          }
        }

        database.logOrchestrator(
          'MemoryWorker',
          'learned_facts',
          'success',
          `Zapisano ${facts.length} nowych faktów: ${facts.map(f => `${f.subject} ${f.predicate} ${f.object}`).join('; ')}`
        );
      }

      return facts;
    } catch (err: any) {
      database.logOrchestrator('MemoryWorker', 'extraction_error', 'failed', err.message);
      return [];
    } finally {
      this.isProcessing = false;
    }
  }
}

export const memoryWorker = new MemoryWorker();
