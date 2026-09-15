import { browserStore } from './storage';

export interface WikiSummaryResult {
  found: boolean;
  title?: string;
  summary?: string;
  url?: string;
  thumbnailUrl?: string;
  source: 'cache' | 'network' | 'none';
}

export class BrowserWikipediaService {
  /**
   * Szuka i pobiera podsumowanie z polskiej Wikipedii (fallback do angielskiej)
   */
  public async getSummary(searchTerm: string, lang: 'pl' | 'en' = 'pl'): Promise<WikiSummaryResult> {
    const cleanTerm = searchTerm.trim();
    if (!cleanTerm) {
      return { found: false, source: 'none' };
    }

    // 1. Sprawdź cache IndexedDB
    const cached = await browserStore.getCachedWiki(cleanTerm);
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
      // 2. Wyszukiwarka MediaWiki z flagą origin=* dla CORS
      const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        cleanTerm
      )}&utf8=&format=json&origin=*&srlimit=1`;
      const searchRes = await fetch(searchUrl);

      if (!searchRes.ok) {
        return { found: false, source: 'none' };
      }

      const searchData = await searchRes.json();
      const firstHit = searchData?.query?.search?.[0];
      if (!firstHit || !firstHit.title) {
        if (lang === 'pl') {
          return this.getSummary(cleanTerm, 'en');
        }
        return { found: false, source: 'none' };
      }

      const exactTitle = firstHit.title;

      // 3. Pobranie podsumowania z REST API Wikipedii
      const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(exactTitle)}`;
      const summaryRes = await fetch(summaryUrl);

      if (!summaryRes.ok) {
        return { found: false, source: 'none' };
      }

      const summaryData = await summaryRes.json();
      const extract = summaryData.extract;
      const pageUrl =
        summaryData.content_urls?.desktop?.page ||
        `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(exactTitle)}`;
      const thumb = summaryData.thumbnail?.source;

      if (!extract) {
        return { found: false, source: 'none' };
      }

      // 4. Zapis do cache IndexedDB
      await browserStore.saveCachedWiki(cleanTerm, exactTitle, extract, pageUrl);

      return {
        found: true,
        title: exactTitle,
        summary: extract,
        url: pageUrl,
        thumbnailUrl: thumb,
        source: 'network'
      };
    } catch (err: any) {
      console.warn('[BrowserWikipediaService] Błąd pobierania:', err.message);
      return { found: false, source: 'none' };
    }
  }
}

export const browserWikipedia = new BrowserWikipediaService();
