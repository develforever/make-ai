import { database } from '../db/database.js';
import { SUPPORTED_MODELS, DEFAULT_CONFIG } from '../config.js';

export interface BudgetStatus {
  totalBudgetUsd: number;
  totalSpentUsd: number;
  remainingBudgetUsd: number;
  totalTokens: number;
  percentageUsed: number;
  canProceed: boolean;
  estimatedMessagesLeft: number;
}

export class CostGuardService {
  public calculateCost(modelId: string, promptTokens: number, completionTokens: number): number {
    const model = SUPPORTED_MODELS[modelId] || SUPPORTED_MODELS[DEFAULT_CONFIG.DEFAULT_CHAT_MODEL];
    const promptCost = (promptTokens / 1_000_000) * model.promptPricePerMillion;
    const completionCost = (completionTokens / 1_000_000) * model.completionPricePerMillion;
    return Number((promptCost + completionCost).toFixed(6));
  }

  public async getStatus(): Promise<BudgetStatus> {
    const rawBudget = await database.getSetting('total_budget_usd');
    const totalBudgetUsd = rawBudget ? parseFloat(rawBudget) : DEFAULT_CONFIG.TOTAL_BUDGET_USD;

    const summary = await database.getBudgetSummary();
    const totalSpentUsd = Number(summary.totalSpentUsd.toFixed(6));
    const remainingBudgetUsd = Math.max(0, Number((totalBudgetUsd - totalSpentUsd).toFixed(6)));
    const percentageUsed = totalBudgetUsd > 0 ? Math.min(100, (totalSpentUsd / totalBudgetUsd) * 100) : 100;

    // Bezpiecznik: jeśli zostało mniej niż $0.005, blokujemy dalsze płatne zapytania
    const canProceed = remainingBudgetUsd > DEFAULT_CONFIG.SAFETY_MARGIN_USD;

    // Szacunkowa liczba wiadomości przy średnim koszcie $0.0003 za wymianę zdań na Gemini 2.0 Flash
    const avgCostPerTurn = 0.0003;
    const estimatedMessagesLeft = Math.floor(remainingBudgetUsd / avgCostPerTurn);

    return {
      totalBudgetUsd,
      totalSpentUsd,
      remainingBudgetUsd,
      totalTokens: summary.totalTokens,
      percentageUsed: Number(percentageUsed.toFixed(2)),
      canProceed,
      estimatedMessagesLeft
    };
  }

  public async registerUsage(modelId: string, promptTokens: number, completionTokens: number, purpose: string): Promise<number> {
    const cost = this.calculateCost(modelId, promptTokens, completionTokens);
    await database.logBudgetUsage(modelId, promptTokens, completionTokens, cost, purpose);
    return cost;
  }

  public async setBudget(newBudget: number): Promise<void> {
    await database.setSetting('total_budget_usd', newBudget.toString());
  }
}

export const costGuard = new CostGuardService();
