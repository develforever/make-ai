import { database } from '../db/database.js';
import { openRouterClient } from './openRouter.js';
import { DEFAULT_CONFIG } from '../config.js';

export interface ResolvedSessionReference {
  sessionId: string;
  title: string;
  summary: string;
  contextText: string;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 3.5));
}

export class SessionResolver {
  /**
   * Generuje natychmiastowy tytuł heurystyczny na podstawie pierwszej wiadomości użytkownika
   */
  public generateHeuristicTitle(message: string): string {
    const clean = message
      .replace(/^[#>\s*_-]+/, '')
      .replace(/^(?:proszę|powiedz mi|jak|czym jest|kim jest|co to jest|napisz|wyjaśnij|hej|cześć|witaj)\s+/i, '')
      .trim();

    if (!clean) return 'Nowa rozmowa';
    const capitalized = clean.charAt(0).toUpperCase() + clean.slice(1);
    const firstLine = capitalized.split('\n')[0].trim();
    if (firstLine.length <= 45) {
      return firstLine;
    }
    return firstLine.slice(0, 42).trim() + '...';
  }

  /**
   * Asynchroniczne doprecyzowanie tytułu sesji przez model LLM po pierwszej turze
   */
  public async refineTitleAsync(sessionId: string, userMessage: string, assistantReply: string): Promise<string | null> {
    if (!(await openRouterClient.hasApiKey())) return null;

    try {
      const model = (await database.getSetting('extraction_model')) || DEFAULT_CONFIG.DEFAULT_EXTRACTION_MODEL;
      const prompt = `Jesteś modułem nadawania zwięzłych tytułów w systemie MakeAI.
Na podstawie poniższej pierwszej tury rozmowy wymyśl bardzo krótki, precyzyjny tytuł sesji (od 2 do 5 słów w języku polskim).
Zwróć WYŁĄCZNIE sam tytuł, bez cudzysłowów, znaków formatowania ani komentarzy.

Użytkownik: ${userMessage.slice(0, 300)}
Asystent: ${assistantReply.slice(0, 300)}

Tytuł sesji:`;

      const response = await openRouterClient.chatCompletion(
        [{ role: 'user', content: prompt }],
        model,
        'session_title_refinement',
        0.3
      );

      const title = response.content?.trim().replace(/^["']|["']$/g, '');
      if (title && title.length > 2 && title.length < 60) {
        await database.updateSession(sessionId, { title });
        return title;
      }
    } catch (err: any) {
      console.warn(`[SessionResolver] Nie udało się wygenerować tytułu LLM dla sesji ${sessionId}:`, err.message);
    }
    return null;
  }

  /**
   * Wykrywa identyfikatory odwołań do innych sesji w treści wiadomości użytkownika
   * Obsługuje:
   * 1. [[session:ID|Tytuł]] lub [[session:ID]]
   * 2. @session:ID
   * 3. @session_[a-zA-Z0-9_-]+
   */
  public extractReferencedSessionIds(message: string): string[] {
    const found = new Set<string>();

    // 1. Format Obsidian/Wiki: [[session:ID...]]
    const wikiRegex = /\[\[session:([a-zA-Z0-9_-]+)(?:\|[^\]]+)?\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = wikiRegex.exec(message)) !== null) {
      found.add(match[1]);
    }

    // 2. Format @session:ID
    const atColonRegex = /@session:([a-zA-Z0-9_-]+)/g;
    while ((match = atColonRegex.exec(message)) !== null) {
      found.add(match[1]);
    }

    // 3. Format @session_timestamp_id
    const atDirectRegex = /@(session_[a-zA-Z0-9_-]+)/g;
    while ((match = atDirectRegex.exec(message)) !== null) {
      found.add(match[1]);
    }

    return Array.from(found);
  }

  /**
   * Pobiera i kompiluje kontekst dla wskazanych sesji powiązanych.
   * Gwarantuje twarde ograniczenie budżetu tokenów (maksymalnie 400 tokenów łącznie dla wszystkich sesji).
   * Selekcjonuje najistotniejsze wiadomości dopasowane semantycznie do currentQuery bez sztucznego obcinania slice(0, 180).
   */
  public async resolveSessionContexts(sessionIds: string[], currentQuery: string = ''): Promise<ResolvedSessionReference[]> {
    const results: ResolvedSessionReference[] = [];
    if (!sessionIds || sessionIds.length === 0) {
      return results;
    }

    const MAX_TOTAL_TOKENS = 400;
    let accumulatedTokens = 0;

    const queryTokens = currentQuery
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
    const queryLower = currentQuery.trim().toLowerCase();

    for (const id of sessionIds) {
      if (accumulatedTokens >= MAX_TOTAL_TOKENS) break;

      const session = await database.getSession(id);
      if (!session) continue;

      const allMessages = await database.getAllSessionMessages(id);
      if (allMessages.length === 0) continue;

      // Ranking wiadomości w ramach sesji według trafności do zapytania użytkownika
      const scoredMessages = allMessages.map((msg, index) => {
        let score = 0;
        const contentLower = (msg.content || '').toLowerCase();

        // Dopasowanie pełnej frazy
        if (queryLower && contentLower.includes(queryLower)) {
          score += 5.0;
        }

        // Nakładanie się tokenów
        for (const token of queryTokens) {
          if (contentLower.includes(token)) {
            score += 1.5;
          }
        }

        // Dopasowanie do tytułu sesji
        if (queryLower && (session.title || '').toLowerCase().includes(queryLower)) {
          score += 1.0;
        }

        // Współczynnik świeżości (ostatnie wypowiedzi są naturalnie istotniejsze)
        const recencyBonus = (index / Math.max(1, allMessages.length)) * 1.0;
        score += recencyBonus;

        return { msg, score, index };
      });

      // Sortuj według wyniku malejąco
      scoredMessages.sort((a, b) => b.score - a.score);

      // Wybierz do 2-3 najbardziej relewantnych wypowiedzi i posortuj je chronologicznie
      const selected = scoredMessages
        .slice(0, 3)
        .sort((a, b) => a.index - b.index)
        .map((s) => s.msg);

      // Budowanie linii kontekstu bez ucinania slice(0, 180)
      const contextLines: string[] = [];
      const header = `[ODWOŁANIE DO POWIĄZANEJ SESJI: "${session.title}" (ID: ${session.id})]`;
      contextLines.push(header);

      if (session.summary) {
        contextLines.push(`Streszczenie sesji: ${session.summary}`);
      }

      contextLines.push('Kluczowe ustalenia w tamtej sesji:');
      for (const m of selected) {
        const roleLabel = m.role === 'assistant' ? 'Asystent' : 'Użytkownik';
        contextLines.push(`- ${roleLabel}: ${m.content}`);
      }

      // Sprawdzenie i twarde przycięcie do budżetu 400 tokenów łącznie
      let sessionText = '';
      const candidateText = contextLines.join('\n');
      const candidateTokens = estimateTokens(candidateText);

      if (accumulatedTokens + candidateTokens <= MAX_TOTAL_TOKENS) {
        sessionText = candidateText;
        accumulatedTokens += candidateTokens;
      } else {
        // Stopniowe dopasowanie linii do pozostałego budżetu tokenów
        const remainingTokens = MAX_TOTAL_TOKENS - accumulatedTokens;
        if (remainingTokens < 25) {
          // Zbyt mało miejsca na sensowny kontekst sesji
          break;
        }

        const fittedLines: string[] = [header];
        let currentTokens = estimateTokens(header);

        for (let l = 1; l < contextLines.length; l++) {
          const line = contextLines[l];
          const lineTokens = estimateTokens(line);
          if (currentTokens + lineTokens <= remainingTokens) {
            fittedLines.push(line);
            currentTokens += lineTokens;
          } else {
            // Jeśli linia jest kluczową wiadomością i mamy jeszcze trochę miejsca, dopełnij
            const availableChars = Math.floor((remainingTokens - currentTokens) * 3.5);
            if (availableChars > 40) {
              fittedLines.push(line.slice(0, availableChars) + '...');
              currentTokens = remainingTokens;
            }
            break;
          }
        }

        sessionText = fittedLines.join('\n');
        accumulatedTokens += currentTokens;
      }

      if (sessionText.trim()) {
        results.push({
          sessionId: session.id,
          title: session.title,
          summary: session.summary || '',
          contextText: sessionText
        });
      }
    }

    return results;
  }
}

export const sessionResolver = new SessionResolver();
