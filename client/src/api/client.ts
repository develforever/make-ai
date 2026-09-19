import type { BudgetStatus, KeyStatus, ExtractedFact, OrchestratorStatus, Message, KANTelemetry, ChatFolder, ChatSession, SearchResult } from '../types';
import { browserStore } from '../services/storage';
import { browserCostGuard } from '../services/costGuard';
import { browserOrchestrator } from '../services/orchestrator';
import { browserOpenRouter } from '../services/openRouter';

const API_BASE = '/api';

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting' | 'browser-native';

export class BackendConnectionManager {
  private status: ConnectionStatus = 'disconnected';
  private lastCheckTime: number = 0;
  private checkIntervalMs: number = 10000;
  private retryIntervalMs: number = 3000;
  private heartbeatTimer: any = null;
  private inFlightCheck: Promise<boolean> | null = null;
  private isSyncing: boolean = false;
  private wasDisconnected: boolean = false;
  private listeners: Set<(status: ConnectionStatus) => void> = new Set();
  private readonly isStaticHost: boolean;

  constructor() {
    this.isStaticHost =
      typeof window !== 'undefined' &&
      (window.location.hostname.includes('github.io') || window.location.protocol === 'file:');

    if (this.isStaticHost) {
      this.status = 'browser-native';
    } else if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.checkBackend(true);
      });
      window.addEventListener('offline', () => {
        this.updateStatus('disconnected');
      });
      this.startHeartbeat();
    }
  }

  public subscribe(listener: (status: ConnectionStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private updateStatus(newStatus: ConnectionStatus) {
    if (this.status !== newStatus) {
      const prev = this.status;
      this.status = newStatus;
      this.notify(newStatus);

      // Trigger automatic sync reconciliation on reconnect
      if (prev === 'disconnected' && newStatus === 'connected') {
        this.reconcileOfflineData().catch((err) => {
          console.warn('[BackendConnectionManager] Reconnect sync warning:', err);
        });
      }
    }
  }

  private notify(s: ConnectionStatus) {
    for (const l of this.listeners) {
      try {
        l(s);
      } catch (err) {
        console.error('[ConnectionManager] listener error:', err);
      }
    }
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public isConnected(): boolean {
    return this.status === 'connected';
  }

  public async checkBackend(force: boolean = false): Promise<boolean> {
    if (this.isStaticHost) {
      this.status = 'browser-native';
      return false;
    }

    const now = Date.now();
    // Return cached state if checked recently (within 2s) unless force is true
    if (!force && now - this.lastCheckTime < 2000 && this.status === 'connected') {
      return true;
    }

    if (this.inFlightCheck) {
      return this.inFlightCheck;
    }

    this.inFlightCheck = (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${API_BASE}/budget`, {
          signal: controller.signal,
          cache: 'no-store'
        });
        clearTimeout(timeoutId);

        this.lastCheckTime = Date.now();
        if (res.ok) {
          const justReconnected = this.wasDisconnected;
          this.wasDisconnected = false;
          this.updateStatus('connected');
          if (justReconnected) {
            console.info('[BackendConnectionManager] Reconnected to Fastify backend. Executing sync reconciliation.');
          }
          return true;
        } else {
          this.wasDisconnected = true;
          this.updateStatus('disconnected');
          return false;
        }
      } catch {
        this.lastCheckTime = Date.now();
        this.wasDisconnected = true;
        this.updateStatus('disconnected');
        return false;
      } finally {
        this.inFlightCheck = null;
      }
    })();

    return this.inFlightCheck;
  }

  public startHeartbeat() {
    if (this.isStaticHost || this.heartbeatTimer) return;

    const tick = async () => {
      await this.checkBackend();
      const nextDelay = this.status === 'connected' ? this.checkIntervalMs : this.retryIntervalMs;
      this.heartbeatTimer = setTimeout(tick, nextDelay);
    };

    this.heartbeatTimer = setTimeout(tick, 300);
  }

  public stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Sync Reconciliation Bridge:
   * Gdy klient pracował offline w IndexedDB, po wznowieniu połączenia z serwerem
   * uzgadnia lokalne foldery, sesje i wiadomości z bazą serwerową SQLite.
   */
  public async reconcileOfflineData(): Promise<void> {
    if (this.isSyncing || this.status !== 'connected') return;
    this.isSyncing = true;

    try {
      // 1. Zbierz lokalne dane z IndexedDB
      const [localFolders, localSessions] = await Promise.all([
        browserStore.getFolders(),
        browserStore.getSessions({ includeArchived: true })
      ]);

      const localMessagesBySession: Record<string, Message[]> = {};
      for (const sess of localSessions) {
        const msgs = await browserStore.getRecentMessages(100, sess.id);
        if (msgs && msgs.length > 0) {
          localMessagesBySession[sess.id] = msgs;
        }
      }

      // 2. Pobierz aktualny stan serwera
      const [serverFoldersRes, serverSessionsRes] = await Promise.all([
        fetch(`${API_BASE}/folders`).then((r) => (r.ok ? r.json() : { folders: [] })).catch(() => ({ folders: [] })),
        fetch(`${API_BASE}/sessions?includeArchived=true`).then((r) => (r.ok ? r.json() : { sessions: [] })).catch(() => ({ sessions: [] }))
      ]);

      const serverFolders: ChatFolder[] = serverFoldersRes.folders || [];
      const serverSessions: ChatSession[] = serverSessionsRes.sessions || [];
      const serverFolderIds = new Set(serverFolders.map((f) => f.id));
      const serverSessionIds = new Set(serverSessions.map((s) => s.id));

      // 3. Próba użycia batch endpointu /api/sync/reconcile
      let batchSuccess = false;
      try {
        const allLocalMessagesFlat: any[] = [];
        for (const [sessId, msgs] of Object.entries(localMessagesBySession)) {
          for (const m of msgs) {
            const metadataStr = (m as any).metadata
              ? (typeof (m as any).metadata === 'string' ? (m as any).metadata : JSON.stringify((m as any).metadata))
              : (m.wiki || m.learnedFacts ? JSON.stringify({ wiki: m.wiki, learnedFacts: m.learnedFacts }) : undefined);
            allLocalMessagesFlat.push({
              session_id: sessId,
              role: m.role,
              content: m.content,
              timestamp: m.timestamp,
              model: m.model,
              metadata: metadataStr
            });
          }
        }

        const reconcileRes = await fetch(`${API_BASE}/sync/reconcile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folders: localFolders,
            sessions: localSessions,
            messages: allLocalMessagesFlat
          })
        });

        if (reconcileRes.ok) {
          batchSuccess = true;
          const data = await reconcileRes.json();
          if (data.folders) {
            for (const sf of data.folders) {
              if (!localFolders.some((lf) => lf.id === sf.id)) {
                await browserStore.saveFolder(sf.name, sf.color, sf.id);
              }
            }
          }
          if (data.sessions) {
            for (const ss of data.sessions) {
              if (!localSessions.some((ls) => ls.id === ss.id)) {
                await browserStore.createSession(ss.title, ss.folder_id, ss.id);
              }
            }
          }
        }
      } catch {
        batchSuccess = false;
      }

      // 4. Granular fallback gdy batch endpoint nie odpowiada
      if (!batchSuccess) {
        // Synchronizacja folderów
        for (const lf of localFolders) {
          if (!serverFolderIds.has(lf.id)) {
            await fetch(`${API_BASE}/folders`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: lf.id, name: lf.name, color: lf.color })
            }).catch(() => {});
          }
        }

        // Synchronizacja sesji i wiadomości
        for (const ls of localSessions) {
          if (!serverSessionIds.has(ls.id)) {
            await fetch(`${API_BASE}/sessions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: ls.id, title: ls.title, folder_id: ls.folder_id })
            }).catch(() => {});

            await fetch(`${API_BASE}/sessions/${ls.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                is_pinned: ls.is_pinned,
                is_archived: ls.is_archived,
                summary: ls.summary
              })
            }).catch(() => {});
          }

          const localMsgs = localMessagesBySession[ls.id] || [];
          if (localMsgs.length > 0) {
            const srvMsgsRes = await fetch(`${API_BASE}/sessions/${ls.id}/messages?limit=100`)
              .then((r) => (r.ok ? r.json() : { messages: [] }))
              .catch(() => ({ messages: [] }));
            const srvMsgs: Message[] = srvMsgsRes.messages || [];

            for (const lm of localMsgs) {
              const existsOnServer = srvMsgs.some(
                (sm) => sm.role === lm.role && sm.content === lm.content
              );
              if (!existsOnServer) {
                const metadataStr = (lm as any).metadata
                  ? (typeof (lm as any).metadata === 'string' ? (lm as any).metadata : JSON.stringify((lm as any).metadata))
                  : (lm.wiki || lm.learnedFacts ? JSON.stringify({ wiki: lm.wiki, learnedFacts: lm.learnedFacts }) : undefined);
                await fetch(`${API_BASE}/sessions/${ls.id}/messages`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    role: lm.role,
                    content: lm.content,
                    model: lm.model,
                    metadata: metadataStr
                  })
                }).catch(() => {});
              }
            }
          }
        }
      }

      await browserStore.logOrchestrator(
        'BackendConnectionManager',
        'sync_reconciliation_complete',
        'success',
        `Pomyślnie uzgodniono stan offline (${localSessions.length} sesji, ${localFolders.length} folderów)`
      );
      console.info('[BackendConnectionManager] Sync reconciliation completed successfully.');
    } catch (err: any) {
      console.warn('[BackendConnectionManager] Sync reconciliation warning:', err);
    } finally {
      this.isSyncing = false;
    }
  }
}

