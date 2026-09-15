import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { orchestrator } from '../orchestrator/engine.js';
import { database } from '../db/database.js';
import { SUPPORTED_MODELS, DEFAULT_CONFIG } from '../config.js';
import { wikipediaService } from '../services/wikipedia.js';

interface PauseBody {
  paused: boolean;
}

interface SettingsBody {
  agentName?: string;
  chatModel?: string;
  extractionModel?: string;
}

export async function orchestratorRoutes(fastify: FastifyInstance) {
  // Status orkiestratora i workerów
  fastify.get('/api/orchestrator/status', async (_req, reply) => {
    const isPaused = orchestrator.isPaused();
    const agentName = database.getSetting('agent_name') || DEFAULT_CONFIG.AGENT_NAME;
    const chatModel = database.getSetting('chat_model') || DEFAULT_CONFIG.DEFAULT_CHAT_MODEL;
    const extractionModel = database.getSetting('extraction_model') || DEFAULT_CONFIG.DEFAULT_EXTRACTION_MODEL;
    const logs = database.getRecentLogs(20);

    return reply.send({
      isPaused,
      agentName,
      chatModel,
      extractionModel,
      supportedModels: Object.values(SUPPORTED_MODELS),
      logs
    });
  });

  // Pauza / wznowienie pętli workerów
  fastify.post('/api/orchestrator/pause', async (request: FastifyRequest<{ Body: PauseBody }>, reply: FastifyReply) => {
    const { paused } = request.body || {};
    orchestrator.setPaused(!!paused);
    return reply.send({
      success: true,
      isPaused: orchestrator.isPaused()
    });
  });

  // Aktualizacja ustawień agenta i modeli
  fastify.post('/api/orchestrator/settings', async (request: FastifyRequest<{ Body: SettingsBody }>, reply: FastifyReply) => {
    const { agentName, chatModel, extractionModel } = request.body || {};

    if (agentName && typeof agentName === 'string') {
      database.setSetting('agent_name', agentName.trim());
    }
    if (chatModel && typeof chatModel === 'string' && SUPPORTED_MODELS[chatModel]) {
      database.setSetting('chat_model', chatModel);
    }
    if (extractionModel && typeof extractionModel === 'string' && SUPPORTED_MODELS[extractionModel]) {
      database.setSetting('extraction_model', extractionModel);
    }

    database.logOrchestrator('Settings', 'update_config', 'success', 'Zaktualizowano konfigurację agenta');

    return reply.send({
      success: true,
      agentName: database.getSetting('agent_name'),
      chatModel: database.getSetting('chat_model'),
      extractionModel: database.getSetting('extraction_model')
    });
  });

  // Historia rozmów
  fastify.get('/api/conversations', async (_req, reply) => {
    const messages = database.getRecentMessages(50);
    return reply.send({ messages });
  });

  // Reset historii rozmów
  fastify.post('/api/conversations/clear', async (_req, reply) => {
    database.clearConversations();
    database.logOrchestrator('Chat', 'clear_history', 'success', 'Wyczyszczono historię konwersacji');
    return reply.send({ success: true, message: 'Historia rozmowy została wyczyszczona' });
  });

  // Ręczne przeszukiwanie Wikipedii
  fastify.get('/api/wiki/search', async (request: FastifyRequest<{ Querystring: { q?: string } }>, reply: FastifyReply) => {
    const query = request.query.q;
    if (!query || query.trim().length === 0) {
      return reply.status(400).send({ error: 'Brak parametru zapytania q' });
    }

    const result = await wikipediaService.getSummary(query);
    return reply.send(result);
  });
}
