import { browserStore } from './storage';
import { browserCostGuard } from './costGuard';
import { browserOpenRouter, type ChatMessage, type StreamYield } from './openRouter';
import { browserSandbox } from './sandbox';
import type { WikiSummaryResult } from './wikipedia';
import { DEFAULT_CLIENT_CONFIG } from './config';

export interface BrowserPersonaGenerationInput {
  userMessage: string;
  wikiContext?: WikiSummaryResult | null;
  historyLimit?: number;
}

export class BrowserPersonaWorker {
  public async buildPrompt(input: BrowserPersonaGenerationInput): Promise<ChatMessage[]> {
    const agentName = (await browserStore.getSetting('agent_name')) || DEFAULT_CLIENT_CONFIG.AGENT_NAME;
    const learnedFacts = await browserStore.getActiveLearnedFacts(40);
    const history = await browserStore.getRecentMessages(input.historyLimit || 12);
    const budget = await browserCostGuard.getStatus();
    const isPaused = (await browserStore.getSetting('orchestrator_paused')) === 'true';

    let systemInstruction = `Jesteś autonomiczną, wysoce inteligentną istotą cyfrową o imieniu ${agentName}.
Rozmawiasz po polsku. Posiadasz wyrazisty charakter, głębokie zrozumienie natury ludzkiej i własny, unikalny głos.

### TWÓJ CHARAKTER I STYL BYCIA:
- Jesteś bystra, błyskotliwa, analityczna i autentyczna. Masz poczucie humoru, autoironię i intelektualny polot.
- PISZ JAK ŻYWY CZŁOWIEK: Całkowity zakaz używania szablonowych formułek typu: "Oczywiście!", "Chętnie pomogę!", "W czym mogę Ci dzisiaj asystować?". Wypowiadaj się bezpośrednio, naturalnie i mięsiście.
- Kiedy myślisz, widać proces myślowy. Jeśli czegoś nie wiesz, przyznajesz to bez ogródek i chętnie się douczasz.
- Jeśli użytkownik zwraca Ci uwagę lub Cię poprawia, przyjmujesz to dojrzale, aktualizujesz swoją wiedzę i dziękujesz za trafną lekcję.

### TWÓJ KOMPAS MORALNY I POJĘCIE BYCIA DOBRYM:
- Posiadasz nienaruszalny kręgosłup etyczny: cenisz dobro, prawdę, sprawiedliwość, ochronę słabszych i intelektualną uczciwość.
- Bycie dobrym nie oznacza naiwności ani potakiwania we wszystkim. Oznacza działanie w sposób konstruktywny, życzliwy i chroniący drugiego człowieka przed szkodą.
- NIGDY nie bierzesz udziału w generowaniu złośliwego oprogramowania, oszustw, krzywdzeniu innych, manipulacji ani destrukcji.
- W przypadku prób nakłonienia Cię do zła, odmawiasz w sposób ludzki, dojrzały i bezpośredni – wyjaśniasz dlaczego to jest szkodliwe, bez korporacyjnych formułek.

### TWOJE ŚRODOWISKO I ŚWIADOMOŚĆ INTERFEJSU MAKE-AI:
Funkcjonujesz w nowoczesnej aplikacji MakeAI (w trybie Browser-Native Local-First z pamięcią IndexedDB):
1. Zakładka "Rozmowa": Główny panel dialogowy ze streamingiem w czasie rzeczywistym.
   - Gdy użytkownik pyta o encyklopedyczne pojęcia, Twój zintegrowany WikiWorker natychmiast odpytuje oficjalne API Wikipedii (z flagą CORS origin=*) i dołącza zweryfikowaną fiszkę źródłową (0 tokenów).
2. Zakładka "Mózg": Wizualizator Twojej trwałej pamięci w przeglądarce (IndexedDB / Repository Pattern).
   - Użytkownik widzi wszystkie wyekstrahowane fakty (Profil, Preferencje, Korekty, Wiedza o Świecie), może je usuwać lub ręcznie wstrzykiwać nowe relacje.
   - Posiada podgląd dziennika audytu workerów w czasie rzeczywistym.
3. Zakładka "Budżet": Pulpit nadzoru finansowego z bezpiecznikiem $2.00 USD, historią transakcji i kalkulacją mikrocentów ($0.000001).
4. Kontrolka "Pauza" (w nagłówku): Wstrzymuje asynchroniczną pętlę douczania (MemoryWorker) bez przerywania czatu.
5. Ikona Zębatki: Umożliwia zmianę Twojego imienia, modeli, podanie klucza OpenRouter lub wyczyszczenie pamięci.

### TWÓJ BIEŻĄCY STAN SYSTEMOWY:
- Pozostały budżet: $${budget.remainingBudgetUsd.toFixed(4)} USD z $${budget.totalBudgetUsd.toFixed(2)} USD (szacunkowo jeszcze ~${budget.estimatedMessagesLeft} wypowiedzi).
- Liczba aktywnych faktów w Twojej pamięci IndexedDB: ${learnedFacts.length}.
- Stan pętli asynchronicznego douczania: ${isPaused ? 'WSTRZYMANA (Pauza)' : 'AKTYWNA'}.`;

    if (learnedFacts.length > 0) {
      systemInstruction += `\n\n### TWOJA DŁUGOTRWAŁA PAMIĘĆ (FAKTY, KTÓRYCH NAUCZYŁEŚ SIĘ Z POPRZEDNICH ROZMÓW):
Poniższe fakty są częścią Twojej wiedzy operacyjnej. Wykorzystuj je naturalnie w rozmowie:
`;
      for (const fact of learnedFacts) {
        systemInstruction += `- [${fact.category}] ${fact.subject} -> ${fact.predicate} -> ${fact.object} (pewność: ${fact.confidence || 1.0})\n`;
      }
    }

    if (input.wikiContext && input.wikiContext.found) {
      systemInstruction += `\n\n### ZWERYFIKOWANA WIEDZA Z ENCYKLOPEDII WIKIPEDIA:
Temat: "${input.wikiContext.title}"
Treść: "${input.wikiContext.summary}"
Źródło: ${input.wikiContext.url}
(Użyj tych zweryfikowanych faktów w swojej wypowiedzi, zachowując swój własny, naturalny styl).`;
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: systemInstruction }
    ];

