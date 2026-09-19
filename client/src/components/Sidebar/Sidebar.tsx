import React, { useState } from 'react';
import {
  Plus,
  FolderPlus,
  PanelLeftClose,
  Archive,
  Pin,
  Sparkles,
  Check,
  X
} from 'lucide-react';
import type { ChatFolder, ChatSession } from '../../types';
import { FolderItem } from './FolderItem';
import { SessionItem } from './SessionItem';
import { SearchBar } from './SearchBar';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  folders: ChatFolder[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: (folderId?: string | null) => void;
  onCreateFolder: (name: string, color?: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onTogglePinSession: (id: string, isPinned: boolean) => void;
  onToggleArchiveSession: (id: string, isArchived: boolean) => void;
  onMoveSessionFolder: (id: string, folderId: string | null) => void;
  onDeleteSession: (id: string) => void;
  showArchived: boolean;
  onToggleShowArchived: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  sessions,
  folders,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onRenameSession,
  onTogglePinSession,
  onToggleArchiveSession,
  onMoveSessionFolder,
  onDeleteSession,
  showArchived,
  onToggleShowArchived
}) => {
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('#06b6d4');

  const colorOptions = ['#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6'];

  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (newFolderName.trim()) {
      onCreateFolder(newFolderName.trim(), newFolderColor);
      setNewFolderName('');
      setIsCreatingFolder(false);
    }
  };

  // Podział sesji na kategorie
  const pinnedSessions = sessions.filter((s) => s.is_pinned && (showArchived ? true : !s.is_archived));
  const archivedSessions = sessions.filter((s) => s.is_archived);
  
  // Sesje w folderach vs wolne sesje
  const rootSessions = sessions.filter(
    (s) => !s.folder_id && !s.is_pinned && (showArchived ? true : !s.is_archived)
  );

  return (
    <>
      {/* Backdrop na urządzeniach mobilnych */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Główny kontener paska bocznego */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 flex flex-col w-72 bg-slate-950/95 border-r border-slate-800/80 shadow-2xl transition-all duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0 md:w-0 md:border-r-0 md:overflow-hidden'
        }`}
      >
        {/* Górny pasek narzędziowy */}
        <div className="flex items-center justify-between p-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-sm">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Rozmowy
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsCreatingFolder(!isCreatingFolder)}
              className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60 rounded-lg transition-colors"
              title="Nowy katalog"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-lg transition-colors"
              title="Zwiń pasek boczny"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Przycisk nowej rozmowy */}
        <div className="p-2 pb-0">
          <button
            onClick={() => onNewSession(null)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-xs rounded-xl shadow-md shadow-cyan-950/40 transition-all hover:scale-[1.01] active:scale-[0.99]"
          >
            <Plus className="w-4 h-4" />
            <span>Nowa rozmowa</span>
          </button>
        </div>

        {/* Globalna Wyszukiwarka */}
        <SearchBar onSelectSession={onSelectSession} />

        {/* Formularz tworzenia nowego katalogu (rozwijany) */}
        {isCreatingFolder && (
          <form
            onSubmit={handleCreateFolder}
            className="m-2 p-2.5 bg-slate-900 border border-cyan-500/40 rounded-xl space-y-2 text-xs"
          >
            <div className="font-semibold text-cyan-300 flex items-center justify-between">
              <span>Nowy katalog</span>
              <button
                type="button"
                onClick={() => setIsCreatingFolder(false)}
                className="text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <label htmlFor="sidebar-new-folder-input" className="sr-only">
              Nazwa nowego katalogu
            </label>
            <input
              id="sidebar-new-folder-input"
              name="newFolderName"
              aria-label="Nazwa nowego katalogu"
              type="text"
              placeholder="Nazwa katalogu..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              autoFocus
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
            />
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1">
                {colorOptions.map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setNewFolderColor(c)}
                    className={`w-3.5 h-3.5 rounded-full border ${
                      newFolderColor === c ? 'border-white scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <button
                type="submit"
                disabled={!newFolderName.trim()}
                className="flex items-center gap-1 px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white rounded-md text-[11px] font-medium"
              >
                <Check className="w-3 h-3" />
                <span>Utwórz</span>
              </button>
            </div>
          </form>
        )}

        {/* Lista sesji z przewijaniem */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
          {/* Sekcja: Przypięte */}
          {pinnedSessions.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                <Pin className="w-3 h-3" />
                <span>Przypięte</span>
              </div>
              <div className="space-y-0.5 mt-0.5">
                {pinnedSessions.map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    isActive={s.id === activeSessionId}
                    folders={folders}
                    onSelect={onSelectSession}
                    onRename={onRenameSession}
                    onTogglePin={onTogglePinSession}
                    onToggleArchive={onToggleArchiveSession}
                    onMoveFolder={onMoveSessionFolder}
                    onDelete={onDeleteSession}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Sekcja: Katalogi */}
          {folders.length > 0 && (
            <div>
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Katalogi
              </div>
              <div className="space-y-1 mt-0.5">
                {folders.map((f) => (
                  <FolderItem
                    key={f.id}
                    folder={f}
                    sessions={sessions.filter(
                      (s) => s.folder_id === f.id && !s.is_pinned && (showArchived ? true : !s.is_archived)
                    )}
                    activeSessionId={activeSessionId}
                    folders={folders}
                    onSelectSession={onSelectSession}
                    onNewSessionInFolder={onNewSession}
                    onRenameFolder={onRenameFolder}
                    onDeleteFolder={onDeleteFolder}
                    onRenameSession={onRenameSession}
                    onTogglePinSession={onTogglePinSession}
                    onToggleArchiveSession={onToggleArchiveSession}
                    onMoveSessionFolder={onMoveSessionFolder}
                    onDeleteSession={onDeleteSession}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Sekcja: Wszystkie pozostałe rozmowy */}
          <div>
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
              <span>Rozmowy</span>
              <span className="text-[10px] text-slate-600">{rootSessions.length}</span>
            </div>
            <div className="space-y-0.5 mt-0.5">
              {rootSessions.length === 0 ? (
                <div className="text-[11px] text-slate-600 italic px-2 py-1">
                  Brak otwartych sesji
                </div>
              ) : (
                rootSessions.map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    isActive={s.id === activeSessionId}
                    folders={folders}
                    onSelect={onSelectSession}
                    onRename={onRenameSession}
                    onTogglePin={onTogglePinSession}
                    onToggleArchive={onToggleArchiveSession}
                    onMoveFolder={onMoveSessionFolder}
                    onDelete={onDeleteSession}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Dolna stopka: Archiwum */}
        <div className="p-2 border-t border-slate-800/80 bg-slate-950/60">
          <button
            onClick={onToggleShowArchived}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
              showArchived
                ? 'bg-amber-950/50 text-amber-300 border border-amber-800/60'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <Archive className="w-3.5 h-3.5" />
              <span>{showArchived ? 'Ukryj zarchiwizowane' : 'Pokaż archiwum'}</span>
            </div>
            {archivedSessions.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 bg-slate-800 rounded-full">
                {archivedSessions.length}
              </span>
            )}
          </button>
        </div>
      </aside>
    </>
  );
};
