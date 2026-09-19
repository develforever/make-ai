import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { database } from '../db/database.js';

export async function sessionRoutes(fastify: FastifyInstance) {
  // === Folders ===
  fastify.get('/api/folders', async () => {
    const folders = database.getFolders();
    return { folders };
  });

  fastify.post('/api/folders', async (request: FastifyRequest<{
    Body: { name: string; color?: string; id?: string };
  }>, reply: FastifyReply) => {
    const { name, color, id } = request.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return reply.status(400).send({ error: 'Nazwa katalogu jest wymagana' });
    }
    const folderId = database.saveFolder(name.trim(), color, id);
    return { success: true, id: folderId, name: name.trim(), color };
  });

  fastify.delete('/api/folders/:id', async (request: FastifyRequest<{
    Params: { id: string };
  }>) => {
    const { id } = request.params;
    database.deleteFolder(id);
    return { success: true, message: `Katalog ${id} został usunięty` };
  });

  // === Sessions ===
  fastify.get('/api/sessions', async (request: FastifyRequest<{
    Querystring: { includeArchived?: string; folderId?: string };
  }>) => {
    const includeArchived = request.query.includeArchived === 'true' || request.query.includeArchived === '1';
    const folderId = request.query.folderId !== undefined ? request.query.folderId : undefined;
    const sessions = database.getSessions({
      includeArchived,
      folderId: folderId === 'null' ? null : folderId
    });
    return { sessions };
  });

  fastify.post('/api/sessions', async (request: FastifyRequest<{
    Body: { title?: string; folder_id?: string | null; id?: string };
  }>) => {
    const { title, folder_id, id } = request.body || {};
    const sessionId = database.createSession(title, folder_id, id);
    const session = database.getSession(sessionId);
    return { success: true, session };
  });

  fastify.get('/api/sessions/:id', async (request: FastifyRequest<{
    Params: { id: string };
  }>, reply: FastifyReply) => {
    const { id } = request.params;
    const session = database.getSession(id);
    if (!session) {
      return reply.status(404).send({ error: 'Sesja nie została znaleziona' });
    }
    return { session };
  });

  fastify.patch('/api/sessions/:id', async (request: FastifyRequest<{
    Params: { id: string };
    Body: {
      title?: string;
      folder_id?: string | null;
      is_pinned?: boolean | number;
      is_archived?: boolean | number;
      summary?: string;
    };
  }>, reply: FastifyReply) => {
    const { id } = request.params;
    const current = database.getSession(id);
    if (!current) {
      return reply.status(404).send({ error: 'Sesja nie została znaleziona' });
    }
    database.updateSession(id, request.body || {});
    const updated = database.getSession(id);
    return { success: true, session: updated };
  });

  fastify.delete('/api/sessions/:id', async (request: FastifyRequest<{
    Params: { id: string };
  }>) => {
    const { id } = request.params;
    database.deleteSession(id);
    return { success: true, message: `Sesja ${id} i powiązane wiadomości zostały trwale usunięte` };
  });

  // Messages per session
  fastify.get('/api/sessions/:id/messages', async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>) => {
    const { id } = request.params;
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
    const messages = database.getRecentMessages(limit, id);
    return { messages };
  });

  fastify.delete('/api/sessions/:id/messages', async (request: FastifyRequest<{
    Params: { id: string };
  }>) => {
    const { id } = request.params;
    database.clearConversations(id);
    return { success: true, message: `Historia sesji ${id} została wyczyszczona` };
  });

  // === Global Search ===
  fastify.get('/api/search', async (request: FastifyRequest<{
    Querystring: { q: string };
  }>, reply: FastifyReply) => {
    const query = request.query.q;
    if (!query || typeof query !== 'string' || !query.trim()) {
      return reply.status(400).send({ error: 'Parametr zapytania q jest wymagany' });
    }
    const results = database.searchAllSessions(query.trim());
    return { query: query.trim(), results };
  });
}
