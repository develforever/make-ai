import React, { useState, useRef, useEffect } from 'react';
import {
  MessageSquare,
  Pin,
  PinOff,
  Archive,
  ArchiveRestore,
  Trash2,
  Edit2,
  MoreVertical,
  FolderInput,
  Check,
  X
} from 'lucide-react';
import type { ChatSession, ChatFolder } from '../../types';

interface SessionItemProps {
  session: ChatSession;
  isActive: boolean;
  folders: ChatFolder[];
  onSelect: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
  onTogglePin: (id: string, isPinned: boolean) => void;
  onToggleArchive: (id: string, isArchived: boolean) => void;
  onMoveFolder: (id: string, folderId: string | null) => void;
  onDelete: (id: string) => void;
}

export const SessionItem: React.FC<SessionItemProps> = ({
  session,
  isActive,
  folders,
  onSelect,
  onRename,
  onTogglePin,
  onToggleArchive,
  onMoveFolder,
  onDelete
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditTitle(session.title);
  }, [session.title]);

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
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== session.title) {
      onRename(session.id, trimmed);
    } else {
      setEditTitle(session.title);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveRename();
    } else if (e.key === 'Escape') {
      setEditTitle(session.title);
      setIsEditing(false);
    }
  };

  return (
    <div
      className={`group relative flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-all duration-150 cursor-pointer ${
        isActive
          ? 'bg-cyan-950/70 text-cyan-200 border border-cyan-500/40 shadow-sm shadow-cyan-950/50'
          : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100 border border-transparent'
      }`}
      onClick={() => {
        if (!isEditing) onSelect(session.id);
      }}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {session.is_pinned ? (
          <Pin className="w-3.5 h-3.5 text-cyan-400 shrink-0 fill-cyan-400/20" />
        ) : (
          <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-500 group-hover:text-slate-400'}`} />
        )}

        {isEditing ? (
          <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <label htmlFor={`rename-session-input-${session.id}`} className="sr-only">
              Zmień tytuł sesji
            </label>
            <input
              id={`rename-session-input-${session.id}`}
              name="sessionRename"
              aria-label="Zmień tytuł sesji"
              ref={inputRef}
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-slate-900 border border-cyan-500/60 rounded px-1.5 py-0.5 text-xs text-slate-100 focus:outline-none"
            />
            <button
              onClick={handleSaveRename}
              className="p-0.5 text-emerald-400 hover:text-emerald-300"
              title="Zapisz"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setEditTitle(session.title);
                setIsEditing(false);
              }}
              className="p-0.5 text-slate-400 hover:text-slate-300"
              title="Anuluj"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <span
            className="truncate select-none text-xs font-medium"
            title={session.title}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
          >
            {session.title}
          </span>
        )}
      </div>

      {/* Message Count & Actions */}
      {!isEditing && (
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {session.message_count !== undefined && session.message_count > 0 && (
            <span className="text-[10px] text-slate-500 group-hover:text-slate-400 px-1 py-0.2 bg-slate-800/80 rounded-full">
              {session.message_count}
            </span>
          )}

          <div className="relative" ref={menuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 rounded transition-opacity"
              title="Więcej opcji"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>

            {/* Context Menu Dropdown */}
            {showMenu && (
              <div
                className="absolute right-0 top-full mt-1 w-48 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl py-1 z-50 text-xs text-slate-200 divide-y divide-slate-800"
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
                      onTogglePin(session.id, !session.is_pinned);
                      setShowMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 hover:text-cyan-300 text-left transition-colors"
                  >
                    {session.is_pinned ? (
                      <>
                        <PinOff className="w-3.5 h-3.5" />
                        <span>Odepnij</span>
                      </>
                    ) : (
                      <>
                        <Pin className="w-3.5 h-3.5" />
                        <span>Przypnij na górze</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      onToggleArchive(session.id, !session.is_archived);
                      setShowMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 hover:text-amber-300 text-left transition-colors"
                  >
                    {session.is_archived ? (
                      <>
                        <ArchiveRestore className="w-3.5 h-3.5" />
                        <span>Przywróć z archiwum</span>
                      </>
                    ) : (
                      <>
                        <Archive className="w-3.5 h-3.5" />
                        <span>Zarchiwizuj</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Move to folder */}
                {folders.length > 0 && (
                  <div className="py-1">
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <FolderInput className="w-3 h-3" />
                      <span>Przenieś do katalogu</span>
                    </div>
                    {session.folder_id && (
                      <button
                        onClick={() => {
                          onMoveFolder(session.id, null);
                          setShowMenu(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-left"
                      >
                        <span>Bez katalogu</span>
                      </button>
                    )}
                    {folders.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => {
                          onMoveFolder(session.id, f.id);
                          setShowMenu(false);
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-1 hover:bg-slate-800 text-left ${
                          session.folder_id === f.id ? 'text-cyan-400 font-medium' : 'text-slate-300'
                        }`}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: f.color || '#06b6d4' }}
                        />
                        <span className="truncate">{f.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Delete */}
                <div className="py-1">
                  <button
                    onClick={() => {
                      if (confirm(`Czy na pewno chcesz usunąć sesję "${session.title}"? Wiadomości zostaną trwale usunięte.`)) {
                        onDelete(session.id);
                      }
                      setShowMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-rose-950/40 text-rose-400 hover:text-rose-300 text-left transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Usuń sesję</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
