export interface Message {
  id?: number;
  session_id?: string;
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

export interface ChatFolder {
  id: string;
  name: string;
  created_at: string;
  updated_at?: string;
  color?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  folder_id: string | null;
  is_pinned: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  summary?: string | null;
  message_count?: number;
  last_message_preview?: string;
}

export interface SearchMatch {
  messageId?: number;
  content: string;
  role: string;
  timestamp: string;
  snippet: string;
}

export interface SearchResult {
  session: ChatSession;
  matches: SearchMatch[];
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

export interface SplineProfile {
  expert_id: number | string;
  title: string;
  x: number[];
  y: number[];
  in_features: number;
  out_features: number;
  grid_size: number;
}

export interface SOMPrototype {
  expert_id: number;
  name: string;
  x: number;
  y: number;
  norm: number;
}

export interface KANTelemetry {
  status: string;
  architecture: string;
  activation_function: string;
  spline_degree: number;
  grid_size: number;
  model_summary: {
    total_parameters: number;
    trainable_parameters: number;
    kan_spline_parameters: number;
    hidden_dimension: number;
    num_experts: number;
  };
  som_topological_map: SOMPrototype[];
  spline_profiles: SplineProfile[];
  fisher_diagnostics: {
    status: string;
    mean_rigidity: number;
    max_rigidity: number;
    min_rigidity: number;
    histogram: number[];
  };
  distillation_metrics: {
    initial_loss: number;
    final_loss: number;
    loss_history: number[];
  };
}

