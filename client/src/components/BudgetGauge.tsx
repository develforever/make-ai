import React, { useState } from 'react';
import { DollarSign, Zap, MessageSquare, Clock, ShieldAlert } from 'lucide-react';
import type { BudgetStatus } from '../types';
import { api } from '../api/client';

interface BudgetGaugeProps {
  budget: BudgetStatus | null;
  onRefresh: () => void;
}

export const BudgetGauge: React.FC<BudgetGaugeProps> = ({ budget, onRefresh }) => {
  const [newLimit, setNewLimit] = useState<string>(budget ? budget.totalBudgetUsd.toString() : '2.00');
  const [isUpdating, setIsUpdating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  if (!budget) {
    return (
      <div className="p-8 text-center text-slate-400">
        Ładowanie danych telemetrycznych budżetu...
      </div>
    );
  }

  const handleUpdateLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(newLimit);
    if (isNaN(val) || val <= 0) return;

    setIsUpdating(true);
    try {
      await api.setBudgetLimit(val);
      setStatusMsg('Zaktualizowano limit budżetu.');
      setTimeout(() => setStatusMsg(null), 3000);
      onRefresh();
    } catch (err: any) {
      setStatusMsg(`Błąd: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const percentUsed = budget.percentageUsed;
  const isDanger = budget.remainingBudgetUsd <= 0.05;

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
              <DollarSign className="w-4 h-4" />
              <span>Nadzór Finansowy i Tokenów (OpenRouter)</span>
            </div>
            <h2 className="text-3xl font-bold text-white mt-1">
              ${budget.remainingBudgetUsd.toFixed(4)}{' '}
              <span className="text-slate-500 text-lg font-normal">
                pozostało z ${budget.totalBudgetUsd.toFixed(2)} USD
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-4">
            <div className="bg-slate-800/80 px-4 py-2.5 rounded-xl border border-slate-700/60 text-right">
              <div className="text-xs text-slate-400 flex items-center gap-1 justify-end">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Pozostałe wiadomości:</span>
              </div>
              <div className="text-lg font-bold text-cyan-400 font-mono">
                ~{budget.estimatedMessagesLeft}
              </div>
            </div>

            <div className="bg-slate-800/80 px-4 py-2.5 rounded-xl border border-slate-700/60 text-right">
              <div className="text-xs text-slate-400 flex items-center gap-1 justify-end">
                <Zap className="w-3.5 h-3.5" />
                <span>Łączne tokeny:</span>
              </div>
              <div className="text-lg font-bold text-indigo-400 font-mono">
                {budget.totalTokens.toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-6 space-y-2">
          <div className="flex justify-between text-xs text-slate-400">
            <span>Zużycie budżetu: {percentUsed.toFixed(1)}%</span>
            <span>Wydano: ${budget.totalSpentUsd.toFixed(4)} USD</span>
          </div>
          <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isDanger
                  ? 'bg-rose-500'
                  : percentUsed > 75
                  ? 'bg-amber-400'
                  : 'bg-gradient-to-r from-cyan-500 to-emerald-400'
              }`}
              style={{ width: `${Math.min(100, percentUsed)}%` }}
            />
          </div>
        </div>

        {isDanger && (
          <div className="mt-4 p-3 bg-rose-950/40 border border-rose-800/50 rounded-xl flex items-center gap-2 text-rose-300 text-sm">
            <ShieldAlert className="w-5 h-5 flex-shrink-0" />
            <span>
              Krytycznie niski stan budżetu! Zostało mniej niż $0.05. Wstrzymano automatyczne workerów.
            </span>
          </div>
        )}
      </div>

      {/* Adjust Budget Form & Strategy */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
          <h3 className="text-base font-semibold text-white mb-3">Zmień limit budżetu</h3>
          <form onSubmit={handleUpdateLimit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Nowy limit budżetu (USD)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-500 font-mono">$</span>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={newLimit}
                  onChange={(e) => setNewLimit(e.target.value)}
                  className="w-full pl-8 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white font-mono text-sm focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={isUpdating}
              className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-700 text-cyan-400 font-medium text-sm rounded-xl border border-slate-700 transition-colors"
            >
              {isUpdating ? 'Zapisywanie...' : 'Zaktualizuj limit'}
            </button>
            {statusMsg && <p className="text-xs text-emerald-400 text-center">{statusMsg}</p>}
          </form>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
          <h3 className="text-base font-semibold text-white mb-2">Strategia oszczędnościowa</h3>
          <ul className="text-xs text-slate-300 space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-cyan-400 font-bold">•</span>
              <span>
                <strong>Gemini 2.0 Flash:</strong> ~$0.10 / 1M prompt. Odpowiedzialny za dialog i zachowanie charakteru.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">•</span>
              <span>
                <strong>Gemini 2.0 Flash Lite:</strong> ~$0.075 / 1M prompt. Wywoływany w tle tylko wtedy, gdy wykryto nowe fakty.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 font-bold">•</span>
              <span>
                <strong>Wikipedia REST API:</strong> 100% darmowe zapytania zewnętrzne. Zero narzutu na tokeny przy pobieraniu faktów.
              </span>
            </li>
          </ul>
        </div>
      </div>

      {/* Ledger Table */}
      {budget.ledger && budget.ledger.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
          <h3 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-400" />
            Ostatnie wydatki i operacje
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300 font-mono">
              <thead className="bg-slate-800/60 text-slate-400 border-b border-slate-700">
                <tr>
                  <th className="p-2.5">Czas</th>
                  <th className="p-2.5">Model</th>
                  <th className="p-2.5">Cel</th>
                  <th className="p-2.5">Tokeny (in/out)</th>
                  <th className="p-2.5 text-right">Koszt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {budget.ledger.slice(0, 10).map((row: any) => (
                  <tr key={row.id} className="hover:bg-slate-800/30">
                    <td className="p-2.5 text-slate-400">
                      {new Date(row.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="p-2.5 text-cyan-400">{row.model.split('/')[1] || row.model}</td>
                    <td className="p-2.5 text-slate-300">{row.purpose}</td>
                    <td className="p-2.5 text-slate-400">
                      {row.prompt_tokens} / {row.completion_tokens}
                    </td>
                    <td className="p-2.5 text-right text-emerald-400 font-bold">
                      ${row.cost_usd.toFixed(6)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
