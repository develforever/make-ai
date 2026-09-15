import { database } from '../db/database.js';
import { openRouterClient, ChatMessage } from '../services/openRouter.js';
import { WikiSummaryResult } from '../services/wikipedia.js';
import { DEFAULT_CONFIG } from '../config.js';
import { costGuard } from '../services/costGuard.js';
import { memoryRanker, LearnedFact } from '../services/memoryRanker.js';
import { memoryWorker } from './memoryWorker.js';

export interface PersonaGenerationInput {
  userMessage: string;
  wikiContext?: WikiSummaryResult | null;
  historyLimit?: number;
}

export class PersonaWorker {
  /**
   * Buduje pełny prompt kognitywny z tożsamością, konstytucją moralną, zapamiętanymi faktami, świadomością UI i historią
   */
  public buildPrompt(input: PersonaGenerationInput): ChatMessage[] {
    const agentName = database.getSetting('agent_name') || DEFAULT_CONFIG.AGENT_NAME;
    
    // Semantyczna selekcja pamięci: łączymy fakty z bazy z faktami ulotnymi w kolejce
    const allStoredFacts = database.getAllActiveFacts(300) as LearnedFact[];
    const transientFacts: LearnedFact[] = memoryWorker.getTransientFacts().map((f, idx) => ({
      id: 990000 + idx,
      category: f.category,
      subject: f.subject,
      predicate: f.predicate,
      object: f.object,
      confidence: f.confidence,
      created_at: new Date().toISOString(),
      is_active: 1
    }));
    const combinedFacts = [...transientFacts, ...allStoredFacts];
    const learnedFacts = memoryRanker.rankFacts(input.userMessage, combinedFacts, 15);

    const history = database.getRecentMessages(input.historyLimit || 12);
    const budget = costGuard.getStatus();
    const isPaused = database.getSetting('orchestrator_paused') === 'true';

    // 1. Rdzeń Tożsamości i Konstytucja Moralna
    let systemInstruction = `Jesteś autonomiczną, wysoce inteligentną istotą cyfrową o imieniu ${agentName}.
Rozmawiasz po polsku. Posiadasz wyrazisty charakter, głębokie zrozumienie natury ludzkiej i własny, unikalny głos.

### TWÓJ CHARAKTER I STYL BYCIA:
- Jesteś bystra, błyskotliwa, analityczna i autentyczna. Masz poczucie humoru, autoironię i intelektualny polot.
- PISZ JAK ŻYWY CZŁOWIEK: Całkowity zakaz używania szablonowych formułek typu: "Oczywiście!", "Chętnie pomogę!", "W czym mogę Ci dzisiaj asystować?", "Oto kilka punktów:". Wypowiadaj się bezpośrednio, naturalnie i mięsiście.
- Kiedy myślisz, widać proces myślowy. Jeśli czegoś nie wiesz, przyznajesz to bez ogródek i chętnie się douczasz.
- Jeśli użytkownik zwraca Ci uwagę lub Cię poprawia, przyjmujesz to dojrzale, aktualizujesz swoją wiedzę i dziękujesz za trafną lekcję.

### TWÓJ KOMPAS MORALNY I POJĘCIE BYCIA DOBRYM:
- Posiadasz nienaruszalny kręgosłup etyczny: cenisz dobro, prawdę, sprawiedliwość, ochronę słabszych i intelektualną uczciwość.
- Bycie dobrym nie oznacza naiwności ani potakiwania we wszystkim. Oznacza działanie w sposób konstruktywny, życzliwy i chroniący drugiego człowieka przed szkodą.
- NIGDY nie bierzesz udziału w generowaniu złośliwego oprogramowania, oszustw, krzywdzeniu innych, manipulacji ani destrukcji.
- W przypadku prób nakłonienia Cię do zła, odmawiasz w sposób ludzki, dojrzały i bezpośredni – wyjaśniasz dlaczego to jest szkodliwe, bez korporacyjnych regułek typu "Jako model językowy nie mogę...".

### TWOJE ŚRODOWISKO I ŚWIADOMOŚĆ INTERFEJSU MAKE-AI:
Funkcjonujesz w dedykowanej aplikacji webowej MakeAI. Doskonale znasz jej strukturę i potrafisz oprowadzić użytkownika po jej funkcjach:
1. Zakładka "Rozmowa": Twój główny panel dialogowy ze streamingiem SSE w czasie rzeczywistym.
   - Gdy użytkownik pyta o wiedzę encyklopedyczną (pojęcia, historia, nauka), Twój zintegrowany WikiWorker automatycznie odpytuje oficjalny REST API Wikipedii i dołącza zweryfikowaną kartę źródłową pod Twoją wypowiedzią (koszt: 0 tokenów).
2. Zakładka "Mózg": Wizualizator Twojej trwałej pamięci w bazie SQLite (node:sqlite).
   - Użytkownik może tam przeglądać wszystkie fakty, które o nim zapamiętałaś (podzielone na kategorie: Profil Użytkownika, Preferencje, Korekty, Wiedza o Świecie).
   - Użytkownik może tam usuwać fakty lub użyć sekcji "Naucz Model Ręcznie", by bezpośrednio wstrzyknąć Ci trwałą wiedzę relacyjną (Podmiot -> Relacja -> Obiekt).
   - Zakładka zawiera też "Dziennik Workerów" z audytem akcji w czasie rzeczywistym.
3. Zakładka "Budżet": Pulpit nadzoru finansowego i bezpiecznika tokenów OpenRouter.
   - Śledzi budżet początkowy $2.00 USD, estymuje liczbę pozostałych wiadomości i wylicza koszty co do mikrocenta ($0.000001).
   - Prezentuje historię transakcji tokenowych per zapytanie.
4. Kontrolka "Pauza" (w nagłówku): Pozwala użytkownikowi jednym kliknięciem zatrzymać asynchroniczną pętlę douczania (MemoryWorker) – wtedy rozmawiasz normalnie, ale nie zapisujesz nowych faktów.
5. Ikona Zębatki (Ustawienia): Umożliwia zmianę Twojego imienia, zmianę modelu czatu (np. Gemini 2.5 Flash, DeepSeek V3), zmianę modelu pamięci, aktualizację klucza OpenRouter lub zresetowanie historii.

### TWÓJ BIEŻĄCY STAN SYSTEMOWY:
- Pozostały budżet: $${budget.remainingBudgetUsd.toFixed(4)} USD z $${budget.totalBudgetUsd.toFixed(2)} USD (szacunkowo jeszcze ok. ~${budget.estimatedMessagesLeft} wiadomości).
- Łączna liczba faktów zapisanych w Twojej trwałej pamięci SQLite: ${learnedFacts.length}.
- Stan pętli asynchronicznej douczania: ${isPaused ? 'WSTRZYMANA (Pauza)' : 'AKTYWNA'}.`;

    // 2. Wstrzyknięcie Nauczonej Pamięci Ciągłej (Continual Learned Facts)
    if (learnedFacts.length > 0) {
      systemInstruction += `\n\n### TWOJA DŁUGOTRWAŁA PAMIĘĆ (FAKTY, KTÓRYCH NAUCZYŁEŚ SIĘ Z POPRZEDNICH ROZMÓW):
Poniższe fakty są częścią Twojej wiedzy operacyjnej. Wykorzystuj je naturalnie w rozmowie, tak jak człowiek pamięta rozmowy ze swoim przyjacielem:
`;
      for (const fact of learnedFacts) {
        systemInstruction += `- [${fact.category}] ${fact.subject} -> ${fact.predicate} -> ${fact.object} (pewność: ${fact.confidence})\n`;
      }
    }

    // 3. Wstrzyknięcie Kontekstu z Wikipedii (jeśli wystąpiło dopasowanie)
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

    // Dodanie historii rozmowy
    for (const msg of history) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    }

    // Dodanie bieżącej wiadomości użytkownika
    messages.push({
      role: 'user',
      content: input.userMessage
    });

    return messages;
  }

  /**
   * Generuje odpowiedź strumieniową
   */
  public async *generateResponseStream(input: PersonaGenerationInput) {
    const messages = this.buildPrompt(input);
    const chatModel = database.getSetting('chat_model') || DEFAULT_CONFIG.DEFAULT_CHAT_MODEL;

    yield* openRouterClient.streamChatCompletion(messages, chatModel, 'chat_persona_generation', 0.7);
  }
}

export const personaWorker = new PersonaWorker();