export const backendConnectionManager = new BackendConnectionManager();

async function checkBackend(force?: boolean): Promise<boolean> {
  return backendConnectionManager.checkBackend(force);
}

export const api = {
  async getEngineMode(): Promise<'backend' | 'browser-native'> {
    const isBackend = await checkBackend();
    return isBackend ? 'backend' : 'browser-native';
  },

  async getBudget(): Promise<BudgetStatus> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/budget`);
        if (res.ok) return await res.json();
      } catch {}
    }
    return await browserCostGuard.getStatus();
  },

  async getKeyStatus(): Promise<KeyStatus> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/budget/key-status`);
        if (res.ok) return await res.json();
      } catch {}
    }
    const key = await browserOpenRouter.getApiKey();
    if (!key) {
      return { hasKey: false, maskedKey: '' };
    }
    const masked = key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : '****';
    return { hasKey: true, maskedKey: masked };
  },

  async saveApiKey(apiKey: string): Promise<{ success: boolean; message: string }> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/budget/key`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey }),
        });
        if (res.ok) return await res.json();
      } catch {}
    }
    await browserOpenRouter.setApiKey(apiKey);
    return { success: true, message: 'Klucz API został pomyślnie zapisany w pamięci przeglądarki.' };
  },

  async setBudgetLimit(budgetUsd: number): Promise<{ success: boolean; newLimitUsd: number }> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/budget/limit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ budgetUsd }),
        });
        if (res.ok) return await res.json();
      } catch {}
    }
    await browserCostGuard.setBudget(budgetUsd);
    return { success: true, newLimitUsd: budgetUsd };
  },

  async getMemory(): Promise<{ count: number; facts: ExtractedFact[] }> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/memory`);
        if (res.ok) return await res.json();
      } catch {}
    }
    const facts = await browserStore.getActiveLearnedFacts(100);
    return { count: facts.length, facts };
  },

  async teachFact(category: string, subject: string, predicate: string, object: string): Promise<any> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/memory/teach`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category, subject, predicate, object }),
        });
        if (res.ok) return await res.json();
      } catch {}
    }
    const id = await browserStore.saveLearnedFact(category, subject, predicate, object, 1.0);
    return { success: true, id, fact: { category, subject, predicate, object } };
  },

  async deleteFact(id: number): Promise<void> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/memory/${id}`, { method: 'DELETE' });
        if (res.ok) return;
      } catch {}
    }
    await browserStore.deleteFact(id);
  },

  async clearMemory(): Promise<void> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/memory/clear`, { method: 'POST' });
        if (res.ok) return;
      } catch {}
    }
    await browserStore.clearAllFacts();
  },

  // Folders
  async getFolders(): Promise<{ folders: ChatFolder[] }> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/folders`);
        if (res.ok) return await res.json();
      } catch {}
    }
    const folders = await browserStore.getFolders();
    return { folders };
  },

  async saveFolder(name: string, color?: string, id?: string): Promise<{ success: boolean; id: string }> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/folders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, color, id }),
        });
        if (res.ok) return await res.json();
      } catch {}
    }
    const folderId = await browserStore.saveFolder(name, color, id);
    return { success: true, id: folderId };
  },

  async deleteFolder(id: string): Promise<void> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/folders/${id}`, { method: 'DELETE' });
        if (res.ok) return;
      } catch {}
    }
    await browserStore.deleteFolder(id);
  },

  // Sessions
  async getSessions(options?: { includeArchived?: boolean; folderId?: string }): Promise<{ sessions: ChatSession[] }> {
    if (await checkBackend()) {
      try {
        const params = new URLSearchParams();
        if (options?.includeArchived) params.set('includeArchived', 'true');
        if (options?.folderId !== undefined) params.set('folderId', options.folderId);
        const res = await fetch(`${API_BASE}/sessions?${params.toString()}`);
        if (res.ok) return await res.json();
      } catch {}
    }
    const sessions = await browserStore.getSessions(options);
    return { sessions };
  },

  async getSession(id: string): Promise<{ session: ChatSession | null }> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/sessions/${id}`);
        if (res.ok) return await res.json();
      } catch {}
    }
    const session = await browserStore.getSession(id);
    return { session };
  },

  async createSession(title?: string, folder_id?: string | null, id?: string): Promise<{ success: boolean; session: ChatSession }> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, folder_id, id }),
        });
        if (res.ok) return await res.json();
      } catch {}
    }
    const session = await browserStore.createSession(title, folder_id, id);
    return { success: true, session };
  },

  async updateSession(id: string, updates: Partial<ChatSession>): Promise<{ success: boolean; session?: ChatSession }> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/sessions/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        if (res.ok) return await res.json();
      } catch {}
    }
    await browserStore.updateSession(id, updates);
    const session = await browserStore.getSession(id);
    return { success: true, session: session || undefined };
  },

  async deleteSession(id: string): Promise<void> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/sessions/${id}`, { method: 'DELETE' });
        if (res.ok) return;
      } catch {}
    }
    await browserStore.deleteSession(id);
  },

  // Conversations (Messages per session)
  async getConversations(limit: number = 50, sessionId: string = 'default'): Promise<{ messages: Message[] }> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/sessions/${sessionId}/messages?limit=${limit}`);
        if (res.ok) return await res.json();
      } catch {}
    }
    const messages = await browserStore.getRecentMessages(limit, sessionId);
    return { messages };
  },

  async clearConversations(sessionId?: string): Promise<void> {
    if (await checkBackend()) {
      try {
        const endpoint = sessionId ? `${API_BASE}/sessions/${sessionId}/messages` : `${API_BASE}/conversations/clear`;
        const res = await fetch(endpoint, { method: sessionId ? 'DELETE' : 'POST' });
        if (res.ok) return;
      } catch {}
    }
    await browserStore.clearConversations(sessionId);
  },

  // Global Search across sessions
  async searchAllSessions(query: string): Promise<{ query: string; results: SearchResult[] }> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
        if (res.ok) return await res.json();
      } catch {}
    }
    const results = await browserStore.searchAllSessions(query);
    return { query, results };
  },

  async getOrchestratorStatus(): Promise<OrchestratorStatus> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/orchestrator/status`);
        if (res.ok) return await res.json();
      } catch {}
    }
    return await browserOrchestrator.getStatus();
  },

  async setPause(paused: boolean): Promise<{ success: boolean; isPaused: boolean }> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/orchestrator/pause`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paused }),
        });
        if (res.ok) return await res.json();
      } catch {}
    }
    const isPaused = await browserOrchestrator.setPause(paused);
    return { success: true, isPaused };
  },

  async updateSettings(settings: {
    agentName?: string;
    chatModel?: string;
    extractionModel?: string;
    useLocalOllama?: boolean;
    localOllamaUrl?: string;
  }): Promise<any> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/orchestrator/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        });
        if (res.ok) return await res.json();
      } catch {}
    }
    await browserOrchestrator.updateSettings(settings);
    return { success: true, settings };
  },

  /**
   * Obsługa strumienia SSE dla czatu – hybryda Node.js Backend / Browser-Native Engine
   */
  async streamChat(
    message: string,
    callbacks: {
      onWiki?: (wiki: any) => void;
      onDelta?: (chunk: string) => void;
      onLearned?: (facts: ExtractedFact[]) => void;
      onUsage?: (usage: any) => void;
      onError?: (error: string) => void;
      onDone?: () => void;
    },
    sessionId: string = 'default',
    referencedSessionIds: string[] = []
  ): Promise<void> {
    const isBackend = await checkBackend();

    if (isBackend) {
      try {
        const res = await fetch(`${API_BASE}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, sessionId, referencedSessionIds }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Błąd serwera' }));
          callbacks.onError?.(data.error || 'Wystąpił błąd');
          callbacks.onDone?.();
          return;
        }

        if (!res.body) {
          callbacks.onError?.('Brak strumienia danych');
          callbacks.onDone?.();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let currentEvent = 'message';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              currentEvent = 'message';
              continue;
            }

            if (trimmed.startsWith('event: ')) {
              currentEvent = trimmed.slice(7).trim();
              continue;
            }

            if (trimmed.startsWith('data: ')) {
              const dataStr = trimmed.slice(6).trim();
              try {
                const parsed = JSON.parse(dataStr);
                if (currentEvent === 'wiki') callbacks.onWiki?.(parsed);
                else if (currentEvent === 'delta') callbacks.onDelta?.(parsed.chunk);
                else if (currentEvent === 'learned') callbacks.onLearned?.(parsed);
                else if (currentEvent === 'usage') callbacks.onUsage?.(parsed);
                else if (currentEvent === 'error') callbacks.onError?.(parsed.error);
                else if (currentEvent === 'done') callbacks.onDone?.();
              } catch {}
            }
          }
        }
        return;
      } catch (backendErr: any) {
        console.warn('Backend stream failed, falling back to Browser Engine:', backendErr);
        // Fallback do silnika przeglądarkowego poniżej
      }
    }

    // Wykonanie przez wbudowany w przeglądarkę Browser-Native Orchestrator
    await browserOrchestrator.streamChat(message, callbacks, sessionId, referencedSessionIds);
  },

  async getKANTelemetry(): Promise<KANTelemetry | null> {
    // 1. Spróbuj pobrać z backendu Fastify jeśli dostępny
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/neural/telemetry`);
        if (res.ok) return await res.json();
      } catch {}
    }

    // 2. Fallback do statycznego pliku publicznego (GitHub Pages & Local SPA)
    try {
      const staticRes = await fetch('./kan_telemetry.json');
      if (staticRes.ok) return await staticRes.json();
    } catch {}

    return null;
  }
};
