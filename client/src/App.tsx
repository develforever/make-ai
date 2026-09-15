import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { ChatWindow } from './components/ChatWindow';
import { BrainVisualizer } from './components/BrainVisualizer';
import { BudgetGauge } from './components/BudgetGauge';
import { SettingsModal } from './components/SettingsModal';
import type { Message, BudgetStatus, OrchestratorStatus, KeyStatus, ExtractedFact } from './types';
import { api } from './api/client';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'chat' | 'brain' | 'budget'>('chat');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Stany telemetrii i danych
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [orchestrator, setOrchestrator] = useState<OrchestratorStatus | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [facts, setFacts] = useState<ExtractedFact[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [engineMode, setEngineMode] = useState<'backend' | 'browser-native'>('browser-native');

  // Stany wykonawcze
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLearning, setIsLearning] = useState(false);

  // Załadowanie wszystkich danych bazowych
  const refreshAllData = useCallback(async () => {
    try {
      const [bData, oData, kData, mData, cData, mode] = await Promise.all([
        api.getBudget().catch(() => null),
        api.getOrchestratorStatus().catch(() => null),
        api.getKeyStatus().catch(() => null),
        api.getMemory().catch(() => ({ count: 0, facts: [] })),
        api.getConversations().catch(() => ({ messages: [] })),
        api.getEngineMode().catch(() => 'browser-native' as const)
      ]);

      if (bData) setBudget(bData);
      if (oData) setOrchestrator(oData);
      if (kData) setKeyStatus(kData);
      if (mData) setFacts(mData.facts);
      if (cData && cData.messages) {
        setMessages(cData.messages);
      }
      setEngineMode(mode);
    } catch (err) {
      console.error('Błąd odświeżania danych:', err);
    }
  }, []);

  useEffect(() => {
    refreshAllData();
  }, [refreshAllData]);

  // Pauza / Wznowienie pętli workerów
  const handleTogglePause = async () => {
    if (!orchestrator) return;
    try {
      const result = await api.setPause(!orchestrator.isPaused);
      setOrchestrator((prev) => prev ? { ...prev, isPaused: result.isPaused } : null);
    } catch (err: any) {
      alert(`Błąd zmiany stanu pauzy: ${err.message}`);
    }
  };

  // Wysłanie wiadomości i obsługa strumieniowania ze sprzężeniem zwrotnym workerów
  const handleSendMessage = async (text: string) => {
    if (isStreaming) return;

    // 1. Dodaj wiadomość użytkownika do lokalnego widoku
    const userMsg: Message = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    };

    // 2. Przygotuj placeholder na odpowiedź asystenta
    const assistantMsgPlaceholder: Message = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString()
    };

    setMessages((prev) => [...prev, userMsg, assistantMsgPlaceholder]);
    setIsStreaming(true);
    setIsLearning(true);

    let accumulatedContent = '';

    await api.streamChat(text, {
      onWiki: (wikiData) => {
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            updated[lastIdx] = {
              ...updated[lastIdx],
              wiki: wikiData
            };
          }
          return updated;
        });
      },

      onDelta: (chunk) => {
        accumulatedContent += chunk;
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: accumulatedContent
            };
          }
          return updated;
        });
      },

      onLearned: (learnedFacts) => {
        setIsLearning(false);
        if (learnedFacts && learnedFacts.length > 0) {
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = {
                ...updated[lastIdx],
                learnedFacts
              };
            }
            return updated;
          });
          // Odśwież listę faktów w pamięci
          api.getMemory().then((res) => {
            if (res?.facts) setFacts(res.facts);
          });
        }
      },

      onUsage: () => {
        // Zaktualizuj stan budżetu
        api.getBudget().then((b) => {
          if (b) setBudget(b);
        });
      },

      onError: (err) => {
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: accumulatedContent
                ? `${accumulatedContent}\n\n*[Błąd: ${err}]*`
                : `*[Błąd generowania odpowiedzi: ${err}]*`
            };
          }
          return updated;
        });
      },

      onDone: () => {
        setIsStreaming(false);
        setIsLearning(false);
        // Odśwież telemetrię
        api.getBudget().then((b) => {
          if (b) setBudget(b);
        });
        api.getOrchestratorStatus().then((o) => {
          if (o) setOrchestrator(o);
        });
      }
    });
  };

  const agentName = orchestrator?.agentName || 'Aura';
  const hasKey = keyStatus?.hasKey ?? false;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Header
        agentName={agentName}
        budget={budget}
        orchestrator={orchestrator}
        learnedFactsCount={facts.length}
        engineMode={engineMode}
        onTogglePause={handleTogglePause}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenBrain={() => setActiveTab('brain')}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      <main className="flex-1 flex flex-col">
        {activeTab === 'chat' && (
          <ChatWindow
            messages={messages}
            isStreaming={isStreaming}
            isLearning={isLearning}
            onSendMessage={handleSendMessage}
            agentName={agentName}
            hasApiKey={hasKey}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        )}

        {activeTab === 'brain' && (
          <div className="flex-1 py-6">
            <BrainVisualizer
              facts={facts}
              onRefresh={refreshAllData}
              logs={orchestrator?.logs || []}
            />
          </div>
        )}

        {activeTab === 'budget' && (
          <div className="flex-1 py-6">
            <BudgetGauge
              budget={budget}
              onRefresh={refreshAllData}
            />
          </div>
        )}
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        keyStatus={keyStatus}
        orchestrator={orchestrator}
        onSettingsSaved={refreshAllData}
      />
    </div>
  );
};

export default App;
