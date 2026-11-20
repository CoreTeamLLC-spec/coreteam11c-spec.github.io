/* ============================================================
   CoreTeam.LLC — player.js
   Shared audio / YouTube player with mini + full UI.
   ============================================================ */
(function () {
    'use strict';

    const t = (key, fallback) => (window.I18n ? window.I18n.t(key, fallback) : (fallback !== undefined ? fallback : key));

    const PLAY_ICON = '<path d="M8 5v14l11-7z"/>';
    const PAUSE_ICON = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
    const VOL_ON = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>';
    const VOL_OFF = '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>';
    const COVER_PLACEHOLDER = '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>';

    window.Player = {
        audio: new Audio(),
        state: {
            tracks: [],
            queue: [],
            currentIndex: -1,
            isPlaying: false,
            ytReady: false,
            ytPlayer: null,
            volume: 1,
            muted: false,
            lastVolume: 1,
            shuffle: false,
            repeat: 'off',
            playHistory: [],
            _pendingIndex: undefined,
            _pendingPosition: 0,
            _pendingWasPlaying: false,
            _ytPendingPlay: false,
            _ytSeek: null,
            _ytLoading: false
        }
    };

    const P = window.Player;
    const S = P.state;
    const ui = {};
    let rafId = null;
    let lastProgressPaint = 0;
    const lastTimes = { current: null, total: null };

    /* ---------- helpers ---------- */
    function formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const total = Math.floor(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = String(total % 60).padStart(2, '0');
        return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
    }

    function cssUrl(url) {
        return `url("${String(url).replace(/\\/g, '%5C').replace(/"/g, '%22')}")`;
    }

    function clamp01(value) {
        return Math.max(0, Math.min(1, value));
    }

    function currentTrack() {
        return S.tracks[S.currentIndex] || null;
    }

    function showError(message) {
        if (!ui.errorMsg) return;
        ui.errorMsg.textContent = message;
        clearTimeout(showError._timer);
        showError._timer = setTimeout(() => { ui.errorMsg.textContent = ''; }, 6000);
    }

    function emitStateChange() {
        window.dispatchEvent(new CustomEvent('player:statechange', {
            detail: { currentIndex: S.currentIndex, isPlaying: S.isPlaying }
        }));
    }

    /* ---------- UI updates ---------- */
    function setDiscCover(cover) {
        if (!ui.mini.discInner) return;
        ui.mini.discInner.style.backgroundImage = cover ? cssUrl(cover) : '';
        ui.mini.discInner.classList.toggle('has-cover', Boolean(cover));
    }

    function setDiscPlaying(isPlaying) {
        if (ui.mini.disc) ui.mini.disc.classList.toggle('playing', isPlaying);
        if (ui.mini.root) ui.mini.root.classList.toggle('playing', isPlaying);
    }

    function showMiniPlayer() {
        if (!ui.mini.root) return;
        ui.mini.root.classList.add('visible');
        ui.mini.root.classList.remove('hidden');
    }

    let backdropToken = 0;

    function setFullBackdrop(cover) {
        if (!ui.full.backdrop) return;
        const token = ++backdropToken;
        ui.full.backdrop.style.backgroundImage = '';
        ui.full.root.classList.remove('backdrop-filtered');
        if (!cover) return;

        const blurred = String(cover).replace(/\.[a-z0-9]+($|\?)/i, '-blur.webp$1');
        const probe = new Image();
        probe.decoding = 'async';
        probe.onload = () => {
            if (token !== backdropToken) return;
            ui.full.backdrop.style.backgroundImage = cssUrl(blurred);
        };
        probe.onerror = () => {
            if (token !== backdropToken) return;
            ui.full.backdrop.style.backgroundImage = cssUrl(cover);
            ui.full.root.classList.add('backdrop-filtered');
        };
        probe.src = blurred;
    }

    function setFullArtwork(track) {
        const cover = track && track.cover;
        setFullBackdrop(cover);
        ui.full.root.classList.toggle('has-art', Boolean(cover));
        if (!ui.full.cover) return;

        ui.full.cover.innerHTML = '';
        if (cover) {
            const img = document.createElement('img');
            img.src = cover;
            img.alt = track ? `${track.title || ''}${track.author ? ' — ' + track.author : ''}` : '';
            img.loading = 'lazy';
            img.decoding = 'async';
            ui.full.cover.appendChild(img);
        } else {
            ui.full.cover.innerHTML = COVER_PLACEHOLDER;
        }
    }

    function setProgress(ratio) {
        const percent = `${clamp01(ratio) * 100}%`;
        if (ui.mini.progressFill) ui.mini.progressFill.style.width = percent;
        if (ui.full.progressFill) ui.full.progressFill.style.width = percent;
        const now = String(Math.round(clamp01(ratio) * 100));
        if (ui.mini.progressBar) ui.mini.progressBar.setAttribute('aria-valuenow', now);
        if (ui.full.progressBar) ui.full.progressBar.setAttribute('aria-valuenow', now);
    }

    function setTimes(current, total) {
        const currentText = formatTime(current);
        const totalText = total > 0 ? formatTime(total) : '0:00';
        if (currentText !== lastTimes.current) {
            lastTimes.current = currentText;
            if (ui.mini.cur) ui.mini.cur.textContent = currentText;
            if (ui.full.cur) ui.full.cur.textContent = currentText;
        }
        if (totalText !== lastTimes.total) {
            lastTimes.total = totalText;
            if (ui.mini.total) ui.mini.total.textContent = totalText;
            if (ui.full.total) ui.full.total.textContent = totalText;
        }
    }

    function readPosition() {
        const track = currentTrack();
        if (!track) return { current: 0, total: 0 };
        if (track.type === 'audio') {
            const total = isFinite(P.audio.duration) ? P.audio.duration : (track.duration || 0);
            return { current: P.audio.currentTime || 0, total };
        }
        if (track.type === 'youtube' && S.ytPlayer && S.ytReady) {
            return {
                current: (S.ytPlayer.getCurrentTime && S.ytPlayer.getCurrentTime()) || 0,
                total: (S.ytPlayer.getDuration && S.ytPlayer.getDuration()) || track.duration || 0
            };
        }
        return { current: 0, total: track.duration || 0 };
    }

    function updatePositionUI() {
        const { current, total } = readPosition();
        setTimes(current, total);
        if (total > 0) setProgress(current / total);
    }

    function startProgressLoop() {
        if (rafId !== null) return;
        const tick = (now) => {
            if (!S.isPlaying) { rafId = null; return; }
            if (now - lastProgressPaint >= 250) {
                lastProgressPaint = now;
                updatePositionUI();
                P.saveStateThrottled();
            }
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
    }

    function stopProgressLoop() {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
        lastProgressPaint = 0;
    }

    /* ---------- media session ---------- */
    function artworkType(src) {
        const clean = String(src || '').split('?')[0].toLowerCase();
        if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
        if (clean.endsWith('.webp')) return 'image/webp';
        if (clean.endsWith('.gif')) return 'image/gif';
        return 'image/png';
    }

    P.updateMediaSession = function () {
        if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
        const track = currentTrack();
        if (!track) return;
        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: track.title || 'CoreTeam',
                artist: track.author || 'CoreTeam.LLC',
                album: 'CoreTeam.LLC',
                artwork: track.cover
                    ? [{ src: track.cover, sizes: '512x512', type: artworkType(track.cover) }]
                    : []
            });
            navigator.mediaSession.setActionHandler('play', () => P.playTrack());
            navigator.mediaSession.setActionHandler('pause', () => P.pauseTrack());
            navigator.mediaSession.setActionHandler('previoustrack', () => P.playPrev());
            navigator.mediaSession.setActionHandler('nexttrack', () => P.playNext(false));
            navigator.mediaSession.setActionHandler('seekto', (details) => {
                if (typeof details.seekTime === 'number') P.seekTo(details.seekTime);
            });
        } catch (e) { /* unsupported */ }
    };

    /* ---------- public: init ---------- */
    P.init = function () {
        ui.mini = {
            root: document.getElementById('miniPlayer'),
            disc: document.getElementById('miniDisc'),
            discInner: document.getElementById('miniDiscInner'),
            title: document.getElementById('miniTitle'),
            author: document.getElementById('miniAuthor'),
            playIcon: document.getElementById('miniPlayIcon'),
            progressFill: document.getElementById('miniProgressFill'),
            progressBar: document.getElementById('miniProgress'),
            cur: document.getElementById('miniCur'),
            total: document.getElementById('miniTotal'),
            volumeFill: document.getElementById('miniVolumeFill'),
            volumeBar: document.getElementById('miniVolumeBar'),
            muteBtn: document.getElementById('miniMuteBtn'),
            muteIcon: document.querySelector('#miniMuteBtn svg'),
            shuffleBtn: document.getElementById('miniShuffleBtn'),
            repeatBtn: document.getElementById('miniRepeatBtn')
        };
        ui.full = {
            root: document.getElementById('fullPlayer'),
            backdrop: document.getElementById('fullBackdrop'),
            title: document.getElementById('fullTitle'),
            author: document.getElementById('fullAuthor'),
            cover: document.getElementById('fullCover'),
            playIcon: document.getElementById('fullPlayIcon'),
            progressFill: document.getElementById('fullProgressFill'),
            progressBar: document.getElementById('fullProgress'),
            cur: document.getElementById('fullCur'),
            total: document.getElementById('fullTotal'),
            volumeFill: document.getElementById('fullVolumeFill'),
            volumeBar: document.getElementById('fullVolumeBar'),
            muteBtn: document.getElementById('fullMuteBtn'),
            muteIcon: document.querySelector('#fullMuteBtn svg'),
            shuffleBtn: document.getElementById('fullShuffle'),
            repeatBtn: document.getElementById('fullRepeat')
        };
        ui.errorMsg = document.getElementById('errorMsg');

        if (!ui.mini.root || !ui.full.root) return;

        const audio = P.audio;
        audio.preload = 'metadata';

        audio.addEventListener('loadedmetadata', () => {
            const track = currentTrack();
            if (track && track.type === 'audio' && isFinite(audio.duration)) {
                if (!track.duration) track.duration = audio.duration;
                setTimes(audio.currentTime, audio.duration);
                window.dispatchEvent(new CustomEvent('player:duration', {
                    detail: { index: S.currentIndex, duration: audio.duration }
                }));
            }
        });
        audio.addEventListener('play', () => { P.updatePlayState(true); P.saveState(); });
        audio.addEventListener('pause', () => {
            if (!audio.ended) P.updatePlayState(false);
            P.saveState();
        });
        audio.addEventListener('ended', () => P.playNext(true));
        audio.addEventListener('error', () => {
            if (currentTrack() && currentTrack().type === 'audio' && P.audio.src) {
                showError(t('player.fileError', 'Failed to load the file. Check the link.'));
                P.updatePlayState(false);
            }
        });

        bindSeekBar(ui.mini.progressBar);
        bindSeekBar(ui.full.progressBar);
        bindVolumeBar(ui.mini.volumeBar);
        bindVolumeBar(ui.full.volumeBar);

        if (ui.mini.muteBtn) ui.mini.muteBtn.addEventListener('click', P.toggleMute);
        if (ui.full.muteBtn) ui.full.muteBtn.addEventListener('click', P.toggleMute);

        const on = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };
        on('miniPlay', P.togglePlay);
        on('fullPlay', P.togglePlay);
        on('miniNext', () => P.playNext(false));
        on('fullNext', () => P.playNext(false));
        on('miniPrev', P.playPrev);
        on('fullPrev', P.playPrev);
        on('miniShuffleBtn', P.toggleShuffle);
        on('fullShuffle', P.toggleShuffle);
        on('miniRepeatBtn', P.cycleRepeat);
        on('fullRepeat', P.cycleRepeat);

        on('miniExpand', (e) => { e.stopPropagation(); P.openFull(); });
        on('miniDisc', (e) => { e.stopPropagation(); P.openFull(); });
        on('fullClose', P.closeFull);
        on('miniTrackWrap', (e) => { e.stopPropagation(); P.openFull(); });

        if (ui.full.root) {
            ui.full.root.addEventListener('click', (e) => {
                if (e.target === ui.full.root || e.target === ui.full.backdrop) P.closeFull();
            });
        }

        on('miniCloseBtn', (e) => {
            e.stopPropagation();
            P.pauseTrack();
            P.resetPosition();
            ui.mini.root.classList.remove('visible', 'hidden');
            P.saveState();
        });

        ui.mini.root.addEventListener('click', (e) => {
            // Use composedPath: icon updates can detach the clicked SVG path
            // before the event bubbles up here.
            const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
            const isControl = path.some(node =>
                node instanceof Element &&
                node.matches &&
                node.matches('button, .mini-progress, .mini-volume, .mini-disc, .mini-track-wrap')
            );
            if (isControl) return;
            P.openFull();
        });

        document.addEventListener('keydown', handleKeyboard);

        initYouTube();

        ui.mini.root.classList.remove('visible');

        P.loadSavedState();
        P.updateVolumeUI();
        P.updateShuffleRepeatUI();
        P.applyVolume();
        P.refreshLabels();
    };

    /* ---------- keyboard ---------- */
    function handleKeyboard(e) {
        if (document.body.classList.contains('lightbox-open')) return;
        if (document.body.classList.contains('modal-open')) return;

        const target = e.target;
        const tag = (target.tagName || '').toLowerCase();
        const isField = tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
        if (isField) return;

        const fullOpen = ui.full.root && ui.full.root.classList.contains('open');

        if (e.key === 'Escape' && fullOpen) {
            e.preventDefault();
            P.closeFull();
            return;
        }

        const playerFocused = fullOpen || (ui.mini.root && ui.mini.root.contains(target));
        if (!playerFocused) return;

        const interactive = target.closest('button, a, [role="slider"]');
        if (e.code === 'Space' || e.key === 'Enter') {
            if (interactive) return;
            e.preventDefault();
            P.togglePlay();
            return;
        }

        // Sliders handle their own arrow-key seeking/volume.
        if (target.closest('[role="slider"]')) return;

        switch (e.code) {
            case 'ArrowRight': e.preventDefault(); P.seekBy(e.shiftKey ? 30 : 5); break;
            case 'ArrowLeft': e.preventDefault(); P.seekBy(e.shiftKey ? -30 : -5); break;
            case 'KeyM': e.preventDefault(); P.toggleMute(); break;
            case 'KeyN': e.preventDefault(); P.playNext(false); break;
            case 'KeyP': e.preventDefault(); P.playPrev(); break;
        }
    }

    /* ---------- YouTube (loaded on demand) ---------- */
    function initYouTube() {
        window.onYouTubeIframeAPIReady = createYouTubePlayer;
    }

    function ensureYouTube() {
        if (S.ytPlayer || S._ytLoading) return;
        if (window.YT && window.YT.Player) {
            createYouTubePlayer();
            return;
        }
        S._ytLoading = true;
        const existing = document.querySelector('script[src*="youtube.com/iframe_api"]');
        if (!existing) {
            const script = document.createElement('script');
            script.src = 'https://www.youtube.com/iframe_api';
            script.async = true;
            document.head.appendChild(script);
        }
        window.onYouTubeIframeAPIReady = createYouTubePlayer;
    }

    function createYouTubePlayer() {
        if (S.ytPlayer || !window.YT || !window.YT.Player) return;
        S._ytLoading = false;
        S.ytPlayer = new YT.Player('yt-player', {
            height: '0',
            width: '0',
            playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, playsinline: 1 },
            events: {
                onReady: () => {
                    S.ytReady = true;
                    P.applyVolume();
                    const track = currentTrack();
                    if (track && track.type === 'youtube') {
                        S.ytPlayer.loadVideoById(track.id);
                        S.ytPlayer.pauseVideo();
                        if (S._ytSeek != null) {
                            S.ytPlayer.seekTo(S._ytSeek, true);
                            S._ytSeek = null;
                        }
                        if (S._ytPendingPlay) {
                            S._ytPendingPlay = false;
                            S.ytPlayer.playVideo();
                        }
                    }
                },
                onStateChange: (event) => {
                    if (event.data === YT.PlayerState.PLAYING) {
                        P.updatePlayState(true);
                        updatePositionUI();
                        P.saveState();
                    } else if (event.data === YT.PlayerState.PAUSED) {
                        P.updatePlayState(false);
                        P.saveState();
                    } else if (event.data === YT.PlayerState.ENDED) {
                        P.updatePlayState(false);
                        P.playNext(true);
                    }
                },
                onError: () => showError(t('player.fileError', 'Failed to load the file. Check the link.'))
            }
        });
    }

    /* ---------- track list / queue ---------- */
    P.setTracks = function (tracks) {
        S.tracks = Array.isArray(tracks) ? tracks : [];
        if (S.currentIndex >= S.tracks.length) S.currentIndex = -1;
        if (!S.tracks.length) {
            S.queue = [];
            S.currentIndex = -1;
        }
    };

    P.setQueue = function (indices) {
        if (!Array.isArray(indices)) { S.queue = []; return; }
        S.queue = indices.filter(i => Number.isInteger(i) && i >= 0 && i < S.tracks.length);
    };

    P.getQueue = function () {
        return S.queue.length ? S.queue : S.tracks.map((_, i) => i);
    };

    P.nextIndex = function (auto) {
        const list = P.getQueue();
        if (!list.length) return -1;
        if (S.shuffle) {
            if (list.length === 1) return list[0];
            let next;
            do { next = list[Math.floor(Math.random() * list.length)]; } while (next === S.currentIndex);
            return next;
        }
        const pos = list.indexOf(S.currentIndex);
        if (pos === -1) return list[0];
        if (pos + 1 < list.length) return list[pos + 1];
        if (auto && S.repeat === 'off') return -1;
        return list[0];
    };

    P.prevIndex = function () {
        const list = P.getQueue();
        if (!list.length) return -1;
        if (S.shuffle) {
            if (S.playHistory.length > 1) {
                S.playHistory.pop();
                return S.playHistory[S.playHistory.length - 1];
            }
            if (list.length === 1) return list[0];
            let prev;
            do { prev = list[Math.floor(Math.random() * list.length)]; } while (prev === S.currentIndex);
            return prev;
        }
        const pos = list.indexOf(S.currentIndex);
        if (pos === -1) return list[list.length - 1];
        return list[(pos - 1 + list.length) % list.length];
    };

    /* ---------- select / playback ---------- */
    P.selectTrack = function (index, opts) {
        opts = opts || {};
        if (!Number.isInteger(index) || index < 0 || index >= S.tracks.length) return;

        if (S.currentIndex !== -1) {
            if (S.tracks[S.currentIndex] && S.tracks[S.currentIndex].type === 'youtube' && S.ytPlayer && S.ytReady) {
                S.ytPlayer.pauseVideo();
            } else {
                P.audio.pause();
            }
        }

        S.currentIndex = index;
        const track = S.tracks[index];

        showMiniPlayer();

        setDiscCover(track.cover);        setFullArtwork(track);

        ui.mini.title.textContent = track.title || '—';
        ui.mini.author.textContent = track.author || '';
        ui.full.title.textContent = track.title || '—';
        ui.full.author.textContent = track.author || '';
        ui.full.title.title = track.title || '';
        if (ui.errorMsg) ui.errorMsg.textContent = '';

        setProgress(0);
        setTimes(0, track.duration || 0);

        if (track.type === 'audio') {
            if (P.audio.dataset.src !== track.src) {
                P.audio.dataset.src = track.src;
                P.audio.src = track.src;
                P.audio.load();
            } else {
                try { P.audio.currentTime = 0; } catch (e) { /* not ready */ }
            }
            P.applyVolume();
        } else if (track.type === 'youtube') {
            ensureYouTube();
            if (S.ytPlayer && S.ytReady) {
                S.ytPlayer.loadVideoById(track.id);
                S.ytPlayer.pauseVideo();
            }
        }

        P.updatePlayState(false);
        P.updateMediaSession();
        P.updateShuffleRepeatUI();

        if (S._pendingPosition > 0) {
            const position = S._pendingPosition;
            S._pendingPosition = 0;
            P.seekTo(position);
        }

        window.dispatchEvent(new CustomEvent('player:trackchange', {
            detail: { index, track }
        }));

        if (!opts.silent) P.saveState();
        if (opts.autoplay) P.playTrack();
    };

    P.togglePlay = function () {
        if (S.isPlaying) P.pauseTrack();
        else P.playTrack();
    };

    P.playTrack = function () {
        if (!S.tracks.length) return;
        if (S.currentIndex === -1) P.selectTrack(0, { silent: true });

        const track = currentTrack();
        if (!track) return;

        showMiniPlayer();

        if (track.type === 'youtube') {
            ensureYouTube();
            if (S.ytPlayer && S.ytReady) {
                S.ytPlayer.playVideo();
            } else {
                S._ytPendingPlay = true;
            }
            return;
        }

        const promise = P.audio.play();
        if (promise && typeof promise.catch === 'function') {
            promise.catch((error) => {
                if (error && error.name === 'AbortError') return;
                showError(t('player.playError', 'Error: audio file not found or blocked.'));
                P.updatePlayState(false);
            });
        }
    };

    P.pauseTrack = function () {
        if (S.currentIndex === -1) return;
        const track = currentTrack();
        if (!track) return;
        if (track.type === 'youtube' && S.ytPlayer && S.ytReady) {
            S.ytPlayer.pauseVideo();
        } else {
            P.audio.pause();
        }
        P.updatePlayState(false);
    };

    P.playNext = function (auto) {
        if (!S.tracks.length) return;
        if (auto && S.repeat === 'one') {
            P.seekTo(0);
            P.playTrack();
            return;
        }
        const next = P.nextIndex(Boolean(auto));
        if (next === -1) {
            P.updatePlayState(false);
            P.saveState();
            return;
        }
        S.playHistory.push(next);
        if (S.playHistory.length > 50) S.playHistory.shift();
        P.selectTrack(next, { autoplay: true, silent: true });
    };

    P.playPrev = function () {
        if (!S.tracks.length) return;
        const { current } = readPosition();
        if (current > 3) {
            P.seekTo(0);
            return;
        }
        const prev = P.prevIndex();
        if (prev === -1) return;
        P.selectTrack(prev, { autoplay: true, silent: true });
    };

    P.seekTo = function (seconds, options) {
        const track = currentTrack();
        if (!track) return;
        const shouldSave = !options || options.save !== false;
        const value = Math.max(0, seconds || 0);
        if (track.type === 'audio') {
            const apply = () => {
                try { P.audio.currentTime = value; } catch (e) { /* not ready */ }
                updatePositionUI();
                if (shouldSave) P.saveState();
            };
            if (P.audio.readyState >= 1) apply();
            else P.audio.addEventListener('loadedmetadata', apply, { once: true });
        } else if (track.type === 'youtube') {
            if (S.ytPlayer && S.ytReady) {
                S.ytPlayer.seekTo(value, true);
                updatePositionUI();
                if (shouldSave) P.saveState();
            } else {
                S._ytSeek = value;
            }
        }
    };

    P.seekBy = function (delta) {
        const { current, total } = readPosition();
        if (!total) return;
        P.seekTo(Math.max(0, Math.min(total, current + delta)));
    };

    P.seekToRatio = function (ratio, options) {
        const { total } = readPosition();
        if (!total) return;
        P.seekTo(clamp01(ratio) * total, options);
    };

    P.resetPosition = function () {
        const track = currentTrack();
        if (!track) return;
        P.seekTo(0, { save: false });
        setProgress(0);
        setTimes(0, track.duration || 0);
    };

    P.updateProgress = function () {
        updatePositionUI();
        if (S.isPlaying) startProgressLoop();
    };

    /* ---------- state ---------- */
    P.updatePlayState = function (isPlaying) {
        if (!ui.mini || !ui.full) return;
        S.isPlaying = Boolean(isPlaying);
        const icon = isPlaying ? PAUSE_ICON : PLAY_ICON;
        if (ui.mini.playIcon) ui.mini.playIcon.innerHTML = icon;
        if (ui.full.playIcon) ui.full.playIcon.innerHTML = icon;
        setDiscPlaying(isPlaying);

        const track = currentTrack();
        if (track) {
            document.title = `${isPlaying ? '▶' : '❚❚'} ${track.title || 'CoreTeam'} — ${track.author || 'CoreTeam.LLC'}`;
        } else {
            document.title = t('site.title', 'CoreTeam.LLC');
        }

        if (isPlaying) startProgressLoop();
        else stopProgressLoop();

        P.refreshPlayLabels();
        emitStateChange();
    };

    P.refreshPlayLabels = function () {
        if (!ui.mini || !ui.full) return;
        const label = S.isPlaying ? t('playlist.pause', 'Pause') : t('playlist.play', 'Play');
        ['miniPlay', 'fullPlay'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.setAttribute('aria-label', label);
                el.title = label;
            }
        });
    };

    P.refreshLabels = function () {
        if (!ui.mini || !ui.full) return;
        P.refreshPlayLabels();
        P.updateShuffleRepeatUI();
        P.updateVolumeUI();
        if (currentTrack()) {
            document.title = `${S.isPlaying ? '▶' : '❚❚'} ${currentTrack().title || 'CoreTeam'} — ${currentTrack().author || 'CoreTeam.LLC'}`;
        } else {
            document.title = t('site.title', 'CoreTeam.LLC');
        }
    };

    /* ---------- volume ---------- */
    P.updateVolumeUI = function () {
        if (!ui.mini || !ui.full) return;
        const effective = S.muted ? 0 : S.volume;
        const percent = `${clamp01(effective) * 100}%`;
        if (ui.mini.volumeFill) ui.mini.volumeFill.style.width = percent;
        if (ui.full.volumeFill) ui.full.volumeFill.style.width = percent;

        const icon = S.muted || S.volume === 0 ? VOL_OFF : VOL_ON;
        if (ui.mini.muteIcon) ui.mini.muteIcon.innerHTML = icon;
        if (ui.full.muteIcon) ui.full.muteIcon.innerHTML = icon;

        const muteLabel = S.muted ? t('player.unmute', 'Unmute') : t('player.mute', 'Mute');
        [ui.mini.muteBtn, ui.full.muteBtn].forEach(btn => {
            if (!btn) return;
            btn.title = muteLabel;
            btn.setAttribute('aria-label', muteLabel);
        });

        const value = String(Math.round(clamp01(effective) * 100));
        if (ui.mini.volumeBar) ui.mini.volumeBar.setAttribute('aria-valuenow', value);
        if (ui.full.volumeBar) ui.full.volumeBar.setAttribute('aria-valuenow', value);
    };

    P.setVolume = function (value, save) {
        S.volume = clamp01(Number(value) || 0);
        if (S.volume > 0) S.muted = false;
        P.updateVolumeUI();
        P.applyVolume();
        if (save !== false) P.saveState();
    };

    P.applyVolume = function () {
        const volume = S.muted ? 0 : S.volume;
        P.audio.volume = volume;
        if (S.ytPlayer && S.ytReady && typeof S.ytPlayer.setVolume === 'function') {
            S.ytPlayer.setVolume(volume * 100);
        }
    };

    P.toggleMute = function () {
        if (S.muted) {
            S.muted = false;
            if (S.volume === 0) S.volume = S.lastVolume || 0.5;
        } else {
            S.lastVolume = S.volume;
            S.muted = true;
        }
        P.updateVolumeUI();
        P.applyVolume();
        P.saveState();
    };

    /* ---------- shuffle / repeat ---------- */
    P.toggleShuffle = function () {
        S.shuffle = !S.shuffle;
        P.updateShuffleRepeatUI();
        P.saveState();
    };

    P.cycleRepeat = function () {
        S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off';
        P.updateShuffleRepeatUI();
        P.saveState();
    };

    P.updateShuffleRepeatUI = function () {
        if (!ui.mini || !ui.full) return;
        const pairs = [
            [ui.mini.shuffleBtn, ui.mini.repeatBtn],
            [ui.full.shuffleBtn, ui.full.repeatBtn]
        ];

        const repeatTitle = S.repeat === 'off'
            ? t('player.repeatOff', 'Repeat off')
            : S.repeat === 'all'
                ? t('player.repeatAll', 'Repeat playlist')
                : t('player.repeatOne', 'Repeat track');

        pairs.forEach(([shuffleBtn, repeatBtn]) => {
            if (shuffleBtn) {
                shuffleBtn.classList.toggle('active', S.shuffle);
                shuffleBtn.setAttribute('aria-pressed', String(S.shuffle));
            }
            if (repeatBtn) {
                repeatBtn.classList.toggle('active', S.repeat !== 'off');
                repeatBtn.classList.toggle('repeat-one', S.repeat === 'one');
                repeatBtn.title = repeatTitle;
                repeatBtn.setAttribute('aria-label', repeatTitle);
                repeatBtn.setAttribute('aria-pressed', String(S.repeat !== 'off'));
            }
        });
    };

    /* ---------- full player ---------- */
    P.openFull = function () {
        if (!ui.full.root) return;
        ui.full.root.classList.add('open');
        ui.full.root.setAttribute('aria-hidden', 'false');
        document.body.classList.add('player-expanded');
        const close = document.getElementById('fullClose');
        if (close) close.focus({ preventScroll: true });
        updatePositionUI();
    };

    P.closeFull = function () {
        if (!ui.full.root) return;
        ui.full.root.classList.remove('open');
        ui.full.root.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('player-expanded');
        const miniPlay = document.getElementById('miniPlay');
        if (miniPlay) miniPlay.focus({ preventScroll: true });
    };

    /* ---------- persistence ---------- */
    P.saveState = function () {
        try {
            localStorage.setItem('ct-settings', JSON.stringify({
                volume: S.volume,
                muted: S.muted,
                shuffle: S.shuffle,
                repeat: S.repeat
            }));

            if (S.currentIndex >= 0) {
                const track = currentTrack();
                let position = 0;
                if (track) {
                    if (track.type === 'audio') position = P.audio.currentTime || 0;
                    else if (track.type === 'youtube' && S.ytPlayer && S.ytReady) {
                        position = S.ytPlayer.getCurrentTime() || 0;
                    }
                }
                sessionStorage.setItem('ct-session', JSON.stringify({
                    index: S.currentIndex,
                    position: position,
                    wasPlaying: S.isPlaying
                }));
            }
        } catch (e) { /* storage unavailable */ }
    };

    P.saveStateThrottled = (function () {
        let last = 0;
        return function () {
            const now = Date.now();
            if (now - last > 1000) {
                last = now;
                P.saveState();
            }
        };
    })();

    P.loadSavedState = function () {
        try {
            const rawSettings = localStorage.getItem('ct-settings');
            if (rawSettings) {
                const settings = JSON.parse(rawSettings);
                if (typeof settings.volume === 'number') S.volume = clamp01(settings.volume);
                if (typeof settings.shuffle === 'boolean') S.shuffle = settings.shuffle;
                if (settings.repeat === 'all' || settings.repeat === 'one' || settings.repeat === 'off') {
                    S.repeat = settings.repeat;
                }
                if (typeof settings.muted === 'boolean') {
                    S.muted = settings.muted;
                    if (settings.muted) S.lastVolume = S.volume || 0.5;
                }
            }

            const rawSession = sessionStorage.getItem('ct-session');
            if (rawSession) {
                const session = JSON.parse(rawSession);
                if (typeof session.index === 'number' && session.index >= 0) {
                    S._pendingIndex = session.index;
                    S._pendingPosition = Number(session.position) || 0;
                    S._pendingWasPlaying = Boolean(session.wasPlaying);
                }
            }
        } catch (e) { /* corrupt state */ }
    };

    P.restorePending = function () {
        const index = S._pendingIndex;
        S._pendingIndex = undefined;
        S._pendingWasPlaying = false;
        if (typeof index === 'number' && index >= 0 && index < S.tracks.length) {
            P.selectTrack(index, { silent: true });
            P.saveState();
        }
    };

    /* ---------- range inputs ---------- */
    function bindSeekBar(el) {
        if (!el) return;
        let dragging = false;

        const ratioFrom = (event) => {
            const rect = el.getBoundingClientRect();
            if (!rect.width) return 0;
            return clamp01((event.clientX - rect.left) / rect.width);
        };

        el.addEventListener('pointerdown', (event) => {
            if (S.currentIndex === -1) return;
            dragging = true;
            el.classList.add('is-dragging');
            if (el.setPointerCapture) {
                try { el.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
            }
            P.seekToRatio(ratioFrom(event), { save: false });
            event.preventDefault();
        });

        el.addEventListener('pointermove', (event) => {
            if (!dragging) return;
            P.seekToRatio(ratioFrom(event), { save: false });
        });

        const endDrag = (event) => {
            if (!dragging) return;
            dragging = false;
            el.classList.remove('is-dragging');
            if (el.releasePointerCapture) {
                try { el.releasePointerCapture(event.pointerId); } catch (e) { /* ignore */ }
            }
            P.saveState();
        };
        el.addEventListener('pointerup', endDrag);
        el.addEventListener('pointercancel', endDrag);

        el.addEventListener('keydown', (event) => {
            if (S.currentIndex === -1) return;
            const step = event.shiftKey ? 30 : 5;
            if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                event.preventDefault();
                P.seekBy(step);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                event.preventDefault();
                P.seekBy(-step);
            } else if (event.key === 'Home') {
                event.preventDefault();
                P.seekTo(0);
            } else if (event.key === 'End') {
                event.preventDefault();
                P.seekBy(1e9);
            }
        });
    }

    function bindVolumeBar(el) {
        if (!el) return;
        let dragging = false;

        const ratioFrom = (event) => {
            const rect = el.getBoundingClientRect();
            if (!rect.width) return 0;
            return clamp01((event.clientX - rect.left) / rect.width);
        };

        el.addEventListener('pointerdown', (event) => {
            dragging = true;
            el.classList.add('is-dragging');
            if (el.setPointerCapture) {
                try { el.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
            }
            P.setVolume(ratioFrom(event), false);
            event.preventDefault();
        });
        el.addEventListener('pointermove', (event) => {
            if (dragging) P.setVolume(ratioFrom(event), false);
        });
        const endDrag = (event) => {
            if (!dragging) return;
            dragging = false;
            el.classList.remove('is-dragging');
            if (el.releasePointerCapture) {
                try { el.releasePointerCapture(event.pointerId); } catch (e) { /* ignore */ }
            }
            P.saveState();
        };
        el.addEventListener('pointerup', endDrag);
        el.addEventListener('pointercancel', endDrag);

        el.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                event.preventDefault();
                P.setVolume(S.volume + 0.05);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                event.preventDefault();
                P.setVolume(S.volume - 0.05);
            }
        });
    }

    P.formatTime = formatTime;
    P.getCurrentTrack = currentTrack;
})();
