import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, MessageSquare, ArrowRight } from 'lucide-react';
import type { SearchResult } from '../../types';
import { api } from '../../api/client';

interface SearchBarProps {
  onSelectSession: (id: string) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSelectSession }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const trimmed = query.trim();
      if (!trimmed) {
        setResults([]);
        setIsSearching(false);
        setIsOpen(false);
        return;
      }

      setIsSearching(true);
      try {
        const res = await api.searchAllSessions(trimmed);
        setResults(res.results || []);
        setIsOpen(true);
      } catch (err) {
        console.error('Błąd wyszukiwania:', err);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
  };

  return (
    <div className="relative w-full px-2 py-2" ref={searchRef}>
      <div className="relative flex items-center">
        <Search className="w-3.5 h-3.5 absolute left-2.5 text-slate-500 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
          placeholder="Szukaj we wszystkich rozmowach..."
          className="w-full bg-slate-900/90 border border-slate-800 focus:border-cyan-500/60 rounded-xl pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 transition-all"
        />
        {isSearching ? (
          <Loader2 className="w-3.5 h-3.5 absolute right-2.5 text-cyan-400 animate-spin" />
        ) : query ? (
          <button
            onClick={handleClear}
            className="absolute right-2 text-slate-500 hover:text-slate-300 p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        ) : null}
      </div>

      {/* Results Popover Dropdown */}
      {isOpen && query.trim() && (
        <div className="absolute left-2 right-2 top-full mt-1 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl z-50 max-h-80 overflow-y-auto divide-y divide-slate-800 text-xs">
          {results.length === 0 ? (
            <div className="p-3 text-center text-slate-500 italic">
              Brak wyników dla "{query}"
            </div>
          ) : (
            results.map(({ session, matches }) => (
              <div
                key={session.id}
                onClick={() => {
                  onSelectSession(session.id);
                  setIsOpen(false);
                }}
                className="p-2.5 hover:bg-slate-800/80 cursor-pointer transition-colors group"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-medium text-cyan-300 group-hover:text-cyan-200 truncate">
                    <MessageSquare className="w-3 h-3 text-cyan-400 shrink-0" />
                    <span className="truncate">{session.title}</span>
                  </div>
                  <ArrowRight className="w-3 h-3 text-slate-600 group-hover:text-cyan-400 shrink-0 transition-colors" />
                </div>

                {matches.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {matches.slice(0, 2).map((m, idx) => (
                      <div
                        key={idx}
                        className="text-[11px] text-slate-400 bg-slate-950/60 rounded px-1.5 py-0.5 font-mono truncate"
                      >
                        <span className="text-slate-500 uppercase text-[9px] mr-1">
                          {m.role === 'user' ? 'Ty:' : 'Aura:'}
                        </span>
                        {m.snippet}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
