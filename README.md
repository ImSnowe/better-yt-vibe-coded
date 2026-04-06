# Private YouTube Theater (Electron)

An Electron-based YouTube web app that redirects YouTube video clicks to a local player page for a cleaner playback experience.

## Features
- Redirects YouTube video URLs (`watch`, `shorts`, etc.) to a local player view.
- Ad-reduced playback flow using direct stream extraction (`yt-dlp`) when available.
- Fallback embedded player (`youtube-nocookie`) if direct stream is unavailable.
- Optional SponsorBlock segment skipping.
- Search and quick return to YouTube from inside the local player.

## Project Structure
- `src/main/main.js`: Electron main process, navigation interception, IPC handlers.
- `src/main/preload.js`: Secure renderer API bridge.
- `src/renderer/player.html`: Local player page UI.
- `src/renderer/player.js`: Playback logic, captions, SponsorBlock skipping.

## Tech Stack
- Electron
- hls.js
- ytdlp-nodejs (yt-dlp wrapper)

## Requirements
- Node.js 18+
- npm
- Linux/macOS/Windows

## Getting Started
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the app:
   ```bash
   npm start
   ```

## How It Works
1. The app opens YouTube in an Electron `BrowserWindow`.
2. Video navigations are detected in the main process.
3. Matching URLs are redirected to `player.html` with the target video ID.
4. The renderer requests stream info through IPC and plays via native video/HLS.
5. If stream extraction fails, the app falls back to `youtube-nocookie` embed.

## Security Notes
- `contextIsolation` is enabled.
- `nodeIntegration` is disabled.
- `sandbox` is enabled.
- Renderer communicates with main process only through `preload`-exposed APIs.

## Privacy Notes
- The app aims to reduce tracking surface compared to normal browsing.
- Full anonymity is not guaranteed (network/provider/fingerprint factors still apply).

## Known Limitations
- Some videos may fail direct playback depending on stream availability or extractor changes.
- Audio-language behavior depends on available tracks and YouTube delivery.
- YouTube and extractor behavior can change over time and may require maintenance.

## Troubleshooting
- If playback fails, test again after restarting the app.
- Check terminal output for `yt-dlp` or navigation errors.
- Reinstall dependencies if needed:
  ```bash
  rm -rf node_modules package-lock.json
  npm install
  ```

## Development
- Entry point: `src/main/main.js`
- Start dev run:
  ```bash
  npm start
  ```

## Disclaimer
This project is for educational/personal use. Ensure your usage complies with YouTube Terms of Service, local laws, and content rights.
