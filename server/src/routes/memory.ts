import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { database } from '../db/database.js';

interface TeachFactBody {
  category?: string;
  subject: string;
  predicate: string;
  object: string;
  embedding?: number[];
}

interface VectorSearchBody {
  vector: number[];
  topK?: number;
  minConfidence?: number;
}

export async function memoryRoutes(fastify: FastifyInstance) {
  // Pobranie listy zapamiętanych faktów
  fastify.get('/api/memory', async (_req, reply) => {
    const facts = await database.getActiveLearnedFacts(100);
    return reply.send({
      count: facts.length,
      facts
    });
  });

  // Wyszukiwanie semantyczne wektorowe faktów
  fastify.post('/api/memory/search-vector', async (request: FastifyRequest<{ Body: VectorSearchBody }>, reply: FastifyReply) => {
    const { vector, topK = 10, minConfidence = 0.0 } = request.body || {};
    if (!vector || !Array.isArray(vector)) {
      return reply.status(400).send({ error: 'Wymagany parametr wektora: vector (tablica liczb)' });
    }
    const results = await database.searchFactsByVector(vector, topK, minConfidence);
    return reply.send({
      count: results.length,
      results
    });
  });

  // Ręczne nauczenie modelu nowego faktu (np. przez UI "Naucz model")
  fastify.post('/api/memory/teach', async (request: FastifyRequest<{ Body: TeachFactBody }>, reply: FastifyReply) => {
    const { category, subject, predicate, object, embedding } = request.body || {};

    if (!subject || !predicate || !object) {
      return reply.status(400).send({ error: 'Pola subject, predicate i object są wymagane' });
    }

    const factId = await database.saveLearnedFact(
      category || 'user_taught',
      subject.trim(),
      predicate.trim(),
      object.trim(),
      1.0,
      undefined,
      embedding
    );

    await database.logOrchestrator(
      'ManualTeacher',
      'teach_fact',
      'success',
      `Użytkownik nauczył model: ${subject} ${predicate} ${object}`
    );

    return reply.send({
      success: true,
      factId,
      message: `Pomyślnie nauczono model: "${subject} ${predicate} ${object}"`
    });
  });

  // Usunięcie faktu
  fastify.delete('/api/memory/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      return reply.status(400).send({ error: 'Nieprawidłowe ID faktu' });
    }

    await database.deleteFact(id);
    await database.logOrchestrator('Memory', 'delete_fact', 'success', `Usunięto fakt #${id}`);
    return reply.send({ success: true, message: `Fakt #${id} został usunięty z pamięci` });
  });

  // Wyczyszczenie całej pamięci douczania
  fastify.post('/api/memory/clear', async (_req, reply) => {
    await database.clearAllFacts();
    await database.logOrchestrator('Memory', 'clear_facts', 'success', 'Wyczyszczono wszystkie zapamiętane fakty');
    return reply.send({ success: true, message: 'Pamięć została całkowicie zresetowana' });
  });
}
