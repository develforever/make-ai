# Instrukcje Projektowe MakeAI (GEMINI.md)

## Stały Obowiązek Aktualizacji Prezentacji Architektonicznej (`docs/presentation.html`)

1. **Ścieżka pliku:** `c:/Users/robert/code/make-ai/docs/presentation.html`
2. **Kiedy aktualizować:**
   * **Na polecenie użytkownika.**
   * **Autonomicznie / z własnej inicjatywy:** gdy w kodzie, modelach, architekturze workerów, bazie danych lub metrykach kosztowych zajdą jakiekolwiek istotne zmiany inżynieryjne.
3. **Wymogi merytoryczne:**
   * Utrzymanie tonu Principal Software Architect: twarde metryki, brak języka marketingowego, precyzyjne diagramy i bezwzględny audyt wąskich gardeł przy skalowaniu.

## Dyrektywa Architektoniczna: Zero-Compromise Tier-1 Engineering (Najwyższa Klasa Systemu)

1. **Zakaz Rozwiązań Półśrodkowych (No Band-Aid Solutions):**
   * Bezwzględny zakaz proponowania prowizorek, obejść, sztucznego buforowania w RAM zamiast właściwego silnika bazy danych, czy protez tekstowych zamiast wyszukiwania wektorowego.
   * Każde zidentyfikowane wąskie gardło rozwiązujemy poprzez wdrożenie komponentów klasy przemysłowej (Enterprise Tier-1).

2. **Standardy Skalowalności i Wydajności:**
   * **Baza Danych & I/O:** Pełna asynchroniczność, brak blokad plikowych pojedynczego procesu, wsparcie dla rozproszonej replikacji i wektorów (libSQL / Turso).
   * **Pamięć Kognitywna:** Natywny Vector Search (ANN / HNSW / Embeddings).
   * **Obliczenia AI/KAN:** Całkowite oddelegowanie do wątków roboczych (`node:worker_threads`), pętla zdarzeń Node.js chroniona przed operacjami blokującymi.
   * **Frontend:** Płynny code-splitting, zero niepotrzebnych zależności w ścieżce krytycznej, pełna dostępność WCAG/a11y.
