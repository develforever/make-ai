import type { BudgetStatus, KeyStatus, ExtractedFact, OrchestratorStatus, Message, KANTelemetry } from '../types';
import { browserStore } from '../services/storage';
import { browserCostGuard } from '../services/costGuard';
import { browserOrchestrator } from '../services/orchestrator';
import { browserOpenRouter } from '../services/openRouter';

const API_BASE = '/api';

// Detekcja dostępności backendu Fastify
let backendAvailable: boolean | null = null;

async function checkBackend(): Promise<boolean> {
  if (backendAvailable !== null) return backendAvailable;

  // GitHub Pages lub inne środowisko statyczne - natychmiast Browser-Native
  if (
    typeof window !== 'undefined' &&
    (window.location.hostname.includes('github.io') ||
      window.location.protocol === 'file:')
  ) {
    backendAvailable = false;
    return false;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600);
    const res = await fetch(`${API_BASE}/budget`, { signal: controller.signal });
    clearTimeout(timeoutId);
    backendAvailable = res.ok;
  } catch {
    backendAvailable = false;
  }
  return backendAvailable;
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

  async getConversations(): Promise<{ messages: Message[] }> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/conversations`);
        if (res.ok) return await res.json();
      } catch {}
    }
    const messages = await browserStore.getRecentMessages(50);
    return { messages };
  },

  async clearConversations(): Promise<void> {
    if (await checkBackend()) {
      try {
        const res = await fetch(`${API_BASE}/conversations/clear`, { method: 'POST' });
        if (res.ok) return;
      } catch {}
    }
    await browserStore.clearConversations();
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

  async updateSettings(settings: { agentName?: string; chatModel?: string; extractionModel?: string }): Promise<any> {
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
    }
  ): Promise<void> {
    const isBackend = await checkBackend();

    if (isBackend) {
      try {
        const res = await fetch(`${API_BASE}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
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
    await browserOrchestrator.streamChat(message, callbacks);
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
