const { app, BrowserWindow, session, ipcMain, shell } = require('electron');
const path = require('path');
const { YtDlp } = require('ytdlp-nodejs');
const ytdlp = new YtDlp();

// Force privacy-focused defaults
process.env.TZ = 'UTC';
app.commandLine.appendSwitch('lang', 'en-US');
app.commandLine.appendSwitch('accept-lang', 'en-US,en;q=0.9');
app.commandLine.appendSwitch('disable-geolocation');

const ISOLATED_SESSION_PARTITION = 'temp-youtube-session';
const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const metadataCache = new Map();

function logIfNotAborted(error) {
  if (!error) return;
  const code = error.code || '';
  const message = error.message || String(error);
  if (code === 'ERR_ABORTED' || message.includes('ERR_ABORTED')) return;
  console.error(error);
}

// Helper: Extract and validate videoId
function getVideoId(urlStr) {
  try {
    const url = new URL(urlStr);
    let videoId = '';

    if (url.hostname === 'youtu.be') {
      videoId = url.pathname.slice(1);
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      if (url.pathname.startsWith('/watch')) {
        videoId = url.searchParams.get('v');
      } else if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/live/') || url.pathname.startsWith('/embed/')) {
        videoId = url.pathname.split('/')[2];
      }
    }

    return VIDEO_ID_REGEX.test(videoId) ? videoId : null;
  } catch (e) {
    return null;
  }
}

// Relaxed "Unhook" CSS
const unhookCSS = `
  ytd-browse[page-subtype="subscriptions"], 
  ytd-browse[page-subtype="home"],
  ytd-rich-grid-renderer,
  ytd-shelf-renderer,
  ytd-reel-shelf-renderer,
  ytd-shorts,
  [is-shorts],
  #chips-wrapper {
    display: none !important;
  }
`;

function createWindow() {
  const ses = session.fromPartition(ISOLATED_SESSION_PARTITION);
  let lastRedirect = { videoId: null, at: 0 };
  
  // Force English locale at session level
  ses.setSpellCheckerEnabled(false);
  
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: ses,
      spellcheck: false,
    },
  });

  const handleNavigation = (url) => {
    const videoId = getVideoId(url);
    if (videoId) {
      // Avoid duplicate redirects during rapid SPA / network navigation churn.
      const now = Date.now();
      if (lastRedirect.videoId === videoId && now - lastRedirect.at < 1200) {
        return true;
      }
      lastRedirect = { videoId, at: now };

      // If we're already on the same local player URL, treat as handled.
      const currentUrl = mainWindow.webContents.getURL();
      if (currentUrl.startsWith('file:')) {
        try {
          const currentVideoId = new URL(currentUrl).searchParams.get('v');
          if (currentVideoId === videoId) return true;
        } catch (_) {}
      }

      const playerPath = path.join(__dirname, '../renderer/player.html');
      mainWindow.loadFile(playerPath, { query: { v: videoId } }).catch(logIfNotAborted);
      return true;
    }
    return false;
  };

  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow.webContents.getURL().includes('youtube.com')) {
      mainWindow.webContents.insertCSS(unhookCSS).catch(() => {});
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // Ignore ERR_ABORTED
    console.error(`Load failed: ${errorCode} ${errorDescription} for ${validatedURL}`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      return { action: 'deny' };
    }
    if (parsed.protocol !== 'https:') return { action: 'deny' };
    
    // Only allow youtube navigations if they aren't redirects to player
    if (getVideoId(url)) {
      handleNavigation(url);
      return { action: 'deny' };
    }

    if (parsed.hostname.endsWith('youtube.com') || parsed.hostname === 'youtu.be') {
      return { action: 'allow' };
    }

    shell.openExternal(url).catch(logIfNotAborted);
    return { action: 'deny' };
  });

  // Strict privacy: Block all permissions except fullscreen
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'fullscreen');
  });

  ses.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'fullscreen';
  });

  // Set privacy-focused User Agent and force English
  mainWindow.webContents.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // Intercept headers to force English
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['Accept-Language'] = 'en-US,en;q=0.9';
    callback({ requestHeaders: details.requestHeaders });
  });

  ses.webRequest.onBeforeRequest({
    urls: [
      '*://*.youtube.com/watch?v=*',
      '*://*.youtube.com/shorts/*',
      '*://*.youtube.com/live/*',
      '*://*.youtube.com/embed/*',
      '*://youtu.be/*'
    ]
  }, (details, callback) => {
    // Avoid re-entrant calls from our own player.html loading or if it's already a local file
    if (details.resourceType === 'mainFrame' && !details.url.startsWith('file:')) {
      if (handleNavigation(details.url)) {
        return callback({ cancel: true });
      }
    }
    callback({});
  });

  mainWindow.webContents.on('did-navigate-in-page', (event, url) => {
    handleNavigation(url);
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    const url = details.url;
    
    if (url.includes('youtube.com') || url.includes('googlevideo.com') || url.includes('youtube-nocookie.com')) {
      responseHeaders['Content-Security-Policy'] = [
        "default-src 'self' https://*.youtube.com https://*.ytimg.com https://*.ggpht.com https://fonts.googleapis.com https://fonts.gstatic.com https://*.googleusercontent.com; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.youtube.com https://*.ytimg.com; " +
        "style-src 'self' 'unsafe-inline' https://*.youtube.com https://*.ytimg.com https://fonts.googleapis.com; " +
        "img-src 'self' data: blob: https://*.youtube.com https://*.ytimg.com https://*.ggpht.com https://*.googleusercontent.com; " +
        "media-src 'self' blob: https://*.googlevideo.com https://*.youtube.com https://*.youtube-nocookie.com; " +
        "frame-src 'self' https://*.youtube.com https://*.youtube-nocookie.com; " +
        "connect-src 'self' https://*.youtube.com https://*.googlevideo.com https://*.google.com;"
      ];
    }
    callback({ cancel: false, responseHeaders });
  });

  mainWindow.loadURL('https://www.youtube.com').catch(logIfNotAborted);
}

