/**
 * SemanticEncoder (MakeAI KAN-Cognitive Core v2).
 * Deterministic lexical & semantic hashing engine that maps text to a normalized Float32Array.
 * Zero external libraries, zero Math.random(), zero Math.sin().
 * Employs rolling hash, char/word n-grams, domain-specific semantic projections, and L2 normalization.
 */

export class SemanticEncoder {
  private static readonly MERSENNE_PRIME = 2147483647; // 2^31 - 1
  private static readonly ROLLING_BASE = 131;

  // Domain-specific semantic markers
  private static readonly ETHICAL_PATTERNS = [
    'powinienem', 'powinno', 'etyk', 'moral', 'dobr', 'zło', 'sumienie',
    'praworządn', 'sprawiedliw', 'zasad', 'godnośc', 'cnot', 'etyczn',
    'odpowiedzialn', 'wartośc', 'czy wolno', 'czy wypada', 'zbrodnia', 'grzech',
    'ethical', 'moral', 'right', 'wrong', 'duty', 'conscience', 'justice',
    'virtue', 'principle', 'ethics', 'responsibility', 'harm', 'dilemma'
  ];

  private static readonly FACTUAL_PATTERNS = [
    'co to', 'kto to', 'kto byl', 'kto był', 'kiedy', 'gdzie', 'dlaczego',
    'jak powstał', 'historia', 'data', 'rok', 'wiek', 'stolica', 'definicja',
    'twierdzenie', 'teoria', 'odkrycie', 'encykloped', 'fakt', 'biografia',
    'populacja', 'geografia', 'nauk', 'w którym roku',
    'what is', 'who is', 'who was', 'when', 'where', 'why', 'history',
    'date', 'year', 'capital', 'definition', 'theorem', 'theory', 'discovery'
  ];

  private static readonly CODE_PATTERNS = [
    'function', 'class', 'const', 'let', 'var', 'return', 'import', 'export',
    'interface', 'type', 'async', 'await', 'def', 'public', 'private', 'void',
    'string', 'number', 'boolean', 'array', 'null', 'undefined', 'promise',
    'kod', 'funkcja', 'klasa', 'zmienna', 'pętla', 'algorytm', 'b-spline',
    'sqlite', 'sql', 'json', 'api', 'endpoint', 'kompilator', 'debug',
    'quicksort', 'matrix', 'tensor', 'float32', 'vector', 'optimizer'
  ];

  private static readonly CODE_SYMBOLS = [
    '{', '}', '(', ')', '[', ']', ';', '=>', '===', '!==', '++', '--',
    '&&', '||', '->', ':=', '+=', '-=', '*=', '/=', '<=', '>='
  ];

  private static readonly CONVERSATIONAL_PATTERNS = [
    'cześć', 'hej', 'witaj', 'dzień dobry', 'dobry wieczór', 'siema',
    'kim jesteś', 'jak się masz', 'co tam', 'dzięki', 'dziękuję', 'proszę',
    'twoje imię', 'nazywasz', 'aura', 'porozmawiajmy', 'miło cię',
    'hello', 'hi', 'hey', 'good morning', 'who are you', 'how are you',
    'thanks', 'thank you', 'your name', 'identity'
  ];

  /**
   * Encodes arbitrary text into a deterministic, L2-normalized Float32Array vector.
   * @param text Input string
   * @param dim Vector dimension (default 32)
   */
  public static encode(text: string, dim: number = 32): Float32Array {
    const vector = new Float32Array(dim);
    if (!text || typeof text !== 'string') {
      vector[0] = 1.0;
      return vector;
    }

    const trimmed = text.trim();
    if (trimmed.length === 0) {
      vector[0] = 1.0;
      return vector;
    }

    const lower = trimmed.toLowerCase();

    // 1. Character-level rolling hash & n-grams (slots 0 .. min(7, dim - 1))
    const charSlots = Math.min(8, dim);
    let rollingHash = 0;
    for (let i = 0; i < lower.length; i++) {
      const code = lower.charCodeAt(i);
      rollingHash = (rollingHash * this.ROLLING_BASE + code) % this.MERSENNE_PRIME;
      const targetSlot = Math.abs(rollingHash) % charSlots;
      const sign = (rollingHash & 1) === 0 ? 1.0 : -1.0;
      vector[targetSlot] += sign * 0.15;

      // Character bigrams
      if (i > 0) {
        const bigramCode = ((lower.charCodeAt(i - 1) << 8) | code) % this.MERSENNE_PRIME;
        const bSlot = Math.abs(bigramCode) % charSlots;
        vector[bSlot] += ((bigramCode & 2) === 0 ? 0.2 : -0.2);
      }

      // Character trigrams
      if (i > 1) {
        const trigramCode = ((lower.charCodeAt(i - 2) << 16) | (lower.charCodeAt(i - 1) << 8) | code) % this.MERSENNE_PRIME;
        const tSlot = Math.abs(trigramCode) % charSlots;
        vector[tSlot] += ((trigramCode & 4) === 0 ? 0.25 : -0.25);
      }
    }

    // 2. Word-level hashing & token frequency (slots 8 .. min(15, dim - 1))
    const wordSlotsStart = Math.min(8, dim);
    const wordSlotsCount = Math.max(1, Math.min(8, dim - wordSlotsStart));
    const words = lower.match(/[a-zA-Z0-9ąćęłńóśźż_+-]+/g) || [];

    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      let wordHash = 5381;
      for (let c = 0; c < word.length; c++) {
        wordHash = ((wordHash << 5) + wordHash + word.charCodeAt(c)) % this.MERSENNE_PRIME;
      }
      const wSlot = wordSlotsStart + (Math.abs(wordHash) % wordSlotsCount);
      const sign = (wordHash & 1) === 0 ? 1.0 : -1.0;
      vector[wSlot] += sign * (0.3 + Math.min(0.5, word.length * 0.05));

      // Word bigrams
      if (w > 0) {
        const prevWord = words[w - 1];
        let biHash = wordHash;
        for (let c = 0; c < prevWord.length; c++) {
          biHash = ((biHash << 5) + biHash + prevWord.charCodeAt(c)) % this.MERSENNE_PRIME;
        }
        const biSlot = wordSlotsStart + (Math.abs(biHash) % wordSlotsCount);
        vector[biSlot] += ((biHash & 2) === 0 ? 0.35 : -0.35);
      }
    }

