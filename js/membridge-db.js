// ==========================================
// MEMBRIDGE DB
// The SQLite engine I built for Termux.
// Same schema. Same search. Same knowledge graph.
// All like yours.
// Uses @capacitor-community/sqlite v6 API
// ==========================================

const MemBridgeDB = (() => {
  let db = null;
  const DB_NAME = 'membridge_gallery';

  const SCHEMA = `
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wing TEXT NOT NULL,
      room TEXT NOT NULL,
      hall TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      content_hash TEXT UNIQUE,
      file_path TEXT,
      file_type TEXT,
      line_count INTEGER DEFAULT 0,
      keywords TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      title, content, wing, room, hall, file_path, keywords,
      content=memories, content_rowid=id
    );
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, title, content, wing, room, hall, file_path, keywords)
      VALUES (new.id, new.title, new.content, new.wing, new.room, new.hall, new.file_path, new.keywords);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, title, content, wing, room, hall, file_path, keywords)
      VALUES ('delete', old.id, old.title, old.content, old.wing, old.room, old.hall, old.file_path, old.keywords);
    END;
    CREATE TABLE IF NOT EXISTS triples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      valid_from TEXT,
      valid_until TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER,
      target_id INTEGER,
      relation_type TEXT,
      weight REAL DEFAULT 1.0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS mining_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      files_found INTEGER,
      files_indexed INTEGER,
      status TEXT,
      mined_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wing TEXT NOT NULL,
      room TEXT NOT NULL,
      scene_label TEXT,
      scene_color TEXT,
      marker_sequence TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS scene_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scene_id INTEGER,
      memory_id INTEGER,
      marker TEXT NOT NULL,
      marker_color TEXT NOT NULL,
      sequence_order INTEGER,
      FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memories_wing ON memories(wing);
    CREATE INDEX IF NOT EXISTS idx_memories_room ON memories(room);
    CREATE INDEX IF NOT EXISTS idx_memories_hall ON memories(hall);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_scenes_wing ON scenes(wing);
    CREATE INDEX IF NOT EXISTS idx_scene_members_scene ON scene_members(scene_id);
  `;

  // ==========================================
  // INIT
  // ==========================================

  async function init() {
    try {
      const CapacitorSQLite = window.Capacitor?.Plugins?.CapacitorSQLite;
      if (!CapacitorSQLite) {
        console.error('CapacitorSQLite not found');
        return false;
      }

      console.log('Creating connection...');
      await CapacitorSQLite.createConnection({
        database: DB_NAME,
        encrypted: false,
        mode: 'no-encryption',
        version: 1
      });

      console.log('Opening database...');
      await CapacitorSQLite.open({ database: DB_NAME });

      console.log('Creating schema...');
      await CapacitorSQLite.execute({
        database: DB_NAME,
        statements: SCHEMA
      });

      db = CapacitorSQLite;
      console.log('🏛️ MemBridge DB initialized');
      return true;
    } catch (e) {
      console.error('DB init failed:', e.message);
      return false;
    }
  }

  // ==========================================
  // MEMORIES
  // ==========================================

  async function addMemory(memory) {
    const hash = simpleHash(memory.content + memory.filePath);

    const existing = await db.query({
      database: DB_NAME,
      statement: 'SELECT id FROM memories WHERE content_hash = ?',
      values: [hash]
    });
    if (existing.values && existing.values.length > 0) {
      return existing.values[0].id;
    }

    const result = await db.run({
      database: DB_NAME,
      statement: `INSERT INTO memories (wing, room, hall, title, content, content_hash, file_path, file_type, keywords, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values: [
        memory.wing, memory.room, memory.hall,
        memory.title, memory.content, hash,
        memory.filePath, memory.fileType,
        memory.keywords.join(','), JSON.stringify(memory.metadata),
        new Date().toISOString(), new Date().toISOString()
      ]
    });

    return result.changes.lastId;
  }

  async function getMemoriesByWing(wing, limit = 100) {
    const result = await db.query({
      database: DB_NAME,
      statement: 'SELECT * FROM memories WHERE wing = ? ORDER BY created_at DESC LIMIT ?',
      values: [wing, limit]
    });
    return (result.values || []).map(rowToMemory);
  }

  async function getMemoriesByRoom(wing, room) {
    const result = await db.query({
      database: DB_NAME,
      statement: 'SELECT * FROM memories WHERE wing = ? AND room = ? ORDER BY created_at DESC',
      values: [wing, room]
    });
    return (result.values || []).map(rowToMemory);
  }

  async function search(query, wing, limit = 50) {
    const ftsQuery = query.split(/\s+/).filter(Boolean).join(' OR ');
    let statement = `SELECT m.*, snippet(memories_fts, 2, '<b>', '</b>', '...', 30) as snippet, rank
               FROM memories_fts JOIN memories m ON m.id = memories_fts.rowid
               WHERE memories_fts MATCH ?`;
    const values = [ftsQuery];

    if (wing) {
      statement += ' AND m.wing = ?';
      values.push(wing);
    }

    statement += ' ORDER BY rank LIMIT ?';
    values.push(limit);

    const result = await db.query({ database: DB_NAME, statement, values });
    return (result.values || []).map(rowToMemory);
  }

  // ==========================================
  // SCENES
  // ==========================================

  async function getScenesByWing(wing) {
    const result = await db.query({
      database: DB_NAME,
      statement: `SELECT s.*, COUNT(sm.id) as photo_count,
        (SELECT m.file_path FROM scene_members sm2
         JOIN memories m ON sm2.memory_id = m.id
         WHERE sm2.scene_id = s.id AND sm2.marker = 'A' LIMIT 1) as anchor_photo
       FROM scenes s
       LEFT JOIN scene_members sm ON s.id = sm.scene_id
       WHERE s.wing = ?
       GROUP BY s.id
       ORDER BY s.created_at DESC`,
      values: [wing]
    });
    return result.values || [];
  }

  async function getSceneMembers(sceneId) {
    const result = await db.query({
      database: DB_NAME,
      statement: `SELECT sm.*, m.file_path, m.title, m.metadata
       FROM scene_members sm
       JOIN memories m ON sm.memory_id = m.id
       WHERE sm.scene_id = ?
       ORDER BY sm.sequence_order ASC`,
      values: [sceneId]
    });
    return result.values || [];
  }

  async function createScene(wing, room, photoIds) {
    const markers = assignMarkers(photoIds.length);

    const result = await db.run({
      database: DB_NAME,
      statement: 'INSERT INTO scenes (wing, room, scene_label, marker_sequence) VALUES (?, ?, ?, ?)',
      values: [wing, room, `${wing}/${room}`, JSON.stringify(markers)]
    });

    const sceneId = result.changes.lastId;

    for (let i = 0; i < photoIds.length; i++) {
      const marker = markers[i];
      const color = MARKER_COLORS[marker];
      await db.run({
        database: DB_NAME,
        statement: 'INSERT INTO scene_members (scene_id, memory_id, marker, marker_color, sequence_order) VALUES (?, ?, ?, ?, ?)',
        values: [sceneId, photoIds[i], marker, color, i]
      });
    }

    return sceneId;
  }

  // ==========================================
  // RELATIONS
  // ==========================================

  async function addRelation(sourceId, targetId, type) {
    await db.run({
      database: DB_NAME,
      statement: 'INSERT OR IGNORE INTO relations (source_id, target_id, relation_type) VALUES (?, ?, ?)',
      values: [sourceId, targetId, type]
    });
  }

  async function getRelatedMemories(memoryId, limit = 5) {
    const result = await db.query({
      database: DB_NAME,
      statement: `SELECT m.* FROM memories m
       JOIN relations r ON m.id = r.target_id
       WHERE r.source_id = ?
       ORDER BY r.weight DESC
       LIMIT ?`,
      values: [memoryId, limit]
    });
    return (result.values || []).map(rowToMemory);
  }

  // ==========================================
  // TRIPLES
  // ==========================================

  async function addTriple(subject, predicate, object) {
    await db.run({
      database: DB_NAME,
      statement: 'INSERT INTO triples (subject, predicate, object, valid_from) VALUES (?, ?, ?, ?)',
      values: [subject, predicate, object, new Date().toISOString()]
    });
  }

  // ==========================================
  // STATUS
  // ==========================================

  async function getStatus() {
    const total = await db.query({ database: DB_NAME, statement: 'SELECT COUNT(*) as c FROM memories', values: [] });
    const scenes = await db.query({ database: DB_NAME, statement: 'SELECT COUNT(*) as c FROM scenes', values: [] });
    const triples = await db.query({ database: DB_NAME, statement: 'SELECT COUNT(*) as c FROM triples', values: [] });
    const relations = await db.query({ database: DB_NAME, statement: 'SELECT COUNT(*) as c FROM relations', values: [] });

    return {
      totalMemories: total.values[0].c,
      totalScenes: scenes.values[0].c,
      totalTriples: triples.values[0].c,
      totalRelations: relations.values[0].c,
    };
  }

  async function recordMining(path, found, indexed, status) {
    await db.run({
      database: DB_NAME,
      statement: 'INSERT INTO mining_history (path, files_found, files_indexed, status) VALUES (?, ?, ?, ?)',
      values: [path, found, indexed, status]
    });
  }

  async function vacuum() {
    await db.execute({ database: DB_NAME, statements: "INSERT INTO memories_fts(memories_fts) VALUES('optimize')" });
    await db.execute({ database: DB_NAME, statements: 'VACUUM' });
  }

  async function close() {
    await db.close({ database: DB_NAME });
  }

  // ==========================================
  // HELPERS
  // ==========================================

  function assignMarkers(count) {
    if (count === 1) return ['A'];
    if (count === 2) return ['A', 'C'];
    const markers = ['A'];
    for (let i = 1; i < count - 1; i++) markers.push('B');
    markers.push('C');
    return markers;
  }

  function rowToMemory(row) {
    return {
      id: row.id,
      wing: row.wing,
      room: row.room,
      hall: row.hall,
      title: row.title,
      content: row.content,
      contentHash: row.content_hash,
      filePath: row.file_path,
      fileType: row.file_type,
      keywords: row.keywords ? row.keywords.split(',') : [],
      metadata: safeParse(row.metadata, {}),
      createdAt: row.created_at,
      snippet: row.snippet || '',
    };
  }

  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(16);
  }

  function safeParse(json, fallback) {
    try { return JSON.parse(json); } catch { return fallback; }
  }

  const MARKER_COLORS = {
    'A': '#FF1744',
    'B': '#FFD600',
    'C': '#00E676',
  };

  return {
    init,
    addMemory,
    getMemoriesByWing,
    getMemoriesByRoom,
    search,
    getScenesByWing,
    getSceneMembers,
    createScene,
    addRelation,
    getRelatedMemories,
    addTriple,
    getStatus,
    recordMining,
    vacuum,
    close,
    assignMarkers,
    MARKER_COLORS,
  };
})();
