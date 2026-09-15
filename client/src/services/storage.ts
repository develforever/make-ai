import type { ExtractedFact, Message } from '../types';

export class BrowserCognitiveStore {
  private dbName = 'MakeAI_CognitiveDB';
  private dbVersion = 1;
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    this.dbPromise = this.initDB();
  }

  private initDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('learned_facts')) {
          const store = db.createObjectStore('learned_facts', { keyPath: 'id', autoIncrement: true });
          store.createIndex('is_active', 'is_active', { unique: false });
          store.createIndex('category', 'category', { unique: false });
        }
        if (!db.objectStoreNames.contains('budget_ledger')) {
          db.createObjectStore('budget_ledger', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('conversations')) {
          db.createObjectStore('conversations', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('wiki_cache')) {
          db.createObjectStore('wiki_cache', { keyPath: 'query' });
        }
        if (!db.objectStoreNames.contains('orchestrator_logs')) {
          db.createObjectStore('orchestrator_logs', { keyPath: 'id', autoIncrement: true });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        this.seedDefaults(db);
        resolve(db);
      };

      request.onerror = () => reject(request.error);
    });
  }

  private async seedDefaults(db: IDBDatabase) {
    const defaults = [
      { key: 'total_budget_usd', value: '2.00' },
      { key: 'agent_name', value: 'Aura' },
      { key: 'chat_model', value: 'openrouter/free' },
      { key: 'extraction_model', value: 'google/gemini-2.5-flash-lite' },
      { key: 'orchestrator_paused', value: 'false' },
      { key: 'sandbox_mode', value: 'false' },
      { key: 'use_local_ollama', value: 'false' },
      { key: 'local_ollama_url', value: 'http://localhost:11434' }
    ];

    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');

    for (const item of defaults) {
      const getReq = store.get(item.key);
      getReq.onsuccess = () => {
        if (!getReq.result) {
          store.put(item);
        }
      };
    }
  }

  // Settings
  public async getSetting(key: string): Promise<string | null> {
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction('settings', 'readonly');
      const req = tx.objectStore('settings').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => resolve(null);
    });
  }

  public async setSetting(key: string, value: string): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const req = tx.objectStore('settings').put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Learned Facts
  public async saveLearnedFact(
    category: string,
    subject: string,
    predicate: string,
    object: string,
    confidence: number = 1.0,
    sourceMessageId?: number
  ): Promise<number> {
    const db = await this.dbPromise;
    const createdAt = new Date().toISOString();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('learned_facts', 'readwrite');
      const store = tx.objectStore('learned_facts');

      // Deaktywuj poprzednie fakty na ten sam temat i relację (korekta wiedzy)
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const item = cursor.value;
          if (
            item.is_active === 1 &&
            item.subject.toLowerCase() === subject.toLowerCase() &&
            item.predicate.toLowerCase() === predicate.toLowerCase()
          ) {
            item.is_active = 0;
            cursor.update(item);
          }
          cursor.continue();
        }
      };

      const addReq = store.add({
        category,
        subject,
        predicate,
        object,
        confidence,
        created_at: createdAt,
        source_message_id: sourceMessageId || null,
        is_active: 1
      });

      addReq.onsuccess = () => resolve(Number(addReq.result));
      addReq.onerror = () => reject(addReq.error);
    });
  }

  public async getActiveLearnedFacts(limit: number = 100): Promise<ExtractedFact[]> {
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction('learned_facts', 'readonly');
      const store = tx.objectStore('learned_facts');
      const req = store.getAll();

      req.onsuccess = () => {
        const all: ExtractedFact[] = req.result || [];
        const active = all.filter((f) => f.is_active === 1).reverse().slice(0, limit);
        resolve(active);
      };
      req.onerror = () => resolve([]);
    });
  }

  public async deleteFact(id: number): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction('learned_facts', 'readwrite');
      const store = tx.objectStore('learned_facts');
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        if (getReq.result) {
          const fact = getReq.result;
          fact.is_active = 0;
          store.put(fact);
        }
        resolve();
      };
      getReq.onerror = () => resolve();
    });
  }

  public async clearAllFacts(): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction('learned_facts', 'readwrite');
      tx.objectStore('learned_facts').clear();
      tx.oncomplete = () => resolve();
    });
  }

  // Conversations
  public async saveMessage(role: 'user' | 'assistant' | 'system', content: string, model?: string, metadata?: string): Promise<number> {
    const db = await this.dbPromise;
    const timestamp = new Date().toISOString();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('conversations', 'readwrite');
      const store = tx.objectStore('conversations');
      const req = store.add({ role, content, timestamp, model: model || null, metadata: metadata || null });
      req.onsuccess = () => resolve(Number(req.result));
      req.onerror = () => reject(req.error);
    });
  }

  public async getRecentMessages(limit: number = 30): Promise<Message[]> {
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction('conversations', 'readonly');
      const req = tx.objectStore('conversations').getAll();

      req.onsuccess = () => {
        const all: any[] = req.result || [];
        const parsed = all.map((m) => {
          let wikiData = undefined;
          if (m.metadata) {
            try {
              const meta = JSON.parse(m.metadata);
              if (meta.wiki) wikiData = meta.wiki;
            } catch {}
          }
          return {
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
            model: m.model,
            wiki: wikiData
          };
        });
        resolve(parsed.slice(-limit));
      };
      req.onerror = () => resolve([]);
    });
  }

  public async clearConversations(): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction('conversations', 'readwrite');
      tx.objectStore('conversations').clear();
      tx.oncomplete = () => resolve();
    });
  }

  // Budget
  public async logBudgetUsage(model: string, promptTokens: number, completionTokens: number, costUsd: number, purpose: string): Promise<void> {
    const db = await this.dbPromise;
    const timestamp = new Date().toISOString();

    return new Promise((resolve) => {
      const tx = db.transaction('budget_ledger', 'readwrite');
      tx.objectStore('budget_ledger').add({
        timestamp,
        model,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        cost_usd: costUsd,
        purpose
      });
      tx.oncomplete = () => resolve();
    });
  }

  public async getBudgetSummary(): Promise<{ totalSpentUsd: number; totalTokens: number; ledgerCount: number; ledger: any[] }> {
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction('budget_ledger', 'readonly');
      const req = tx.objectStore('budget_ledger').getAll();

      req.onsuccess = () => {
        const rows: any[] = req.result || [];
        let totalSpentUsd = 0;
        let totalTokens = 0;

        for (const r of rows) {
          totalSpentUsd += r.cost_usd || 0;
          totalTokens += (r.prompt_tokens || 0) + (r.completion_tokens || 0);
        }

        resolve({
          totalSpentUsd: Number(totalSpentUsd.toFixed(6)),
          totalTokens,
          ledgerCount: rows.length,
          ledger: rows.reverse().slice(0, 15)
        });
      };
      req.onerror = () => resolve({ totalSpentUsd: 0, totalTokens: 0, ledgerCount: 0, ledger: [] });
    });
  }

  // Wiki Cache
  public async getCachedWiki(query: string): Promise<any> {
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction('wiki_cache', 'readonly');
      const req = tx.objectStore('wiki_cache').get(query.toLowerCase());
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  public async saveCachedWiki(query: string, title: string, summary: string, url: string): Promise<void> {
    const db = await this.dbPromise;
    const fetchedAt = new Date().toISOString();

    return new Promise((resolve) => {
      const tx = db.transaction('wiki_cache', 'readwrite');
      tx.objectStore('wiki_cache').put({
        query: query.toLowerCase(),
        title,
        summary,
        url,
        fetched_at: fetchedAt
      });
      tx.oncomplete = () => resolve();
    });
  }

  // Orchestrator Logs
  public async logOrchestrator(worker: string, action: string, status: string, details?: string): Promise<void> {
    const db = await this.dbPromise;
    const timestamp = new Date().toISOString();

    return new Promise((resolve) => {
      const tx = db.transaction('orchestrator_logs', 'readwrite');
      tx.objectStore('orchestrator_logs').add({ timestamp, worker, action, status, details: details || null });
      tx.oncomplete = () => resolve();
    });
  }

  public async getRecentLogs(limit: number = 30): Promise<any[]> {
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction('orchestrator_logs', 'readonly');
      const req = tx.objectStore('orchestrator_logs').getAll();
      req.onsuccess = () => {
        const rows: any[] = req.result || [];
        resolve(rows.reverse().slice(0, limit));
      };
      req.onerror = () => resolve([]);
    });
  }
}

export const browserStore = new BrowserCognitiveStore();
