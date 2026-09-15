import React, { useState, useEffect } from 'react';
import { X, Key, Cpu, User, Trash2, Check, ExternalLink, Server, RefreshCw, CheckCircle2, AlertCircle, Save } from 'lucide-react';
import type { OrchestratorStatus, KeyStatus } from '../types';
import { api } from '../api/client';
import { browserStore } from '../services/storage';
import { browserPersonaWorker } from '../services/personaWorker';

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
  const [useLocalOllama, setUseLocalOllama] = useState(false);
  const [localOllamaUrl, setLocalOllamaUrl] = useState('http://localhost:11434');
  const [isTestingOllama, setIsTestingOllama] = useState(false);
  const [ollamaTestResult, setOllamaTestResult] = useState<{
    success: boolean;
    message: string;
    models?: string[];
  } | null>(null);
  const [isSavingOllamaOnly, setIsSavingOllamaOnly] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      browserStore.getSetting('use_local_ollama').then((val) => {
        setUseLocalOllama(val === 'true');
        setOllamaTestResult(null);
      });
      browserStore.getSetting('local_ollama_url').then((val) => {
        setLocalOllamaUrl(val || 'http://localhost:11434');
      });
    }
  }, [isOpen]);

  const handleTestOllama = async () => {
    setIsTestingOllama(true);
    setOllamaTestResult(null);
    try {
      const res = await browserPersonaWorker.testOllamaConnection(localOllamaUrl.trim());
      setOllamaTestResult(res);
    } catch (err: any) {
      setOllamaTestResult({
        success: false,
        message: err.message || 'Nieoczekiwany błąd połączenia'
      });
    } finally {
      setIsTestingOllama(false);
    }
  };

  const handleSaveOllamaOnly = async () => {
    setIsSavingOllamaOnly(true);
    try {
      await browserStore.setSetting('use_local_ollama', useLocalOllama ? 'true' : 'false');
      await browserStore.setSetting('local_ollama_url', localOllamaUrl.trim() || 'http://localhost:11434');
      setOllamaTestResult({
        success: true,
        message: 'Ustawienia Ollama zostały pomyślnie zapisane w storage.'
      });
      onSettingsSaved();
    } catch (err: any) {
      setOllamaTestResult({
        success: false,
        message: `Błąd zapisu: ${err.message}`
      });
    } finally {
      setIsSavingOllamaOnly(false);
    }
  };

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
        useLocalOllama,
        localOllamaUrl: localOllamaUrl.trim() || 'http://localhost:11434',
      });

      // 3. Zapis do storage dla Local-First IndexedDB
      await browserStore.setSetting('use_local_ollama', useLocalOllama ? 'true' : 'false');
      await browserStore.setSetting('local_ollama_url', localOllamaUrl.trim() || 'http://localhost:11434');

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

          {/* Lokalny Model (Ollama) - Filar 4 */}
          <div className="p-3.5 bg-slate-800/70 border border-slate-700/80 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold text-white">Lokalny Model (Ollama)</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-medium">
                  Filar 4
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={useLocalOllama}
                  onChange={(e) => setUseLocalOllama(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Wnioskowanie lokalne (0 tokenów płatnych, $0.00 USD). Po włączeniu zapytania czatu kierowane są bezpośrednio do lokalnej instancji Ollama.
            </p>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-slate-300">Adres URL serwera Ollama</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="http://localhost:11434"
                  value={localOllamaUrl}
                  onChange={(e) => setLocalOllamaUrl(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={handleTestOllama}
                  disabled={isTestingOllama}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTestingOllama ? 'animate-spin' : ''}`} />
                  {isTestingOllama ? 'Test...' : 'Testuj połączenie'}
                </button>
                <button
                  type="button"
                  onClick={handleSaveOllamaOnly}
                  disabled={isSavingOllamaOnly}
                  title="Zapisz tylko ustawienia Ollama"
                  className="px-2.5 py-1.5 bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  Zapisz
                </button>
              </div>
            </div>

            {ollamaTestResult && (
              <div
                className={`p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                  ollamaTestResult.success
                    ? 'bg-emerald-950/40 border border-emerald-800 text-emerald-300'
                    : 'bg-rose-950/40 border border-rose-800 text-rose-300'
                }`}
              >
                {ollamaTestResult.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                )}
                <div className="leading-snug">
                  <div className="font-semibold">{ollamaTestResult.success ? 'Połączenie aktywne' : 'Błąd połączenia'}</div>
                  <div className="text-[11px] opacity-90 mt-0.5">{ollamaTestResult.message}</div>
                </div>
              </div>
            )}
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
                  <option value="openrouter/free">OpenRouter Free Tier (Darmowy $0.00)</option>
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
