import { database } from '../db/database.js';

export interface WikiSummaryResult {
  found: boolean;
  title?: string;
  summary?: string;
  url?: string;
  thumbnailUrl?: string;
  source: 'cache' | 'network' | 'none';
}

export class WikipediaService {
  private userAgent = 'MakeAI-ArchitectAgent/1.0 (contact: test@example.com)';

  /**
   * Szuka i pobiera podsumowanie z polskiej Wikipedii (fallback do angielskiej)
   */
  public async getSummary(searchTerm: string, lang: 'pl' | 'en' = 'pl'): Promise<WikiSummaryResult> {
    const cleanTerm = searchTerm.trim();
    if (!cleanTerm) {
      return { found: false, source: 'none' };
    }

    // 1. Sprawdź cache bazy danych
    const cached = database.getCachedWiki(cleanTerm);
    if (cached) {
      return {
        found: true,
        title: cached.title,
        summary: cached.summary,
        url: cached.url,
        source: 'cache'
      };
    }

    try {
      // 2. Najpierw sprawdź wyszukiwarkę Wikipedii, aby znaleźć dokładny tytuł artykułu
      const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanTerm)}&utf8=&format=json&srlimit=1`;
      const searchRes = await fetch(searchUrl, {
        headers: { 'User-Agent': this.userAgent }
      });

      if (!searchRes.ok) {
        return { found: false, source: 'none' };
      }

      const searchData = await searchRes.json() as any;
      const firstHit = searchData?.query?.search?.[0];
      if (!firstHit || !firstHit.title) {
        // Spróbuj w wersji angielskiej jeśli po polsku nic nie znaleziono
        if (lang === 'pl') {
          return this.getSummary(cleanTerm, 'en');
        }
        return { found: false, source: 'none' };
      }

      const exactTitle = firstHit.title;

      // 3. Pobierz ustandaryzowane podsumowanie z REST API
      const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(exactTitle)}`;
      const summaryRes = await fetch(summaryUrl, {
        headers: { 'User-Agent': this.userAgent }
      });

      if (!summaryRes.ok) {
        return { found: false, source: 'none' };
      }

      const summaryData = await summaryRes.json() as any;
      const extract = summaryData.extract;
      const pageUrl = summaryData.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(exactTitle)}`;
      const thumb = summaryData.thumbnail?.source;

      if (!extract) {
        return { found: false, source: 'none' };
      }

      // 4. Zapisz do cache
      database.saveCachedWiki(cleanTerm, exactTitle, extract, pageUrl);

      return {
        found: true,
        title: exactTitle,
        summary: extract,
        url: pageUrl,
        thumbnailUrl: thumb,
        source: 'network'
      };
    } catch (err: any) {
      console.error('[WikipediaService] Błąd pobierania:', err.message);
      return { found: false, source: 'none' };
    }
  }
}

export const wikipediaService = new WikipediaService();
