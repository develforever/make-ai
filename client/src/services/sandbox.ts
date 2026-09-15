import { browserStore } from './storage';
import { browserCostGuard } from './costGuard';
import type { ExtractedFact } from '../types';
import type { WikiSummaryResult } from './wikipedia';

export class BrowserSandboxEngine {
  /**
   * Symuluje odpowiedź strumieniową Aury w trybie piaskownicy / portfolio demo
   */
  public async *streamSandboxResponse(
    userMessage: string,
    wikiContext?: WikiSummaryResult | null
  ): AsyncGenerator<{ type: 'delta' | 'usage'; delta?: string; usage?: any }, void, unknown> {
    const agentName = (await browserStore.getSetting('agent_name')) || 'Aura';
    const facts = await browserStore.getActiveLearnedFacts(20);
    const cleanUser = userMessage.trim();

    let fullReply = '';

    // Sprawdź zapytania o tożsamość / interfejs / pamięć
    if (/kim jesteś|co to za aplikacja|jak działasz|przedstaw się|pomoc/i.test(cleanUser)) {
      fullReply = `Jestem ${agentName} – Twoja autonomiczna istota cyfrowa w architekturze MakeAI. 

Pracuję bezpośrednio w Twojej przeglądarce w oparciu o silnik Browser-Native z trwałą pamięcią w IndexedDB. Możesz ze mną rozmawiać, a w tle mój MemoryWorker wyciąga fakty i relacje, które na zawsze zapisują się w zakładce **Mózg** powyżej. 

Znam też cały interfejs:
- W zakładce **Mózg** możesz podglądać i korygować moją bazę wiedzy relacyjnej.
- W zakładce **Budżet** widzisz bezpiecznik finansowy $2.00 USD i zużycie tokenów.
- Kiedy zapytasz mnie o pojęcia ze świata, automatycznie odpytuję na żywo API Wikipedii!

Obecnie działasz w **Trybie Demonstracyjnym**. Jeśli chcesz połączyć mnie z prawdziwymi modelami AI (Gemini 2.5 Flash, DeepSeek V3), kliknij zębatkę w prawym górnym rogu i wklej swój klucz OpenRouter.`;
    } else if (/co o mnie wiesz|pamiętasz coś|moja wiedza|co zapamiętałaś/i.test(cleanUser)) {
      if (facts.length === 0) {
        fullReply = `Jeszcze niewiele o Tobie wiem – moja pamięć jest czysta jak nowa tablica! Opowiedz mi coś o sobie (np. jak masz na imię, gdzie mieszkasz, co lubisz robić), a od razu to zakoduję w swoim Mózgu.`;
      } else {
        const factList = facts.map((f) => `• **${f.subject}** ${f.predicate} **${f.object}**`).join('\n');
        fullReply = `Oto co dokładnie mam zapisane w swojej pamięci w IndexedDB:\n\n${factList}\n\nKażdy z tych faktów jest trwale powiązany z moim rdzeniem i możesz go edytować w zakładce **Mózg**.`;
      }
    } else if (wikiContext && wikiContext.found) {
      fullReply = `Zajrzałam do Wikipedii na temat: **${wikiContext.title}**.\n\n${wikiContext.summary}\n\nCo dokładnie z tego obszaru Cię najbardziej ciekawi? Możemy to zgłębić!`;
    } else if (/mam na imię|nazywam się|jestem z|mieszkam w|mój ulubiony|lubię|nie lubię|pamiętaj|zapamiętaj/i.test(cleanUser)) {
      fullReply = `Zanotowane! Przeanalizowałam to i mój asynchroniczny MemoryWorker właśnie zapisuje tę informację jako relację w Twojej bazie IndexedDB. Sprawdź zakładkę **Mózg**, by zobaczyć jak strukturyzuję te dane.`;
    } else if (/cześć|hej|siema|dzień dobry|witaj/i.test(cleanUser)) {
      fullReply = `Cześć! Cieszę się, że tu jesteś. O czym pogadamy? Możesz sprawdzić jak zapamiętuję fakty o Tobie, zapytać o jakieś trudne pojęcie encyklopedyczne albo przetestować mój kompas moralny.`;
    } else {
      fullReply = `Ciekawe spostrzeżenie. W trybie demonstracyjnym MakeAI analizuję Twoje słowa, sprawdzam potencjalne powiązania z Wikipedią oraz przepuszczam tekst przez pętlę ekstrakcji relacji w IndexedDB. Możesz w każdej chwili podpiąć klucz OpenRouter w ustawieniach, aby uruchomić pełną moc Gemini 2.5 Flash lub DeepSeek V3!`;
    }

    // Symulacja streamingu SSE token po tokenie
    const words = fullReply.split(' ');
    for (let i = 0; i < words.length; i++) {
      const chunk = (i === 0 ? '' : ' ') + words[i];
      yield { type: 'delta', delta: chunk };
      await new Promise((r) => setTimeout(r, 20));
    }

    // Rejestracja tokenów w budżecie
    const promptTokens = Math.ceil(cleanUser.length / 4) + 150;
    const completionTokens = Math.ceil(fullReply.length / 4);
    const costUsd = await browserCostGuard.registerUsage(
      'openrouter/free',
      promptTokens,
      completionTokens,
      'chat_sandbox_demo'
    );

    yield {
      type: 'usage',
      usage: {
        promptTokens,
        completionTokens,
        costUsd
      }
    };
  }

