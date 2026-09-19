import { createClient, Client } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, SUPPORTED_MODELS } from '../config.js';
import { SemanticEncoder } from '../neural/SemanticEncoder.js';
import { DreamConsolidationResult } from '../neural/types.js';

function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA <= 0 || normB <= 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class AppDatabase {
  private _client: Client;
  private initPromise: Promise<void>;

  constructor(url?: string, authToken?: string) {
    const dbUrl = url || DEFAULT_CONFIG.LIBSQL_URL || 'file:data/makeai.db';
    const token = authToken || DEFAULT_CONFIG.LIBSQL_AUTH_TOKEN;

    if (dbUrl.startsWith('file:')) {
      const rawPath = dbUrl.replace(/^file:/, '');
      const dbDir = path.dirname(path.resolve(rawPath));
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
    }

    this._client = createClient({
      url: dbUrl,
      authToken: token
    });

    this.initPromise = this.initSchema(dbUrl);
  }

  public get client(): Client {
    return this._client;
  }

  public async ensureInitialized(): Promise<void> {
    await this.initPromise;
  }

  private async initSchema(dbUrl: string): Promise<void> {
    if (dbUrl.startsWith('file:')) {
      try {
        await this._client.execute('PRAGMA journal_mode = WAL;');
        await this._client.execute('PRAGMA synchronous = NORMAL;');
      } catch {
        // Ignoruj w przypadku braku obsługi pragma
      }
    }

    await this._client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS budget_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        purpose TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        tokens INTEGER DEFAULT 0,
        model TEXT,
        metadata TEXT,
        session_id TEXT DEFAULT 'default'
      );

      CREATE TABLE IF NOT EXISTS learned_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        created_at TEXT NOT NULL,
        source_message_id INTEGER,
        is_active INTEGER DEFAULT 1,
        embedding TEXT,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_facts_active_cat ON learned_facts (is_active, category);
      CREATE INDEX IF NOT EXISTS idx_facts_subject ON learned_facts (subject);
      CREATE INDEX IF NOT EXISTS idx_conv_timestamp ON conversations (timestamp);
      CREATE INDEX IF NOT EXISTS idx_conv_session_time ON conversations (session_id, timestamp);

      CREATE TABLE IF NOT EXISTS consolidated_fact_pairs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fact_a_id INTEGER NOT NULL,
        fact_b_id INTEGER NOT NULL,
        evaluated_at TEXT NOT NULL,
        confidence REAL,
        axiom_id INTEGER,
        UNIQUE (fact_a_id, fact_b_id)
      );

      CREATE INDEX IF NOT EXISTS idx_pairs_ab ON consolidated_fact_pairs (fact_a_id, fact_b_id);

      CREATE TABLE IF NOT EXISTS wiki_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        url TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_wiki_query ON wiki_cache (query);

      CREATE TABLE IF NOT EXISTS orchestrator_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        worker TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        details TEXT
      );

      CREATE TABLE IF NOT EXISTS chat_folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        color TEXT
      );

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        folder_id TEXT,
        is_pinned INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        summary TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_folder ON chat_sessions (folder_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_pinned ON chat_sessions (is_pinned, is_archived);
    `);

    // Migracje kolumn w przypadku istniejących tabel
    try {
      await this._client.execute(`ALTER TABLE learned_facts ADD COLUMN embedding TEXT`);
    } catch {
      // Kolumna embedding już istnieje
    }

    try {
      await this._client.execute(`ALTER TABLE learned_facts ADD COLUMN metadata TEXT`);
    } catch {
      // Kolumna metadata już istnieje
    }

    try {
      await this._client.execute(`ALTER TABLE conversations ADD COLUMN session_id TEXT DEFAULT 'default'`);
    } catch {
      // Kolumna session_id już istnieje
    }

    // Gwarancja istnienia domyślnej sesji bazowej
    const defaultSessionRes = await this._client.execute({
      sql: 'SELECT id FROM chat_sessions WHERE id = ?',
      args: ['default']
    });
    if (defaultSessionRes.rows.length === 0) {
      const now = new Date().toISOString();
      await this._client.execute({
        sql: `INSERT INTO chat_sessions (id, title, folder_id, is_pinned, is_archived, created_at, updated_at)
              VALUES ('default', 'Główna sesja', NULL, 0, 0, ?, ?)`,
        args: [now, now]
      });
    }
    await this._client.execute(`UPDATE conversations SET session_id = 'default' WHERE session_id IS NULL OR session_id = ''`);

    // Inicjalizacja domyślnych ustawień
    const defaults = [
      ['total_budget_usd', DEFAULT_CONFIG.TOTAL_BUDGET_USD.toString()],
      ['agent_name', DEFAULT_CONFIG.AGENT_NAME],
      ['chat_model', DEFAULT_CONFIG.DEFAULT_CHAT_MODEL],
      ['extraction_model', DEFAULT_CONFIG.DEFAULT_EXTRACTION_MODEL],
      ['orchestrator_paused', 'false']
    ];

    for (const [key, val] of defaults) {
      const existingRes = await this._client.execute({
        sql: 'SELECT value FROM settings WHERE key = ?',
        args: [key]
      });
      if (existingRes.rows.length === 0) {
        await this._client.execute({
          sql: 'INSERT INTO settings (key, value) VALUES (?, ?)',
          args: [key, val]
        });
      } else if (key === 'chat_model') {
        const currentModel = existingRes.rows[0].value as string;
        if (!SUPPORTED_MODELS[currentModel]) {
          await this.setSetting('chat_model', DEFAULT_CONFIG.DEFAULT_CHAT_MODEL);
        }
      } else if (key === 'extraction_model') {
        const currentModel = existingRes.rows[0].value as string;
        if (!SUPPORTED_MODELS[currentModel]) {
          await this.setSetting('extraction_model', DEFAULT_CONFIG.DEFAULT_EXTRACTION_MODEL);
        }
      }
    }
  }

  // Settings
  public async getSetting(key: string): Promise<string | null> {
    await this.ensureInitialized();
    const res = await this._client.execute({
      sql: 'SELECT value FROM settings WHERE key = ?',
      args: [key]
    });
    return res.rows.length > 0 ? (res.rows[0].value as string) : null;
  }

  public async setSetting(key: string, value: string): Promise<void> {
    await this.ensureInitialized();
    await this._client.execute({
      sql: `INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: [key, value]
    });
  }

  // Budget
  public async logBudgetUsage(
    model: string,
    promptTokens: number,
    completionTokens: number,
    costUsd: number,
    purpose: string
  ): Promise<void> {
    await this.ensureInitialized();
    const timestamp = new Date().toISOString();
    await this._client.execute({
      sql: `INSERT INTO budget_ledger (timestamp, model, prompt_tokens, completion_tokens, cost_usd, purpose)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [timestamp, model, promptTokens, completionTokens, costUsd, purpose]
    });
  }

  public async getBudgetSummary(): Promise<{ totalSpentUsd: number; totalTokens: number; ledgerCount: number }> {
    await this.ensureInitialized();
    const res = await this._client.execute(`
      SELECT 
        COALESCE(SUM(cost_usd), 0) as totalSpentUsd,
        COALESCE(SUM(prompt_tokens + completion_tokens), 0) as totalTokens,
        COUNT(*) as ledgerCount
      FROM budget_ledger
    `);
    const row = res.rows[0];
    return {
      totalSpentUsd: Number(row.totalSpentUsd ?? 0),
      totalTokens: Number(row.totalTokens ?? 0),
      ledgerCount: Number(row.ledgerCount ?? 0)
    };
  }

  public async getRecentLedger(limit: number = 20): Promise<any[]> {
    await this.ensureInitialized();
    const res = await this._client.execute({
      sql: `SELECT * FROM budget_ledger ORDER BY id DESC LIMIT ?`,
      args: [limit]
    });
    return Array.from(res.rows);
  }

  // Folders
  public async getFolders(): Promise<any[]> {
    await this.ensureInitialized();
    const res = await this._client.execute('SELECT * FROM chat_folders ORDER BY name ASC');
    return Array.from(res.rows);
  }

  public async saveFolder(name: string, color?: string, id?: string): Promise<string> {
    await this.ensureInitialized();
    const folderId = id || `folder_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    await this._client.execute({
      sql: `INSERT INTO chat_folders (id, name, created_at, updated_at, color)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at, color = excluded.color`,
      args: [folderId, name, now, now, color || null]
    });
    return folderId;
  }

  public async deleteFolder(id: string): Promise<void> {
    await this.ensureInitialized();
    await this._client.batch([
      { sql: 'UPDATE chat_sessions SET folder_id = NULL WHERE folder_id = ?', args: [id] },
      { sql: 'DELETE FROM chat_folders WHERE id = ?', args: [id] }
    ], 'write');
  }

  // Sessions
  public async getSessions(options?: { includeArchived?: boolean; folderId?: string | null }): Promise<any[]> {
    await this.ensureInitialized();
    let sql = `
      SELECT 
        s.*,
        COUNT(c.id) as message_count,
        (
          SELECT content FROM conversations 
          WHERE session_id = s.id 
          ORDER BY id DESC LIMIT 1
        ) as last_message_preview
      FROM chat_sessions s
      LEFT JOIN conversations c ON c.session_id = s.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (!options?.includeArchived) {
      sql += ' AND s.is_archived = 0';
    }

    if (options?.folderId !== undefined) {
      if (options.folderId === null) {
        sql += ' AND s.folder_id IS NULL';
      } else {
        sql += ' AND s.folder_id = ?';
        params.push(options.folderId);
      }
    }

    sql += ' GROUP BY s.id ORDER BY s.is_pinned DESC, s.updated_at DESC';
    const res = await this._client.execute({ sql, args: params });
    return Array.from(res.rows);
  }

  public async getSession(id: string): Promise<any> {
    await this.ensureInitialized();
    const res = await this._client.execute({
      sql: `SELECT 
              s.*,
              COUNT(c.id) as message_count
            FROM chat_sessions s
            LEFT JOIN conversations c ON c.session_id = s.id
            WHERE s.id = ?
            GROUP BY s.id`,
      args: [id]
    });
    return res.rows.length > 0 ? res.rows[0] : null;
  }

  public async createSession(title?: string, folderId?: string | null, id?: string): Promise<string> {
    await this.ensureInitialized();
    const sessionId = id || `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const sessionTitle = title || 'Nowa rozmowa';
    await this._client.execute({
      sql: `INSERT INTO chat_sessions (id, title, folder_id, is_pinned, is_archived, created_at, updated_at)
            VALUES (?, ?, ?, 0, 0, ?, ?)
            ON CONFLICT(id) DO NOTHING`,
      args: [sessionId, sessionTitle, folderId || null, now, now]
    });
    return sessionId;
  }

  public async reconcileSyncData(payload: {
    folders?: Array<{ id: string; name: string; color?: string }>;
    sessions?: Array<{ id: string; title: string; folder_id?: string | null; is_pinned?: number | boolean; is_archived?: number | boolean }>;
    messages?: Array<{ session_id: string; role: string; content: string; timestamp?: string; model?: string; metadata?: string }>;
  }): Promise<{ folders: any[]; sessions: any[] }> {
    await this.ensureInitialized();
    const { folders = [], sessions = [], messages = [] } = payload;

    for (const f of folders) {
      if (f.id && f.name) {
        await this.saveFolder(f.name, f.color, f.id);
      }
    }

    for (const s of sessions) {
      if (s.id) {
        await this.createSession(s.title, s.folder_id, s.id);
        if (s.is_pinned !== undefined || s.is_archived !== undefined) {
          await this.updateSession(s.id, {
            is_pinned: s.is_pinned,
            is_archived: s.is_archived
          });
        }
      }
    }

    for (const m of messages) {
      if (m.session_id && m.content) {
        const checkRes = await this._client.execute({
          sql: 'SELECT id FROM chat_conversations WHERE session_id = ? AND role = ? AND content = ? LIMIT 1',
          args: [m.session_id, m.role, m.content]
        });
        if (checkRes.rows.length === 0) {
          await this._client.execute({
            sql: `INSERT INTO chat_conversations (session_id, role, content, timestamp, tokens, model, metadata)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: [
              m.session_id,
              m.role,
              m.content,
              m.timestamp || new Date().toISOString(),
              0,
              m.model || null,
              m.metadata || null
            ]
          });
        }
      }
    }

    const allFolders = await this.getFolders();
    const allSessions = await this.getSessions({ includeArchived: true });
    return { folders: allFolders, sessions: allSessions };
  }

  public async updateSession(
    id: string,
    updates: {
      title?: string;
      folder_id?: string | null;
      is_pinned?: boolean | number;
      is_archived?: boolean | number;
      summary?: string;
    }
  ): Promise<void> {
    await this.ensureInitialized();
    const now = new Date().toISOString();
    const current = await this.getSession(id);
    if (!current) return;

    const title = updates.title !== undefined ? updates.title : current.title;
    const folderId = updates.folder_id !== undefined ? updates.folder_id : current.folder_id;
    const isPinned = updates.is_pinned !== undefined ? (updates.is_pinned ? 1 : 0) : current.is_pinned;
    const isArchived = updates.is_archived !== undefined ? (updates.is_archived ? 1 : 0) : current.is_archived;
    const summary = updates.summary !== undefined ? updates.summary : current.summary;

    await this._client.execute({
      sql: `UPDATE chat_sessions 
            SET title = ?, folder_id = ?, is_pinned = ?, is_archived = ?, summary = ?, updated_at = ?
            WHERE id = ?`,
      args: [title, folderId, isPinned, isArchived, summary, now, id]
    });
  }

  public async deleteSession(id: string): Promise<void> {
    await this.ensureInitialized();
    await this._client.batch([
      { sql: 'DELETE FROM conversations WHERE session_id = ?', args: [id] },
      { sql: 'DELETE FROM chat_sessions WHERE id = ?', args: [id] }
    ], 'write');
  }

  public async touchSession(id: string): Promise<void> {
    await this.ensureInitialized();
    const now = new Date().toISOString();
    await this._client.execute({
      sql: 'UPDATE chat_sessions SET updated_at = ? WHERE id = ?',
      args: [now, id]
    });
  }

  // Conversations (Messages)
  public async saveMessage(
    role: string,
    content: string,
    tokens: number = 0,
    model?: string,
    metadata?: string,
    sessionId: string = 'default'
  ): Promise<number> {
    await this.ensureInitialized();
    const timestamp = new Date().toISOString();
    if (sessionId !== 'default') {
      const existsRes = await this._client.execute({
        sql: 'SELECT id FROM chat_sessions WHERE id = ?',
        args: [sessionId]
      });
      if (existsRes.rows.length === 0) {
        await this.createSession('Nowa rozmowa', null, sessionId);
      }
    }
    const result = await this._client.execute({
      sql: `INSERT INTO conversations (role, content, timestamp, tokens, model, metadata, session_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [role, content, timestamp, tokens, model || null, metadata || null, sessionId]
    });
    await this.touchSession(sessionId);
    return Number(result.lastInsertRowid);
  }

  public async getRecentMessages(limit: number = 30, sessionId: string = 'default'): Promise<any[]> {
    await this.ensureInitialized();
    const res = await this._client.execute({
      sql: `SELECT * FROM conversations WHERE session_id = ? ORDER BY id DESC LIMIT ?`,
      args: [sessionId, limit]
    });
    return Array.from(res.rows).reverse();
  }

  public async getAllSessionMessages(sessionId: string): Promise<any[]> {
    await this.ensureInitialized();
    const res = await this._client.execute({
      sql: `SELECT * FROM conversations WHERE session_id = ? ORDER BY id ASC`,
      args: [sessionId]
    });
    return Array.from(res.rows);
  }

  public async clearConversations(sessionId?: string): Promise<void> {
    await this.ensureInitialized();
    if (sessionId) {
      await this._client.execute({
        sql: 'DELETE FROM conversations WHERE session_id = ?',
        args: [sessionId]
      });
    } else {
      await this._client.execute('DELETE FROM conversations');
    }
  }

  // Global Search across sessions and messages
  public async searchAllSessions(query: string): Promise<any[]> {
    await this.ensureInitialized();
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];

    const likeQuery = `%${trimmed}%`;

    const matchingSessionsRes = await this._client.execute({
      sql: `SELECT s.*, COUNT(c.id) as message_count
            FROM chat_sessions s
            LEFT JOIN conversations c ON c.session_id = s.id
            WHERE LOWER(s.title) LIKE ?
            GROUP BY s.id
            ORDER BY s.updated_at DESC
            LIMIT 20`,
      args: [likeQuery]
    });

    const matchingMessagesRes = await this._client.execute({
      sql: `SELECT c.id, c.session_id, c.role, c.content, c.timestamp, s.title as session_title
            FROM conversations c
            JOIN chat_sessions s ON c.session_id = s.id
            WHERE LOWER(c.content) LIKE ?
            ORDER BY c.id DESC
            LIMIT 50`,
      args: [likeQuery]
    });

    const resultsMap = new Map<string, any>();

    for (const session of matchingSessionsRes.rows) {
      resultsMap.set(session.id as string, {
        session,
        matches: []
      });
    }

    for (const msg of matchingMessagesRes.rows) {
      const sId = msg.session_id as string;
      let entry = resultsMap.get(sId);
      if (!entry) {
        const session = await this.getSession(sId);
        if (session) {
          entry = { session, matches: [] };
          resultsMap.set(sId, entry);
        }
      }
      if (entry) {
        const content = msg.content as string;
        const idx = content.toLowerCase().indexOf(trimmed);
        const start = Math.max(0, idx - 40);
        const end = Math.min(content.length, idx + trimmed.length + 40);
        const snippet = (start > 0 ? '...' : '') + 
          content.substring(start, end) + 
          (end < content.length ? '...' : '');

        entry.matches.push({
          messageId: msg.id,
          content: msg.content,
          role: msg.role,
          timestamp: msg.timestamp,
          snippet
        });
      }
    }

    return Array.from(resultsMap.values());
  }

  // Learned Facts
  public async saveLearnedFact(
    category: string,
    subject: string,
    predicate: string,
    object: string,
    confidence: number = 1.0,
    sourceMessageId?: number,
    embedding?: number[] | Float32Array | string,
    metadata?: string
  ): Promise<number> {
    await this.ensureInitialized();
    const createdAt = new Date().toISOString();
    const embeddingStr = embedding
      ? (typeof embedding === 'string' ? embedding : JSON.stringify(Array.from(embedding)))
      : null;

    // Deaktywuj poprzednie fakty na ten sam temat i relację (korekta wiedzy) w transakcji batch
    const batchRes = await this._client.batch([
      {
        sql: `UPDATE learned_facts 
              SET is_active = 0 
              WHERE is_active = 1 AND LOWER(subject) = LOWER(?) AND LOWER(predicate) = LOWER(?)`,
        args: [subject, predicate]
      },
      {
        sql: `INSERT INTO learned_facts (category, subject, predicate, object, confidence, created_at, source_message_id, is_active, embedding, metadata)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        args: [category, subject, predicate, object, confidence, createdAt, sourceMessageId || null, embeddingStr, metadata || null]
      }
    ], 'write');

    return Number(batchRes[1].lastInsertRowid);
  }

  public async updateFactEmbedding(id: number, embedding: number[] | Float32Array | string): Promise<void> {
    await this.ensureInitialized();
    const embeddingStr = typeof embedding === 'string' ? embedding : JSON.stringify(Array.from(embedding));
    await this._client.execute({
      sql: 'UPDATE learned_facts SET embedding = ? WHERE id = ?',
      args: [embeddingStr, id]
    });
  }

  public async searchFactsByVector(
    queryVector: number[] | Float32Array,
    topK: number = 10,
    minConfidence: number = 0.0
  ): Promise<any[]> {
    await this.ensureInitialized();
    const vecArray = Array.from(queryVector);
    const vecJson = JSON.stringify(vecArray);

    try {
      // Wykorzystaj natywną funkcję libSQL vector_distance_cos
      const res = await this._client.execute({
        sql: `SELECT *, (1.0 - vector_distance_cos(embedding, ?)) AS similarity
              FROM learned_facts
              WHERE is_active = 1 AND confidence >= ? AND embedding IS NOT NULL
              ORDER BY vector_distance_cos(embedding, ?) ASC
              LIMIT ?`,
        args: [vecJson, minConfidence, vecJson, topK]
      });
      return res.rows.map((row) => ({
        ...row,
        similarity: Number(row.similarity)
      }));
    } catch {
      // Fallback: obliczanie cosinusowe w pamięci
      const res = await this._client.execute({
        sql: 'SELECT * FROM learned_facts WHERE is_active = 1 AND confidence >= ? AND embedding IS NOT NULL',
        args: [minConfidence]
      });
      const scored: any[] = [];
      for (const row of res.rows) {
        if (!row.embedding) continue;
        try {
          const emb = JSON.parse(row.embedding as string);
          const sim = cosineSimilarity(vecArray, emb);
          scored.push({ ...row, similarity: sim });
        } catch {}
      }
      scored.sort((a, b) => b.similarity - a.similarity);
      return scored.slice(0, topK);
    }
  }

  public async getActiveLearnedFacts(limit: number = 100): Promise<any[]> {
    await this.ensureInitialized();
    const res = await this._client.execute({
      sql: `SELECT * FROM learned_facts WHERE is_active = 1 ORDER BY id DESC LIMIT ?`,
      args: [limit]
    });
    return Array.from(res.rows);
  }

  public async getAllActiveFacts(limit: number = 500): Promise<any[]> {
    await this.ensureInitialized();
    const res = await this._client.execute({
      sql: `SELECT * FROM learned_facts WHERE is_active = 1 ORDER BY id DESC LIMIT ?`,
      args: [limit]
    });
    return Array.from(res.rows);
  }

  public async deleteFact(id: number): Promise<void> {
    await this.ensureInitialized();
    await this._client.execute({
      sql: 'UPDATE learned_facts SET is_active = 0 WHERE id = ?',
      args: [id]
    });
  }

  public async clearAllFacts(): Promise<void> {
    await this.ensureInitialized();
    await this._client.batch([
      { sql: 'DELETE FROM learned_facts', args: [] },
      { sql: 'DELETE FROM consolidated_fact_pairs', args: [] }
    ], 'write');
  }

  // Cognitive Dream Consolidation Helpers
  public async getUnconsolidatedFactPairs(limit: number = 5): Promise<Array<{ factA: any; factB: any }>> {
    await this.ensureInitialized();
    const res = await this._client.execute({
      sql: `
        SELECT 
          f1.id as a_id, f1.category as a_category, f1.subject as a_subject, f1.predicate as a_predicate, f1.object as a_object, f1.confidence as a_confidence, f1.embedding as a_embedding,
          f2.id as b_id, f2.category as b_category, f2.subject as b_subject, f2.predicate as b_predicate, f2.object as b_object, f2.confidence as b_confidence, f2.embedding as b_embedding
        FROM learned_facts f1
        JOIN learned_facts f2 ON f1.id < f2.id
        LEFT JOIN consolidated_fact_pairs p ON (p.fact_a_id = f1.id AND p.fact_b_id = f2.id)
        WHERE f1.is_active = 1 AND f2.is_active = 1
          AND (f1.category != f2.category OR f1.subject != f2.subject)
          AND p.id IS NULL
        ORDER BY (f1.confidence + f2.confidence) DESC, f1.id DESC
        LIMIT ?
      `,
      args: [limit]
    });

    return res.rows.map((row) => ({
      factA: {
        id: Number(row.a_id),
        category: row.a_category,
        subject: row.a_subject,
        predicate: row.a_predicate,
        object: row.a_object,
        confidence: Number(row.a_confidence),
        embedding: row.a_embedding
      },
      factB: {
        id: Number(row.b_id),
        category: row.b_category,
        subject: row.b_subject,
        predicate: row.b_predicate,
        object: row.b_object,
        confidence: Number(row.b_confidence),
        embedding: row.b_embedding
      }
    }));
  }

  public async recordEvaluatedPair(
    factAId: number,
    factBId: number,
    confidence?: number,
    axiomId?: number
  ): Promise<void> {
    await this.ensureInitialized();
    const minId = Math.min(factAId, factBId);
    const maxId = Math.max(factAId, factBId);
    const now = new Date().toISOString();
    await this._client.execute({
      sql: `INSERT INTO consolidated_fact_pairs (fact_a_id, fact_b_id, evaluated_at, confidence, axiom_id)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(fact_a_id, fact_b_id) DO UPDATE SET
              evaluated_at = excluded.evaluated_at,
              confidence = excluded.confidence,
              axiom_id = excluded.axiom_id`,
      args: [minId, maxId, now, confidence !== undefined ? confidence : null, axiomId !== undefined ? axiomId : null]
    });
  }

  public async saveConsolidatedAxiom(
    result: DreamConsolidationResult,
    sourceFactIds: number[]
  ): Promise<number> {
    await this.ensureInitialized();
    const createdAt = new Date().toISOString();
    const subject = result.subject.trim();
    const predicate = result.predicate.trim();
    const object = result.object.trim();
    const category = 'synergy_axiom';

    // Duplication & redundancy check: examine active facts with matching subject and predicate
    const existingRes = await this._client.execute({
      sql: `SELECT id, confidence, object FROM learned_facts
            WHERE is_active = 1 AND LOWER(subject) = LOWER(?) AND LOWER(predicate) = LOWER(?)`,
      args: [subject, predicate]
    });

    if (existingRes.rows.length > 0) {
      const existing = existingRes.rows[0];
      const existingObj = String(existing.object).trim().toLowerCase();
      // If object matches or existing confidence is equal/higher, keep existing
      if (existingObj === object.toLowerCase() || Number(existing.confidence) >= result.confidence) {
        return Number(existing.id);
      }
      // If new synthesized axiom has higher confidence, deactivate previous version
      await this._client.execute({
        sql: 'UPDATE learned_facts SET is_active = 0 WHERE id = ?',
        args: [existing.id]
      });
    }

    const metadata = JSON.stringify({
      sourceFactIds,
      rule: 'dream_consolidation',
      synthesizedAxiom: result.synthesizedAxiom
    });

    const embeddingVec = SemanticEncoder.encode(result.synthesizedAxiom || `${subject} ${predicate} ${object}`, 32);
    const embeddingStr = JSON.stringify(Array.from(embeddingVec));

    const insertRes = await this._client.execute({
      sql: `INSERT INTO learned_facts (category, subject, predicate, object, confidence, created_at, source_message_id, is_active, embedding, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      args: [category, subject, predicate, object, result.confidence, createdAt, sourceFactIds[0] || null, embeddingStr, metadata]
    });

    return Number(insertRes.lastInsertRowid);
  }

  // Wiki Cache
  public async getCachedWiki(query: string): Promise<any> {
    await this.ensureInitialized();
    const res = await this._client.execute({
      sql: 'SELECT * FROM wiki_cache WHERE query = ?',
      args: [query.toLowerCase()]
    });
    return res.rows.length > 0 ? res.rows[0] : null;
  }

  public async saveCachedWiki(query: string, title: string, summary: string, url: string): Promise<void> {
    await this.ensureInitialized();
    const fetchedAt = new Date().toISOString();
    await this._client.execute({
      sql: `INSERT INTO wiki_cache (query, title, summary, url, fetched_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(query) DO UPDATE SET title = excluded.title, summary = excluded.summary, url = excluded.url, fetched_at = excluded.fetched_at`,
      args: [query.toLowerCase(), title, summary, url, fetchedAt]
    });
  }

  // Orchestrator Logs
  public async logOrchestrator(worker: string, action: string, status: string, details?: string): Promise<void> {
    await this.ensureInitialized();
    const timestamp = new Date().toISOString();
    await this._client.execute({
      sql: `INSERT INTO orchestrator_logs (timestamp, worker, action, status, details)
            VALUES (?, ?, ?, ?, ?)`,
      args: [timestamp, worker, action, status, details || null]
    });
  }

  public async getRecentLogs(limit: number = 30): Promise<any[]> {
    await this.ensureInitialized();
    const res = await this._client.execute({
      sql: `SELECT * FROM orchestrator_logs ORDER BY id DESC LIMIT ?`,
      args: [limit]
    });
    return Array.from(res.rows);
  }

  public close(): void {
    this._client.close();
  }
}

export const database = new AppDatabase();
