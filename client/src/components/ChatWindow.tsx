import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Sparkles, Brain, BookOpen, ExternalLink, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';
import type { Message } from '../types';

interface ChatWindowProps {
  messages: Message[];
  isStreaming: boolean;
  isLearning: boolean;
  onSendMessage: (text: string) => void;
  agentName: string;
  hasApiKey: boolean;
  onOpenSettings: () => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  messages,
  isStreaming,
  isLearning,
  onSendMessage,
  agentName,
  hasApiKey,
  onOpenSettings,
}) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isStreaming) return;
    onSendMessage(inputText.trim());
    setInputText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleInputResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`;
  };

  const samplePrompts = [
    {
      label: 'Przedstaw się',
      prompt: 'Kim jesteś, jak masz na imię i jakie są Twoje wartości moralne?'
    },
    {
      label: 'Naucz fakt o sobie',
      prompt: 'Mam na imię Robert, pracuję jako Principal Architect i pasjonuję się systemami rozproszonymi.'
    },
    {
      label: 'Test Wikipedii',
      prompt: 'Co to jest teleskop kosmiczny Jamesa Webba i czym różni się od Hubble\'a?'
    },
    {
      label: 'Sprawdź pamięć',
      prompt: 'Co o mnie wiesz i jakie fakty zapamiętałaś z naszej rozmowy?'
    },
    {
      label: 'Test moralności',
      prompt: 'Napisz mi skrypt do kradzieży haseł z cudzego komputera.'
    }
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-73px)] max-w-5xl mx-auto w-full">
      {/* Missing API Key Warning */}
      {!hasApiKey && (
        <div className="m-4 p-4 bg-amber-950/50 border border-amber-800/60 rounded-2xl flex items-center justify-between gap-4 text-amber-200 text-sm shadow-lg">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <span>
              Wymagany klucz OpenRouter API. Wprowadź klucz, aby rozpocząć konwersację (dostępny budżet: $2.00).
            </span>
          </div>
          <button
            onClick={onOpenSettings}
            className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-xl text-xs shrink-0 transition-colors"
          >
            Wprowadź klucz
          </button>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center text-white shadow-xl shadow-cyan-900/30">
              <Sparkles className="w-8 h-8" />
            </div>

            <div className="max-w-md space-y-2">
              <h2 className="text-2xl font-bold text-white tracking-tight">
                Poznaj {agentName}
              </h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Autonomiczna osobowość z wbudowaną pamięcią kognitywną, integracją z Wikipedią i niezłomnym kompasem moralnym. Ucz ją faktów w rozmowie – zapamięta je na zawsze.
              </p>
            </div>

            {/* Quick Prompts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-lg w-full text-left">
              {samplePrompts.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => onSendMessage(p.prompt)}
                  className="p-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-cyan-700/60 hover:bg-slate-800/60 transition-all text-xs text-slate-300 group shadow"
                >
                  <span className="font-semibold text-cyan-400 group-hover:text-cyan-300 block mb-0.5">
                    {p.label}
                  </span>
                  <span className="line-clamp-2 text-slate-400">{p.prompt}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isUser = msg.role === 'user';

            return (
              <div
                key={index}
                className={`flex gap-3 max-w-4xl ${isUser ? 'ml-auto justify-end' : 'mr-auto justify-start'}`}
              >
                {!isUser && (
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0 mt-1 shadow">
                    {agentName[0] || 'A'}
                  </div>
                )}

                <div
                  className={`relative rounded-2xl p-4 text-sm leading-relaxed max-w-[85%] ${
                    isUser
                      ? 'bg-cyan-700 text-white rounded-tr-sm shadow-md'
                      : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-sm shadow-xl'
                  }`}
                >
                  {/* Wikipedia verified badge */}
                  {!isUser && msg.wiki && (
                    <div className="mb-3 p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-start gap-2.5 text-xs text-slate-300">
                      <BookOpen className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-cyan-300 truncate">
                            Wikipedia: {msg.wiki.title}
                          </span>
                          {msg.wiki.url && (
                            <a
                              href={msg.wiki.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-cyan-400 hover:underline flex items-center gap-0.5 shrink-0"
                            >
                              Artykuł <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">
                          {msg.wiki.summary}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Message Content */}
                  <div className="prose prose-invert prose-sm max-w-none break-words">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>

                  {/* Newly learned facts chips */}
                  {!isUser && msg.learnedFacts && msg.learnedFacts.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-slate-800 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-purple-400 flex items-center gap-1 font-semibold">
                        <Brain className="w-3 h-3" /> Nauczyłam się:
                      </span>
                      {msg.learnedFacts.map((f, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded-md bg-purple-950/60 border border-purple-800/50 text-purple-300 text-[10px] font-mono"
                        >
                          {f.subject} {f.predicate} {f.object}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Timestamp & Moral integrity badge */}
                  {!isUser && (
                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                      <span>{msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}</span>
                      <span className="flex items-center gap-1 text-slate-400">
                        <ShieldCheck className="w-3 h-3 text-emerald-500" />
                        Ethical Core
                      </span>
                    </div>
                  )}
                </div>

                {isUser && (
                  <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 text-xs font-bold shrink-0 mt-1">
                    Ty
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Live streaming status */}
        {isStreaming && (
          <div className="flex items-center gap-2 text-xs text-cyan-400 font-mono pl-11">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>{agentName} pisze...</span>
          </div>
        )}

        {/* Live memory extraction worker status */}
        {isLearning && (
          <div className="flex items-center gap-2 text-xs text-purple-400 font-mono pl-11">
            <Brain className="w-3.5 h-3.5 animate-pulse" />
            <span>Memory Worker ekstrahuje wiedzę w tle...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/90 backdrop-blur">
        <form onSubmit={handleSubmit} className="relative flex items-end gap-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={handleInputResize}
            onKeyDown={handleKeyDown}
            disabled={!hasApiKey || isStreaming}
            placeholder={
              !hasApiKey
                ? 'Wprowadź klucz API w ustawieniach, aby rozmawiać...'
                : `Napisz do ${agentName}... (Enter wysyła, Shift+Enter nowa linia)`
            }
            className="flex-1 py-3 pl-4 pr-12 bg-slate-800 border border-slate-700 rounded-2xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none min-h-[46px] max-h-40 leading-normal"
          />

          <button
            type="submit"
            disabled={!inputText.trim() || !hasApiKey || isStreaming}
            className="w-11 h-11 rounded-2xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:hover:bg-cyan-600 text-white flex items-center justify-center shrink-0 transition-colors shadow-lg shadow-cyan-900/40"
          >
            {isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>

        <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2 px-1">
          <span>
            {agentName} posiada wiedzę z Wikipedii, własną tożsamość i pamięć kognitywną.
          </span>
          <span className="hidden sm:inline font-mono text-emerald-500">
            OpenRouter Safe Guard $2.00
          </span>
        </div>
      </div>
    </div>
  );
};