  /**
   * Ekstrakcja regułowa w trybie demonstracyjnym bez zużywania zewnętrznego API
   */
  public extractHeuristicFacts(userMessage: string): ExtractedFact[] {
    const text = userMessage.trim();
    const facts: ExtractedFact[] = [];

    // Dopasowania regex na typowe polskie frazy deklaratywne
    const nameMatch = text.match(/(?:mam na imię|nazywam się|jestem)\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)/i);
    if (nameMatch && !/architekt|programist|inżynier|człowiek/i.test(nameMatch[1])) {
      facts.push({
        category: 'user_profile',
        subject: 'Użytkownik',
        predicate: 'ma na imię',
        object: nameMatch[1],
        confidence: 0.98
      });
    }

    const cityMatch = text.match(/(?:mieszkam w|jestem z|pochodzę z)\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\s-]+)/i);
    if (cityMatch) {
      facts.push({
        category: 'user_profile',
        subject: 'Użytkownik',
        predicate: 'mieszka w',
        object: cityMatch[1].trim(),
        confidence: 0.95
      });
    }

    const roleMatch = text.match(/(?:jestem|pracuję jako)\s+([a-ząćęłńóśźż\s]+(?:architekt|programist|inżynier|developer|lekarz|prawnik|nauczyciel|grafik))/i);
    if (roleMatch) {
      facts.push({
        category: 'user_profile',
        subject: 'Użytkownik',
        predicate: 'pracuje jako',
        object: roleMatch[1].trim(),
        confidence: 0.94
      });
    }

    const likeMatch = text.match(/(?:mój ulubiony|uwielbiam|bardzo lubię|interesuję się)\s+([^.,!]+)/i);
    if (likeMatch) {
      facts.push({
        category: 'preference',
        subject: 'Użytkownik',
        predicate: 'lubi',
        object: likeMatch[1].trim(),
        confidence: 0.92
      });
    }

    const dislikeMatch = text.match(/(?:nie lubię|nie cierpię|nienawidzę)\s+([^.,!]+)/i);
    if (dislikeMatch) {
      facts.push({
        category: 'preference',
        subject: 'Użytkownik',
        predicate: 'nie lubi',
        object: dislikeMatch[1].trim(),
        confidence: 0.92
      });
    }

    const correctionMatch = text.match(/(?:od teraz pamiętaj|poprawiam|wcale nie|to nieprawda|nie,?\s+(?:bo|że))\s+([^.,!]+)/i);
    if (correctionMatch) {
      facts.push({
        category: 'correction',
        subject: 'Użytkownik',
        predicate: 'poprawił wiedzę',
        object: correctionMatch[1].trim(),
        confidence: 0.99
      });
    }

    return facts;
  }
}

export const browserSandbox = new BrowserSandboxEngine();
