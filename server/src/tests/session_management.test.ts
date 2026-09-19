import assert from 'node:assert/strict';
import { database } from '../db/database.js';
import { sessionResolver } from '../services/sessionResolver.js';

async function runSessionTests() {
  console.log('=== Testy Zarządzania Sesjami, Folderami i Cross-Session Referencing ===\n');

  // 1. Test Folderów
  console.log('Test 1: Tworzenie, odczyt i usuwanie katalogów...');
  const folderId = database.saveFolder('Architektura KAN', '#06b6d4');
  assert.ok(folderId, 'Folder powinien mieć unikalny ID');

  const folders = database.getFolders();
  const createdFolder = folders.find((f: any) => f.id === folderId);
  assert.ok(createdFolder, 'Utworzony folder powinien być na liście');
  assert.equal(createdFolder.name, 'Architektura KAN');
  console.log('✓ Katalog utworzony pomyślnie.');

  // 2. Test Tworzenia Sesji i Heurystyki Tytułu
  console.log('Test 2: Tworzenie sesji i automatyczne nadawanie tytułu...');
  const sessAId = database.createSession('Nowa rozmowa', folderId);
  assert.ok(sessAId, 'Sesja A powinna zostać utworzona');

  // Symulacja pierwszej wiadomości użytkownika i auto-titlingu heurystycznego
  const firstUserMsg = 'Jak zaprojektować splajny B-spline w sieci KAN?';
  const heuristicTitle = sessionResolver.generateHeuristicTitle(firstUserMsg);
  database.updateSession(sessAId, { title: heuristicTitle });

  const sessionA = database.getSession(sessAId);
  assert.equal(sessionA.title, 'Zaprojektować splajny B-spline w sieci KAN?');
  assert.equal(sessionA.folder_id, folderId);
  console.log(`✓ Heurystyczny tytuł nadany: "${sessionA.title}"`);

  // 3. Test Izolacji Wiadomości między Sesjami
  console.log('Test 3: Izolacja wiadomości między niezależnymi sesjami...');
  const sessBId = database.createSession('Sesja B - Pamięć EWC');

  database.saveMessage('user', 'Pytanie w sesji A', 10, 'gpt-4o', undefined, sessAId);
  database.saveMessage('assistant', 'Odpowiedź w sesji A', 20, 'gpt-4o', undefined, sessAId);

  database.saveMessage('user', 'Pytanie w sesji B o EWC', 15, 'gpt-4o', undefined, sessBId);

  const msgsA = database.getRecentMessages(10, sessAId);
  const msgsB = database.getRecentMessages(10, sessBId);

  assert.equal(msgsA.length, 2, 'Sesja A powinna mieć dokładnie 2 wiadomości');
  assert.equal(msgsB.length, 1, 'Sesja B powinna mieć dokładnie 1 wiadomość');
  assert.equal(msgsA[0].content, 'Pytanie w sesji A');
  assert.equal(msgsB[0].content, 'Pytanie w sesji B o EWC');
  console.log('✓ Wiadomości są ściśle wyizolowane per session_id.');

  // 4. Test Przypinania (Pinning) i Sortowania
  console.log('Test 4: Przypinanie sesji (Pinning)...');
  database.updateSession(sessBId, { is_pinned: true });

  const sessionsAll = database.getSessions({ includeArchived: false });
  assert.equal(sessionsAll[0].id, sessBId, 'Przypięta sesja B powinna być na pierwszym miejscu listy');
  console.log('✓ Przypięte sesje są sortowane priorytetowo na szczycie listy.');

  // 5. Test Archiwizacji (Archiving)
  console.log('Test 5: Archiwizacja sesji...');
  database.updateSession(sessAId, { is_archived: true });

  const activeSessions = database.getSessions({ includeArchived: false });
  const hasAInActive = activeSessions.some((s: any) => s.id === sessAId);
  assert.equal(hasAInActive, false, 'Zarchiwizowana sesja A nie powinna być na liście aktywnych');

  const archivedSessions = database.getSessions({ includeArchived: true });
  const hasAInAll = archivedSessions.some((s: any) => s.id === sessAId);
  assert.equal(hasAInAll, true, 'Zarchiwizowana sesja A powinna być na pełnej liście z archiwum');
  console.log('✓ Archiwizacja poprawnie filtruje sesje.');

  // Przywróć sesję A z archiwum do testów wyszukiwania
  database.updateSession(sessAId, { is_archived: false });

  // 6. Test Wyszukiwania Globalnego (Search across sessions)
  console.log('Test 6: Globalne wyszukiwanie we wszystkich sesjach i wiadomościach...');
  const searchResultsTitle = database.searchAllSessions('splajny');
  assert.ok(searchResultsTitle.length > 0, 'Powinno znaleźć sesję po tytule');
  assert.equal(searchResultsTitle[0].session.id, sessAId);

  const searchResultsContent = database.searchAllSessions('EWC');
  assert.ok(searchResultsContent.length > 0, 'Powinno znaleźć wiadomość po treści');
  const matchB = searchResultsContent.find((r: any) => r.session.id === sessBId);
  assert.ok(matchB, 'Wynik powinien zawierać sesję B');
  assert.ok(matchB.matches.length > 0, 'Wynik powinien zawierać dopasowane wiadomości');
  assert.ok(matchB.matches[0].snippet.includes('EWC'), 'Snippet powinien zawierać szukane słowo');
  console.log(`✓ Wyszukiwarka zwróciła dopasowany snippet: "${matchB.matches[0].snippet}"`);

  // 7. Test Cross-Session Referencing (Wykrywanie i Kompilacja Kontekstu)
  console.log('Test 7: Wykrywanie referencji między sesjami (@session oraz [[session]])...');
  const userPromptWithRefs = `Nawiązując do ustaleń z @session:${sessAId} oraz [[session:${sessBId}|EWC Notes]], jak połączyć KAN z EWC?`;
  const extractedIds = sessionResolver.extractReferencedSessionIds(userPromptWithRefs);

  assert.equal(extractedIds.length, 2, 'Powinno wykryć dokładnie 2 identyfikatory sesji');
  assert.ok(extractedIds.includes(sessAId));
  assert.ok(extractedIds.includes(sessBId));

  const resolvedContexts = sessionResolver.resolveSessionContexts(extractedIds);
  assert.equal(resolvedContexts.length, 2);
  assert.ok(resolvedContexts[0].contextText.includes('ODWOŁANIE DO POWIĄZANEJ SESJI'));
  console.log('✓ Pomyślnie rozwiązano i skompilowano kontekst zewnętrznych sesji.');

  // 8. Test Kaskadowego Usuwania Sesji
  console.log('Test 8: Kaskadowe usuwanie sesji i wiadomości...');
  database.deleteSession(sessAId);
  const deletedSession = database.getSession(sessAId);
  assert.equal(deletedSession, undefined, 'Sesja A powinna być usunięta');
  const remainingMsgsA = database.getRecentMessages(10, sessAId);
  assert.equal(remainingMsgsA.length, 0, 'Wiadomości sesji A powinny zostać kaskadowo usunięte');

  // Usuń też folder i sprawdź czy sesje w folderze nie crashują
  database.deleteFolder(folderId);
  const deletedFolder = database.getFolders().find((f: any) => f.id === folderId);
  assert.equal(deletedFolder, undefined, 'Folder powinien zostać usunięty');
  console.log('✓ Kaskadowe czyszczenie działa bez zarzutu.');

  console.log('\n🎉 WSZYSTKIE TESTY ZARZĄDZANIA SESJAMI ZAKOŃCZONE SUKCESEM (8/8)!\n');
}

runSessionTests().catch((err) => {
  console.error('❌ Błąd testu sesji:', err);
  process.exit(1);
});
