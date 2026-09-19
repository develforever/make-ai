# Reguły Projektu MakeAI: Wiedza Operacyjna i Standardy Inżynieryjne

## Obowiązek Utrzymania Dokumentacji i Prezentacji Architektonicznej

1. **Plik Prezentacji:**
   * Ścieżka: `docs/presentation.html`
   * Cel: Samodzielna, interaktywna prezentacja techniczna (Keynote) dla globalnej publiczności / architektów systemowych.

2. **Zasada Aktualizacji (`docs/presentation.html`):**
   * **Na żądanie użytkownika:** Zawsze, gdy użytkownik wyda polecenie aktualizacji lub rozbudowy prezentacji.
   * **Z własnej inicjatywy (Autonomicznie):** Za każdym razem, gdy w projekcie zostaną wprowadzone istotne zmiany architektoniczne, w szczególności:
     - Dodanie lub modyfikacja workerów (`Orchestrator`, `PersonaWorker`, `MemoryWorker`, `WikiWorker`, nowe moduły).
     - Zmiana modeli AI, cenników lub parametrów budżetowych (`CostGuard`).
     - Zmiany w schemacie bazy danych (`node:sqlite`) lub silniku pamięci kognitywnej.
     - Wdrożenie nowych mechanizmów skalowalności (np. Tenant-per-Database libSQL, Redis buffer, vLLM).
     - Identyfikacja i rozwiązanie krytycznych wąskich gardeł lub błędów runtime.

3. **Styl i Standard Prezentacji:**
   * Całkowity zakaz języka marketingowego i pustych haseł (*zero hype*).
   * Format: Rygorystyczny, zwięzły, oparty na twardych metrykach, diagramach przepływu (ASCII/SVG), tabelach zysku/kosztu i analizie ograniczeń brzegowych.

## Dyrektywa Architektoniczna: Zero-Compromise Tier-1 Engineering (Najwyższa Klasa Systemu)

1. **Całkowity Zakaz Rozwiązań Półśrodkowych (No Band-Aid Solutions):**
   * Bezwzględny zakaz proponowania prowizorek, protez, obejść (workarounds) i plastrów maskujących wady fundamentalne architektury (np. sztuczne buforowanie w RAM zamiast właściwego silnika bazy, sztywne timeouty zamiast protokołów asynchronicznych, protezy tekstowe `LIKE` zamiast indeksów wektorowych).
   * Jeśli komponent ma wadę strukturalną uniemożliwiającą skalowanie horyzontalne, współbieżność lub wysoką przepustowość, jedyną dopuszczalną propozycją jest jego gruntowna przebudowa lub migracja do komponentu klasy przemysłowej.

2. **Standard Projektowy Systemu (Enterprise & Distributed Standard):**
   * Każdy moduł musi być projektowany i implementowany pod obciążenie systemów wielodostępnych i rozproszonych (100 000 równoległych sesji, bez pojedynczych punktów awarii / SPOF).
   * Pamięć kognitywna i retrieval: wyłącznie oparte o natywne indeksy wektorowe (ANN / HNSW / Vector Embeddings) i asynchroniczne zapytania.
   * Warstwa I/O i bazy danych: wyłącznie asynchroniczna, wolna od blokad plikowych pojedynczego procesu, z obsługą replikacji (np. libSQL / Turso).
   * Obliczenia numeryczne i AI (KAN / SOM / EWC): ścisła izolacja poza wątkiem głównym Node.js (`node:worker_threads` / WebAssembly).

3. **Autonomia Refaktoryzacji:**
   * Zakaz kierowania się „minimalnym nakładem pracy” lub „unikaniem dużych zmian w kodzie”. Jeśli właściwe rozwiązanie inżynieryjne wymaga przepisania 20 plików i wymiany zależności, wdrażane jest pełne, bezkompromisowe rozwiązanie docelowe.
