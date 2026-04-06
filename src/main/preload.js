const { contextBridge, ipcRenderer } = require('electron');

const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

contextBridge.exposeInMainWorld('api', {
  getStreamUrl: (videoId) => {
    if (typeof videoId !== 'string' || !VIDEO_ID_REGEX.test(videoId)) {
      return Promise.reject(new Error('Invalid video ID'));
    }
    return ipcRenderer.invoke('get-stream-url', videoId);
  },
  goBack: () => ipcRenderer.send('go-back'),
  search: (query) => {
    if (typeof query !== 'string') return;
    ipcRenderer.send('search', query.slice(0, 500)); // Sanitize length
  },
  getSkipSegments: (videoId) => {
    if (typeof videoId !== 'string' || !VIDEO_ID_REGEX.test(videoId)) {
      return Promise.reject(new Error('Invalid video ID'));
    }
    return ipcRenderer.invoke('get-skip-segments', videoId);
  },
});
