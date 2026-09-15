import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

export interface ModelPricing {
  id: string;
  name: string;
  promptPricePerMillion: number;    // USD
  completionPricePerMillion: number; // USD
  contextLength: number;
  recommendedRole: 'chat' | 'extraction' | 'balanced';
}

export const SUPPORTED_MODELS: Record<string, ModelPricing> = {
  'google/gemini-2.5-flash': {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    promptPricePerMillion: 0.30,
    completionPricePerMillion: 2.50,
    contextLength: 1048576,
    recommendedRole: 'chat'
  },
  'google/gemini-2.5-flash-lite': {
    id: 'google/gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite (Super-Tani)',
    promptPricePerMillion: 0.10,
    completionPricePerMillion: 0.40,
    contextLength: 1048576,
    recommendedRole: 'extraction'
  },
  'deepseek/deepseek-chat': {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    promptPricePerMillion: 0.26,
    completionPricePerMillion: 1.03,
    contextLength: 163840,
    recommendedRole: 'chat'
  },
  'meta-llama/llama-3.3-70b-instruct': {
    id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B Instruct',
    promptPricePerMillion: 0.10,
    completionPricePerMillion: 0.32,
    contextLength: 131072,
    recommendedRole: 'balanced'
  }
};

export const DEFAULT_CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
  DEFAULT_CHAT_MODEL: 'google/gemini-2.5-flash',
  DEFAULT_EXTRACTION_MODEL: 'google/gemini-2.5-flash-lite',
  TOTAL_BUDGET_USD: 2.00,
  SAFETY_MARGIN_USD: 0.01,
  AGENT_NAME: 'Aura',
  DB_PATH: path.resolve(process.cwd(), 'data', 'make_ai.sqlite')
};
