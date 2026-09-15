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

interface QueueTask {
  userMessage: string;
  assistantReply: string;
  sourceMessageId?: number;
  resolve: (facts: ExtractedFact[]) => void;
}

export class MemoryWorker {
  private queue: QueueTask[] = [];
  private isProcessing = false;
  // Transient memory buffer: facts held in RAM during active turns
  private transientFacts: ExtractedFact[] = [];

  public getTransientFacts(): ExtractedFact[] {
    return [...this.transientFacts];
  }

  /**
   * Enqueues an extraction task into FIFO queue, preventing race condition drops.
   */
  public enqueue(userMessage: string, assistantReply: string, sourceMessageId?: number): Promise<ExtractedFact[]> {
    return new Promise((resolve) => {
      this.queue.push({
        userMessage,
        assistantReply,
        sourceMessageId,
        resolve
      });
      this.processQueue();
    });
  }

  public async extractAndLearn(userMessage: string, assistantReply: string, sourceMessageId?: number): Promise<ExtractedFact[]> {
    return this.enqueue(userMessage, assistantReply, sourceMessageId);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const task = this.queue.shift();
    if (!task) {
      this.isProcessing = false;
      return;
    }

    try {
      const facts = await this.executeExtraction(task.userMessage, task.assistantReply, task.sourceMessageId);
      task.resolve(facts);
    } catch (err: any) {
      database.logOrchestrator('MemoryWorker', 'queue_task_error', 'failed', err.message);
      task.resolve([]);
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0) {
        setImmediate(() => this.processQueue());
      }
    }
  }

  /**
   * Performs the actual extraction with self-healing JSON parsing and SQLite transaction.
   */
  private async executeExtraction(userMessage: string, assistantReply: string, sourceMessageId?: number): Promise<ExtractedFact[]> {
    const isPaused = database.getSetting('orchestrator_paused') === 'true';
    if (isPaused) {
      database.logOrchestrator('MemoryWorker', 'skip', 'paused', 'Orkiestrator jest wstrzymany');
      return [];
    }

    const cleanUser = userMessage.trim();
    if (cleanUser.length < 5 || /^(cześć|hej|siema|ok|dobra|dzięki|super|jasne|aha|pa|bye|hello|hi)$/i.test(cleanUser)) {
      return [];
    }

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

    const rawContent = result.content.trim();
    const facts = this.parseWithSelfHealing(rawContent);

    if (facts.length > 0) {
      for (const fact of facts) {
        database.saveLearnedFact(
          fact.category,
          fact.subject,
          fact.predicate,
          fact.object,
          fact.confidence,
          sourceMessageId
        );
      }

      // Add to transient buffer (keeping last 20 transient facts in memory)
      this.transientFacts.push(...facts);
      if (this.transientFacts.length > 20) {
        this.transientFacts = this.transientFacts.slice(-20);
      }

      database.logOrchestrator(
        'MemoryWorker',
        'learned_facts',
        'success',
        `Zapisano ${facts.length} nowych faktów: ${facts.map(f => `${f.subject} ${f.predicate} ${f.object}`).join('; ')}`
      );
    }

    return facts;
  }

  /**
   * Self-healing parser handling markdown code blocks, truncated brackets, and invalid schema.
   */
  public parseWithSelfHealing(text: string): ExtractedFact[] {
    let clean = text.trim();

    // 1. Strip markdown fences
    if (clean.includes('```json')) {
      const match = clean.match(/```json\s*([\s\S]*?)\s*```/);
      if (match && match[1]) {
        clean = match[1].trim();
      }
    } else if (clean.includes('```')) {
      const match = clean.match(/```\s*([\s\S]*?)\s*```/);
      if (match && match[1]) {
        clean = match[1].trim();
      }
    }

    // 2. Find outermost array [ ... ]
    const startIdx = clean.indexOf('[');
    if (startIdx === -1) {
      // Check if it's a single object { ... } instead of an array
      const objStart = clean.indexOf('{');
      if (objStart !== -1) {
        clean = `[${clean.slice(objStart)}]`;
      } else {
        return [];
      }
    } else {
      clean = clean.slice(startIdx);
    }

    // 3. Self-healing bracket completion if truncated
    clean = this.repairJsonString(clean);

    let parsed: any;
    try {
      parsed = JSON.parse(clean);
    } catch {
      // Secondary heuristic recovery: extract individual objects using regex
      parsed = this.recoverObjectsFromMalformedJson(clean);
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    // 4. Strict Schema Validation & Sanitization
    const validated: ExtractedFact[] = [];
    const validCategories = new Set(['user_profile', 'world_knowledge', 'correction', 'preference']);

    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const sub = String(item.subject || '').trim();
      const pred = String(item.predicate || '').trim();
      const obj = String(item.object || '').trim();

      if (sub.length > 0 && pred.length > 0 && obj.length > 0) {
        let cat = String(item.category || 'world_knowledge').toLowerCase().trim();
        if (!validCategories.has(cat)) {
          cat = 'world_knowledge';
        }

        const conf = typeof item.confidence === 'number' && !isNaN(item.confidence)
          ? Math.max(0.1, Math.min(1.0, item.confidence))
          : 0.95;

        validated.push({
          category: cat as any,
          subject: sub,
          predicate: pred,
          object: obj,
          confidence: conf
        });
      }
    }

    return validated;
  }

  private repairJsonString(jsonStr: string): string {
    let s = jsonStr.trim();
    // Count curly and square brackets
    let openCurly = 0;
    let openSquare = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < s.length; i++) {
      const char = s[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{') openCurly++;
        if (char === '}') openCurly = Math.max(0, openCurly - 1);
        if (char === '[') openSquare++;
        if (char === ']') openSquare = Math.max(0, openSquare - 1);
      }
    }

    if (inString) {
      s += '"';
    }
    while (openCurly > 0) {
      s += '}';
      openCurly--;
    }
    while (openSquare > 0) {
      s += ']';
      openSquare--;
    }

    return s;
  }

  private recoverObjectsFromMalformedJson(text: string): any[] {
    const objects: any[] = [];
    // Match potential json objects like {"subject": ..., "predicate": ..., "object": ...}
    const regex = /\{[^{}]*?"subject"[^{}]*?"predicate"[^{}]*?"object"[^{}]*?\}/g;
    const matches = text.match(regex);
    if (matches) {
      for (const m of matches) {
        try {
          objects.push(JSON.parse(m));
        } catch {
          // ignore individual unparsable chunk
        }
      }
    }
    return objects;
  }
}

export const memoryWorker = new MemoryWorker();
