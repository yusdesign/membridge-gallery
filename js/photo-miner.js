// ==========================================
// PHOTO MINER
// Reads camera roll, assigns wing/room/hall.
// MemBridge's "mine" command, for photos.
// ==========================================

const PhotoMiner = (() => {

  async function mineCameraRoll(batchSize = 300) {
    const CameraRoll = window.Capacitor.Plugins.CameraRoll;
    if (!CameraRoll) {
      console.error('CameraRoll plugin not available');
      return { found: 0, indexed: 0 };
    }

    console.log('🔍 Mining camera roll...');

    const { photos } = await CameraRoll.getPhotos({
      quantity: batchSize,
      types: ['photos'],
    });

    let indexed = 0;

    for (const photo of photos) {
      const memory = photoToMemory(photo);
      const id = await MemBridgeDB.addMemory(memory);
      if (id) indexed++;
    }

    await MemBridgeDB.recordMining('camera_roll', photos.length, indexed, 'completed');
    console.log(`✅ Indexed ${indexed}/${photos.length} photos`);

    return { found: photos.length, indexed };
  }

  function photoToMemory(photo) {
    const metadata = extractMetadata(photo);
    const wing = determineWing(metadata);
    const room = determineRoom(metadata);
    const hall = determineHall(metadata);
    const keywords = extractKeywords(metadata);

    return {
      wing,
      room,
      hall,
      title: photo.filename || 'Memory',
      content: JSON.stringify(metadata),
      filePath: photo.uri || photo.path || '',
      fileType: getFileType(photo),
      keywords,
      metadata,
    };
  }

  function determineWing(metadata) {
    if (metadata.isScreenshot) return 'screenshots';
    if (metadata.faces && metadata.faces.length > 0) return 'people';
    if (metadata.location && metadata.location.name) return 'places';

    const hour = new Date(metadata.timestamp).getHours();
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  function determineRoom(metadata) {
    const date = new Date(metadata.timestamp);
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    if (metadata.location && metadata.location.name) {
      return `${metadata.location.name.toLowerCase().replace(/\s+/g, '_')}_${yearMonth}`;
    }

    const dayName = date.toLocaleString('en', { weekday: 'long' }).toLowerCase();
    return `${dayName}_${yearMonth}`;
  }

  function determineHall(metadata) {
    if (metadata.faces && metadata.faces.length > 2) return 'gathering';
    if (metadata.faces && metadata.faces.length === 1) return 'portrait';
    if (metadata.location && metadata.location.name) return 'location';
    if (metadata.isScreenshot) return 'archive';
    return 'moment';
  }

  function extractMetadata(photo) {
    const timestamp = photo.createdAt || new Date().toISOString();
    const isScreenshot = detectScreenshot(photo);

    return {
      exif: photo.exif || {},
      location: photo.location || null,
      timestamp,
      faces: photo.faces || [],
      dimensions: { width: photo.width || 0, height: photo.height || 0 },
      isScreenshot,
    };
  }

  function extractKeywords(metadata) {
    const keywords = [];
    const date = new Date(metadata.timestamp);

    if (metadata.location && metadata.location.name) {
      keywords.push(...metadata.location.name.toLowerCase().split(/[\s,]+/));
    }

    keywords.push(date.toLocaleString('en', { weekday: 'long' }));
    keywords.push(date.toLocaleString('en', { month: 'long' }));
    keywords.push(String(date.getFullYear()));

    const hour = date.getHours();
    if (hour >= 5 && hour < 12) keywords.push('morning');
    else if (hour >= 12 && hour < 17) keywords.push('afternoon');
    else if (hour >= 17 && hour < 21) keywords.push('evening');
    else keywords.push('night');

    if (metadata.faces) {
      if (metadata.faces.length === 1) keywords.push('portrait');
      else if (metadata.faces.length > 2) keywords.push('group');
      keywords.push(...metadata.faces);
    }

    if (metadata.isScreenshot) keywords.push('screenshot');

    return [...new Set(keywords.filter(k => k && k.length > 1))];
  }

  function detectScreenshot(photo) {
    const name = (photo.filename || '').toLowerCase();
    return name.includes('screenshot') || name.includes('screen_shot');
  }

  function getFileType(photo) {
    const name = photo.filename || '';
    const ext = name.split('.').pop()?.toLowerCase();
    return ext || 'jpg';
  }

  return { mineCameraRoll, photoToMemory, determineWing };
})();
