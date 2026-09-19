import type { ExtractedFact, Message, ChatFolder, ChatSession, SearchResult } from '../types';

export class BrowserCognitiveStore {
  private dbName = 'MakeAI_CognitiveDB';
  private dbVersion = 2;
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    this.dbPromise = this.initDB();
  }

  private initDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = (event.target as IDBOpenDBRequest).transaction;

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
          const convStore = db.createObjectStore('conversations', { keyPath: 'id', autoIncrement: true });
          convStore.createIndex('session_id', 'session_id', { unique: false });
        } else if (transaction && db.objectStoreNames.contains('conversations')) {
          const convStore = transaction.objectStore('conversations');
          if (!convStore.indexNames.contains('session_id')) {
            convStore.createIndex('session_id', 'session_id', { unique: false });
          }
        }
        if (!db.objectStoreNames.contains('wiki_cache')) {
          db.createObjectStore('wiki_cache', { keyPath: 'query' });
        }
        if (!db.objectStoreNames.contains('orchestrator_logs')) {
          db.createObjectStore('orchestrator_logs', { keyPath: 'id', autoIncrement: true });
        }

        // Nowe magazyny dla sesji i folderów (v2)
        if (!db.objectStoreNames.contains('chat_folders')) {
          db.createObjectStore('chat_folders', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('chat_sessions')) {
          const sessionStore = db.createObjectStore('chat_sessions', { keyPath: 'id' });
          sessionStore.createIndex('is_pinned', 'is_pinned', { unique: false });
          sessionStore.createIndex('is_archived', 'is_archived', { unique: false });
          sessionStore.createIndex('folder_id', 'folder_id', { unique: false });
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

    // Seed default session if not exists
    if (db.objectStoreNames.contains('chat_sessions')) {
      const sessTx = db.transaction('chat_sessions', 'readwrite');
      const sessStore = sessTx.objectStore('chat_sessions');
      const getSess = sessStore.get('default');
      getSess.onsuccess = () => {
        if (!getSess.result) {
          const now = new Date().toISOString();
          sessStore.put({
            id: 'default',
            title: 'Główna sesja',
            folder_id: null,
            is_pinned: false,
            is_archived: false,
            created_at: now,
            updated_at: now,
            summary: null
          });
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

  // Folders
  public async getFolders(): Promise<ChatFolder[]> {
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction('chat_folders', 'readonly');
      const req = tx.objectStore('chat_folders').getAll();
      req.onsuccess = () => {
        const folders = (req.result || []) as ChatFolder[];
        folders.sort((a, b) => a.name.localeCompare(b.name));
        resolve(folders);
      };
      req.onerror = () => resolve([]);
    });
  }

  public async saveFolder(name: string, color?: string, id?: string): Promise<string> {
    const db = await this.dbPromise;
    const folderId = id || `folder_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const folder: ChatFolder = {
      id: folderId,
      name: name.trim(),
      created_at: now,
      updated_at: now,
      color: color || '#06b6d4'
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction('chat_folders', 'readwrite');
      const req = tx.objectStore('chat_folders').put(folder);
      req.onsuccess = () => resolve(folderId);
      req.onerror = () => reject(req.error);
    });
  }

  public async deleteFolder(id: string): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['chat_folders', 'chat_sessions'], 'readwrite');
      const folderStore = tx.objectStore('chat_folders');
      const sessionStore = tx.objectStore('chat_sessions');

      folderStore.delete(id);

      const req = sessionStore.getAll();
      req.onsuccess = () => {
        const sessions = (req.result || []) as ChatSession[];
        for (const s of sessions) {
          if (s.folder_id === id) {
            s.folder_id = null;
            sessionStore.put(s);
          }
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Sessions
  public async getSessions(options?: { includeArchived?: boolean; folderId?: string | null }): Promise<ChatSession[]> {
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction(['chat_sessions', 'conversations'], 'readonly');
      const sessionStore = tx.objectStore('chat_sessions');
      const convStore = tx.objectStore('conversations');

      const sessReq = sessionStore.getAll();
      const convReq = convStore.getAll();

      let sessions: ChatSession[] = [];
      let messages: any[] = [];

      let completed = 0;
      const checkDone = () => {
        completed++;
        if (completed === 2) {
          // Policz wiadomości i podgląd dla każdej sesji
          const msgMap = new Map<string, any[]>();
          for (const m of messages) {
            const sId = m.session_id || 'default';
            if (!msgMap.has(sId)) msgMap.set(sId, []);
            msgMap.get(sId)!.push(m);
          }

          let filtered = sessions.map((s) => {
            const sMsgs = msgMap.get(s.id) || [];
            const lastMsg = sMsgs[sMsgs.length - 1];
            return {
              ...s,
              is_pinned: Boolean(s.is_pinned),
              is_archived: Boolean(s.is_archived),
              message_count: sMsgs.length,
              last_message_preview: lastMsg?.content
            };
          });

          if (!options?.includeArchived) {
            filtered = filtered.filter((s) => !s.is_archived);
          }

          if (options?.folderId !== undefined) {
            if (options.folderId === null) {
              filtered = filtered.filter((s) => !s.folder_id);
            } else {
              filtered = filtered.filter((s) => s.folder_id === options.folderId);
            }
          }

          filtered.sort((a, b) => {
            if (a.is_pinned && !b.is_pinned) return -1;
            if (!a.is_pinned && b.is_pinned) return 1;
            return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
          });

          resolve(filtered);
        }
      };

      sessReq.onsuccess = () => {
        sessions = (sessReq.result || []) as ChatSession[];
        checkDone();
      };
      sessReq.onerror = () => {
        sessions = [];
        checkDone();
      };

      convReq.onsuccess = () => {
        messages = convReq.result || [];
        checkDone();
      };
      convReq.onerror = () => {
        messages = [];
        checkDone();
      };
    });
  }

  public async getSession(id: string): Promise<ChatSession | null> {
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction('chat_sessions', 'readonly');
      const req = tx.objectStore('chat_sessions').get(id);
      req.onsuccess = () => resolve(req.result ? (req.result as ChatSession) : null);
      req.onerror = () => resolve(null);
    });
  }

  public async createSession(title?: string, folderId?: string | null, id?: string): Promise<ChatSession> {
    const db = await this.dbPromise;
    const sessionId = id || `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: sessionId,
      title: title || 'Nowa rozmowa',
      folder_id: folderId || null,
      is_pinned: false,
      is_archived: false,
      created_at: now,
      updated_at: now,
      summary: null,
      message_count: 0
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction('chat_sessions', 'readwrite');
      const req = tx.objectStore('chat_sessions').put(session);
      req.onsuccess = () => resolve(session);
      req.onerror = () => reject(req.error);
    });
  }

  public async updateSession(id: string, updates: Partial<ChatSession>): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chat_sessions', 'readwrite');
      const store = tx.objectStore('chat_sessions');
      const req = store.get(id);

      req.onsuccess = () => {
        if (!req.result) {
          return resolve();
        }
        const updated = {
          ...req.result,
          ...updates,
          updated_at: new Date().toISOString()
        };
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async deleteSession(id: string): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['chat_sessions', 'conversations'], 'readwrite');
      const sessionStore = tx.objectStore('chat_sessions');
      const convStore = tx.objectStore('conversations');

      sessionStore.delete(id);

      // Usunięcie powiązanych wiadomości
      const convReq = convStore.getAll();
      convReq.onsuccess = () => {
        const all = convReq.result || [];
        for (const m of all) {
          if ((m.session_id || 'default') === id) {
            convStore.delete(m.id);
          }
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async touchSession(id: string): Promise<void> {
    await this.updateSession(id, {});
  }

  // Conversations (Messages)
  public async saveMessage(
    role: 'user' | 'assistant' | 'system',
    content: string,
    model?: string,
    metadata?: string,
    sessionId: string = 'default'
  ): Promise<number> {
    const db = await this.dbPromise;
    const timestamp = new Date().toISOString();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(['conversations', 'chat_sessions'], 'readwrite');
      const convStore = tx.objectStore('conversations');
      const sessStore = tx.objectStore('chat_sessions');

      // Dotknij sesję, aby zaktualizować jej timestamp
      const sessReq = sessStore.get(sessionId);
      sessReq.onsuccess = () => {
        if (sessReq.result) {
          sessReq.result.updated_at = timestamp;
          sessStore.put(sessReq.result);
        } else if (sessionId !== 'default') {
          sessStore.put({
            id: sessionId,
            title: 'Nowa rozmowa',
            folder_id: null,
            is_pinned: false,
            is_archived: false,
            created_at: timestamp,
            updated_at: timestamp,
            summary: null
          });
        }
      };

      const req = convStore.add({
        role,
        content,
        timestamp,
        model: model || null,
        metadata: metadata || null,
        session_id: sessionId
      });
      req.onsuccess = () => resolve(Number(req.result));
      req.onerror = () => reject(req.error);
    });
  }

  public async getRecentMessages(limit: number = 30, sessionId: string = 'default'): Promise<Message[]> {
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction('conversations', 'readonly');
      const req = tx.objectStore('conversations').getAll();

      req.onsuccess = () => {
        const all: any[] = req.result || [];
        const sessionMsgs = all.filter((m) => (m.session_id || 'default') === sessionId);

        const parsed: Message[] = sessionMsgs.map((m) => {
          let wikiData = undefined;
          let learnedData = undefined;
          if (m.metadata) {
            try {
              const meta = JSON.parse(m.metadata);
              if (meta.wiki) wikiData = meta.wiki;
              if (meta.learned) learnedData = meta.learned;
            } catch {}
          }
          return {
            id: m.id,
            session_id: m.session_id || 'default',
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
            model: m.model,
            wiki: wikiData,
            learnedFacts: learnedData
          };
        });
        resolve(parsed.slice(-limit));
      };
      req.onerror = () => resolve([]);
    });
  }

  public async clearConversations(sessionId?: string): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction('conversations', 'readwrite');
      const store = tx.objectStore('conversations');

      if (!sessionId) {
        store.clear();
      } else {
        const req = store.getAll();
        req.onsuccess = () => {
          const all = req.result || [];
          for (const m of all) {
            if ((m.session_id || 'default') === sessionId) {
              store.delete(m.id);
            }
          }
        };
      }
      tx.oncomplete = () => resolve();
    });
  }

  // Global Search across sessions and messages
  public async searchAllSessions(query: string): Promise<SearchResult[]> {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];

    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction(['chat_sessions', 'conversations'], 'readonly');
      const sessStore = tx.objectStore('chat_sessions');
      const convStore = tx.objectStore('conversations');

      const sessReq = sessStore.getAll();
      const convReq = convStore.getAll();

      let sessions: ChatSession[] = [];
      let messages: any[] = [];
      let doneCount = 0;

      const finishSearch = () => {
        doneCount++;
        if (doneCount === 2) {
          const resultsMap = new Map<string, SearchResult>();

          // 1. Dopasowania tytułów
          for (const s of sessions) {
            if (s.title.toLowerCase().includes(trimmed)) {
              resultsMap.set(s.id, {
                session: { ...s, is_pinned: Boolean(s.is_pinned), is_archived: Boolean(s.is_archived) },
                matches: []
              });
            }
          }

          // 2. Dopasowania treści wiadomości
          for (const m of messages) {
            if (m.content && m.content.toLowerCase().includes(trimmed)) {
              const sId = m.session_id || 'default';
              let entry = resultsMap.get(sId);
              if (!entry) {
                const s = sessions.find((item) => item.id === sId);
                if (s) {
                  entry = {
                    session: { ...s, is_pinned: Boolean(s.is_pinned), is_archived: Boolean(s.is_archived) },
                    matches: []
                  };
                  resultsMap.set(sId, entry);
                }
              }
              if (entry) {
                const idx = m.content.toLowerCase().indexOf(trimmed);
                const start = Math.max(0, idx - 40);
                const end = Math.min(m.content.length, idx + trimmed.length + 40);
                const snippet =
                  (start > 0 ? '...' : '') +
                  m.content.substring(start, end) +
                  (end < m.content.length ? '...' : '');

                entry.matches.push({
                  messageId: m.id,
                  content: m.content,
                  role: m.role,
                  timestamp: m.timestamp,
                  snippet
                });
              }
            }
          }

          resolve(Array.from(resultsMap.values()));
        }
      };

      sessReq.onsuccess = () => {
        sessions = (sessReq.result || []) as ChatSession[];
        finishSearch();
      };
      sessReq.onerror = () => {
        sessions = [];
        finishSearch();
      };

      convReq.onsuccess = () => {
        messages = convReq.result || [];
        finishSearch();
      };
      convReq.onerror = () => {
        messages = [];
        finishSearch();
      };
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
