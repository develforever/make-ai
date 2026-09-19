import React, { useEffect, useRef } from 'react';
import { MessageSquare, Pin } from 'lucide-react';
import type { ChatSession } from '../../types';

interface SessionMentionPopoverProps {
  isOpen: boolean;
  sessions: ChatSession[];
  activeSessionId: string;
  filterText: string;
  onSelect: (session: ChatSession) => void;
  onClose: () => void;
}

export const SessionMentionPopover: React.FC<SessionMentionPopoverProps> = ({
  isOpen,
  sessions,
  activeSessionId,
  filterText,
  onSelect,
  onClose
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filtered = sessions.filter(
    (s) =>
      s.id !== activeSessionId &&
      !s.is_archived &&
      (filterText ? s.title.toLowerCase().includes(filterText.toLowerCase()) : true)
  );

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full mb-2 left-0 w-80 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl z-50 overflow-hidden divide-y divide-slate-800 text-xs animate-in fade-in slide-in-from-bottom-2 duration-150"
    >
      <div className="p-2 bg-slate-950/80 text-[11px] font-semibold text-cyan-400 flex items-center justify-between">
        <span>Odwołaj się do innej rozmowy (@)</span>
        <span className="text-slate-500 font-normal">Wybierz sesję</span>
      </div>

      <div className="max-h-56 overflow-y-auto divide-y divide-slate-850 p-1 space-y-0.5">
        {filtered.length === 0 ? (
          <div className="p-3 text-center text-slate-500 italic">
            Brak innych sesji do połączenia
          </div>
        ) : (
          filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s)}
              className="w-full flex items-center gap-2 p-2 hover:bg-slate-800/80 rounded-xl text-left transition-colors group"
            >
              {s.is_pinned ? (
                <Pin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              ) : (
                <MessageSquare className="w-3.5 h-3.5 text-slate-500 group-hover:text-cyan-400 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-200 group-hover:text-cyan-300 truncate">
                  {s.title}
                </div>
                {s.last_message_preview && (
                  <div className="text-[10px] text-slate-500 truncate mt-0.5">
                    {s.last_message_preview}
                  </div>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
