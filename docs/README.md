# Dokumentacja Projektu MakeAI

Katalog `docs/` zawiera dokumentację architektoniczną oraz interaktywne materiały prezentacyjne projektu.

## Dostępne Dokumenty

* **[presentation.html](./presentation.html):** 
  Interaktywna prezentacja slajdowa (Keynote) opisująca architekturę kognitywną MakeAI, dekompozycję pamięci, potok Orchestrator-Workers, deterministyczny nadzór budżetowy $2.00 oraz audyt skalowalności do 10 milionów użytkowników.
  * Otwieranie w przeglądarce: `file:///c:/Users/robert/code/make-ai/docs/presentation.html`
  * Sterowanie: Strzałki klawiatury (`←` / `→`), spacja, klawisz `F` (pełny ekran).

## Zasada Utrzymania i Cyklu Życia

Zgodnie z regułą zdefiniowaną w `AGENTS.md`, dokument `presentation.html` podlega obowiązkowej aktualizacji:
1. **Na życzenie użytkownika.**
2. **Proaktywnie przez agenta AI**, gdy nastąpi:
   * Zmiana w pipeline orkiestratora lub workerów.
   * Migracja modeli AI / aktualizacja cenników tokenów w `CostGuard`.
   * Modyfikacja struktur trwałej pamięci SQLite.
   * Wdrożenie nowych rozwiązań związanych ze skalowaniem (np. libSQL, Redis cache, vLLM).
