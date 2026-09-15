import { browserStore } from './storage';
import { browserCostGuard } from './costGuard';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamYield {
  type: 'delta' | 'usage';
  delta?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
  };
}

export class BrowserOpenRouterClient {
  private apiUrl = 'https://openrouter.ai/api/v1/chat/completions';

  public async getApiKey(): Promise<string | null> {
    const fromDb = await browserStore.getSetting('api_key');
    if (fromDb && fromDb.trim().length > 0) return fromDb.trim();
    const fromLocal = localStorage.getItem('openrouter_api_key');
    return fromLocal && fromLocal.trim().length > 0 ? fromLocal.trim() : null;
  }

  public async setApiKey(key: string): Promise<void> {
    await browserStore.setSetting('api_key', key.trim());
    localStorage.setItem('openrouter_api_key', key.trim());
  }

  public async *streamChatCompletion(
    messages: ChatMessage[],
    model: string,
    purpose: string = 'chat_browser',
    temperature: number = 0.7
  ): AsyncGenerator<StreamYield, void, unknown> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error('Brak klucza API OpenRouter. Skonfiguruj klucz w ustawieniach lub skorzystaj z trybu demonstracyjnego.');
    }

    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': 'MakeAI Autonomous Cognitive Engine'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        stream: true,
        stream_options: { include_usage: true }
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      let errorMsg = `OpenRouter API error ${res.status}`;
      try {
        const parsed = JSON.parse(errBody);
        if (parsed.error?.message) errorMsg = parsed.error.message;
      } catch {}
      throw new Error(errorMsg);
    }

    if (!res.body) {
      throw new Error('Brak strumienia danych w odpowiedzi OpenRouter.');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let accumulatedContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const dataStr = trimmed.slice(6).trim();
          if (dataStr === '[DONE]') {
            break;
          }

          try {
            const data = JSON.parse(dataStr);
            const delta = data.choices?.[0]?.delta?.content;
            if (delta) {
              accumulatedContent += delta;
              yield { type: 'delta', delta };
            }

            if (data.usage) {
              totalPromptTokens = data.usage.prompt_tokens || 0;
              totalCompletionTokens = data.usage.completion_tokens || 0;
            }
          } catch {}
        }
      }
    } finally {
      // Estymacja jeśli model nie zwrócił usage w streamie
      if (totalPromptTokens === 0) {
        const totalChars = messages.reduce((acc, m) => acc + m.content.length, 0);
        totalPromptTokens = Math.ceil(totalChars / 4);
        totalCompletionTokens = Math.max(1, Math.ceil(accumulatedContent.length / 4));
      }

      const costUsd = await browserCostGuard.registerUsage(
        model,
        totalPromptTokens,
        totalCompletionTokens,
        purpose
      );

      yield {
        type: 'usage',
        usage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          costUsd
        }
      };
    }
  }

  public async chatCompletion(
    messages: ChatMessage[],
    model: string,
    purpose: string = 'extraction_browser',
    temperature: number = 0.1
  ): Promise<{ content: string; promptTokens: number; completionTokens: number; costUsd: number }> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error('Brak klucza API OpenRouter.');
    }

    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': 'MakeAI Cognitive Engine'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        stream: false
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      let errorMsg = `OpenRouter API error ${res.status}`;
      try {
        const parsed = JSON.parse(errBody);
        if (parsed.error?.message) errorMsg = parsed.error.message;
      } catch {}
      throw new Error(errorMsg);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const promptTokens = data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.completion_tokens || 0;

    const costUsd = await browserCostGuard.registerUsage(
      model,
      promptTokens,
      completionTokens,
      purpose
    );

    return { content, promptTokens, completionTokens, costUsd };
  }
}

export const browserOpenRouter = new BrowserOpenRouterClient();
