// ==========================================
// MEMBRIDGE WEB APP
// Browser demo controller
// ==========================================

(async function() {
  let currentWing = 'morning';

  // Init DB
  const ok = await MemBridgeWeb.init();
  if (!ok) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#FF1744;">IndexedDB not available. Please use a modern browser.</div>';
    return;
  }

  // Load palace
  await loadPalace(currentWing);
  await updateStats();

  // ==========================================
  // TABS
  // ==========================================
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');

      if (btn.dataset.tab === 'stats') updateStats();
      if (btn.dataset.tab === 'palace') loadPalace(currentWing);
    });
  });

  // ==========================================
  // WING SELECTOR
  // ==========================================
  document.querySelectorAll('#wing-selector .wing-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#wing-selector .wing-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentWing = chip.dataset.wing;
      loadPalace(currentWing);
    });
  });

  // ==========================================
  // SEARCH
  // ==========================================
  let searchTimeout;
  document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
      const query = document.getElementById('search-input').value.trim();
      if (query.length < 2) {
        await loadPalace(currentWing);
        return;
      }
      const results = await MemBridgeWeb.search(query);
      renderSearchResults(results);
    }, 300);
  });

  // ==========================================
  // ADD MEMORY
  // ==========================================
  document.getElementById('add-memory-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const wing = document.getElementById('mem-wing').value;
    const room = document.getElementById('mem-room').value.trim();
    const content = document.getElementById('mem-content').value.trim();
    const title = document.getElementById('mem-title').value.trim();

    if (!room || !content) return;

    await MemBridgeWeb.addMemory({
      wing,
      room,
      content,
      title: title || content.substring(0, 50),
      keywords: extractKeywords(content, wing, room),
    });

    // Show confirmation
    document.getElementById('add-memory-form').style.display = 'none';
    document.getElementById('add-confirm').style.display = 'block';
    setTimeout(() => {
      document.getElementById('add-memory-form').style.display = 'flex';
      document.getElementById('add-confirm').style.display = 'none';
      document.getElementById('add-memory-form').reset();
    }, 1500);

    await updateStats();
  });

  // ==========================================
  // RESET
  // ==========================================
  document.getElementById('reset-db').addEventListener('click', async () => {
    if (confirm('Delete all memories from your palace?')) {
      await MemBridgeWeb.resetDatabase();
      await loadPalace('morning');
      await updateStats();
    }
  });

  // ==========================================
  // LOAD PALACE
  // ==========================================
  async function loadPalace(wing) {
    const mapEl = document.getElementById('palace-map');
    const rooms = await MemBridgeWeb.getRoomsByWing(wing);

    if (rooms.length === 0) {
      mapEl.innerHTML = `
        <div style="text-align:center;padding:40px;color:var(--text-secondary);">
          <div style="font-size:48px;margin-bottom:12px;">🏛️</div>
          <p>This wing is empty.</p>
          <p style="font-size:12px;">Go to "Add Memory" to place something here.</p>
        </div>`;
      return;
    }

    mapEl.innerHTML = rooms.map(room => {
      const markers = MemBridgeWeb.assignMarkers(room.memories.length);
      return `
        <div class="room-card" data-room="${room.name}">
          <div class="room-name">${room.name}</div>
          <div class="room-meta">${room.count} memories</div>
          <div class="memory-detail" id="detail-${room.name.replace(/[^a-zA-Z0-9]/g, '_')}">
            ${room.memories.map((mem, i) => `
              <div class="memory-item">
                <div class="memory-marker" style="background:${MemBridgeWeb.MARKER_COLORS[markers[i]]}">${markers[i]}</div>
                <div class="memory-text">
                  <strong>${escapeHtml(mem.title)}</strong><br>
                  <span style="color:var(--text-secondary);">${escapeHtml(mem.content.substring(0, 100))}${mem.content.length > 100 ? '...' : ''}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Toggle detail on click
    mapEl.querySelectorAll('.room-card').forEach(card => {
      card.addEventListener('click', () => {
        const detail = card.querySelector('.memory-detail');
        detail.classList.toggle('open');
      });
    });
  }

  // ==========================================
  // SEARCH RESULTS
  // ==========================================
  function renderSearchResults(results) {
    const mapEl = document.getElementById('palace-map');
    if (results.length === 0) {
      mapEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary);">No memories found.</div>';
      return;
    }

    mapEl.innerHTML = `
      <div class="wing-section">
        <div class="wing-title">🔍 ${results.length} results</div>
        <div class="room-list">
          ${results.map(mem => `
            <div class="room-card">
              <div class="room-name">[${mem.wing}/${mem.room}] ${escapeHtml(mem.title)}</div>
              <div class="room-meta">${escapeHtml(mem.content.substring(0, 150))}</div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  // ==========================================
  // STATS
  // ==========================================
  async function updateStats() {
    const stats = await MemBridgeWeb.getStats();
    document.getElementById('stat-memories').textContent = stats.totalMemories;
    document.getElementById('stat-scenes').textContent = stats.totalRooms;
    document.getElementById('stat-wings').textContent = stats.totalWings;
    document.getElementById('stat-rooms').textContent = stats.totalRooms;
  }

  // ==========================================
  // HELPERS
  // ==========================================
  function extractKeywords(content, wing, room) {
    const words = content.toLowerCase().split(/[\s,.;:!?]+/).filter(w => w.length > 2);
    const stopwords = new Set(['the','and','for','with','this','that','from','have','has','are','were','was','not','but','you','your','can','all','will','what','when','where']);
    return [...new Set([wing, room, ...words.filter(w => !stopwords.has(w))])].slice(0, 20);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
