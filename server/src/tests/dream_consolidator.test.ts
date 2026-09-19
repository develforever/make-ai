/**
 * Integration Test for Autonomous Idle Dream Consolidation Cycle (Tier-1 Cognitive Dreamer)
 */

import { database } from '../db/database.js';
import { kanService } from '../neural/index.js';
import { dreamConsolidator } from '../services/dreamConsolidator.js';
import { orchestrator } from '../orchestrator/engine.js';

async function runTests() {
  console.log('=== Rozpoczęcie Testów Autonomicznego Cyklu Konsolidacji Wiedzy (DreamConsolidator) ===\n');

  await database.ensureInitialized();
  await database.clearAllFacts();
  await orchestrator.setPaused(false);

  // TEST 1: Weryfikacja pobierania niekonsolidowanych par faktów
  console.log('Test 1: Weryfikacja getUnconsolidatedFactPairs...');
  const fact1Id = await database.saveLearnedFact(
    'astronomy',
    'Słońce',
    'emituje',
    'promieniowanie UV',
    0.95
  );

  const fact2Id = await database.saveLearnedFact(
    'biology',
    'Promieniowanie UV',
    'stymuluje',
    'produkcję witaminy D',
    0.92
  );

  const fact3Id = await database.saveLearnedFact(
    'botany',
    'Rośliny zielone',
    'pochłaniają',
    'dwutlenek węgla',
    0.88
  );

  const pairs = await database.getUnconsolidatedFactPairs(10);
  if (pairs.length < 3) {
    throw new Error(`Oczekiwano co najmniej 3 unikalnych par faktów, otrzymano: ${pairs.length}`);
  }

  const relatedPair = pairs.find(
    p => (p.factA.id === fact1Id && p.factB.id === fact2Id) || (p.factA.id === fact2Id && p.factB.id === fact1Id)
  );
  if (!relatedPair) {
    throw new Error('Para faktów Słońce <-> UV nie została poprawnie wyselekcjonowana');
  }
  console.log(`✓ Wyselekcjonowano ${pairs.length} kandydujących par faktów o różnych kategoriach/podmiotach`);

  // TEST 2: Weryfikacja zapisu i unikania duplikatów aksjomatów (saveConsolidatedAxiom)
  console.log('\nTest 2: Weryfikacja saveConsolidatedAxiom i zapobiegania duplikatom...');
  const testAxiomResult = {
    synthesizedAxiom: 'Słońce pośrednio stymuluje produkcję witaminy D',
    subject: 'Słońce',
    predicate: 'pośrednio stymuluje',
    object: 'produkcję witaminy D',
    confidence: 0.65
  };

  const axiom1Id = await database.saveConsolidatedAxiom(testAxiomResult, [fact1Id, fact2Id]);
  if (!axiom1Id || axiom1Id <= 0) {
    throw new Error('Zapis aksjomatu zwrócił nieprawidłowe ID');
  }

  // Weryfikacja pól zapisanego aksjomatu
  const activeFacts = await database.getActiveLearnedFacts(50);
  const savedAxiom = activeFacts.find(f => f.id === axiom1Id);
  if (!savedAxiom || savedAxiom.category !== 'synergy_axiom') {
    throw new Error(`Nie odnaleziono zapisanego aksjomatu lub kategoria nie jest 'synergy_axiom': ${JSON.stringify(savedAxiom)}`);
  }
  if (!savedAxiom.metadata || !savedAxiom.metadata.includes('dream_consolidation')) {
    throw new Error(`Brak poprawnych metadanych w aksjomacie: ${savedAxiom.metadata}`);
  }
  if (!savedAxiom.embedding) {
    throw new Error('Brak wektora cech (embedding) w zapisanym aksjomacie');
  }
  console.log(`✓ Aksjomat #${axiom1Id} zapisany poprawnie z kategorią 'synergy_axiom' i embeddingiem`);

  // Próba zapisu duplikatu o niższej lub równej pewności
  const duplicateAxiomId = await database.saveConsolidatedAxiom(
    { ...testAxiomResult, confidence: 0.60 },
    [fact1Id, fact2Id]
  );
  if (duplicateAxiomId !== axiom1Id) {
    throw new Error(`Zapobieganie duplikatom zawiodło: oczekiwano istniejącego ID #${axiom1Id}, otrzymano #${duplicateAxiomId}`);
  }
  console.log('✓ Zduplikowany aksjomat o niższej pewności został zignorowany');

  // TEST 3: Wykonanie autonomicznego cyklu konsolidacji wiedzy (runCycleNow)
  console.log('\nTest 3: Weryfikacja pełnego cyklu DreamConsolidator.runCycleNow()...');
  // Wyczyśćmy bazę faktów i wstawmy parę dedykowaną do dedukcji tranzytywnej
  await database.clearAllFacts();
  const fAId = await database.saveLearnedFact('astronomy', 'Słońce', 'emituje', 'promieniowanie UV', 0.95);
  const fBId = await database.saveLearnedFact('health', 'Promieniowanie UV', 'stymuluje', 'produkcję witaminy D', 0.90);

  const synthesizedCount = await dreamConsolidator.runCycleNow();
  if (synthesizedCount !== 1) {
    throw new Error(`Oczekiwano zsyntetyzowania 1 aksjomatu, zsyntetyzowano: ${synthesizedCount}`);
  }

  const allActive = await database.getActiveLearnedFacts(20);
  const newAxiom = allActive.find(f => f.category === 'synergy_axiom');
  if (!newAxiom) {
    throw new Error('Nie odnaleziono zsyntetyzowanego aksjomatu w bazie danych');
  }
  if (!newAxiom.subject.includes('Słońce') || !newAxiom.object.includes('witaminy D')) {
    throw new Error(`Niepoprawny aksjomat tranzytywny: ${newAxiom.subject} -> ${newAxiom.predicate} -> ${newAxiom.object}`);
  }
  console.log(`✓ Zsyntetyzowano aksjomat: "${newAxiom.subject} ${newAxiom.predicate} ${newAxiom.object}" (ID: ${newAxiom.id}, Conf: ${newAxiom.confidence})`);

  // Weryfikacja wpisu audytowego w orchestrator_logs
  const recentLogs = await database.getRecentLogs(10);
  const auditLog = recentLogs.find(l => l.worker === 'DreamConsolidator' && l.action === 'axiom_synthesized');
  if (!auditLog) {
    throw new Error('Brak wpisu audytowego DreamConsolidator:axiom_synthesized w logach');
  }
  console.log(`✓ Wpis w dzienniku audytowym orkiestratora obecny: "${auditLog.details}"`);

  // Sprawdzenie, czy po zbadaniu pary getUnconsolidatedFactPairs nie zwraca już tej samej pary
  const pairsAfter = await database.getUnconsolidatedFactPairs(5);
  const alreadyEvaluated = pairsAfter.find(
    p => (p.factA.id === fAId && p.factB.id === fBId) || (p.factA.id === fBId && p.factB.id === fAId)
  );
  if (alreadyEvaluated) {
    throw new Error('Zbadana para faktów nie została wykluczona w kolejnym zapytaniu');
  }
  console.log('✓ Zbadana para została zarejestrowana i wykluczona z redundancji');

  // TEST 4: Weryfikacja blokady konsolidacji przy spauzowanym orkiestratorze
  console.log('\nTest 4: Weryfikacja zachowania przy orchestrator_paused=true...');
  await orchestrator.setPaused(true);
  const countWhilePaused = await dreamConsolidator.runCycleNow();
  if (countWhilePaused !== 0) {
    throw new Error(`Oczekiwano 0 aksjomatów przy spauzowanym orkiestratorze, zsyntetyzowano: ${countWhilePaused}`);
  }
  await orchestrator.setPaused(false);
  console.log('✓ Cykl konsolidacji jest poprawnie wstrzymywany przy spauzowanym orkiestratorze');

  // TEST 5: Weryfikacja notifyUserActivity i statusu diagnostycznego
  console.log('\nTest 5: Weryfikacja śledzenia bezczynności i telemetrii...');
  dreamConsolidator.notifyUserActivity();
  const statusBefore = dreamConsolidator.getStatus();
  if (statusBefore.idleSeconds > 1) {
    throw new Error(`notifyUserActivity nie zresetowało czasu bezczynności (idleSeconds: ${statusBefore.idleSeconds})`);
  }
  if (statusBefore.totalConsolidationsCount < 1) {
    throw new Error(`Licznik totalConsolidationsCount nie zarejestrował konsolidacji: ${statusBefore.totalConsolidationsCount}`);
  }
  console.log(`✓ Status DreamConsolidator: bezczynność=${statusBefore.idleSeconds}s, próg=${statusBefore.idleThresholdSeconds}s, łączna liczba syntez=${statusBefore.totalConsolidationsCount}`);

  // Sprzątanie wątku KAN
  await kanService.terminate();
  console.log('✓ Wątek roboczy KAN zwolniony czysto');

  console.log('\n======================================================');
  console.log('WSZYSTKIE TESTY DREAM CONSOLIDATOR ZAKOŃCZONE SUKCESEM (5/5)');
  console.log('======================================================\n');
}

runTests().catch((err) => {
  console.error('BŁĄD TESTU:', err);
  process.exit(1);
});
