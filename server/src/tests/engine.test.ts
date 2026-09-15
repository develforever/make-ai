import assert from 'node:assert/strict';
import { database } from '../db/database.js';
import { costGuard } from '../services/costGuard.js';
import { wikipediaService } from '../services/wikipedia.js';
import { personaWorker } from '../workers/personaWorker.js';

async function runTests() {
  console.log('🧪 Rozpoczynanie testów jednostkowych i integracyjnych MakeAI...\n');

  // 1. Test Bazy Danych i Pamięci
  console.log('1. Test pamięci kognitywnej i korekty wiedzy...');
  database.clearAllFacts();
  
  const fact1Id = database.saveLearnedFact('user_profile', 'Użytkownik', 'ma na imię', 'Robert');
  assert.ok(fact1Id > 0, 'Fakt 1 powinien zostać zapisany');

  let activeFacts = database.getActiveLearnedFacts();
  assert.equal(activeFacts.length, 1);
  assert.equal(activeFacts[0].object, 'Robert');

  // Test korekty wiedzy: nadpisanie faktu
  const fact2Id = database.saveLearnedFact('user_profile', 'Użytkownik', 'ma na imię', 'Robert Architect');
  activeFacts = database.getActiveLearnedFacts();
  assert.equal(activeFacts.length, 1, 'Poprzedni fakt powinien zostać zdeaktywowany po korekcie');
  assert.equal(activeFacts[0].object, 'Robert Architect');
  console.log('   ✅ Pamięć kognitywna i mechanizm korekty działają poprawnie.');

  // 2. Test CostGuard i kalkulatora tokenów
  console.log('2. Test CostGuard i kalkulatora wydatków...');
  costGuard.setBudget(2.00);
  const cost = costGuard.calculateCost('google/gemini-2.5-flash-lite', 1000, 500);
  // 1000 * 0.10/1M = 0.0001; 500 * 0.40/1M = 0.0002; total = 0.0003
  assert.ok(Math.abs(cost - 0.0003) < 0.00001, `Koszt powinien wynosić ~0.0003, wynosi: ${cost}`);

  const status = costGuard.getStatus();
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
  const prompt = personaWorker.buildPrompt({
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

  console.log('\n🎉 Wszystkie testy automatyczne zakończone sukcesem (4/4)!');
}

runTests().catch((err) => {
  console.error('\n❌ Błąd podczas wykonywania testów:', err);
  process.exit(1);
});
