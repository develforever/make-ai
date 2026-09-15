import type { BudgetStatus, KeyStatus, ExtractedFact, OrchestratorStatus, Message } from '../types';

const API_BASE = '/api';

export const api = {
  async getBudget(): Promise<BudgetStatus> {
    const res = await fetch(`${API_BASE}/budget`);
    if (!res.ok) throw new Error('Błąd pobierania budżetu');
    return res.json();
  },

  async getKeyStatus(): Promise<KeyStatus> {
    const res = await fetch(`${API_BASE}/budget/key-status`);
    if (!res.ok) throw new Error('Błąd sprawdzania klucza');
    return res.json();
  },

  async saveApiKey(apiKey: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/budget/key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Błąd zapisu klucza API');
    return data;
  },

  async setBudgetLimit(budgetUsd: number): Promise<{ success: boolean; newLimitUsd: number }> {
    const res = await fetch(`${API_BASE}/budget/limit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budgetUsd }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Błąd aktualizacji budżetu');
    return data;
  },

  async getMemory(): Promise<{ count: number; facts: ExtractedFact[] }> {
    const res = await fetch(`${API_BASE}/memory`);
    if (!res.ok) throw new Error('Błąd pobierania pamięci');
    return res.json();
  },

  async teachFact(category: string, subject: string, predicate: string, object: string): Promise<any> {
    const res = await fetch(`${API_BASE}/memory/teach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, subject, predicate, object }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Błąd nauczania modelu');
    return data;
  },

  async deleteFact(id: number): Promise<void> {
    const res = await fetch(`${API_BASE}/memory/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Błąd usuwania faktu');
  },

  async clearMemory(): Promise<void> {
    const res = await fetch(`${API_BASE}/memory/clear`, { method: 'POST' });
    if (!res.ok) throw new Error('Błąd czyszczenia pamięci');
  },

  async getConversations(): Promise<{ messages: Message[] }> {
    const res = await fetch(`${API_BASE}/conversations`);
    if (!res.ok) throw new Error('Błąd pobierania historii');
    return res.json();
  },

  async clearConversations(): Promise<void> {
    const res = await fetch(`${API_BASE}/conversations/clear`, { method: 'POST' });
    if (!res.ok) throw new Error('Błąd czyszczenia historii');
  },

  async getOrchestratorStatus(): Promise<OrchestratorStatus> {
    const res = await fetch(`${API_BASE}/orchestrator/status`);
    if (!res.ok) throw new Error('Błąd pobierania statusu orkiestratora');
    return res.json();
  },

  async setPause(paused: boolean): Promise<{ success: boolean; isPaused: boolean }> {
    const res = await fetch(`${API_BASE}/orchestrator/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused }),
    });
    return res.json();
  },

  async updateSettings(settings: { agentName?: string; chatModel?: string; extractionModel?: string }): Promise<any> {
    const res = await fetch(`${API_BASE}/orchestrator/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    return res.json();
  },

  /**
   * Obsługa strumienia SSE dla czatu
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
    }
  ): Promise<void> {
    const res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Błąd połączenia z serwerem' }));
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

    try {
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
              if (currentEvent === 'wiki') {
                callbacks.onWiki?.(parsed);
              } else if (currentEvent === 'delta') {
                callbacks.onDelta?.(parsed.chunk);
              } else if (currentEvent === 'learned') {
                callbacks.onLearned?.(parsed);
              } else if (currentEvent === 'usage') {
                callbacks.onUsage?.(parsed);
              } else if (currentEvent === 'error') {
                callbacks.onError?.(parsed.error);
              } else if (currentEvent === 'done') {
                callbacks.onDone?.();
              }
            } catch (e) {
              // Błąd parsowania pojedynczego pakietu
            }
          }
        }
      }
    } catch (err: any) {
      callbacks.onError?.(err.message);
    } finally {
      callbacks.onDone?.();
    }
  }
};
