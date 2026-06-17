// ==========================================
// MEMBRIDGE WEB — Browser Memory Palace
// Pure IndexedDB. Same schema. Same search.
// No server. No camera. Pure method.
// ==========================================

const MemBridgeWeb = (() => {
  const DB_NAME = 'membridge_web';
  const DB_VERSION = 1;
  let db = null;

  // ==========================================
  // INIT
  // ==========================================

  function init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Memories store
        if (!db.objectStoreNames.contains('memories')) {
          const memoriesStore = db.createObjectStore('memories', { keyPath: 'id', autoIncrement: true });
          memoriesStore.createIndex('wing', 'wing', { unique: false });
          memoriesStore.createIndex('room', 'room', { unique: false });
          memoriesStore.createIndex('wing_room', ['wing', 'room'], { unique: false });
          memoriesStore.createIndex('created_at', 'createdAt', { unique: false });
        }

        // Scenes store
        if (!db.objectStoreNames.contains('scenes')) {
          const scenesStore = db.createObjectStore('scenes', { keyPath: 'id', autoIncrement: true });
          scenesStore.createIndex('wing', 'wing', { unique: false });
        }

        // Scene members store
        if (!db.objectStoreNames.contains('scene_members')) {
          const smStore = db.createObjectStore('scene_members', { keyPath: 'id', autoIncrement: true });
          smStore.createIndex('scene_id', 'sceneId', { unique: false });
          smStore.createIndex('memory_id', 'memoryId', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        console.log('🏛️  MemBridge Web initialized');
        resolve(true);
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        resolve(false);
      };
    });
  }

  // ==========================================
  // MEMORIES
  // ==========================================

  function addMemory(memory) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('memories', 'readwrite');
      const store = tx.objectStore('memories');

      const record = {
        wing: memory.wing,
        room: memory.room,
        hall: memory.hall || 'moment',
        title: memory.title || 'Memory',
        content: memory.content,
        keywords: memory.keywords || [],
        metadata: memory.metadata || {},
        filePath: memory.filePath || '',
        createdAt: new Date().toISOString(),
      };

      const request = store.add(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getMemoriesByWing(wing, limit = 100) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('memories', 'readonly');
      const store = tx.objectStore('memories');
      const index = store.index('wing');
      const results = [];
      let count = 0;

      const request = index.openCursor(IDBKeyRange.only(wing), 'prev');
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && count < limit) {
          results.push({ id: cursor.key, ...cursor.value });
          count++;
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  function getMemoriesByRoom(wing, room) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('memories', 'readonly');
      const store = tx.objectStore('memories');
      const index = store.index('wing_room');
      const results = [];

      const request = index.openCursor(IDBKeyRange.only([wing, room]));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push({ id: cursor.key, ...cursor.value });
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  function search(query) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('memories', 'readonly');
      const store = tx.objectStore('memories');
      const results = [];
      const lowerQuery = query.toLowerCase();

      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const mem = cursor.value;
          const searchText = (mem.title + ' ' + mem.content + ' ' + (mem.keywords || []).join(' ')).toLowerCase();
          if (searchText.includes(lowerQuery)) {
            results.push({ id: cursor.key, ...mem });
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ==========================================
  // SCENES
  // ==========================================

  function getRoomsByWing(wing) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('memories', 'readonly');
      const store = tx.objectStore('memories');
      const index = store.index('wing');
      const rooms = new Map();

      const request = index.openCursor(IDBKeyRange.only(wing));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const room = cursor.value.room;
          if (!rooms.has(room)) {
            rooms.set(room, { name: room, count: 0, memories: [] });
          }
          const entry = rooms.get(room);
          entry.count++;
          entry.memories.push({ id: cursor.key, ...cursor.value });
          cursor.continue();
        } else {
          resolve(Array.from(rooms.values()));
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  function getAllWings() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('memories', 'readonly');
      const store = tx.objectStore('memories');
      const wings = new Map();

      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const wing = cursor.value.wing;
          if (!wings.has(wing)) {
            wings.set(wing, { name: wing, count: 0, rooms: new Set() });
          }
          const entry = wings.get(wing);
          entry.count++;
          entry.rooms.add(cursor.value.room);
          cursor.continue();
        } else {
          const result = Array.from(wings.values()).map(w => ({
            name: w.name,
            count: w.count,
            rooms: w.rooms.size,
          }));
          resolve(result);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  function getStats() {
    return new Promise(async (resolve) => {
      const tx = db.transaction('memories', 'readonly');
      const store = tx.objectStore('memories');
      const wings = new Set();
      const rooms = new Set();
      let count = 0;

      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          count++;
          wings.add(cursor.value.wing);
          rooms.add(cursor.value.wing + '::' + cursor.value.room);
          cursor.continue();
        } else {
          resolve({
            totalMemories: count,
            totalWings: wings.size,
            totalRooms: rooms.size,
          });
        }
      };
    });
  }

  function resetDatabase() {
    return new Promise((resolve) => {
      db.close();
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => {
        init().then(() => resolve(true));
      };
      request.onerror = () => resolve(false);
    });
  }

  function assignMarkers(count) {
    if (count === 1) return ['A'];
    if (count === 2) return ['A', 'C'];
    const markers = ['A'];
    for (let i = 1; i < count - 1; i++) markers.push('B');
    markers.push('C');
    return markers;
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
    getRoomsByWing,
    getAllWings,
    getStats,
    resetDatabase,
    assignMarkers,
    MARKER_COLORS,
  };
})();
