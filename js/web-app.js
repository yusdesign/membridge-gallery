(async function() {
  let currentWing = 'morning';
  let editingId = null;

  const ok = await MemBridgeWeb.init();
  if (!ok) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#FF1744;">IndexedDB not available.</div>';
    return;
  }

  await loadWings();
  await loadPalace(currentWing);
  await updateStats();

  // ========================================== TABS
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

  // ========================================== WING SELECTOR
  async function loadWings() {
    const wings = await MemBridgeWeb.getAllWings();
    const container = document.getElementById('wing-selector');
    const allWings = ['morning','afternoon','evening','night','people','places','ideas'];
    const existing = wings.map(w => w.name);
    
    container.innerHTML = allWings.map(w => 
      `<button class="wing-chip${w === currentWing ? ' active' : ''}" data-wing="${w}">
        ${iconForWing(w)} ${w}${existing.includes(w) ? ' · '+wings.find(x=>x.name===w).count : ''}
      </button>`
    ).join('');
    
    container.querySelectorAll('.wing-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        currentWing = chip.dataset.wing;
        loadPalace(currentWing);
        loadWings();
      });
    });
  }

  // ========================================== SEARCH
  let searchTimeout;
  document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
      const query = document.getElementById('search-input').value.trim();
      if (query.length < 2) { await loadPalace(currentWing); return; }
      const results = await MemBridgeWeb.search(query);
      renderSearchResults(results);
    }, 300);
  });

  // ========================================== ADD MEMORY
  document.getElementById('add-memory-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const wing = document.getElementById('mem-wing').value;
    const room = document.getElementById('mem-room').value.trim();
    const content = document.getElementById('mem-content').value.trim();
    const title = document.getElementById('mem-title').value.trim();
    const photoFile = document.getElementById('mem-photo').files[0];

    if (!room || !content) return;

    let filePath = '';
    if (photoFile) {
      filePath = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(photoFile);
      });
    }

    if (editingId) {
      await MemBridgeWeb.updateMemory(editingId, { wing, room, title, content, filePath });
      editingId = null;
    } else {
      await MemBridgeWeb.addMemory({ wing, room, content, title: title || content.substring(0, 50), filePath, keywords: [wing, room] });
    }

    document.getElementById('add-memory-form').reset();
    document.getElementById('add-memory-form').style.display = 'none';
    document.getElementById('add-confirm').style.display = 'block';
    setTimeout(() => {
      document.getElementById('add-memory-form').style.display = 'flex';
      document.getElementById('add-confirm').style.display = 'none';
    }, 1500);

    await updateStats();
    await loadWings();
    await loadPalace(wing);
  });

  // ========================================== RESET
  document.getElementById('reset-db').addEventListener('click', async () => {
    if (confirm('Delete all memories?')) {
      await MemBridgeWeb.resetDatabase();
      await loadWings();
      await loadPalace('morning');
      await updateStats();
    }
  });

  // ========================================== LOAD PALACE
  async function loadPalace(wing) {
    const mapEl = document.getElementById('palace-map');
    const rooms = await MemBridgeWeb.getRoomsByWing(wing);

    if (rooms.length === 0) {
      mapEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-secondary);"><div style="font-size:48px;margin-bottom:12px;">🏛️</div><p>This wing is empty.</p><p style="font-size:12px;">Go to "Add" to place a memory here.</p></div>`;
      return;
    }

    mapEl.innerHTML = rooms.map(room => {
      const markers = MemBridgeWeb.assignMarkers(room.memories.length);
      return `<div class="room-card">
        <div class="room-name">${escapeHtml(room.name)} <span style="font-weight:400;font-size:11px;color:var(--text-secondary);">${room.count} memories</span></div>
        <div class="memory-detail" id="detail-${room.name.replace(/[^a-zA-Z0-9]/g,'_')}">
          ${room.memories.map((mem, i) => `
            <div class="memory-item">
              <div class="memory-marker" style="background:${MemBridgeWeb.MARKER_COLORS[markers[i]]}">${markers[i]}</div>
              <div class="memory-text">
                <strong>${escapeHtml(mem.title)}</strong>
                <button class="edit-btn" data-id="${mem.id}" data-wing="${mem.wing}" data-room="${mem.room}" data-title="${escapeHtml(mem.title||'')}" data-content="${escapeHtml(mem.content||'')}">✏️</button>
                <br><span style="color:var(--text-secondary);">${escapeHtml((mem.content||'').substring(0, 120))}${(mem.content||'').length>120?'...':''}</span>
                ${mem.filePath && mem.filePath.startsWith('data:image') ? `<br><img src="${mem.filePath}" class="memory-img">` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
    }).join('');

    // Click to expand
    mapEl.querySelectorAll('.room-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('edit-btn')) return;
        const detail = card.querySelector('.memory-detail');
        detail.classList.toggle('open');
      });
    });

    // Edit buttons
    mapEl.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        editingId = parseInt(btn.dataset.id);
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-tab="add"]').classList.add('active');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById('tab-add').classList.add('active');
        document.getElementById('mem-wing').value = btn.dataset.wing;
        document.getElementById('mem-room').value = btn.dataset.room;
        document.getElementById('mem-title').value = btn.dataset.title;
        document.getElementById('mem-content').value = btn.dataset.content;
      });
    });
  }

  function renderSearchResults(results) {
    const mapEl = document.getElementById('palace-map');
    if (results.length === 0) {
      mapEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary);">Nothing found.</div>';
      return;
    }
    mapEl.innerHTML = results.map(mem => `
      <div class="room-card">
        <div class="room-name">[${mem.wing}/${mem.room}] ${escapeHtml(mem.title)}</div>
        <div class="room-meta">${escapeHtml((mem.content||'').substring(0, 150))}</div>
        ${mem.filePath && mem.filePath.startsWith('data:image') ? `<img src="${mem.filePath}" class="memory-img">` : ''}
      </div>
    `).join('');
  }

  async function updateStats() {
    const stats = await MemBridgeWeb.getStats();
    document.getElementById('stat-memories').textContent = stats.totalMemories;
    document.getElementById('stat-rooms').textContent = stats.totalRooms;
    document.getElementById('stat-wings').textContent = stats.totalWings;
    document.getElementById('stat-scenes').textContent = stats.totalRooms;
  }

  function iconForWing(w) {
    const icons = { morning:'🌅', afternoon:'☀️', evening:'🌆', night:'🌙', people:'👤', places:'📍', ideas:'💡' };
    return icons[w] || '🏛️';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
})();
