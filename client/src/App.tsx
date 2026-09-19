import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { ChatWindow } from './components/ChatWindow';
import { BrainVisualizer } from './components/BrainVisualizer';
import { BudgetGauge } from './components/BudgetGauge';
import { SettingsModal } from './components/SettingsModal';
import { KANVisualizer } from './components/KANVisualizer';
import { Sidebar } from './components/Sidebar/Sidebar';
import type { Message, BudgetStatus, OrchestratorStatus, KeyStatus, ExtractedFact, ChatSession, ChatFolder } from './types';
import { api } from './api/client';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'chat' | 'brain' | 'budget' | 'neural'>('chat');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Sidebar & Sesje
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    return localStorage.getItem('makeai_sidebar_open') !== 'false';
  });
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    return localStorage.getItem('makeai_active_session') || 'default';
  });
  const [showArchived, setShowArchived] = useState(false);

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

  // Załadowanie sesji i folderów
  const refreshSessions = useCallback(async () => {
    try {
      const [sRes, fRes] = await Promise.all([
        api.getSessions({ includeArchived: true }).catch(() => ({ sessions: [] })),
        api.getFolders().catch(() => ({ folders: [] }))
      ]);
      if (sRes?.sessions) setSessions(sRes.sessions);
      if (fRes?.folders) setFolders(fRes.folders);
    } catch (err) {
      console.error('Błąd ładowania sesji:', err);
    }
  }, []);

  // Załadowanie wiadomości dla aktywnej sesji
  const loadMessages = useCallback(async (sessId: string) => {
    try {
      const res = await api.getConversations(50, sessId);
      setMessages(res.messages || []);
    } catch (err) {
      console.error(`Błąd ładowania wiadomości dla sesji ${sessId}:`, err);
    }
  }, []);

  // Załadowanie wszystkich danych bazowych
  const refreshAllData = useCallback(async () => {
    try {
      const [bData, oData, kData, mData, mode] = await Promise.all([
        api.getBudget().catch(() => null),
        api.getOrchestratorStatus().catch(() => null),
        api.getKeyStatus().catch(() => null),
        api.getMemory().catch(() => ({ count: 0, facts: [] })),
        api.getEngineMode().catch(() => 'browser-native' as const)
      ]);

      if (bData) setBudget(bData);
      if (oData) setOrchestrator(oData);
      if (kData) setKeyStatus(kData);
      if (mData) setFacts(mData.facts);
      setEngineMode(mode);

      await refreshSessions();
      await loadMessages(activeSessionId);
    } catch (err) {
      console.error('Błąd odświeżania danych:', err);
    }
  }, [activeSessionId, refreshSessions, loadMessages]);

  useEffect(() => {
    refreshAllData();
  }, [refreshAllData]);

  // Reakcja na zmianę aktywnej sesji
  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
    localStorage.setItem('makeai_active_session', id);
    loadMessages(id);
  };

  const handleNewSession = async (folderId?: string | null) => {
    try {
      const res = await api.createSession('Nowa rozmowa', folderId);
      await refreshSessions();
      if (res?.session?.id) {
        handleSelectSession(res.session.id);
      }
    } catch (err: any) {
      alert(`Błąd tworzenia sesji: ${err.message}`);
    }
  };

  const handleCreateFolder = async (name: string, color?: string) => {
    try {
      await api.saveFolder(name, color);
      await refreshSessions();
    } catch (err: any) {
      alert(`Błąd tworzenia katalogu: ${err.message}`);
    }
  };

  const handleRenameFolder = async (id: string, name: string) => {
    try {
      await api.saveFolder(name, undefined, id);
      await refreshSessions();
    } catch (err: any) {
      alert(`Błąd edycji katalogu: ${err.message}`);
    }
  };

  const handleDeleteFolder = async (id: string) => {
    try {
      await api.deleteFolder(id);
      await refreshSessions();
    } catch (err: any) {
      alert(`Błąd usuwania katalogu: ${err.message}`);
    }
  };

  const handleRenameSession = async (id: string, title: string) => {
    try {
      await api.updateSession(id, { title });
      await refreshSessions();
    } catch (err: any) {
      alert(`Błąd zmiany nazwy sesji: ${err.message}`);
    }
  };

  const handleTogglePinSession = async (id: string, isPinned: boolean) => {
    try {
      await api.updateSession(id, { is_pinned: isPinned });
      await refreshSessions();
    } catch (err: any) {
      alert(`Błąd przypinania sesji: ${err.message}`);
    }
  };

  const handleToggleArchiveSession = async (id: string, isArchived: boolean) => {
    try {
      await api.updateSession(id, { is_archived: isArchived });
      await refreshSessions();
    } catch (err: any) {
      alert(`Błąd archiwizacji sesji: ${err.message}`);
    }
  };

  const handleMoveSessionFolder = async (id: string, folderId: string | null) => {
    try {
      await api.updateSession(id, { folder_id: folderId });
      await refreshSessions();
    } catch (err: any) {
      alert(`Błąd przenoszenia sesji: ${err.message}`);
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await api.deleteSession(id);
      const sRes = await api.getSessions({ includeArchived: true });
      const remaining = sRes.sessions || [];
      setSessions(remaining);
      if (activeSessionId === id) {
        const fallbackId = remaining[0]?.id || 'default';
        handleSelectSession(fallbackId);
      }
    } catch (err: any) {
      alert(`Błąd usuwania sesji: ${err.message}`);
    }
  };

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
  const handleSendMessage = async (text: string, referencedSessionIds?: string[]) => {
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

    await api.streamChat(
      text,
      {
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
            api.getMemory().then((res) => {
              if (res?.facts) setFacts(res.facts);
            });
          }
        },

        onUsage: () => {
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
          refreshSessions();
          api.getBudget().then((b) => {
            if (b) setBudget(b);
          });
          api.getOrchestratorStatus().then((o) => {
            if (o) setOrchestrator(o);
          });
        }
      },
      activeSessionId,
      referencedSessionIds
    );
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
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => {
          setIsSidebarOpen((prev) => {
            const next = !prev;
            localStorage.setItem('makeai_sidebar_open', String(next));
            return next;
          });
        }}
        onTogglePause={handleTogglePause}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenBrain={() => setActiveTab('brain')}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      <div className="flex-1 flex overflow-hidden h-[calc(100vh-73px)]">
        {activeTab === 'chat' && (
          <Sidebar
            isOpen={isSidebarOpen}
            onClose={() => {
              setIsSidebarOpen(false);
              localStorage.setItem('makeai_sidebar_open', 'false');
            }}
            sessions={sessions}
            folders={folders}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onNewSession={handleNewSession}
            onCreateFolder={handleCreateFolder}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
            onRenameSession={handleRenameSession}
            onTogglePinSession={handleTogglePinSession}
            onToggleArchiveSession={handleToggleArchiveSession}
            onMoveSessionFolder={handleMoveSessionFolder}
            onDeleteSession={handleDeleteSession}
            showArchived={showArchived}
            onToggleShowArchived={() => setShowArchived(!showArchived)}
          />
        )}

        <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {activeTab === 'chat' && (
            <ChatWindow
              messages={messages}
              isStreaming={isStreaming}
              isLearning={isLearning}
              onSendMessage={handleSendMessage}
              agentName={agentName}
              hasApiKey={hasKey}
              onOpenSettings={() => setIsSettingsOpen(true)}
              sessions={sessions}
              activeSessionId={activeSessionId}
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

          {activeTab === 'neural' && (
            <div className="flex-1 py-6">
              <KANVisualizer />
            </div>
          )}
        </main>
      </div>

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
