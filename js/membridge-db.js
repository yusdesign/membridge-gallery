// ==========================================
// MEMBRIDGE DB
// The SQLite engine I built for Termux.
// Same schema. Same search. Same knowledge graph.
// All like yours.
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

  // Initialize with screen debug
  async function init() {
    const debugEl = document.getElementById('status-info');
  
    // Capture console.log
    const logs = [];
    const origLog = console.log;
    const origErr = console.error;
  
    console.log = function(...args) {
      logs.push(args.join(' '));
      origLog.apply(console, args);
    };
    console.error = function(...args) {
      logs.push('❌ ' + args.join(' '));
      origErr.apply(console, args);
    };
  
    debugEl.textContent = 'Init...';
  
    const ok = await MemBridgeDB.init();
  
    if (!ok) {
      debugEl.textContent = 'DB Error - tap to see logs';
      debugEl.style.color = '#FF1744';
      debugEl.onclick = () => {
        alert('Debug Logs:\n\n' + logs.slice(-20).join('\n'));
      };
      showLoading(false);
      return;
    }

    debugEl.textContent = 'DB OK';
    debugEl.style.color = '#00E676';
  
    const status = await MemBridgeDB.getStatus();
    debugEl.textContent = `${status.totalMemories} photos · ${status.totalScenes} scenes`;
    debugEl.style.color = '#e0e0e0';
    debugEl.onclick = null;

    if (status.totalMemories === 0) {
      showEmptyState(true);
    } else {
      showEmptyState(false);
      await loadWing(currentWing);
    }

    showLoading(false);
  }

  async function addMemory(memory) {
    const hash = simpleHash(memory.content + memory.filePath);

    const existing = await db.query('SELECT id FROM memories WHERE content_hash = ?', [hash]);
    if (existing.values && existing.values.length > 0) {
      return existing.values[0].id;
    }

    const result = await db.run(
      `INSERT INTO memories (wing, room, hall, title, content, content_hash, file_path, file_type, keywords, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        memory.wing, memory.room, memory.hall,
        memory.title, memory.content, hash,
        memory.filePath, memory.fileType,
        memory.keywords.join(','), JSON.stringify(memory.metadata),
        new Date().toISOString(), new Date().toISOString()
      ]
    );

    return result.changes.lastId;
  }

  async function getMemoriesByWing(wing, limit = 100) {
    const result = await db.query(
      'SELECT * FROM memories WHERE wing = ? ORDER BY created_at DESC LIMIT ?',
      [wing, limit]
    );
    return (result.values || []).map(rowToMemory);
  }

  async function search(query, wing, limit = 50) {
    const ftsQuery = query.split(/\s+/).filter(Boolean).join(' OR ');
    let sql = `SELECT m.*, snippet(memories_fts, 2, '<b>', '</b>', '...', 30) as snippet, rank
               FROM memories_fts JOIN memories m ON m.id = memories_fts.rowid
               WHERE memories_fts MATCH ?`;
    const params = [ftsQuery];

    if (wing) {
      sql += ' AND m.wing = ?';
      params.push(wing);
    }

    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit);

    const result = await db.query(sql, params);
    return (result.values || []).map(rowToMemory);
  }

  async function getScenesByWing(wing) {
    const result = await db.query(
      `SELECT s.*, COUNT(sm.id) as photo_count,
        (SELECT m.file_path FROM scene_members sm2
         JOIN memories m ON sm2.memory_id = m.id
         WHERE sm2.scene_id = s.id AND sm2.marker = 'A' LIMIT 1) as anchor_photo
       FROM scenes s
       LEFT JOIN scene_members sm ON s.id = sm.scene_id
       WHERE s.wing = ?
       GROUP BY s.id
       ORDER BY s.created_at DESC`,
      [wing]
    );
    return result.values || [];
  }

  async function getSceneMembers(sceneId) {
    const result = await db.query(
      `SELECT sm.*, m.file_path, m.title, m.metadata
       FROM scene_members sm
       JOIN memories m ON sm.memory_id = m.id
       WHERE sm.scene_id = ?
       ORDER BY sm.sequence_order ASC`,
      [sceneId]
    );
    return result.values || [];
  }

  async function createScene(wing, room, photoIds) {
    const markers = assignMarkers(photoIds.length);

    const result = await db.run(
      'INSERT INTO scenes (wing, room, scene_label, marker_sequence) VALUES (?, ?, ?, ?)',
      [wing, room, `${wing}/${room}`, JSON.stringify(markers)]
    );

    const sceneId = result.changes.lastId;

    for (let i = 0; i < photoIds.length; i++) {
      const marker = markers[i];
      const color = MARKER_COLORS[marker];
      await db.run(
        'INSERT INTO scene_members (scene_id, memory_id, marker, marker_color, sequence_order) VALUES (?, ?, ?, ?, ?)',
        [sceneId, photoIds[i], marker, color, i]
      );
    }

    return sceneId;
  }

  async function getStatus() {
    const total = await db.query('SELECT COUNT(*) as c FROM memories');
    const scenes = await db.query('SELECT COUNT(*) as c FROM scenes');
    const triples = await db.query('SELECT COUNT(*) as c FROM triples');

    return {
      totalMemories: total.values[0].c,
      totalScenes: scenes.values[0].c,
      totalTriples: triples.values[0].c,
    };
  }

  async function recordMining(path, found, indexed, status) {
    await db.run(
      'INSERT INTO mining_history (path, files_found, files_indexed, status) VALUES (?, ?, ?, ?)',
      [path, found, indexed, status]
    );
  }

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
    search,
    getScenesByWing,
    getSceneMembers,
    createScene,
    getStatus,
    recordMining,
    assignMarkers,
    MARKER_COLORS,
  };
})();
