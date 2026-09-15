import React from 'react';
import { Sparkles, Brain, DollarSign, Settings, Pause, Play, Presentation, Layers, Cpu } from 'lucide-react';
import type { BudgetStatus, OrchestratorStatus } from '../types';

interface HeaderProps {
  agentName: string;
  budget: BudgetStatus | null;
  orchestrator: OrchestratorStatus | null;
  learnedFactsCount: number;
  engineMode?: 'backend' | 'browser-native';
  onTogglePause: () => void;
  onOpenSettings: () => void;
  onOpenBrain: () => void;
  activeTab: 'chat' | 'brain' | 'budget' | 'neural';
  setActiveTab: (tab: 'chat' | 'brain' | 'budget' | 'neural') => void;
}

export const Header: React.FC<HeaderProps> = ({
  agentName,
  budget,
  orchestrator,
  learnedFactsCount,
  engineMode = 'browser-native',
  onTogglePause,
  onOpenSettings,
  activeTab,
  setActiveTab,
}) => {
  const isPaused = orchestrator?.isPaused ?? false;
  const remaining = budget ? `$${budget.remainingBudgetUsd.toFixed(4)}` : '$2.0000';
  const total = budget ? `$${budget.totalBudgetUsd.toFixed(2)}` : '$2.00';

  return (
    <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-20 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Logo & Agent Identity */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center text-white font-bold shadow-lg shadow-cyan-900/30">
              <Sparkles className="w-5 h-5" />
            </div>
            <span
              className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-slate-900 ${
                isPaused ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'
              }`}
              title={isPaused ? 'Orkiestrator wstrzymany' : 'Orkiestrator aktywny'}
            />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-slate-100 text-lg tracking-tight">{agentName}</h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-cyan-400 font-mono">
                {orchestrator?.chatModel ? orchestrator.chatModel.split('/')[1] : 'Gemini 2.5'}
              </span>
              <span
                className={`hidden lg:inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-mono border ${
                  engineMode === 'backend'
                    ? 'bg-purple-950/40 border-purple-800/50 text-purple-300'
                    : 'bg-cyan-950/40 border-cyan-800/50 text-cyan-300'
                }`}
                title={
                  engineMode === 'backend'
                    ? 'Działa w trybie serwerowym (Node.js + native node:sqlite)'
                    : 'Działa bezpośrednio w przeglądarce (Local-First IndexedDB Engine)'
                }
              >
                <Layers className="w-3 h-3" />
                {engineMode === 'backend' ? 'Node 24 Engine' : 'IndexedDB Engine'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {isPaused ? 'Pętla workerów wstrzymana' : 'Autonomiczne douczanie aktywne'}
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="hidden md:flex items-center bg-slate-800/80 p-1 rounded-xl border border-slate-700/60 text-sm">
          <button
            onClick={() => setActiveTab('chat')}
            className={`px-3 py-1.5 rounded-lg transition-colors font-medium ${
              activeTab === 'chat'
                ? 'bg-cyan-600 text-white shadow'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            Rozmowa
          </button>
          <button
            onClick={() => setActiveTab('brain')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 font-medium ${
              activeTab === 'brain'
                ? 'bg-cyan-600 text-white shadow'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <Brain className="w-4 h-4 text-purple-400" />
            Mózg ({learnedFactsCount})
          </button>
          <button
            onClick={() => setActiveTab('budget')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 font-medium ${
              activeTab === 'budget'
                ? 'bg-cyan-600 text-white shadow'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <DollarSign className="w-4 h-4 text-emerald-400" />
            Budżet ({remaining})
          </button>
          <button
            onClick={() => setActiveTab('neural')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 font-medium ${
              activeTab === 'neural'
                ? 'bg-cyan-600 text-white shadow'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <Cpu className="w-4 h-4 text-cyan-400" />
            Sieć KAN
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Keynote Presentation Link */}
          <a
            href="./presentation.html"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-950/50 border border-indigo-800/50 text-indigo-300 text-xs font-medium hover:bg-indigo-900/60 hover:text-white transition-colors"
            title="Otwórz interaktywną prezentację architektoniczną w nowej karcie"
          >
            <Presentation className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Prezentacja</span>
          </a>

          {/* Pause / Resume Button */}
          <button
            onClick={onTogglePause}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              isPaused
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700/70 hover:text-white'
            }`}
            title={isPaused ? 'Wznów pętlę douczania' : 'Wstrzymaj pętlę douczania'}
          >
            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isPaused ? 'Wznów' : 'Pauza'}</span>
          </button>

          {/* Budget pill on mobile/desktop */}
          <div
            onClick={() => setActiveTab('budget')}
            className="cursor-pointer flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 text-xs font-mono hover:bg-emerald-950/60 transition-colors"
            title="Kliknij, aby otworzyć szczegóły budżetu"
          >
            <DollarSign className="w-3.5 h-3.5" />
            <span>{remaining}</span>
            <span className="text-emerald-600">/ {total}</span>
          </div>

          {/* Settings gear */}
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            title="Ustawienia modelu i klucza API"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
