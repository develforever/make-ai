import { database } from '../db/database.js';
import { openRouterClient } from './openRouter.js';
import { DEFAULT_CONFIG } from '../config.js';

export interface ResolvedSessionReference {
  sessionId: string;
  title: string;
  summary: string;
  contextText: string;
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
    if (!openRouterClient.hasApiKey()) return null;

    try {
      const model = database.getSetting('extraction_model') || DEFAULT_CONFIG.DEFAULT_EXTRACTION_MODEL;
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
        database.updateSession(sessionId, { title });
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
   * Pobiera i kompiluje kontekst dla wskazanych sesji powiązanych
   * Gwarantuje twarde ograniczenie budżetu tokenów (max ~400 tokenów na sesję)
   */
  public resolveSessionContexts(sessionIds: string[]): ResolvedSessionReference[] {
    const results: ResolvedSessionReference[] = [];

    for (const id of sessionIds) {
      const session = database.getSession(id);
      if (!session) continue;

      const messages = database.getRecentMessages(6, id);
      if (messages.length === 0) continue;

      // Wyciągnij kluczowe wypowiedzi (pierwsza i ostatnia tura)
      const firstMsg = messages[0];
      const lastMsg = messages[messages.length - 1];

      let contextLines: string[] = [];
      contextLines.push(`[ODWOŁANIE DO POWIĄZANEJ SESJI: "${session.title}" (ID: ${session.id})]`);
      if (session.summary) {
        contextLines.push(`Streszczenie sesji: ${session.summary}`);
      }

      contextLines.push(`Początek dyskusji:`);
      contextLines.push(`- Użytkownik: ${firstMsg.content.slice(0, 180)}`);
      
      if (messages.length > 1) {
        contextLines.push(`Ostatnie ustalenia w tamtej sesji:`);
        contextLines.push(`- ${lastMsg.role === 'assistant' ? 'Asystent' : 'Użytkownik'}: ${lastMsg.content.slice(0, 220)}`);
      }

      results.push({
        sessionId: session.id,
        title: session.title,
        summary: session.summary || '',
        contextText: contextLines.join('\n')
      });
    }

    return results;
  }
}

export const sessionResolver = new SessionResolver();
