import Fastify from 'fastify';
import cors from '@fastify/cors';
import { DEFAULT_CONFIG } from './config.js';
import { chatRoutes } from './routes/chat.js';
import { memoryRoutes } from './routes/memory.js';
import { budgetRoutes } from './routes/budget.js';
import { orchestratorRoutes } from './routes/orchestrator.js';
import { database } from './db/database.js';
import { costGuard } from './services/costGuard.js';

const fastify = Fastify({
  logger: {
    level: 'info'
  }
});

async function main() {
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  // Rejestracja tras API
  await fastify.register(chatRoutes);
  await fastify.register(memoryRoutes);
  await fastify.register(budgetRoutes);
  await fastify.register(orchestratorRoutes);

  // Health check
  fastify.get('/api/health', async () => {
    const budget = costGuard.getStatus();
    return {
      status: 'ok',
      agent: database.getSetting('agent_name'),
      budget,
      timestamp: new Date().toISOString()
    };
  });

  // KAN Neural Core Telemetry
  fastify.get('/api/neural/telemetry', async (_req, reply) => {
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const candidatePaths = [
        path.resolve(process.cwd(), 'neural-core', 'kan_telemetry.json'),
        path.resolve(process.cwd(), '..', 'neural-core', 'kan_telemetry.json'),
        path.resolve(process.cwd(), 'client', 'public', 'kan_telemetry.json'),
        path.resolve(process.cwd(), '..', 'client', 'public', 'kan_telemetry.json')
      ];

      for (const p of candidatePaths) {
        try {
          const content = await fs.readFile(p, 'utf-8');
          return JSON.parse(content);
        } catch {}
      }
      return reply.status(404).send({ error: 'Brak wygenerowanej telemetrii KAN' });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  const port = DEFAULT_CONFIG.PORT;
  const host = '0.0.0.0';

  try {
    await fastify.listen({ port, host });
    console.log(`\n======================================================`);
    console.log(`🚀 MakeAI Cognitive Orchestrator uruchomiony na:`);
    console.log(`   http://localhost:${port}`);
    console.log(`   Agent: ${database.getSetting('agent_name')}`);
    console.log(`   Budżet: $${costGuard.getStatus().remainingBudgetUsd} USD / $${costGuard.getStatus().totalBudgetUsd} USD`);
    console.log(`======================================================\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
