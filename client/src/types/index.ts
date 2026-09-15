export interface Message {
  id?: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  model?: string;
  wiki?: {
    title: string;
    summary: string;
    url: string;
    thumbnailUrl?: string;
  };
  learnedFacts?: ExtractedFact[];
}

export interface ExtractedFact {
  id?: number;
  category: 'user_profile' | 'world_knowledge' | 'correction' | 'preference' | string;
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  created_at?: string;
  is_active?: number;
}

export interface BudgetStatus {
  totalBudgetUsd: number;
  totalSpentUsd: number;
  remainingBudgetUsd: number;
  totalTokens: number;
  percentageUsed: number;
  canProceed: boolean;
  estimatedMessagesLeft: number;
  ledger?: any[];
}

export interface KeyStatus {
  hasKey: boolean;
  maskedKey: string;
}

export interface ModelOption {
  id: string;
  name: string;
  promptPricePerMillion: number;
  completionPricePerMillion: number;
  contextLength: number;
  recommendedRole: 'chat' | 'extraction' | 'balanced';
}

export interface OrchestratorStatus {
  isPaused: boolean;
  agentName: string;
  chatModel: string;
  extractionModel: string;
  supportedModels: ModelOption[];
  logs: any[];
}
