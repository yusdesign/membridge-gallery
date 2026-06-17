// ==========================================
// MEMBRIDGE GALLERY APP
// ==========================================

(async function() {
  // Elements
  const storyboardEl = document.getElementById('storyboard');
  const emptyStateEl = document.getElementById('empty-state');
  const loadingEl = document.getElementById('loading');
  const statusInfoEl = document.getElementById('status-info');
  const searchInput = document.getElementById('search-input');
  const wingChips = document.querySelectorAll('.wing-chip');
  const pickPhotosBtn = document.getElementById('pick-photos-btn');
  const photoInput = document.getElementById('photo-input');
  const addTextBtn = document.getElementById('add-text-btn');
  const textModal = document.getElementById('text-modal');
  const textSaveBtn = document.getElementById('text-save-btn');
  const textCancelBtn = document.getElementById('text-cancel-btn');

  let currentWing = 'morning';

  // ==========================================
  // INIT
  // ==========================================

  async function init() {
    statusInfoEl.textContent = 'Init...';
    
    const logs = [];
    storyboardEl.innerHTML = '<div style="padding:16px;color:#e0e0e0;font-family:monospace;font-size:11px;"></div>';
    const logEl = storyboardEl.querySelector('div');
    
    function addLog(msg) {
      logs.push(msg);
      logEl.textContent = logs.join('\n');
    }
    
    try {
      const ok = await MemBridgeDB.init();
      addLog('DB init: ' + ok);
      
      if (!ok) {
        statusInfoEl.textContent = '❌ DB Error';
        statusInfoEl.style.color = '#FF1744';
        showLoading(false);
        return;
      }

      const status = await MemBridgeDB.getStatus();
      statusInfoEl.textContent = `${status.totalMemories} photos · ${status.totalScenes} scenes`;
      statusInfoEl.style.color = '#00E676';
      addLog('Status: ' + JSON.stringify(status));

      if (status.totalMemories === 0) {
        showEmptyState(true);
      } else {
        showEmptyState(false);
        await loadWing(currentWing);
      }
    } catch (e) {
      addLog('CRASH: ' + e.message);
      statusInfoEl.textContent = '❌ Crash';
      statusInfoEl.style.color = '#FF1744';
    }
    
    showLoading(false);
  }

  // ==========================================
  // LOAD WING
  // ==========================================

  async function loadWing(wing) {
    currentWing = wing;
    showLoading(true);

    let scenes = await MemBridgeDB.getScenesByWing(wing);
    if (scenes.length === 0) {
      await Storyboard.autoCreateScenes(wing);
      scenes = await MemBridgeDB.getScenesByWing(wing);
    }

    renderScenes(scenes, wing);
    showLoading(false);
    showEmptyState(scenes.length === 0);
  }

  // ==========================================
  // RENDER
  // ==========================================

  async function renderScenes(scenes, wing) {
    storyboardEl.innerHTML = '';

    if (scenes.length === 0) {
      const memories = await MemBridgeDB.getMemoriesByWing(wing, 50);
      if (memories.length > 0) {
        storyboardEl.appendChild(createLooseScene(memories));
      }
      return;
    }

    for (const scene of scenes) {
      const members = await MemBridgeDB.getSceneMembers(scene.id);
      storyboardEl.appendChild(createSceneCard(scene, members));
    }
  }

  function createSceneCard(scene, members) {
    const card = document.createElement('div');
    card.className = 'scene-card';
    card.innerHTML = `
      <div class="scene-header">
        <span class="scene-badge">Scene</span>
        <span class="scene-label">${scene.scene_label || scene.room}</span>
        <span class="scene-count">${scene.photo_count} frames</span>
      </div>
      <div class="scene-strip"></div>
    `;
    
    const strip = card.querySelector('.scene-strip');
    
    for (const member of members) {
      const frame = document.createElement('div');
      frame.className = 'frame-card';
      if (member.marker === 'B') frame.classList.add('has-marker-b');
      
      const markerColor = MemBridgeDB.MARKER_COLORS[member.marker] || '#888';
      const isImage = member.file_path && (member.file_path.startsWith('data:image') || member.file_path.startsWith('http') || member.file_path.startsWith('file://') || member.file_path.includes('.'));
      
      frame.innerHTML = `
        <div class="marker-square" style="background:${markerColor}">${member.marker}</div>
        ${isImage ? 
          `<img src="${member.file_path}" alt="${member.title}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">` : 
          ''}
        <div class="frame-text" style="display:${isImage ? 'none' : 'flex'};align-items:center;justify-content:center;height:160px;padding:8px;font-size:11px;color:var(--text-secondary);text-align:center;overflow:hidden;">${escapeHtml(member.title || member.content || 'Memory')}</div>
        <div class="frame-label">${member.marker === 'A' ? '🎬 Anchor' : member.marker === 'B' ? '🌊 Bridge' : '✨ Closure'}</div>
      `;
      
      frame.addEventListener('click', () => {
        if (isImage) {
          openPhotoModal(member.file_path, member.title, member.marker);
        } else {
          openTextModal(member.title, member.content || '', member.marker, member.file_path);
        }
      });
      
      strip.appendChild(frame);
    }
    
    return card;
  }

  function createLooseScene(memories) {
    const card = document.createElement('div');
    card.className = 'scene-card';
    card.innerHTML = `
      <div class="scene-header">
        <span class="scene-badge">Memories</span>
        <span class="scene-label">Recent</span>
        <span class="scene-count">${memories.length} items</span>
      </div>
      <div class="scene-strip"></div>
    `;
    
    const strip = card.querySelector('.scene-strip');
    const markers = MemBridgeDB.assignMarkers(memories.length);
    
    memories.forEach((mem, i) => {
      const frame = document.createElement('div');
      frame.className = 'frame-card';
      const marker = markers[i];
      const color = MemBridgeDB.MARKER_COLORS[marker];
      const isImage = mem.filePath && (mem.filePath.startsWith('data:image') || mem.filePath.startsWith('http'));
      
      frame.innerHTML = `
        <div class="marker-square" style="background:${color}">${marker}</div>
        ${isImage ? `<img src="${mem.filePath}" alt="${mem.title}" loading="lazy" onerror="this.style.display='none';">` : ''}
        <div class="frame-label">${mem.wing}/${mem.room}</div>
      `;
      
      frame.addEventListener('click', () => {
        if (isImage) openPhotoModal(mem.filePath, mem.title, marker);
        else openTextModal(mem.title, mem.content, marker, mem.filePath);
      });
      
      strip.appendChild(frame);
    });
    
    return card;
  }

  function openPhotoModal(uri, title, marker) {
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <button class="modal-close">✕</button>
      <img src="${uri}" alt="${title}">
      <div class="modal-info"><span class="wing-badge">Marker ${marker}</span></div>
    `;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('modal-close')) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  function openTextModal(title, content, marker, filePath) {
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.overflowY = 'auto';
    overlay.innerHTML = `
      <button class="modal-close">✕</button>
      <div style="max-width:400px;width:100%;padding:20px;">
        ${filePath && filePath.startsWith('data:image') ? `<img src="${filePath}" style="max-width:100%;border-radius:8px;margin-bottom:12px;">` : ''}
        <h3 style="color:var(--text);margin-bottom:4px;">${escapeHtml(title)}</h3>
        <div class="wing-badge" style="margin-bottom:12px;">Marker ${marker}</div>
        <p style="color:var(--text-secondary);font-size:14px;line-height:1.5;">${escapeHtml(content)}</p>
      </div>
    `;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('modal-close')) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  // ==========================================
  // ADD PHOTOS
  // ==========================================

  pickPhotosBtn.addEventListener('click', () => photoInput.click());

  photoInput.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files.length) return;
    
    showLoading(true);
    showEmptyState(false);
    
    let indexed = 0;
    for (const file of files) {
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      
      await MemBridgeDB.addMemory({
        wing: 'places',
        room: 'imported_' + new Date().toISOString().split('T')[0],
        hall: 'moment',
        title: file.name,
        content: JSON.stringify({ filename: file.name, size: file.size }),
        filePath: dataUrl,
        fileType: file.name.split('.').pop() || 'jpg',
        keywords: ['photo', 'imported'],
        metadata: { timestamp: new Date().toISOString(), dimensions: {} },
      });
      indexed++;
    }
    
    await MemBridgeDB.recordMining('manual_import', files.length, indexed, 'completed');
    const status = await MemBridgeDB.getStatus();
    statusInfoEl.textContent = `${status.totalMemories} photos · ${status.totalScenes} scenes`;
    await loadWing('places');
    showLoading(false);
  });

  // ==========================================
  // ADD TEXT MEMORY
  // ==========================================

  addTextBtn.addEventListener('click', () => {
    textModal.style.display = 'block';
  });

  textCancelBtn.addEventListener('click', () => {
    textModal.style.display = 'none';
  });

  textSaveBtn.addEventListener('click', async () => {
    const wing = document.getElementById('text-wing').value;
    const room = document.getElementById('text-room').value.trim();
    const title = document.getElementById('text-title').value.trim();
    const content = document.getElementById('text-content').value.trim();
    
    if (!room || !content) return;
    
    await MemBridgeDB.addMemory({
      wing,
      room,
      hall: 'moment',
      title: title || content.substring(0, 50),
      content,
      filePath: '',
      fileType: 'text',
      keywords: [wing, room, ...content.split(/\s+/).filter(w => w.length > 2).slice(0, 10)],
      metadata: { timestamp: new Date().toISOString() },
    });
    
    textModal.style.display = 'none';
    document.getElementById('text-room').value = '';
    document.getElementById('text-title').value = '';
    document.getElementById('text-content').value = '';
    
    const status = await MemBridgeDB.getStatus();
    statusInfoEl.textContent = `${status.totalMemories} photos · ${status.totalScenes} scenes`;
    await loadWing(wing);
  });

  // ==========================================
  // WING SELECTOR
  // ==========================================

  wingChips.forEach(chip => {
    chip.addEventListener('click', () => {
      wingChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      loadWing(chip.dataset.wing);
    });
  });

  // ==========================================
  // SEARCH
  // ==========================================

  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
      const query = searchInput.value.trim();
      if (query.length < 2) { await loadWing(currentWing); return; }
      showLoading(true);
      const results = await MemBridgeDB.search(query, null, 50);
      renderSearchResults(results);
      showLoading(false);
    }, 400);
  });

  function renderSearchResults(results) {
    storyboardEl.innerHTML = '';
    if (results.length === 0) return;
    storyboardEl.appendChild(createLooseScene(results));
  }

  // ==========================================
  // HELPERS
  // ==========================================

  function showLoading(show) {
    loadingEl.style.display = show ? 'block' : 'none';
  }

  function showEmptyState(show) {
    emptyStateEl.style.display = show ? 'block' : 'none';
    storyboardEl.style.display = show ? 'none' : 'block';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ==========================================
  // START
  // ==========================================

  init();
})();
