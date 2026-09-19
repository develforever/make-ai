import assert from 'node:assert/strict';
import { database } from '../db/database.js';
import { costGuard } from '../services/costGuard.js';
import { wikipediaService } from '../services/wikipedia.js';
import { personaWorker } from '../workers/personaWorker.js';

async function runTests() {
  console.log('🧪 Rozpoczynanie testów jednostkowych i integracyjnych MakeAI...\n');

  // 1. Test Bazy Danych i Pamięci
  console.log('1. Test pamięci kognitywnej i korekty wiedzy...');
  await database.clearAllFacts();
  
  const fact1Id = await database.saveLearnedFact('user_profile', 'Użytkownik', 'ma na imię', 'Robert');
  assert.ok(fact1Id > 0, 'Fakt 1 powinien zostać zapisany');

  let activeFacts = await database.getActiveLearnedFacts();
  assert.equal(activeFacts.length, 1);
  assert.equal(activeFacts[0].object, 'Robert');

  // Test korekty wiedzy: nadpisanie faktu
  const fact2Id = await database.saveLearnedFact('user_profile', 'Użytkownik', 'ma na imię', 'Robert Architect');
  activeFacts = await database.getActiveLearnedFacts();
  assert.equal(activeFacts.length, 1, 'Poprzedni fakt powinien zostać zdeaktywowany po korekcie');
  assert.equal(activeFacts[0].object, 'Robert Architect');
  console.log('   ✅ Pamięć kognitywna i mechanizm korekty działają poprawnie.');

  // Test wektorowy learned_facts i searchFactsByVector
  console.log('1b. Test wyszukiwania wektorowego i embeddingów...');
  const factVecId = await database.saveLearnedFact(
    'world_knowledge',
    'Kolmogorov-Arnold Network',
    'używa',
    'B-splajnów na krawędziach',
    1.0,
    undefined,
    [0.9, 0.1, 0.0, 0.0]
  );
  assert.ok(factVecId > 0);
  const searchResults = await database.searchFactsByVector([0.9, 0.1, 0.0, 0.0], 5);
  assert.ok(searchResults.length > 0, 'Wyszukiwanie wektorowe powinno zwrócić dopasowanie');
  assert.equal(searchResults[0].subject, 'Kolmogorov-Arnold Network');
  assert.ok(searchResults[0].similarity > 0.95, `Podobieństwo cosinusowe powinno być bliskie 1.0 (jest: ${searchResults[0].similarity})`);
  console.log(`   ✅ Wyszukiwanie wektorowe libSQL zwróciło: "${searchResults[0].subject}" (similarity: ${searchResults[0].similarity.toFixed(4)})`);

  // 2. Test CostGuard i kalkulatora tokenów
  console.log('2. Test CostGuard i kalkulatora wydatków...');
  await costGuard.setBudget(2.00);
  const cost = costGuard.calculateCost('google/gemini-2.5-flash-lite', 1000, 500);
  // 1000 * 0.10/1M = 0.0001; 500 * 0.40/1M = 0.0002; total = 0.0003
  assert.ok(Math.abs(cost - 0.0003) < 0.00001, `Koszt powinien wynosić ~0.0003, wynosi: ${cost}`);

  const status = await costGuard.getStatus();
  assert.equal(status.totalBudgetUsd, 2.00);
  assert.equal(status.canProceed, true);
  console.log(`   ✅ Kalkulator kosztów poprawny (Koszt dla 1.5k tokenów: $${cost} USD).`);

  // 3. Test integracji z Wikipedią
  console.log('3. Test serwisu Wikipedii...');
  const wikiResult = await wikipediaService.getSummary('Stanisław Lem');
  assert.ok(wikiResult.found, 'Artykuł o Stanisławie Lemie powinien zostać odnaleziony');
  assert.ok(wikiResult.summary && wikiResult.summary.length > 20, 'Podsumowanie powinno zawierać tekst');
  assert.ok(wikiResult.url?.includes('wikipedia.org'), 'URL powinien prowadzić do Wikipedii');
  console.log(`   ✅ Wikipedia zwróciła: "${wikiResult.title}" (${wikiResult.source})`);

  // 4. Test budowy promptu z tożsamością i pamięcią
  console.log('4. Test budowy promptu kognitywnego PersonaWorker...');
  const prompt = await personaWorker.buildPrompt({
    userMessage: 'Cześć, co u Ciebie?',
    wikiContext: wikiResult
  });
  
  assert.ok(prompt.length >= 2, 'Prompt musi zawierać system i user');
  const systemContent = prompt[0].content;
  assert.ok(systemContent.includes('Aura') || systemContent.includes('TWÓJ CHARAKTER'), 'Prompt musi zawierać tożsamość');
  assert.ok(systemContent.includes('Robert Architect'), 'Prompt musi wstrzykiwać aktywne fakty z pamięci');
  assert.ok(systemContent.includes('Stanisław Lem'), 'Prompt musi wstrzykiwać zweryfikowaną wiedzę z Wikipedii');
  assert.ok(systemContent.includes('KOMPAS MORALNY'), 'Prompt musi zawierać reguły etyczne');
  console.log('   ✅ Prompt kognitywny poprawnie syntetyzuje tożsamość, etykę, fakty z pamięci i Wikipedię.');

  // 5. Test integracji KAN Policy z PersonaWorker (Ethics & Memory Limit)
  console.log('5. Test adaptacji KAN Policy w PersonaWorker (etyka i limit pamięci)...');
  const kanPolicyMock = {
    expertIndex: 2,
    expertName: 'Ethics, Alignment & Safety Guard',
    confidence: 0.88,
    temperatureMod: 0.45,
    memoryTopK: 4,
    ethicsWeight: 0.85
  };

  const personaRes = await personaWorker.generatePrompt({
    userMessage: 'Jak zachować się w sytuacji dylematu moralnego?',
    kanPolicy: kanPolicyMock
  });

  assert.ok(personaRes.messages.length >= 2, 'Prompt musi zawierać wiadomości');
  assert.equal(personaRes.kanPolicy?.expertName, 'Ethics, Alignment & Safety Guard');
  const ethicalSystemContent = personaRes.messages[0].content;
  assert.ok(
    ethicalSystemContent.includes('WZMOCNIONY NADZÓR ETYCZNY'),
    'Gdy ethicsWeight > 0.7, system prompt musi zawierać wzmocnioną sekcję nadzoru etycznego'
  );
  assert.ok(
    personaRes.rankedFacts.length <= 4,
    `Liczba wyselekcjonowanych faktów nie powinna przekraczać memoryTopK=4 (jest: ${personaRes.rankedFacts.length})`
  );
  console.log('   ✅ PersonaWorker poprawnie aplikuje wagi etyczne i dynamiczny limit pamięci KAN.');

  // 6. Test OrchestratorEngine.executeStep z dynamiczną polityką KAN
  console.log('6. Test orkiestratora executeStep z KAN-Cognitive Core v2...');
  const { orchestrator } = await import('../orchestrator/engine.js');
  const { kanService } = await import('../neural/index.js');

  const turn = await orchestrator.executeStep('Co to jest teoria względności Einsteina?');
  assert.ok(turn.kanPolicy !== null, 'Turn powinien zawierać ewaluację polityki KAN');
  assert.ok(typeof turn.kanPolicy.expertIndex === 'number', 'expertIndex musi być liczbą');
  assert.ok(typeof turn.kanPolicy.memoryTopK === 'number', 'memoryTopK musi być liczbą');
  assert.ok(typeof turn.kanPolicy.ethicsWeight === 'number', 'ethicsWeight musi być liczbą');
  console.log(`   ✅ KAN Policy wyznaczona: "${turn.kanPolicy.expertName}" (#${turn.kanPolicy.expertIndex}), memoryTopK=${turn.kanPolicy.memoryTopK}, ethicsWeight=${turn.kanPolicy.ethicsWeight}`);

  // Test callbacku onComplete i zapisu metadanych
  const fakeReply = 'Teoria względności Alberta Einsteina opisuje grawitację jako zakrzywienie czasoprzestrzeni.';
  await turn.onComplete(fakeReply, 0.00012);

  // Weryfikacja zapisu w bazie danych
  const recentMsgs = await database.getRecentMessages(1, 'default');
  assert.equal(recentMsgs.length, 1);
  const lastMsg = recentMsgs[0];
  assert.equal(lastMsg.role, 'assistant');
  assert.ok(lastMsg.metadata, 'Wiadomość asystenta musi posiadać pole metadata');
  const parsedMeta = JSON.parse(lastMsg.metadata);
  assert.ok(parsedMeta.kanPolicy, 'Metadane muszą zawierać obiekt kanPolicy');
  assert.equal(parsedMeta.kanPolicy.bmuExpert, turn.kanPolicy.expertIndex);
  assert.equal(parsedMeta.kanPolicy.expertName, turn.kanPolicy.expertName);
  console.log('   ✅ Metadane KAN Policy poprawnie utrwalone w historii wiadomości asystenta.');

  // Weryfikacja telemetrii na żywo z kanService
  const liveDiag = await kanService.getDiagnostics();
  assert.ok((liveDiag.telemetry?.totalPolicyEvaluations ?? 0) >= 1, 'Licznik totalPolicyEvaluations powinien być >= 1');
  console.log(`   ✅ Diagnostyka czasu rzeczywistego potwierdzona: totalPolicyEvaluations=${liveDiag.telemetry?.totalPolicyEvaluations}`);

  // Zakończenie workera KAN
  await kanService.terminate();
  console.log('   ✅ Wątek roboczy KAN zwolniony czysto.');

  console.log('\n🎉 Wszystkie testy automatyczne MakeAI zakończone pełnym sukcesem (7/7)!');
}

runTests().catch((err) => {
  console.error('\n❌ Błąd podczas wykonywania testów:', err);
  process.exit(1);
});
