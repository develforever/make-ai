import React, { useState } from 'react';
import { X, Key, Cpu, User, Trash2, Check, ExternalLink } from 'lucide-react';
import type { OrchestratorStatus, KeyStatus } from '../types';
import { api } from '../api/client';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  keyStatus: KeyStatus | null;
  orchestrator: OrchestratorStatus | null;
  onSettingsSaved: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  keyStatus,
  orchestrator,
  onSettingsSaved,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [agentName, setAgentName] = useState(orchestrator?.agentName || 'Aura');
  const [chatModel, setChatModel] = useState(orchestrator?.chatModel || 'google/gemini-2.0-flash-001');
  const [extractionModel, setExtractionModel] = useState(
    orchestrator?.extractionModel || 'google/gemini-2.0-flash-lite'
  );
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setStatusMsg(null);

    try {
      // 1. Zapis klucza jeśli podano
      if (apiKey.trim()) {
        await api.saveApiKey(apiKey.trim());
      }

      // 2. Zapis ustawień agenta i modeli
      await api.updateSettings({
        agentName: agentName.trim(),
        chatModel,
        extractionModel,
      });

      setStatusMsg('Ustawienia zostały pomyślnie zapisane.');
      setApiKey('');
      onSettingsSaved();
      setTimeout(() => {
        setStatusMsg(null);
        onClose();
      }, 1000);
    } catch (err: any) {
      setStatusMsg(`Błąd: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearHistory = async () => {
    if (confirm('Czy na pewno chcesz usunąć całą historię czatu?')) {
      await api.clearConversations();
      onSettingsSaved();
      alert('Historia wyczyszczona.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Key className="w-5 h-5 text-cyan-400" />
            Konfiguracja Systemu i Klucza API
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          {/* OpenRouter API Key */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">Klucz OpenRouter API</label>
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-cyan-400 hover:underline flex items-center gap-1"
              >
                Pobierz klucz <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <input
              type="password"
              placeholder={keyStatus?.hasKey ? `Klucz aktywny (${keyStatus.maskedKey})` : 'Wklej sk-or-v1-...'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
            />
            <p className="text-[11px] text-slate-400">
              Klucz zapisywany jest wyłącznie lokalnie w bazie SQLite na Twoim komputerze.
            </p>
          </div>

          {/* Agent Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-purple-400" />
              Imię Agenta / Osobowości
            </label>
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Chat Model Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              Wiodący Model Konwersacyjny (Persona Worker)
            </label>
            <select
              value={chatModel}
              onChange={(e) => setChatModel(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500"
            >
              {orchestrator?.supportedModels?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (${m.promptPricePerMillion}/1M prompt)
                </option>
              )) || (
                <>
                  <option value="google/gemini-2.5-flash">Gemini 2.5 Flash (Zalecany, szybki)</option>
                  <option value="deepseek/deepseek-chat">DeepSeek V3 (Wysoka inteligencja)</option>
                  <option value="google/gemini-2.5-flash-lite">Gemini 2.5 Flash Lite (Oszczędny)</option>
                  <option value="meta-llama/llama-3.3-70b-instruct">Llama 3.3 70B Instruct</option>
                </>
              )}
            </select>
          </div>

          {/* Extraction Model Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">
              Model Asynchronicznej Pamięci (Memory Worker)
            </label>
            <select
              value={extractionModel}
              onChange={(e) => setExtractionModel(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="google/gemini-2.5-flash-lite">
                Gemini 2.5 Flash Lite ($0.10/1M - ultratani, idealny)
              </option>
              <option value="google/gemini-2.5-flash">Gemini 2.5 Flash</option>
            </select>
          </div>

          {statusMsg && (
            <div
              className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                statusMsg.startsWith('Błąd')
                  ? 'bg-rose-950/50 border border-rose-800 text-rose-300'
                  : 'bg-emerald-950/50 border border-emerald-800 text-emerald-300'
              }`}
            >
              <Check className="w-4 h-4" />
              <span>{statusMsg}</span>
            </div>
          )}

          <div className="pt-2 flex items-center justify-between border-t border-slate-800">
            <button
              type="button"
              onClick={handleClearHistory}
              className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 py-2"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Wyczyść historię czatu
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm transition-colors"
              >
                Anuluj
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-medium rounded-xl text-sm transition-colors shadow-lg shadow-cyan-900/30"
              >
                {isSaving ? 'Zapisywanie...' : 'Zapisz zmiany'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