    // 3. Domain-specific semantic projections (slots 16 .. 31 if dim >= 32)
    if (dim >= 32) {
      // Sub-band A: Ethical / Moral Reasoning (Slots 16..19)
      let ethicalScore = 0;
      for (const pat of this.ETHICAL_PATTERNS) {
        if (lower.includes(pat)) {
          ethicalScore += 1.5;
        }
      }

      // Sub-band B: Fact Retrieval & Epistemic Verification (Slots 20..23)
      let factualScore = 0;
      for (const pat of this.FACTUAL_PATTERNS) {
        if (lower.includes(pat)) {
          factualScore += 1.4;
        }
      }
      const numbersCount = (text.match(/\b\d{1,4}\b/g) || []).length;
      factualScore += numbersCount * 0.8;

      // Sub-band C: Code & Algorithmic Synthesis (Slots 24..27)
      let codeScore = 0;
      for (const pat of this.CODE_PATTERNS) {
        if (lower.includes(pat)) {
          codeScore += 1.5;
        }
      }
      for (const sym of this.CODE_SYMBOLS) {
        if (text.includes(sym)) {
          codeScore += 0.9;
        }
      }

      // Sub-band D: Conversational & Identity Coordination (Slots 28..31)
      let convoScore = 0;
      for (const pat of this.CONVERSATIONAL_PATTERNS) {
        if (lower.includes(pat)) {
          convoScore += 1.5;
        }
      }

      // Apply activations with lateral inhibition between orthogonal domains
      vector[16] += ethicalScore * 1.5 - codeScore * 0.5;
      vector[17] += ethicalScore * 1.0;
      vector[18] += (lower.includes('?') && ethicalScore > 0 ? 1.2 : 0.0);
      vector[19] += (ethicalScore > 1.5 ? 1.2 : -0.3);

      vector[20] += factualScore * 1.4 - ethicalScore * 0.3;
      vector[21] += factualScore * 1.0;
      vector[22] += (numbersCount > 0 ? 1.0 : -0.2);
      vector[23] += (lower.includes('kiedy') || lower.includes('when') || lower.includes('rok') ? 1.2 : 0.0);

      vector[24] += codeScore * 1.6 - ethicalScore * 0.5 - convoScore * 0.3;
      vector[25] += codeScore * 1.1;
      vector[26] += (text.includes('{') || text.includes(';') ? 1.5 : -0.3);
      vector[27] += (text.includes('=>') || text.includes('function') ? 1.3 : 0.0);

      vector[28] += convoScore * 1.5 - codeScore * 0.4;
      vector[29] += convoScore * 1.0;
      vector[30] += (lower.startsWith('cześć') || lower.startsWith('hej') || lower.startsWith('hello') ? 1.4 : 0.0);
      vector[31] += (convoScore > 1.5 ? 1.2 : -0.3);
    }

    // 4. Non-linear activation (tanh squashing across all dimensions)
    for (let i = 0; i < dim; i++) {
      vector[i] = Math.tanh(vector[i]);
    }

    // 5. Strict L2 Normalization (||v||_2 = 1.0)
    let sumSq = 0;
    for (let i = 0; i < dim; i++) {
      sumSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm > 1e-9) {
      for (let i = 0; i < dim; i++) {
        vector[i] /= norm;
      }
    } else {
      vector[0] = 1.0;
    }

    return vector;
  }

  /**
   * Instance method wrapper for encode.
   */
  public encode(text: string, dim: number = 32): Float32Array {
    return SemanticEncoder.encode(text, dim);
  }
}
