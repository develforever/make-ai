import { browserStore } from './storage';
import { CLIENT_SUPPORTED_MODELS, DEFAULT_CLIENT_CONFIG } from './config';
import type { BudgetStatus } from '../types';

export class BrowserCostGuardService {
  public calculateCost(modelId: string, promptTokens: number, completionTokens: number): number {
    const model = CLIENT_SUPPORTED_MODELS[modelId] || CLIENT_SUPPORTED_MODELS[DEFAULT_CLIENT_CONFIG.DEFAULT_CHAT_MODEL];
    const promptCost = (promptTokens / 1_000_000) * (model?.promptPricePerMillion ?? 0.30);
    const completionCost = (completionTokens / 1_000_000) * (model?.completionPricePerMillion ?? 2.50);
    return Number((promptCost + completionCost).toFixed(6));
  }

  public async getStatus(): Promise<BudgetStatus> {
    const rawBudget = await browserStore.getSetting('total_budget_usd');
    const totalBudgetUsd = rawBudget ? parseFloat(rawBudget) : DEFAULT_CLIENT_CONFIG.TOTAL_BUDGET_USD;

    const summary = await browserStore.getBudgetSummary();
    const totalSpentUsd = Number(summary.totalSpentUsd.toFixed(6));
    const remainingBudgetUsd = Math.max(0, Number((totalBudgetUsd - totalSpentUsd).toFixed(6)));
    const percentageUsed = totalBudgetUsd > 0 ? Math.min(100, (totalSpentUsd / totalBudgetUsd) * 100) : 100;

    const canProceed = remainingBudgetUsd > DEFAULT_CLIENT_CONFIG.SAFETY_MARGIN_USD;
    const avgCostPerTurn = 0.0003;
    const estimatedMessagesLeft = Math.floor(remainingBudgetUsd / avgCostPerTurn);

    return {
      totalBudgetUsd,
      totalSpentUsd,
      remainingBudgetUsd,
      totalTokens: summary.totalTokens,
      percentageUsed: Number(percentageUsed.toFixed(2)),
      canProceed,
      estimatedMessagesLeft,
      ledger: summary.ledger
    };
  }

  public async registerUsage(
    modelId: string,
    promptTokens: number,
    completionTokens: number,
    purpose: string
  ): Promise<number> {
    const cost = this.calculateCost(modelId, promptTokens, completionTokens);
    await browserStore.logBudgetUsage(modelId, promptTokens, completionTokens, cost, purpose);
    return cost;
  }

  public async setBudget(newBudget: number): Promise<void> {
    await browserStore.setSetting('total_budget_usd', newBudget.toString());
  }
}

export const browserCostGuard = new BrowserCostGuardService();
