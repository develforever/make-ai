# MakeAI — Architektoniczne FAQ & Dokumentacja Techniczna

Dokumentacja techniczna dla inżynierów i architektów systemowych. Projekt publiczny: repozytorium nie zawiera poufnych kluczy API, tokenów uwierzytelniających ani prywatnych danych środowiskowych.

---

## Spis Treści
1. [Czym jest MakeAI i jaka jest filozofia systemu?](#1-czym-jest-makeai-i-jaka-jest-filozofia-systemu)
2. [Jak działa i jaką rolę odgrywa LLM w systemie?](#2-jak-działa-i-jaką-rolę-odgrywa-llm-w-systemie)
3. [Jak działa i jaką rolę pełni KAN (Kolmogorov-Arnold Network)?](#3-jak-działa-i-jaką-rolę-pełni-kan-kolmogorov-arnold-network)
4. [Jak zintegrowano filary gęstej sieci (SOM, EWC, SAM, SWA, Focal Loss)?](#4-jak-zintegrowano-filary-gęstej-sieci-som-ewc-sam-swa-focal-loss)
5. [Jak działa podwójna warstwa pamięci kognitywnej (Dual-Layer Memory)?](#5-jak-działa-podwójna-warstwa-pamięci-kognitywnej-dual-layer-memory)
6. [Jakie są kluczowe wąskie gardła i wyzwania wydajnościowe?](#6-jakie-są-kluczowe-wąskie-gardła-i-wyzwania-wydajnościowe)

---

## 1. Czym jest MakeAI i jaka jest filozofia systemu?

MakeAI to eksperymentalna architektura autonomicznego agenta kognitywnego, zaprojektowana w celu rozwiązania fundamentalnych problemów współczesnych systemów LLM:
* **Przepełnienia okna kontekstowego (Context Rot):** Naiwne dopisywanie całej historii do promptu powoduje degradację uwagi modelu i lawinowy wzrost kosztów.
* **Katastroficznego zapominania (Catastrophic Forgetting):** Modele językowe nie posiadają trwałej pamięci stanowej między sesjami.
* **Brutalnej siły parametrycznej:** Wzrost jakości odpowiedzi próbuje się osiągać powiększaniem liczby parametrów do setek miliardów, zamiast podnoszeniem gęstości reprezentacji matematycznej.

**Nadrzędna zasada MakeAI:** Inteligencja systemu nie wynika z rozmiaru modelu, lecz z rygoru architektury oprogramowania (asynchroniczny potok workerów, deterministyczny bezpiecznik finansowy CostGuard, relacyjny graf faktów oraz mikromodel KAN).

---

## 2. Jak działa i jaką rolę odgrywa LLM w systemie?

W MakeAI model LLM został celowo odarty z roli „wszechwiedzącego monolitu”. Jest wyłącznie **bezstanowym silnikiem syntezy tekstu i parserem semantycznym**.

### Trzy odizolowane role LLM:
1. **Silnik Generowania Dialogu (`PersonaWorker`):**
   * Zamienia strumień tokenów wejściowych w spójną, gramatyczną wypowiedź w czasie rzeczywistym (streaming SSE).
   * Jest całkowicie bezstanowy — stan konwersacji, fakty z bazy SQLite oraz abstrakt z Wikipedii są wstrzykiwane programistycznie do promptu systemowego przed każdą turą.
2. **Parser Semantyczny w Tle (`MemoryWorker`):**
   * Po zakończeniu wypowiedzi asystenta analizuje turę dialogu w osobnym, asynchronicznym wątku.
   * Przy temperaturze $T = 0.1$ ekstrahuje z wypowiedzi trwałe fakty do ścisłego schematu JSON (`subject -> predicate -> object`).
   * Zapisuje wyekstrahowane relacje do bazy relacyjnej (`node:sqlite` lub `IndexedDB`).
3. **Nauczyciel w Pętli Destylacji (`neural-core/teacher_client.py` & `server/src/neural/LocalTeacherLLM.ts`):**
   * Służy jako źródło tzw. *dark knowledge* dla mikro-sieci KAN.
   * Generuje wygładzone temperaturą rozkłady prawdopodobieństw (*soft targets*), które sieć uczniowska KAN aproksymuje przy użyciu dywergencji Kullbacka-Leiblera ($D_{KL}$).

### Czego LLM w MakeAI CELOWO nie robi:
* **Nie przechowuje wiedzy encyklopedycznej:** Od tego jest `WikiWorker` odpytujący oficjalny REST API Wikipedii (koszt: 0 tokenów, 0 halucynacji).
* **Nie decyduje o budżecie:** Nadzór finansowy sprawuje deterministyczny moduł `CostGuard`, który blokuje wywołania na poziomie kodu TypeScript, a nie reguł promptu.
* **Nie utrzymuje historii sesji:** Historią zarządza relacyjna baza danych.

---

## 3. Jak działa i jaką rolę pełni KAN (Kolmogorov-Arnold Network)?

W przeciwieństwie do klasycznych perceptronów wielowarstwowych (MLP), gdzie wagi na krawędziach są liczbami skalarnymi, a aktywacje znajdują się w węzłach ($y = \sigma(Wx)$), sieć **KAN przenosi uczące się funkcje nieliniowe bezpośrednio na krawędzie połączeń**.

### Równanie krawędzi KAN w MakeAI (`neural-core/kan_layer.py`):
$$\phi(x) = w_b \cdot \text{Mish}(x) + w_s \cdot \sum_{p=0}^{G+k-1} c_p B_p(x)$$

* **B-splajny rzędu $k=3$:** Na każdej krawędzi rozpięta jest siatka punktów kontrolnych w przedziale $[-1, 1]$. Krawędź uczy się optymalnego kształtu wielomianu sklejkowego.
* **Ścieżka rezydualna Mish:** $x \cdot \tanh(\text{softplus}(x))$ zapewnia ciągły przepływ gradientów pierwszego i drugiego rzędu, eliminując problem obumierania neuronów (*dying ReLU*).
* **Gęstość parametrów:** W architekturze `MakeAIKANConversationalModel` aż **95.1% parametrów (696 320 z 714 624)** stanowią współczynniki B-splajnów.

### Rola KAN w projekcie:
* **Mikromodel Uczniowski (Edge Student):** Docelowy lekki rdzeń zdolny do działania brzegowego w przeglądarce (WebGPU/WASM) bez konieczności odpytywania chmury.
* **Bloki Ekspertów w Mixture of Experts:** 4 mikro-ekspertów KAN aktywowanych dynamicznie przez router SOM.
* **Podłoże Pamięci Ciągłej:** Zmiana splajnu w jednym przedziale siatki nie niszczy jego przebiegu w innym, co ułatwia douczanie bez katastroficznego zapominania.

---

## 4. Jak zintegrowano filary gęstej sieci (SOM, EWC, SAM, SWA, Focal Loss)?

Architektura neuronowa MakeAI realizuje kompletny zestaw zaawansowanych mechanizmów optymalizacyjnych:

1. **Routing Topologiczny (SOM MoE — `som_router.py` / `SOMRouter.ts`):**
   * Tokeny trafiają na siatkę prototypów Mapy Samoorganizującej.
   * Mechanizm Top-2 gating aktywuje wyłącznie 2 z 4 ekspertów KAN, redukując narzut obliczeniowy o **75% FLOPs**.
2. **Elastic Weight Consolidation (EWC — `ewc_memory.py` / `EWCOptimizer.ts`):**
   * Diagonalna Macierz Informacji Fishera ($F_i = \mathbb{E}[g_i^2]$) identyfikuje wagi krytyczne dla składni języka.
   * Podczas asymilacji nowych danych funkcja straty nakłada karę $\frac{\lambda}{2} \sum F_i (\theta_i - \theta_i^*)^2$, zamrażając reguły syntaktyczne.
3. **Sharpness-Aware Minimization (SAM — `sam_optimizer.py` / `TrainingLoop.ts`):**
   * Zamiast szukać wąskich, niestabilnych minimów lokalnych, SAM wykonuje podwójny krok gradientowy: perturbację wag w kierunku największego wzrostu straty ($\rho = 0.05$), a następnie aktualizację bazową. Wymusza to płaskie minima o wysokiej zdolności do generalizacji.
4. **Stochastic Weight Averaging (SWA — `precision_ops.py`):**
   * Średnia krocząca wag w końcowych fazach trajektorii optymalizacji wygładza granice decyzyjne bez zwiększania rozmiaru sieci.
5. **Focal Loss z OHEM (`precision_ops.py`):**
   * Mechanizm selekcjonuje 35% najtrudniejszych tokenów (Online Hard Example Mining) i skaluje błąd czynnikiem $(1-p_t)^\gamma$ ($\gamma = 2.0$), eliminując marnowanie pojemności sieci na banalne konstrukcje zdaniowe.
6. **Regularyzacja Ortogonalna (`precision_ops.py`):**
   * Kara $\beta \|W^T W - I\|_F^2$ zapobiega redundancji kolumn wag bazowych, wymuszając reprezentację unikalnych cech.

---

## 5. Jak działa podwójna warstwa pamięci kognitywnej (Dual-Layer Memory)?

W MakeAI ochrona wiedzy przed zapominaniem jest rozbita na dwa odrębne poziomy:

| Poziom | Warstwa Makro-Kognitywna (MakeAI Core) | Warstwa Mikro-Neuronowa (KAN Core) |
| :--- | :--- | :--- |
| **Magazyn** | Relacyjna baza danych (`node:sqlite` / `IndexedDB`) | Wagi B-splajnów w grafie neuronowym |
| **Mechanizm** | Relacyjny graf faktów (`Podmiot -> Relacja -> Obiekt`) | EWC (Macierz Fishera) + Bufor Replay |
| **Trwałość** | Permanentna, deterministyczna | Statystyczna (odporność na drift wag) |
| **Zastosowanie** | Fakty o użytkowniku, preferencje, reguły | Płynność językowa, struktura gramatyczna |

Dzięki temu model nie musi marnować swoich wag na zapamiętywanie numeru telefonu czy miasta zamieszkania użytkownika — wiedza ta jest pobierana deterministycznie w czasie $\mathcal{O}(1)$ z indeksu SQLite.

---

## 6. Jakie są kluczowe wąskie gardła i wyzwania wydajnościowe?

1. **Ewaluacja B-splajnów na akceleratorach GPU:**
   * Jednostki Tensor Cores są zoptymalizowane pod gęste mnożenie macierzy (GEMM). KAN wymaga wyliczania wielomianów bazowych Coxa-de Boora, co jest operacją ograniczoną przepustowością pamięci (*memory-bound*).
2. **Wyścig asynchroniczny (Race Condition) w `MemoryWorker`:**
   * Asynchroniczna ekstrakcja faktów w tle może nie zdążyć zapisać nowego faktu przed nadejściem kolejnej wiadomości użytkownika w bardzo szybkim tempie dialogu (< 300 ms).
3. **Wrażliwość KAN na Grid Drift:**
   * Wartości wejściowe wykraczające poza siatkę $[-1, 1]$ tracą wsparcie bazowe splajnów, co wymaga kompensacji przez warstwy LayerNorm i wagę bazową Mish.
4. **Zależność od pojedynczej bramki API (OpenRouter):**
   * W architekturze Tier A (serwerowej) istnieje ryzyko wyczerpania limitów TPM/RPM zewnętrznego dostawcy, co wymaga docelowej migracji na własny klaster vLLM.
