window.addEventListener('DOMContentLoaded', async () => {
    const player = document.getElementById('player');
    const loadingOverlay = document.getElementById('loading-overlay');
    const backBtn = document.getElementById('back-btn');
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const videoTitle = document.getElementById('video-title');
    const videoUploader = document.getElementById('video-uploader');

    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v');
    let hlsInstance = null;

    if (!videoId) {
        loadingOverlay.innerHTML = '<div style="color:white; text-align:center;">Select a video from YouTube to start.</div>';
        return;
    }

    // Cleanup function
    const cleanup = () => {
        if (hlsInstance) {
            hlsInstance.destroy();
            hlsInstance = null;
        }
        player.pause();
        player.src = "";
        player.load();
    };

    window.addEventListener('unload', cleanup);

    try {
        // Concurrent fetch
        const [result, rawSegments] = await Promise.all([
            window.api.getStreamUrl(videoId),
            window.api.getSkipSegments(videoId).catch(() => [])
        ]);

        // Pre-sort and filter segments
        const skipSegments = (rawSegments || [])
            .map(s => s.segment)
            .sort((a, b) => a[0] - b[0]);

        loadingOverlay.style.display = 'none';

        if (result && result.type === 'stream') {
            player.style.display = 'block';

            if (result.captions) {
                const track = document.createElement('track');
                Object.assign(track, {
                    kind: 'captions',
                    label: 'English',
                    srclang: 'en',
                    src: result.captions,
                    default: true
                });
                player.appendChild(track);
            }

            const startPlayback = () => {
                player.play().catch(e => {
                    if (e.name !== 'AbortError') console.error("Playback failed:", e);
                });
            };

            if (result.url && result.url.includes('.m3u8') && typeof Hls !== 'undefined' && Hls.isSupported()) {
                hlsInstance = new Hls();
                hlsInstance.loadSource(result.url);
                hlsInstance.attachMedia(player);
                hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                    const tracks = hlsInstance.audioTracks;
                    if (tracks.length > 1) {
                        const scoreTrack = (t) => {
                            let score = 0;
                            const lang = (t.lang || '').toLowerCase();
                            const name = (t.name || '').toLowerCase();

                            // Favor English
                            if (lang.startsWith('en')) {
                                score += 1000;
                                if (lang === 'en') score += 100;
                            }

                            // Penalize dubbed/auto-generated/audio description
                            const dubbedIndicators = ['dub', 'auto', 'description', 'translated'];
                            if (dubbedIndicators.some(i => name.includes(i) || lang.includes(i))) {
                                score -= 500;
                            }

                            // Favor tracks that likely represent the original (often named 'English' or 'Original')
                            if (name.includes('original')) score += 200;

                            return score;
                        };

                        const bestTrack = tracks
                            .map((t, idx) => ({ t, idx, score: scoreTrack(t) }))
                            .sort((a, b) => b.score - a.score)[0];

                        if (bestTrack && bestTrack.idx !== hlsInstance.audioTrack) {
                            console.log(`Selecting best audio track: ${bestTrack.t.name} (${bestTrack.t.lang}) at index ${bestTrack.idx} with score ${bestTrack.score}`);
                            hlsInstance.audioTrack = bestTrack.idx;
                        }
                    }
                    startPlayback();
                });
                hlsInstance.on(Hls.Events.ERROR, (event, data) => {
                    if (data.fatal) {
                        console.error("HLS fatal error:", data.type);
                        cleanup();
                    }
                });
            } else if (result.url) {
                player.src = result.url;
                startPlayback();
            } else {
                throw new Error("No stream URL available");
            }

            // Optimized SponsorBlock skipping
            let lastSegmentIdx = 0;
            player.ontimeupdate = () => {
                const currentTime = player.currentTime;
                // If we jumped back, reset pointer
                if (skipSegments.length > 0 && currentTime < skipSegments[lastSegmentIdx]?.[0]) {
                    lastSegmentIdx = 0;
                }

                while (lastSegmentIdx < skipSegments.length) {
                    const [start, end] = skipSegments[lastSegmentIdx];
                    if (currentTime >= start && currentTime < end) {
                        player.currentTime = end;
                        break;
                    }
                    if (currentTime < start) break;
                    lastSegmentIdx++;
                }
            };
        } else {
            const fallbackPlayer = document.getElementById('fallback-player');
            if (fallbackPlayer) {
                fallbackPlayer.style.display = 'block';
                fallbackPlayer.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&modestbranding=1`;
            }
        }

        if (result.title) {
            videoTitle.innerText = result.title;
            videoUploader.innerText = result.uploader || '';
        }
    } catch (error) {
        loadingOverlay.innerHTML = `<div style="color:red; text-align:center;">Failed to load video: ${error.message}</div>`;
    }

    backBtn?.addEventListener('click', () => {
        cleanup();
        window.api.goBack();
    });

    const performSearch = () => {
        const query = searchInput?.value.trim();
        if (query) {
            cleanup();
            window.api.search(query);
        }
    };

    searchBtn?.addEventListener('click', performSearch);
    searchInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });
});
