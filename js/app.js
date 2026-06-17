// ==========================================
// MEMBRIDGE GALLERY APP
// ==========================================

(async function() {
  // Wait for Capacitor
  const isNative = window.Capacitor && window.Capacitor.isNativePlatform();

  // Elements
  const storyboardEl = document.getElementById('storyboard');
  const emptyStateEl = document.getElementById('empty-state');
  const loadingEl = document.getElementById('loading');
  const statusInfoEl = document.getElementById('status-info');
  const searchInput = document.getElementById('search-input');
  const mineBtn = document.getElementById('mine-btn');
  const wingChips = document.querySelectorAll('.wing-chip');

  let currentWing = 'morning';

  // Initialize
  async function init() {
    const debugEl = document.getElementById('status-info');
  
    // Build log string directly
    let logText = '';
    function addLog(msg) {
      logText += msg + '\n';
      // Show immediately on screen
      storyboardEl.innerHTML = '<div style="padding:16px;color:#e0e0e0;font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;">' + 
        logText + '</div>';
    }
  
    addLog('Starting init...');
    addLog('window.Capacitor: ' + !!window.Capacitor);
    addLog('window.sqlitePlugin: ' + !!window.sqlitePlugin);
  
    if (window.Capacitor && window.Capacitor.Plugins) {
      const plugins = Object.keys(window.Capacitor.Plugins);
      addLog('Plugins: ' + plugins.join(', '));
    }
  
    try {
      const ok = await MemBridgeDB.init();
      addLog('MemBridgeDB.init() returned: ' + ok);
    
      if (!ok) {
        debugEl.textContent = '❌ DB Error';
        debugEl.style.color = '#FF1744';
        showLoading(false);
        showEmptyState(false);
        return;
      }

      const status = await MemBridgeDB.getStatus();
      addLog('Status: ' + JSON.stringify(status));
      debugEl.textContent = status.totalMemories + ' photos';
      debugEl.style.color = '#00E676';
    
      if (status.totalMemories === 0) {
        showEmptyState(true);
      } else {
        showEmptyState(false);
        await loadWing(currentWing);
        storyboardEl.innerHTML = '';
        renderScenesFromDB();
      }
    } catch(e) {
      addLog('CRASH: ' + e.message);
      debugEl.textContent = '❌ Crash';
      debugEl.style.color = '#FF1744';
      showLoading(false);
      showEmptyState(false);
    }
  
    showLoading(false);
  }

  // Load wing
  async function loadWing(wing) {
    currentWing = wing;
    showLoading(true);

    // Check for existing scenes
    let scenes = await MemBridgeDB.getScenesByWing(wing);

    // If no scenes, auto-create them
    if (scenes.length === 0) {
      await Storyboard.autoCreateScenes(wing);
      scenes = await MemBridgeDB.getScenesByWing(wing);
    }

    renderScenes(scenes, wing);
    showLoading(false);
    showEmptyState(scenes.length === 0);
  }

  // Render scenes
  async function renderScenes(scenes, wing) {
    storyboardEl.innerHTML = '';

    if (scenes.length === 0) {
      // Render loose photos (no scenes yet)
      const memories = await MemBridgeDB.getMemoriesByWing(wing, 50);
      if (memories.length > 0) {
        const looseScene = createLooseScene(memories);
        storyboardEl.appendChild(looseScene);
      }
      return;
    }

    for (const scene of scenes) {
      const members = await MemBridgeDB.getSceneMembers(scene.id);
      const sceneCard = createSceneCard(scene, members);
      storyboardEl.appendChild(sceneCard);
    }
  }

  // Create scene card
  function createSceneCard(scene, members) {
    const card = document.createElement('div');
    card.className = 'scene-card';

    const header = document.createElement('div');
    header.className = 'scene-header';
    header.innerHTML = `
      <span class="scene-badge">Scene</span>
      <span class="scene-label">${scene.scene_label || scene.room}</span>
      <span class="scene-count">${scene.photo_count} frames</span>
    `;
    card.appendChild(header);

    const strip = document.createElement('div');
    strip.className = 'scene-strip';

    for (const member of members) {
      const frame = document.createElement('div');
      frame.className = 'frame-card';
      if (member.marker === 'B') frame.classList.add('has-marker-b');

      const markerColor = MemBridgeDB.MARKER_COLORS[member.marker] || '#888';
      const markerClass = `marker-${member.marker.toLowerCase()}`;

      frame.innerHTML = `
        <div class="marker-square ${markerClass}" style="background:${markerColor}">${member.marker}</div>
        <img src="${member.file_path}" alt="${member.title}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22130%22 height=%22160%22><rect fill=%22%2314141f%22 width=%22130%22 height=%22160%22/></svg>'">
        <div class="frame-label">${member.marker === 'A' ? '🎬 Anchor' : member.marker === 'B' ? '🌊 Bridge' : '✨ Closure'}</div>
      `;

      frame.addEventListener('click', () => {
        openPhotoModal(member.file_path, member.title, member.marker);
      });

      strip.appendChild(frame);
    }

    card.appendChild(strip);
    return card;
  }

  // Loose photos (no scene structure yet)
  function createLooseScene(memories) {
    const card = document.createElement('div');
    card.className = 'scene-card';

    const header = document.createElement('div');
    header.className = 'scene-header';
    header.innerHTML = `
      <span class="scene-badge">Memories</span>
      <span class="scene-label">Recent photos</span>
      <span class="scene-count">${memories.length} photos</span>
    `;
    card.appendChild(header);

    const strip = document.createElement('div');
    strip.className = 'scene-strip';

    const markers = MemBridgeDB.assignMarkers(memories.length);

    memories.forEach((mem, i) => {
      const frame = document.createElement('div');
      frame.className = 'frame-card';
      const marker = markers[i];
      const color = MemBridgeDB.MARKER_COLORS[marker];

      frame.innerHTML = `
        <div class="marker-square" style="background:${color}">${marker}</div>
        <img src="${mem.filePath}" alt="${mem.title}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22130%22 height=%22160%22><rect fill=%22%2314141f%22 width=%22130%22 height=%22160%22/></svg>'">
        <div class="frame-label">${mem.wing}/${mem.room}</div>
      `;

      frame.addEventListener('click', () => {
        openPhotoModal(mem.filePath, mem.title, marker);
      });

      strip.appendChild(frame);
    });

    card.appendChild(strip);
    return card;
  }

  // Photo modal
  function openPhotoModal(uri, title, marker) {
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <button class="modal-close">✕</button>
      <img src="${uri}" alt="${title}">
      <div class="modal-info">
        <span class="wing-badge">Marker ${marker}</span>
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('modal-close')) {
        overlay.remove();
      }
    });

    document.body.appendChild(overlay);
  }

  // Pick photos button
  const pickBtn = document.getElementById('pick-photos-btn');
  const photoInput = document.getElementById('photo-input');

  if (pickBtn && photoInput) {
    pickBtn.addEventListener('click', () => photoInput.click());
  
    photoInput.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (!files.length) return;
    
      showLoading(true);
      showEmptyState(false);
    
      let indexed = 0;
      for (const file of files) {
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve) => {
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
      
        const memory = {
          wing: 'places',
          room: 'imported_' + new Date().toISOString().split('T')[0],
          hall: 'moment',
          title: file.name,
          content: JSON.stringify({ filename: file.name, size: file.size }),
          filePath: dataUrl,
          fileType: file.name.split('.').pop() || 'jpg',
          keywords: ['imported', file.name.split('.')[0]],
          metadata: { timestamp: new Date().toISOString(), dimensions: {} },
        };
      
        await MemBridgeDB.addMemory(memory);
        indexed++;
      }
    
      await MemBridgeDB.recordMining('manual_import', files.length, indexed, 'completed');
      const status = await MemBridgeDB.getStatus();
      statusInfoEl.textContent = `${status.totalMemories} photos · ${status.totalScenes} scenes`;
      await loadWing('places');
      showLoading(false);
    });
  }

  // Mine button
  mineBtn.addEventListener('click', async () => {
    showLoading(true);
    showEmptyState(false);
    const result = await PhotoMiner.mineCameraRoll();
    const status = await MemBridgeDB.getStatus();
    statusInfoEl.textContent = `${status.totalMemories} photos · ${status.totalScenes} scenes`;
    await loadWing(currentWing);
  });

  // Wing chips
  wingChips.forEach(chip => {
    chip.addEventListener('click', () => {
      wingChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const wing = chip.dataset.wing;
      loadWing(wing);
    });
  });

  // Search
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
      const query = searchInput.value.trim();
      if (query.length < 2) {
        await loadWing(currentWing);
        return;
      }

      showLoading(true);
      const results = await MemBridgeDB.search(query, null, 50);
      renderSearchResults(results);
      showLoading(false);
      showEmptyState(results.length === 0);
    }, 400);
  });

  function renderSearchResults(results) {
    storyboardEl.innerHTML = '';

    if (results.length === 0) return;

    const card = document.createElement('div');
    card.className = 'scene-card';

    const header = document.createElement('div');
    header.className = 'scene-header';
    header.innerHTML = `
      <span class="scene-badge">Search</span>
      <span class="scene-label">${results.length} results</span>
    `;
    card.appendChild(header);

    const strip = document.createElement('div');
    strip.className = 'scene-strip';

    results.forEach(mem => {
      const frame = document.createElement('div');
      frame.className = 'frame-card';
      frame.innerHTML = `
        <img src="${mem.filePath}" alt="${mem.title}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22130%22 height=%22160%22><rect fill=%22%2314141f%22 width=%22130%22 height=%22160%22/></svg>'">
        <div class="frame-label">${mem.wing}/${mem.room}</div>
      `;
      frame.addEventListener('click', () => openPhotoModal(mem.filePath, mem.title, ''));
      strip.appendChild(frame);
    });

    card.appendChild(strip);
    storyboardEl.appendChild(card);
  }

  // UI helpers
  function showLoading(show) {
    loadingEl.style.display = show ? 'block' : 'none';
  }

  function showEmptyState(show) {
    emptyStateEl.style.display = show ? 'block' : 'none';
    storyboardEl.style.display = show ? 'none' : 'block';
  }

  // Start
  init();
})();
