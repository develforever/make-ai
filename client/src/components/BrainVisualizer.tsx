import React, { useState } from 'react';
import { Brain, Plus, Trash2, Search, User, Sparkles, BookOpen, AlertCircle, RefreshCw } from 'lucide-react';
import type { ExtractedFact } from '../types';
import { api } from '../api/client';

interface BrainVisualizerProps {
  facts: ExtractedFact[];
  onRefresh: () => void;
  logs: any[];
}

export const BrainVisualizer: React.FC<BrainVisualizerProps> = ({ facts, onRefresh, logs }) => {
  const [activeSubTab, setActiveSubTab] = useState<'facts' | 'teach' | 'logs'>('facts');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');

  // Formularz ręcznego nauczania
  const [category, setCategory] = useState('world_knowledge');
  const [subject, setSubject] = useState('');
  const [predicate, setPredicate] = useState('');
  const [object, setObject] = useState('');
  const [teachStatus, setTeachStatus] = useState<string | null>(null);
  const [isTeaching, setIsTeaching] = useState(false);

  const handleTeach = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject || !predicate || !object) return;

    setIsTeaching(true);
    setTeachStatus(null);
    try {
      await api.teachFact(category, subject, predicate, object);
      setTeachStatus(`Pomyślnie nauczono model: "${subject} ${predicate} ${object}"`);
      setSubject('');
      setPredicate('');
      setObject('');
      onRefresh();
      setTimeout(() => setTeachStatus(null), 4000);
    } catch (err: any) {
      setTeachStatus(`Błąd: ${err.message}`);
    } finally {
      setIsTeaching(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.deleteFact(id);
      onRefresh();
    } catch (err: any) {
      alert(`Błąd usuwania: ${err.message}`);
    }
  };

  const handleClearAll = async () => {
    if (confirm('Czy na pewno chcesz wyczyścić WSZYSTKIE zapamiętane fakty?')) {
      await api.clearMemory();
      onRefresh();
    }
  };

  const filteredFacts = facts.filter((fact) => {
    const matchesSearch =
      fact.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      fact.predicate.toLowerCase().includes(searchTerm.toLowerCase()) ||
      fact.object.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCat = filterCategory === 'all' || fact.category === filterCategory;
    return matchesSearch && matchesCat;
  });

  const getCategoryBadge = (cat: string) => {
    switch (cat) {
      case 'user_profile':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-cyan-950/60 border border-cyan-800/60 text-cyan-400">
            <User className="w-3 h-3" /> Profil Użytkownika
          </span>
        );
      case 'preference':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-purple-950/60 border border-purple-800/60 text-purple-400">
            <Sparkles className="w-3 h-3" /> Preferencja
          </span>
        );
      case 'correction':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-950/60 border border-amber-800/60 text-amber-400">
            <AlertCircle className="w-3 h-3" /> Korekta Wiedzy
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-950/60 border border-emerald-800/60 text-emerald-400">
            <BookOpen className="w-3 h-3" /> Wiedza o Świecie
          </span>
        );
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-purple-400 font-medium text-sm">
            <Brain className="w-5 h-5" />
            <span>Pamięć Kognitywna Agenta (In-Context Continual Learning)</span>
          </div>
          <h2 className="text-2xl font-bold text-white mt-1">
            {facts.length} zapamiętanych relacji i faktów
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Fakty wyekstrahowane automatycznie przez MemoryWorker podczas rozmowy lub wprowadzone ręcznie.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition-colors"
            title="Odśwież pamięć"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleClearAll}
            className="px-3 py-2 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-xs font-medium rounded-xl border border-rose-800/40 transition-colors"
          >
            Wyczyść pamięć
          </button>
        </div>
      </div>

      {/* Sub tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveSubTab('facts')}
          className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-colors ${
            activeSubTab === 'facts'
              ? 'bg-purple-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          Lista Faktów ({facts.length})
        </button>
        <button
          onClick={() => setActiveSubTab('teach')}
          className={`px-4 py-1.5 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-colors ${
            activeSubTab === 'teach'
              ? 'bg-purple-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Plus className="w-4 h-4" />
          Naucz Model Ręcznie
        </button>
        <button
          onClick={() => setActiveSubTab('logs')}
          className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-colors ${
            activeSubTab === 'logs'
              ? 'bg-purple-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          Dziennik Workerów
        </button>
      </div>

      {/* Subtab: Facts */}
      {activeSubTab === 'facts' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <label htmlFor="brain-memory-search" className="sr-only">
                Szukaj w pamięci
              </label>
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" aria-hidden="true" />
              <input
                id="brain-memory-search"
                name="brainMemorySearch"
                aria-label="Szukaj w pamięci"
                type="text"
                placeholder="Szukaj w pamięci..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
              {['all', 'user_profile', 'world_knowledge', 'preference', 'correction'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    filterCategory === cat
                      ? 'bg-purple-900/60 text-purple-300 border border-purple-700/60'
                      : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cat === 'all'
                    ? 'Wszystkie'
                    : cat === 'user_profile'
                    ? 'Profil'
                    : cat === 'world_knowledge'
                    ? 'Wiedza'
                    : cat === 'preference'
                    ? 'Preferencje'
                    : 'Korekty'}
                </button>
              ))}
            </div>
          </div>

          {/* Fact Cards */}
          {filteredFacts.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400 space-y-2">
              <Brain className="w-8 h-8 mx-auto text-slate-600 mb-2" />
              <p className="font-medium text-slate-300">Brak zapamiętanych faktów w tej kategorii</p>
              <p className="text-xs text-slate-500">
                Rozmawiaj z modelem w oknie czatu (np. powiedz "Nazywam się Tomasz i lubię pythona") lub użyj zakładki "Naucz Model Ręcznie".
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredFacts.map((fact) => (
                <div
                  key={fact.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow flex flex-col justify-between hover:border-slate-700 transition-colors"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      {getCategoryBadge(fact.category)}
                      {fact.id && (
                        <button
                          onClick={() => handleDelete(fact.id!)}
                          className="text-slate-500 hover:text-rose-400 p-1 transition-colors"
                          title="Usuń ten fakt"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-white">
                      <span className="text-purple-400">{fact.subject}</span>{' '}
                      <span className="text-slate-400 font-normal italic">{fact.predicate}</span>{' '}
                      <span className="text-cyan-300">{fact.object}</span>
                    </div>
                  </div>

                  {fact.created_at && (
                    <div className="text-[10px] text-slate-500 mt-3">
                      Zapamiętano: {new Date(fact.created_at).toLocaleString()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Subtab: Teach Manually */}
      {activeSubTab === 'teach' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          <div>
            <h3 className="text-lg font-bold text-white">Wstrzyknij wiedzę bezpośrednio do pamięci</h3>
            <p className="text-xs text-slate-400 mt-1">
              Fakty zapisane w tej formie zostaną natychmiast uwzględnione w promptach kognitywnych modelu przy kolejnych wiadomościach.
            </p>
          </div>

          <form onSubmit={handleTeach} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="brain-fact-category" className="block text-xs font-medium text-slate-400 mb-1">
                  Kategoria
                </label>
                <select
                  id="brain-fact-category"
                  name="factCategory"
                  aria-label="Kategoria wiedzy"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="user_profile">Profil Użytkownika</option>
                  <option value="world_knowledge">Wiedza o Świecie</option>
                  <option value="preference">Preferencja</option>
                  <option value="correction">Korekta / Nowa reguła</option>
                </select>
              </div>

              <div>
                <label htmlFor="brain-fact-subject" className="block text-xs font-medium text-slate-400 mb-1">
                  Podmiot (Subject)
                </label>
                <input
                  id="brain-fact-subject"
                  name="factSubject"
                  aria-label="Podmiot wiedzy"
                  type="text"
                  placeholder="np. Użytkownik / Model / Projekt"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label htmlFor="brain-fact-predicate" className="block text-xs font-medium text-slate-400 mb-1">
                  Relacja (Predicate)
                </label>
                <input
                  id="brain-fact-predicate"
                  name="factPredicate"
                  aria-label="Relacja wiedzy"
                  type="text"
                  placeholder="np. ma na imię / lubi / zajmuje się"
                  value={predicate}
                  onChange={(e) => setPredicate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="brain-fact-object" className="block text-xs font-medium text-slate-400 mb-1">
                Wartość / Dopełnienie (Object)
              </label>
              <input
                id="brain-fact-object"
                name="factObject"
                aria-label="Wartość lub dopełnienie wiedzy"
                type="text"
                placeholder="np. Robert / programowanie w Rust / architekturą mikrousług"
                value={object}
                onChange={(e) => setObject(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            <button
              type="submit"
              disabled={isTeaching || !subject || !predicate || !object}
              className="py-2.5 px-5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-medium text-sm rounded-xl transition-colors shadow-lg shadow-purple-900/30"
            >
              {isTeaching ? 'Zapisywanie w mózgu...' : 'Wstrzyknij wiedzę do pamięci'}
            </button>

            {teachStatus && (
              <p className={`text-xs ${teachStatus.startsWith('Błąd') ? 'text-rose-400' : 'text-emerald-400'}`}>
                {teachStatus}
              </p>
            )}
          </form>
        </div>
      )}

      {/* Subtab: Logs */}
      {activeSubTab === 'logs' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <h3 className="text-base font-semibold text-white mb-3">Dziennik akcji orkiestratora i workerów</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto font-mono text-xs">
            {logs.length === 0 ? (
              <p className="text-slate-500">Brak zarejestrowanych logów</p>
            ) : (
              logs.map((log: any) => (
                <div key={log.id} className="p-2.5 rounded-lg bg-slate-800/50 border border-slate-700/60 flex items-start gap-3">
                  <span className="text-slate-500 shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="text-cyan-400 font-bold shrink-0">[{log.worker}]</span>
                  <span className="text-slate-300 shrink-0">{log.action}:</span>
                  <span className="text-slate-400 truncate">{log.details || log.status}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
