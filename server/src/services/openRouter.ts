import { database } from '../db/database.js';
import { costGuard } from './costGuard.js';
import { DEFAULT_CONFIG } from '../config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  model: string;
}

export class OpenRouterClient {
  private getApiKey(): string | null {
    const fromDb = database.getSetting('openrouter_api_key');
    if (fromDb && fromDb.trim().length > 5) {
      return fromDb.trim();
    }
    return process.env.OPENROUTER_API_KEY || null;
  }

  public hasApiKey(): boolean {
    return this.getApiKey() !== null;
  }

  public setApiKey(key: string): void {
    database.setSetting('openrouter_api_key', key.trim());
  }

  /**
   * Wywołanie synchroniczne / blokujące dla workerów pomocniczych (np. Memory Extractor)
   */
  public async chatCompletion(
    messages: ChatMessage[],
    model: string = DEFAULT_CONFIG.DEFAULT_EXTRACTION_MODEL,
    purpose: string = 'worker_extraction',
    temperature: number = 0.2
  ): Promise<CompletionResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('Brak klucza OpenRouter API Key. Wprowadź klucz w ustawieniach aplikacji.');
    }

    const budget = costGuard.getStatus();
    if (!budget.canProceed) {
      throw new Error(`Przekroczono bezpieczny limit budżetu ($${budget.remainingBudgetUsd} USD pozostało). Dalsze operacje wstrzymane.`);
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/make-ai',
        'X-Title': 'MakeAI Autonomous Conversational Agent'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Błąd OpenRouter (${response.status}): ${errText}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '';
    const promptTokens = data.usage?.prompt_tokens || Math.ceil(JSON.stringify(messages).length / 4);
    const completionTokens = data.usage?.completion_tokens || Math.ceil(content.length / 4);

    const costUsd = costGuard.registerUsage(model, promptTokens, completionTokens, purpose);

    return {
      content,
      promptTokens,
      completionTokens,
      costUsd,
      model
    };
  }

  /**
   * Wywołanie strumieniowe (SSE) dla głównego modelu konwersacyjnego
   */
  public async *streamChatCompletion(
    messages: ChatMessage[],
    model: string = DEFAULT_CONFIG.DEFAULT_CHAT_MODEL,
    purpose: string = 'chat_conversation',
    temperature: number = 0.7
  ): AsyncGenerator<{ chunk: string; done: boolean; usage?: { promptTokens: number; completionTokens: number; costUsd: number } }> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('Brak klucza OpenRouter API Key. Wprowadź klucz w ustawieniach.');
    }

    const budget = costGuard.getStatus();
    if (!budget.canProceed) {
      throw new Error(`Przekroczono limit budżetu ($${budget.remainingBudgetUsd} USD pozostało). Operacje zablokowane.`);
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/make-ai',
        'X-Title': 'MakeAI Autonomous Conversational Agent'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        stream: true,
        stream_options: { include_usage: true }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Błąd OpenRouter (${response.status}): ${errText}`);
    }

    if (!response.body) {
      throw new Error('Brak strumienia odpowiedzi z OpenRouter.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullGeneratedText = '';
    let finalPromptTokens = 0;
    let finalCompletionTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') continue;

        if (trimmed.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullGeneratedText += delta;
              yield { chunk: delta, done: false };
            }

            if (parsed.usage) {
              finalPromptTokens = parsed.usage.prompt_tokens || finalPromptTokens;
              finalCompletionTokens = parsed.usage.completion_tokens || finalCompletionTokens;
            }
          } catch (e) {
            // Ignoruj uszkodzone częściowe linie JSON
          }
        }
      }
    }

    // Jeśli OpenRouter nie zwrócił dokładnego usage, oszacuj na podstawie znaków
    if (finalPromptTokens === 0) {
      finalPromptTokens = Math.ceil(JSON.stringify(messages).length / 4);
    }
    if (finalCompletionTokens === 0) {
      finalCompletionTokens = Math.ceil(fullGeneratedText.length / 4);
    }

    const costUsd = costGuard.registerUsage(model, finalPromptTokens, finalCompletionTokens, purpose);

    yield {
      chunk: '',
      done: true,
      usage: {
        promptTokens: finalPromptTokens,
        completionTokens: finalCompletionTokens,
        costUsd
      }
    };
  }
}

export const openRouterClient = new OpenRouterClient();