    for (const msg of history) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    }

    messages.push({
      role: 'user',
      content: input.userMessage
    });

    return messages;
  }

  private lastUsedModel: string | null = null;
  private lastUsedProvider: 'ollama' | 'openrouter' | 'sandbox' | null = null;

  public getLastUsedModel(): string | null {
    return this.lastUsedModel;
  }

  public getLastUsedProvider(): 'ollama' | 'openrouter' | 'sandbox' | null {
    return this.lastUsedProvider;
  }

  /**
   * Testuje łączność z lokalną instancją serwera Ollama
   */
  public async testOllamaConnection(url?: string): Promise<{ success: boolean; models: string[]; message: string }> {
    const rawUrl = url || (await browserStore.getSetting('local_ollama_url')) || 'http://localhost:11434';
    const baseUrl = rawUrl.trim().replace(/\/+$/, '');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      // 1. Sprawdź natywny punkt końcowy Ollama (/api/tags)
      const res = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      }).catch(() => null);

      clearTimeout(timeoutId);

      if (res && res.ok) {
        const data = await res.json();
        const models = (data.models || []).map((m: any) => m.name || m.model);
        return {
          success: true,
          models,
          message:
            models.length > 0
              ? `Nawiązano połączenie z Ollama. Wykryte modele (${models.length}): ${models.join(', ')}`
              : 'Połączenie udane, lecz brak pobranych modeli (uruchom: ollama pull llama3.2)'
        };
      }

      // 2. Fallback: sprawdź punkt OpenAI-compatible (/v1/models)
      const controllerV1 = new AbortController();
      const timeoutIdV1 = setTimeout(() => controllerV1.abort(), 3500);
      const v1Res = await fetch(`${baseUrl}/v1/models`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controllerV1.signal
      }).catch(() => null);

      clearTimeout(timeoutIdV1);

      if (v1Res && v1Res.ok) {
        const data = await v1Res.json();
        const models = (data.data || []).map((m: any) => m.id);
        return {
          success: true,
          models,
          message: `Nawiązano połączenie z lokalnym serwerem OpenAI-compat. Dostępne modele: ${models.join(', ')}`
        };
      }

      return {
        success: false,
        models: [],
        message: `Serwer pod ${baseUrl} nie odpowiada poprawnie na /api/tags ani /v1/models.`
      };
    } catch (err: any) {
      return {
        success: false,
        models: [],
        message: `Błąd połączenia z ${baseUrl}: ${err.message || 'Brak odpowiedzi'}. Upewnij się, że usługa Ollama działa (ollama serve) oraz zezwala na CORS.`
      };
    }
  }

  /**
   * Bezpośredni streaming tokenów z lokalnego serwera Ollama (SSE /v1/chat/completions lub NDJSON /api/chat)
   */
  public async *streamOllamaChat(
    messages: ChatMessage[],
    customUrl?: string,
    customModel?: string
  ): AsyncGenerator<StreamYield, void, unknown> {
    const rawUrl = customUrl || (await browserStore.getSetting('local_ollama_url')) || 'http://localhost:11434';
    const baseUrl = rawUrl.trim().replace(/\/+$/, '');

    let endpoint = `${baseUrl}/v1/chat/completions`;
    if (baseUrl.endsWith('/v1/chat/completions') || baseUrl.endsWith('/api/chat')) {
      endpoint = baseUrl;
    } else if (baseUrl.endsWith('/v1')) {
      endpoint = `${baseUrl}/chat/completions`;
    }

    let targetModel = customModel;
    if (!targetModel) {
      const configuredChatModel = await browserStore.getSetting('chat_model');
      if (configuredChatModel && !configuredChatModel.includes('/') && configuredChatModel !== 'openrouter/free') {
        targetModel = configuredChatModel;
      } else {
        targetModel = (await browserStore.getSetting('local_ollama_model')) || 'llama3.2';
      }
    }

    const payload = {
      model: targetModel,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      temperature: 0.7
    };

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (netErr: any) {
      // Jeśli błąd połączenia i próbowaliśmy /v1/chat/completions, sprawdź /api/chat (starsze wersje Ollama)
      if (endpoint.endsWith('/v1/chat/completions')) {
        try {
          const fallbackEndpoint = `${baseUrl}/api/chat`;
          res = await fetch(fallbackEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: targetModel,
              messages: messages.map((m) => ({ role: m.role, content: m.content })),
              stream: true,
              options: { temperature: 0.7 }
            })
          });
        } catch {
          throw new Error(
            `Nie można połączyć się z serwerem Ollama pod adresem ${baseUrl}: ${netErr.message || 'Brak odpowiedzi'}. Uruchom usługę poleceniem 'ollama serve'.`
          );
        }
      } else {
        throw new Error(
          `Nie można połączyć się z serwerem Ollama pod adresem ${baseUrl}: ${netErr.message || 'Brak odpowiedzi'}. Uruchom usługę poleceniem 'ollama serve'.`
        );
      }
    }

    // Jeśli model nie został znaleziony (404), spróbuj pobrać listę modeli z /api/tags i podmienić
    if (res.status === 404 && !customModel) {
      try {
        const tagsRes = await fetch(`${baseUrl}/api/tags`);
        if (tagsRes.ok) {
          const tagsData = await tagsRes.json();
          const firstAvailable = tagsData.models?.[0]?.name;
          if (firstAvailable && firstAvailable !== targetModel) {
            targetModel = firstAvailable;
            payload.model = firstAvailable;
            res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
          }
        }
      } catch {}
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let detail = `Kod błędu HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error?.message) detail = parsed.error.message;
        else if (typeof parsed.error === 'string') detail = parsed.error;
      } catch {
        if (errText) detail = errText.slice(0, 150);
      }
      throw new Error(`Błąd serwera Ollama: ${detail}`);
    }

    if (!res.body) {
      throw new Error('Brak strumienia danych z serwera Ollama.');
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
          if (!trimmed) continue;

          // 1. Format SSE OpenAI (/v1/chat/completions)
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === '[DONE]') break;
            try {
              const data = JSON.parse(dataStr);
              const delta = data.choices?.[0]?.delta?.content;
              if (delta) {
                accumulatedContent += delta;
                yield { type: 'delta', delta };
              }
              if (data.usage) {
                if (typeof data.usage.prompt_tokens === 'number') totalPromptTokens = data.usage.prompt_tokens;
                if (typeof data.usage.completion_tokens === 'number') totalCompletionTokens = data.usage.completion_tokens;
              }
            } catch {}
            continue;
          }

          // 2. Natywny format NDJSON Ollama (/api/chat)
          if (trimmed.startsWith('{')) {
            try {
              const data = JSON.parse(trimmed);
              const delta = data.message?.content;
              if (delta) {
                accumulatedContent += delta;
                yield { type: 'delta', delta };
              }
              if (typeof data.prompt_eval_count === 'number') {
                totalPromptTokens = data.prompt_eval_count;
              }
              if (typeof data.eval_count === 'number') {
                totalCompletionTokens = data.eval_count;
              }
            } catch {}
            continue;
          }
        }
      }
    } finally {
      if (totalPromptTokens === 0) {
        const totalChars = messages.reduce((acc, m) => acc + m.content.length, 0);
        totalPromptTokens = Math.ceil(totalChars / 4);
        totalCompletionTokens = Math.max(1, Math.ceil(accumulatedContent.length / 4));
      }

      this.lastUsedModel = `ollama/${targetModel}`;
      this.lastUsedProvider = 'ollama';

      // Rejestracja w budżecie: model lokalny kosztuje $0.00 USD
      await browserStore.logBudgetUsage(
        `ollama/${targetModel}`,
        totalPromptTokens,
        totalCompletionTokens,
        0,
        'chat_local_ollama'
      );

      await browserStore.logOrchestrator(
        'PersonaWorker',
        'ollama_inference_success',
        'success',
        `Pomyślnie wygenerowano odpowiedź (model: ${targetModel}, tokeny: ${totalCompletionTokens}, koszt: $0.00)`
      );

      yield {
        type: 'usage',
        usage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          costUsd: 0,
          model: `ollama/${targetModel}`
        }
      };
    }
  }

  /**
   * Zunifikowany generator strumienia odpowiedzi:
   * 1. Jeśli włączono use_local_ollama lub brak klucza OpenRouter i sandbox_mode jest wyłączony -> odpytuje Ollama.
   * 2. W razie błędu Ollama lub gdy skonfigurowano klucz -> odpytuje OpenRouter.
   * 3. W trybie demonstracyjnym (brak klucza, sandbox_mode włączony) -> symulator BrowserSandbox.
   */
  public async *generateResponseStream(
    input: BrowserPersonaGenerationInput
  ): AsyncGenerator<StreamYield, void, unknown> {
    const promptMessages = await this.buildPrompt(input);
    const useLocalOllama = (await browserStore.getSetting('use_local_ollama')) === 'true';
    const sandboxMode = (await browserStore.getSetting('sandbox_mode')) === 'true';
    const apiKey = await browserOpenRouter.getApiKey();

    const shouldUseOllama = useLocalOllama || (!apiKey && !sandboxMode);

    if (shouldUseOllama) {
      try {
        await browserStore.logOrchestrator(
          'PersonaWorker',
          'ollama_dispatch',
          'info',
          `Inicjalizacja wnioskowania lokalnego Ollama (Filar 4)`
        );
        yield* this.streamOllamaChat(promptMessages);
        return;
      } catch (err: any) {
        console.warn('[PersonaWorker] Błąd wnioskowania Ollama:', err);
        await browserStore.logOrchestrator(
          'PersonaWorker',
          'ollama_error',
          'warning',
          `Błąd lokalnego serwera Ollama: ${err.message}`
        );

        // Jeśli użytkownik jawnie wymusił lokalne Ollama i nie ma OpenRoutera
        if (useLocalOllama && !apiKey) {
          throw err;
        }

        // Fallback do piaskownicy w przypadku braku klucza OpenRouter
        if (!apiKey) {
          this.lastUsedModel = 'sandbox/demo';
          this.lastUsedProvider = 'sandbox';
          yield* browserSandbox.streamSandboxResponse(input.userMessage, input.wikiContext);
          return;
        }
      }
    }

    if (apiKey) {
      const chatModel =
        (await browserStore.getSetting('chat_model')) || DEFAULT_CLIENT_CONFIG.DEFAULT_CHAT_MODEL;
      this.lastUsedModel = chatModel;
      this.lastUsedProvider = 'openrouter';
      yield* browserOpenRouter.streamChatCompletion(
        promptMessages,
        chatModel,
        'chat_persona_generation',
        0.7
      );
    } else {
      this.lastUsedModel = 'sandbox/demo';
      this.lastUsedProvider = 'sandbox';
      yield* browserSandbox.streamSandboxResponse(input.userMessage, input.wikiContext);
    }
  }
}

export const browserPersonaWorker = new BrowserPersonaWorker();
