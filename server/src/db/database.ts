import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, SUPPORTED_MODELS } from '../config.js';

class AppDatabase {
  private db: DatabaseSync;

  constructor() {
    const dbDir = path.dirname(DEFAULT_CONFIG.DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new DatabaseSync(DEFAULT_CONFIG.DB_PATH);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA cache_size = -64000;
    `);
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
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
        metadata TEXT
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
        is_active INTEGER DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_facts_active_cat ON learned_facts (is_active, category);
      CREATE INDEX IF NOT EXISTS idx_facts_subject ON learned_facts (subject);
      CREATE INDEX IF NOT EXISTS idx_conv_timestamp ON conversations (timestamp);

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
    `);

    // Inicjalizacja domyślnych ustawień jeśli nie istnieją
    const checkSetting = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const setSetting = this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');

    const defaults = [
      ['total_budget_usd', DEFAULT_CONFIG.TOTAL_BUDGET_USD.toString()],
      ['agent_name', DEFAULT_CONFIG.AGENT_NAME],
      ['chat_model', DEFAULT_CONFIG.DEFAULT_CHAT_MODEL],
      ['extraction_model', DEFAULT_CONFIG.DEFAULT_EXTRACTION_MODEL],
      ['orchestrator_paused', 'false']
    ];

    for (const [key, val] of defaults) {
      const existing = checkSetting.get(key) as { value: string } | undefined;
      if (!existing) {
        setSetting.run(key, val);
      } else if (key === 'chat_model' && !SUPPORTED_MODELS[existing.value]) {
        this.setSetting('chat_model', DEFAULT_CONFIG.DEFAULT_CHAT_MODEL);
      } else if (key === 'extraction_model' && !SUPPORTED_MODELS[existing.value]) {
        this.setSetting('extraction_model', DEFAULT_CONFIG.DEFAULT_EXTRACTION_MODEL);
      }
    }
  }

  // Settings
  public getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  public setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  // Budget
  public logBudgetUsage(model: string, promptTokens: number, completionTokens: number, costUsd: number, purpose: string): void {
    const timestamp = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO budget_ledger (timestamp, model, prompt_tokens, completion_tokens, cost_usd, purpose)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(timestamp, model, promptTokens, completionTokens, costUsd, purpose);
  }

  public getBudgetSummary(): { totalSpentUsd: number; totalTokens: number; ledgerCount: number } {
    const row = this.db.prepare(`
      SELECT 
        COALESCE(SUM(cost_usd), 0) as totalSpentUsd,
        COALESCE(SUM(prompt_tokens + completion_tokens), 0) as totalTokens,
        COUNT(*) as ledgerCount
      FROM budget_ledger
    `).get() as { totalSpentUsd: number; totalTokens: number; ledgerCount: number };
    return row;
  }

  public getRecentLedger(limit: number = 20): any[] {
    return this.db.prepare(`
      SELECT * FROM budget_ledger ORDER BY id DESC LIMIT ?
    `).all(limit);
  }

  // Conversations
  public saveMessage(role: string, content: string, tokens: number = 0, model?: string, metadata?: string): number {
    const timestamp = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO conversations (role, content, timestamp, tokens, model, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(role, content, timestamp, tokens, model || null, metadata || null);
    return Number(result.lastInsertRowid);
  }

  public getRecentMessages(limit: number = 20): any[] {
    const rows = this.db.prepare(`
      SELECT * FROM conversations ORDER BY id DESC LIMIT ?
    `).all(limit);
    return rows.reverse();
  }

  public clearConversations(): void {
    this.db.exec('DELETE FROM conversations');
  }

  // Learned Facts
  public saveLearnedFact(category: string, subject: string, predicate: string, object: string, confidence: number = 1.0, sourceMessageId?: number): number {
    const createdAt = new Date().toISOString();
    
    // Deaktywuj poprzednie fakty na ten sam temat i relację (korekta wiedzy)
    this.db.prepare(`
      UPDATE learned_facts 
      SET is_active = 0 
      WHERE is_active = 1 AND LOWER(subject) = LOWER(?) AND LOWER(predicate) = LOWER(?)
    `).run(subject, predicate);

    const result = this.db.prepare(`
      INSERT INTO learned_facts (category, subject, predicate, object, confidence, created_at, source_message_id, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(category, subject, predicate, object, confidence, createdAt, sourceMessageId || null);
    return Number(result.lastInsertRowid);
  }

  public getActiveLearnedFacts(limit: number = 100): any[] {
    return this.db.prepare(`
      SELECT * FROM learned_facts WHERE is_active = 1 ORDER BY id DESC LIMIT ?
    `).all(limit);
  }

  public getAllActiveFacts(limit: number = 500): any[] {
    return this.db.prepare(`
      SELECT * FROM learned_facts WHERE is_active = 1 ORDER BY id DESC LIMIT ?
    `).all(limit);
  }

  public deleteFact(id: number): void {
    this.db.prepare('UPDATE learned_facts SET is_active = 0 WHERE id = ?').run(id);
  }

  public clearAllFacts(): void {
    this.db.exec('DELETE FROM learned_facts');
  }

  // Wiki Cache
  public getCachedWiki(query: string): any {
    return this.db.prepare('SELECT * FROM wiki_cache WHERE query = ?').get(query.toLowerCase());
  }

  public saveCachedWiki(query: string, title: string, summary: string, url: string): void {
    const fetchedAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO wiki_cache (query, title, summary, url, fetched_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(query) DO UPDATE SET title = excluded.title, summary = excluded.summary, url = excluded.url, fetched_at = excluded.fetched_at
    `).run(query.toLowerCase(), title, summary, url, fetchedAt);
  }

  // Orchestrator Logs
  public logOrchestrator(worker: string, action: string, status: string, details?: string): void {
    const timestamp = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO orchestrator_logs (timestamp, worker, action, status, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(timestamp, worker, action, status, details || null);
  }

  public getRecentLogs(limit: number = 30): any[] {
    return this.db.prepare(`
      SELECT * FROM orchestrator_logs ORDER BY id DESC LIMIT ?
    `).all(limit);
  }
}

export const database = new AppDatabase();