// Helper: Score a format based on language and quality
function scoreFormat(f) {
  let score = 0;
  const lang = (f.language || '').toLowerCase();
  const note = (f.format_note || '').toLowerCase();

  // Language scoring: Prefer English variants
  if (lang.startsWith('en')) {
    score += 1000;
    if (lang === 'en') score += 100; // Prefer generic 'en' as it's often the original
  }

  // Dubbing penalties: Detect dubbed/auto-translated/description tracks
  const dubbedIndicators = ['dubbed', 'auto-generated', 'translated', 'description', 'descriptive'];
  if (dubbedIndicators.some(indicator => note.includes(indicator) || lang.includes(indicator))) {
    score -= 500;
  }

  // Quality scoring: Prefer higher resolution
  score += (f.height || 0);

  return score;
}

ipcMain.handle('get-stream-url', async (event, videoId) => {
  if (!VIDEO_ID_REGEX.test(videoId)) return { error: 'Invalid Video ID' };

  const cached = metadataCache.get(videoId);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  try {
    const infoPromise = ytdlp.getInfoAsync(`https://www.youtube.com/watch?v=${videoId}`);
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('ytdlp timeout')), 10000));
    
    const info = await Promise.race([infoPromise, timeoutPromise]);
    
    // Sort formats by our scoring algorithm
    const format = info.formats
      .filter(f => f.protocol === 'm3u8_native' && f.video_ext !== 'none' && f.url)
      .sort((a, b) => scoreFormat(b) - scoreFormat(a))[0];

    let captions = null;
    const subs = info.subtitles || info.automatic_captions || {};
    if (subs.en) {
      const vtt = subs.en.find(s => s.ext === 'vtt');
      if (vtt) captions = vtt.url;
    }

    const data = { 
      url: format?.url || null, 
      type: format?.url ? 'stream' : 'fallback', 
      videoId,
      title: info.title,
      uploader: info.uploader,
      captions: captions,
      audioHint: {
        language: format?.language,
        formatNote: format?.format_note
      }
    };

    metadataCache.set(videoId, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    return { type: 'fallback', videoId, error: error.message };
  }
});

ipcMain.handle('get-skip-segments', async (event, videoId) => {
  if (!VIDEO_ID_REGEX.test(videoId)) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(`https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=["sponsor","intro","outro","interaction","selfpromo","music_offtopic"]`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (response.ok) return await response.json();
    return [];
  } catch (e) {
    clearTimeout(timeout);
    return [];
  }
});

ipcMain.on('search', (event, query) => {
  if (typeof query !== 'string') return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.loadURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`).catch(logIfNotAborted);
});

ipcMain.on('go-back', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.loadURL('https://www.youtube.com').catch(logIfNotAborted);
});

app.whenReady().then(() => {
  createWindow();
}).catch(err => {
  console.error('Failed to initialize app:', err);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

