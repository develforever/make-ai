/**
 * Hybrid Semantic & Lexical Memory Reranker (Filar 2: Semantyczna Selekcja Pamięci).
 * Replaces naive LIMIT 40 with dynamic relevance scoring:
 *   Score = (LexicalScore + CategoryBoost) * RecencyDecay * Confidence
 */

export interface LearnedFact {
  id: number;
  category: 'user_profile' | 'world_knowledge' | 'correction' | 'preference' | string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  created_at: string;
  is_active?: number;
}

export interface FactRankingResult {
  fact: LearnedFact;
  score: number;
  matchedTokens: string[];
}

const STOP_WORDS = new Set([
  'i', 'w', 'z', 'do', 'na', 'to', 'czy', 'jak', 'że', 'o', 'dla', 'jest', 'się', 'po',
  'co', 'tak', 'nie', 'ale', 'oraz', 'ze', 'za', 'od', 'mi', 'cię', 'go', 'jej', 'mu',
  'a', 'an', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was'
]);

export class MemoryRanker {
  /**
   * Tokenizes and normalizes text into searchable lexical stems/tokens.
   */
  public tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  }

  /**
   * Evaluates relevance score between user query and a learned fact.
   */
  public scoreFact(queryTokens: string[], queryRaw: string, fact: LearnedFact): { score: number; matchedTokens: string[] } {
    let rawScore = 0;
    const matchedTokens: string[] = [];

    const factText = `${fact.subject} ${fact.predicate} ${fact.object}`.toLowerCase();
    const factTokens = this.tokenize(factText);
    const factTokenSet = new Set(factTokens);

    const qLower = queryRaw.toLowerCase();
    const subLower = fact.subject.toLowerCase();
    const objLower = fact.object.toLowerCase();

    // 1. Exact Substring Match (Strongest signal)
    if (qLower.includes(subLower) && subLower.length > 2) {
      rawScore += 4.0;
      matchedTokens.push(fact.subject);
    }
    if (qLower.includes(objLower) && objLower.length > 2) {
      rawScore += 3.5;
      matchedTokens.push(fact.object);
    }

    // 2. Token Overlap Scoring
    for (const qToken of queryTokens) {
      if (factTokenSet.has(qToken)) {
        rawScore += 1.5;
        matchedTokens.push(qToken);
      } else {
        // Partial stem match (prefix >= 4 chars)
        for (const fToken of factTokens) {
          if (qToken.length >= 4 && fToken.length >= 4 && (qToken.startsWith(fToken) || fToken.startsWith(qToken))) {
            rawScore += 0.8;
            matchedTokens.push(`${qToken}~${fToken}`);
            break;
          }
        }
      }
    }

    // 3. Category Priority Multipliers & Base Salience
    // 'correction' facts are explicit corrections from user -> Critical to always include if relevant!
    if (fact.category === 'correction') {
      rawScore += rawScore > 0 ? 3.0 : 1.2;
    } else if (fact.category === 'user_profile') {
      // Base salience for user profile fundamentals (who they are, occupation)
      rawScore += rawScore > 0 ? 1.5 : 0.8;
    } else if (fact.category === 'preference') {
      rawScore += rawScore > 0 ? 1.2 : 0.5;
    }

    // 4. Recency Decay
    const now = Date.now();
    const createdTime = new Date(fact.created_at || now).getTime();
    const diffDays = Math.max(0, (now - createdTime) / (1000 * 60 * 60 * 24));
    const recencyFactor = 1.0 / (1.0 + diffDays * 0.03); // Soft decay over weeks

    // 5. Confidence multiplier
    const confidence = Math.max(0.2, Math.min(1.0, fact.confidence || 1.0));

    const finalScore = rawScore * recencyFactor * confidence;
    return { score: finalScore, matchedTokens };
  }

  /**
   * Selects and orders facts by relevance for persona prompt injection.
   */
  public rankFacts(
    query: string,
    allFacts: LearnedFact[],
    maxResults: number = 15,
    minScoreThreshold: number = 0.3
  ): LearnedFact[] {
    if (allFacts.length <= maxResults) {
      return allFacts;
    }

    const queryTokens = this.tokenize(query);
    const scoredList: FactRankingResult[] = [];

    for (const fact of allFacts) {
      const { score, matchedTokens } = this.scoreFact(queryTokens, query, fact);
      scoredList.push({ fact, score, matchedTokens });
    }

    // Sort descending by score
    scoredList.sort((a, b) => b.score - a.score);

    // Pick top candidates above threshold
    const candidates = scoredList
      .filter((s) => s.score >= minScoreThreshold)
      .slice(0, maxResults)
      .map((s) => s.fact);

    // If matches are few, fill up remaining slots with highest-priority user_profile/correction facts
    if (candidates.length < maxResults) {
      const selectedIds = new Set(candidates.map((c) => c.id));
      for (const s of scoredList) {
        if (candidates.length >= maxResults) break;
        if (!selectedIds.has(s.fact.id)) {
          candidates.push(s.fact);
          selectedIds.add(s.fact.id);
        }
      }
    }

    return candidates;
  }
}

export const memoryRanker = new MemoryRanker();
