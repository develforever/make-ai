import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { orchestrator } from '../orchestrator/engine.js';
import { openRouterClient } from '../services/openRouter.js';

interface ChatRequestBody {
  message: string;
  sessionId?: string;
  referencedSessionIds?: string[];
}

export async function chatRoutes(fastify: FastifyInstance) {
  fastify.post('/api/chat', async (request: FastifyRequest<{ Body: ChatRequestBody }>, reply: FastifyReply) => {
    const { message, sessionId = 'default', referencedSessionIds = [] } = request.body || {};

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return reply.status(400).send({ error: 'Wiadomość nie może być pusta' });
    }

    if (!openRouterClient.hasApiKey()) {
      return reply.status(400).send({
        error: 'Brak klucza OpenRouter API. Skonfiguruj klucz w ustawieniach aplikacji.'
      });
    }

    // Przejmij kontrolę nad odpowiedzią przed rozpoczęciem SSE
    reply.hijack();

    try {
      const turn = await orchestrator.handleUserMessage(message, sessionId, referencedSessionIds);

      // Konfiguracja nagłówków Server-Sent Events (SSE)
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // 1. Jeśli pobrano kontekst z Wikipedii, wyślij zdarzenie do klienta
      if (turn.wikiContext && turn.wikiContext.found) {
        reply.raw.write(`event: wiki\ndata: ${JSON.stringify(turn.wikiContext)}\n\n`);
      }

      let fullGeneratedText = '';

      // 2. Strumieniowanie tokenów odpowiedzi
      for await (const chunkData of turn.stream) {
        if (chunkData.chunk) {
          fullGeneratedText += chunkData.chunk;
          reply.raw.write(`event: delta\ndata: ${JSON.stringify({ chunk: chunkData.chunk })}\n\n`);
        }

        if (chunkData.done && chunkData.usage) {
          reply.raw.write(`event: usage\ndata: ${JSON.stringify(chunkData.usage)}\n\n`);
        }
      }

      // 3. Po zakończeniu strumieniowania uruchom w tle MemoryWorker i prześlij nowo nauczone fakty
      turn.onComplete(fullGeneratedText).then((learnedFacts) => {
        if (learnedFacts && learnedFacts.length > 0) {
          reply.raw.write(`event: learned\ndata: ${JSON.stringify(learnedFacts)}\n\n`);
        }
        reply.raw.write(`event: done\ndata: {}\n\n`);
        reply.raw.end();
      }).catch((err) => {
        console.error('[ChatRoute] Błąd onComplete:', err);
        reply.raw.write(`event: done\ndata: {}\n\n`);
        reply.raw.end();
      });

    } catch (err: any) {
      console.error('[ChatRoute] Błąd orkiestracji:', err);
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        reply.raw.end(JSON.stringify({ error: err.message || 'Wewnętrzny błąd serwera' }));
      } else {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
        reply.raw.end();
      }
    }
  });
}
