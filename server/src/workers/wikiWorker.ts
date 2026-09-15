import { wikipediaService, WikiSummaryResult } from '../services/wikipedia.js';

export class WikiWorker {
  /**
   * Sprawdza, czy zapytanie użytkownika wymaga odwołania do Wikipedii
   * Wykrywa wzorce typu: "kim jest...", "co to jest...", "opowiedz o...", "jak działa...", lub nazwy własne
   */
  public async inspectAndFetch(userPrompt: string): Promise<WikiSummaryResult | null> {
    const prompt = userPrompt.trim();

    // Wzorce zapytań encyklopedycznych
    const patterns = [
      /(?:kim (?:jest|był|była)|who is)\s+([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż\s\-]+)/i,
      /(?:co to (?:jest|znaczy)|czym jest|what is)\s+([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż\s\-]+)/i,
      /(?:opowiedz (?:mi )?o|definicja|historia|encyklopedia)\s+([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż\s\-]+)/i,
      /(?:wytłumacz pojęcie|co wiesz o)\s+([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż\s\-]+)/i
    ];

    for (const pattern of patterns) {
      const match = prompt.match(pattern);
      if (match && match[1]) {
        const queryTerm = match[1].replace(/[?!.,;]/g, '').trim();
        if (queryTerm.length > 2) {
          const result = await wikipediaService.getSummary(queryTerm);
          if (result.found) {
            return result;
          }
        }
      }
    }

    return null;
  }
}

export const wikiWorker = new WikiWorker();
