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
