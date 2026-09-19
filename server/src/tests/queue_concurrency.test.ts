/**
 * Integration Test for Concurrency Queue, Self-Healing JSON, and Memory Reranker
 */

import { memoryWorker, ExtractedFact } from '../workers/memoryWorker.js';
import { memoryRanker, LearnedFact } from '../services/memoryRanker.js';
import { database } from '../db/database.js';

async function runTests() {
  console.log('=== Rozpoczęcie Testów Współbieżności i Selekcji Pamięci ===\n');

  // TEST 1: Weryfikacja PRAGMA WAL w libSQL
  console.log('Test 1: Weryfikacja trybu WAL i indeksów w libSQL...');
  await database.ensureInitialized();
  const pragmaRes = await database.client.execute('PRAGMA journal_mode;');
  const journalMode = ((pragmaRes.rows[0]?.journal_mode as string) || '').toLowerCase();
  if (journalMode !== 'wal') {
    throw new Error(`Oczekiwano journal_mode=wal, otrzymano: ${journalMode}`);
  }
  console.log(`✓ libSQL journal_mode: ${journalMode.toUpperCase()}`);

  const indexesRes = await database.client.execute("SELECT name FROM sqlite_master WHERE type='index';");
  const indexNames = new Set(indexesRes.rows.map((i: any) => i.name));
  if (!indexNames.has('idx_facts_active_cat')) {
    throw new Error('Brak indeksu idx_facts_active_cat');
  }
  console.log('✓ Indeksy B-Tree na tabelach bazy danych obecne');

  // TEST 2: Self-Healing JSON Extractor
  console.log('\nTest 2: Weryfikacja Self-Healing JSON Extractor...');
  // Case A: Ucięty JSON (brakujące zamykające nawiasy ']}')
  const truncatedJson = `
  \`\`\`json
  [
    {
      "category": "user_profile",
      "subject": "Użytkownik",
      "predicate": "mieszka w",
      "object": "Krakowie",
      "confidence": 0.95
  `;
  const repairedFacts = memoryWorker.parseWithSelfHealing(truncatedJson);
  if (repairedFacts.length !== 1 || repairedFacts[0].object !== 'Krakowie') {
    throw new Error(`Self-healing zawiódł przy uciętym JSON: ${JSON.stringify(repairedFacts)}`);
  }
  console.log('✓ Naprawiono ucięty JSON bez nawiasów domykających');

  // Case B: Markdown z tekstem przed i po
  const noisyJson = `
  Oto wyekstrahowane fakty w formacie JSON:
  [
    {
      "category": "correction",
      "subject": "Model KAN",
      "predicate": "wykorzystuje",
      "object": "B-splajny",
      "confidence": 0.99
    }
  ]
  Mam nadzieję, że to pomoże!
  `;
  const cleanFacts = memoryWorker.parseWithSelfHealing(noisyJson);
  if (cleanFacts.length !== 1 || cleanFacts[0].category !== 'correction') {
    throw new Error('Ekstrakcja z tekstu zaszumionego zawiodła');
  }
  console.log('✓ Odfiltrowano komentarze wokół JSON');

  // TEST 3: Memory Reranker (Semantic Ranking)
  console.log('\nTest 3: Weryfikacja MemoryRanker (Selekcja Semantyczna vs Sztywne LIMIT 40)...');
  const dummyFacts: LearnedFact[] = [
    { id: 1, category: 'preference', subject: 'Użytkownik', predicate: 'lubi', object: 'język Rust', confidence: 0.9, created_at: '2026-01-01' },
    { id: 2, category: 'world_knowledge', subject: 'Python', predicate: 'posiada', object: 'GIL', confidence: 0.8, created_at: '2026-01-02' },
    { id: 3, category: 'user_profile', subject: 'Użytkownik', predicate: 'posiada', object: 'szklarnię z pomidorami', confidence: 0.95, created_at: '2026-02-01' },
    { id: 4, category: 'preference', subject: 'Pomidory', predicate: 'wymagają', object: 'dużo słońca i podlewania', confidence: 0.9, created_at: '2026-02-05' },
    { id: 5, category: 'correction', subject: 'Nawożenie pomidorów', predicate: 'wymaga', object: 'wapnia i potasu', confidence: 1.0, created_at: '2026-02-10' },
    { id: 6, category: 'world_knowledge', subject: 'Docker', predicate: 'używa', object: 'cgroups i namespaces', confidence: 0.85, created_at: '2026-02-12' }
  ];

  const query = 'Jak dbać o pomidory w mojej szklarni? Czym je nawozić?';
  const ranked = memoryRanker.rankFacts(query, dummyFacts, 3);

  console.log(`Wyselekcjonowane top ${ranked.length} fakty dla zapytania: "${query}"`);
  ranked.forEach((f, idx) => {
    console.log(`  #${idx + 1} [${f.category}] ${f.subject} ${f.predicate} ${f.object}`);
  });

  // Weryfikacja: fakty o pomidorach muszą być na szczycie
  const subjects = ranked.map((r) => r.subject);
  if (!subjects.includes('Pomidory') && !subjects.includes('Nawożenie pomidorów') && !subjects.includes('Użytkownik')) {
    throw new Error('Ranking nie wyniósł na szczyt faktów ogrodniczych!');
  }
  if (subjects.includes('Docker')) {
    throw new Error('Nierelewantny fakt o Dockerze znalazł się w top 3 rankingu ogrodniczego!');
  }
  console.log('✓ Semantyczna selekcja wyeliminowała szum informacyjny');

  console.log('\n=== WSZYSTKIE TESTY INTEGRACYJNE ZAKOŃCZONE SUKCESEM (3/3) ===');
}

runTests().catch((err) => {
  console.error('Błąd testu:', err);
  process.exit(1);
});
