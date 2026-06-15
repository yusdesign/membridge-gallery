// ==========================================
// STORYBOARD ENGINE
// A/B/C marker assignment and scene management.
// ==========================================

const Storyboard = (() => {

  async function createSceneFromPhotos(wing, room, photoIds) {
    if (photoIds.length === 0) return null;
    return await MemBridgeDB.createScene(wing, room, photoIds);
  }

  async function autoCreateScenes(wing) {
    const memories = await MemBridgeDB.getMemoriesByWing(wing, 200);
    if (memories.length === 0) return [];

    // Group by room
    const rooms = {};
    for (const mem of memories) {
      if (!rooms[mem.room]) rooms[mem.room] = [];
      rooms[mem.room].push(mem.id);
    }

    const sceneIds = [];
    for (const [room, photoIds] of Object.entries(rooms)) {
      if (photoIds.length >= 2) {
        const sceneId = await createSceneFromPhotos(wing, room, photoIds);
        if (sceneId) sceneIds.push(sceneId);
      }
    }

    return sceneIds;
  }

  return { createSceneFromPhotos, autoCreateScenes };
})();
