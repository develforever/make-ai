import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { costGuard } from '../services/costGuard.js';
import { openRouterClient } from '../services/openRouter.js';
import { database } from '../db/database.js';

interface SetKeyBody {
  apiKey: string;
}

interface SetLimitBody {
  budgetUsd: number;
}

export async function budgetRoutes(fastify: FastifyInstance) {
  // Pobranie aktualnego stanu budżetu i ostatnich wydatków
  fastify.get('/api/budget', async (_req, reply) => {
    const status = costGuard.getStatus();
    const recentLedger = database.getRecentLedger(15);
    return reply.send({
      ...status,
      ledger: recentLedger
    });
  });

  // Sprawdzenie statusu klucza API (bez ujawniania całego sekretu)
  fastify.get('/api/budget/key-status', async (_req, reply) => {
    const hasKey = openRouterClient.hasApiKey();
    const rawKey = database.getSetting('openrouter_api_key') || process.env.OPENROUTER_API_KEY || '';
    const maskedKey = rawKey.length > 8 
      ? `${rawKey.slice(0, 7)}...${rawKey.slice(-4)}`
      : hasKey ? 'sk-or-***' : '';

    return reply.send({
      hasKey,
      maskedKey
    });
  });

  // Ustawienie klucza OpenRouter API
  fastify.post('/api/budget/key', async (request: FastifyRequest<{ Body: SetKeyBody }>, reply: FastifyReply) => {
    const { apiKey } = request.body || {};

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 5) {
      return reply.status(400).send({ error: 'Nieprawidłowy klucz API OpenRouter' });
    }

    openRouterClient.setApiKey(apiKey.trim());
    database.logOrchestrator('Security', 'set_key', 'success', 'Zaktualizowano klucz API OpenRouter');

    return reply.send({
      success: true,
      message: 'Klucz API OpenRouter został pomyślnie zapisany.'
    });
  });

  // Zmiana limitu budżetu (np. $2.00)
  fastify.post('/api/budget/limit', async (request: FastifyRequest<{ Body: SetLimitBody }>, reply: FastifyReply) => {
    const { budgetUsd } = request.body || {};

    if (typeof budgetUsd !== 'number' || budgetUsd <= 0) {
      return reply.status(400).send({ error: 'Wartość budżetu musi być liczbą dodatnią' });
    }

    costGuard.setBudget(budgetUsd);
    database.logOrchestrator('Budget', 'set_limit', 'success', `Zmieniono limit budżetu na $${budgetUsd} USD`);

    return reply.send({
      success: true,
      newLimitUsd: budgetUsd
    });
  });
}
