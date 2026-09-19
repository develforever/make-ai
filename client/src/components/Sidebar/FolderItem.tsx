import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Plus,
  MoreVertical,
  Edit2,
  Trash2,
  Check,
  X
} from 'lucide-react';
import type { ChatFolder, ChatSession } from '../../types';
import { SessionItem } from './SessionItem';

interface FolderItemProps {
  folder: ChatFolder;
  sessions: ChatSession[];
  activeSessionId: string;
  folders: ChatFolder[];
  onSelectSession: (id: string) => void;
  onNewSessionInFolder: (folderId: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
  onTogglePinSession: (id: string, isPinned: boolean) => void;
  onToggleArchiveSession: (id: string, isArchived: boolean) => void;
  onMoveSessionFolder: (id: string, folderId: string | null) => void;
  onDeleteSession: (id: string) => void;
}

export const FolderItem: React.FC<FolderItemProps> = ({
  folder,
  sessions,
  activeSessionId,
  folders,
  onSelectSession,
  onNewSessionInFolder,
  onRenameFolder,
  onDeleteFolder,
  onRenameSession,
  onTogglePinSession,
  onToggleArchiveSession,
  onMoveSessionFolder,
  onDeleteSession
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditName(folder.name);
  }, [folder.name]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMenu]);

  const handleSaveRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== folder.name) {
      onRenameFolder(folder.id, trimmed);
    } else {
      setEditName(folder.name);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveRename();
    } else if (e.key === 'Escape') {
      setEditName(folder.name);
      setIsEditing(false);
    }
  };

  return (
    <div className="mb-1">
      {/* Folder Header */}
      <div
        className="group relative flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 cursor-pointer transition-colors"
        onClick={() => {
          if (!isEditing) setIsOpen(!isOpen);
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
            className="p-0.5 hover:text-slate-100 text-slate-500"
          >
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: folder.color || '#06b6d4' }}
          />

          {isOpen ? (
            <FolderOpen className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          ) : (
            <Folder className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )}

          {isEditing ? (
            <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full bg-slate-900 border border-cyan-500/60 rounded px-1.5 py-0.5 text-xs text-slate-100 focus:outline-none"
              />
              <button onClick={handleSaveRename} className="p-0.5 text-emerald-400 hover:text-emerald-300">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setEditName(folder.name);
                  setIsEditing(false);
                }}
                className="p-0.5 text-slate-400 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <span
              className="truncate flex-1 select-none font-medium"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
            >
              {folder.name}
            </span>
          )}
        </div>

        {/* Actions & Count */}
        {!isEditing && (
          <div className="flex items-center gap-1 shrink-0 ml-1">
            <span className="text-[10px] text-slate-500 px-1 py-0.2 bg-slate-800/80 rounded-full">
              {sessions.length}
            </span>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onNewSessionInFolder(folder.id);
              }}
              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-700/80 text-slate-400 hover:text-cyan-300 rounded transition-opacity"
              title="Nowa rozmowa w tym katalogu"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>

            <div className="relative" ref={menuRef}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 rounded transition-opacity"
                title="Opcje katalogu"
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>

              {showMenu && (
                <div
                  className="absolute right-0 top-full mt-1 w-44 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl py-1 z-50 text-xs text-slate-200 divide-y divide-slate-800"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="py-1">
                    <button
                      onClick={() => {
                        setIsEditing(true);
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 hover:text-cyan-300 text-left transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Zmień nazwę</span>
                    </button>
                    <button
                      onClick={() => {
                        onNewSessionInFolder(folder.id);
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 hover:text-cyan-300 text-left transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Nowa rozmowa</span>
                    </button>
                  </div>

                  <div className="py-1">
                    <button
                      onClick={() => {
                        if (confirm(`Czy na pewno chcesz usunąć katalog "${folder.name}"? Rozmowy zostaną zachowane bez katalogu.`)) {
                          onDeleteFolder(folder.id);
                        }
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-rose-950/40 text-rose-400 hover:text-rose-300 text-left transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Usuń katalog</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Child Sessions */}
      {isOpen && (
        <div className="pl-4 pr-1 mt-0.5 space-y-0.5 border-l border-slate-800/80 ml-3">
          {sessions.length === 0 ? (
            <div className="text-[11px] text-slate-600 italic py-1 px-2">Brak rozmów w katalogu</div>
          ) : (
            sessions.map((s) => (
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
      )}
    </div>
  );
};
