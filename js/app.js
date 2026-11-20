/* ============================================================
   CoreTeam.LLC — app.js
   ============================================================ */

'use strict';

const MUSIC_FILE = './data/music.json';
const PROJECTS_INDEX = './data/projects/index.json';
const PROJECTS_DIR = './data/projects/';
const CREDITS_FILE = './data/credits.json';
let projectRecordsPromise = null;

const PLAY_ICON = '<path d="M8 5v14l11-7z"/>';
const PAUSE_ICON = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';

function t(key, fallback) {
    return window.I18n ? window.I18n.t(key, fallback) : (fallback !== undefined ? fallback : key);
}

const appState = {
    projects: [],
    tracks: [],
    playlists: {},
    currentPlaylist: null,
    musicDetailOpen: false,
    credits: [],
    creditsLoaded: false,
    creditsLoading: false
};

const appUi = {
    main: document.getElementById('main'),
    trackList: document.getElementById('trackList'),
    projectsGrid: document.getElementById('projectsGrid'),
    homeProjects: document.getElementById('homeProjects'),
    homeWorkSection: document.getElementById('homeWorkSection'),
    projectPage: document.getElementById('projectPage'),
    creditsGrid: document.getElementById('creditsGrid')
};

/* ---------- helpers ---------- */
function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

function escapeCssUrl(value) {
    return escapeHtml(String(value).replace(/'/g, '%27').replace(/"/g, '%22'));
}

function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function formatTotalDuration(indices) {
    let total = 0;
    indices.forEach((index) => {
        const track = appState.tracks[index];
        if (track && track.duration) total += track.duration;
    });
    if (!total) return '';
    const minutes = Math.round(total / 60);
    const minUnit = t('playlist.minUnit', 'min');
    const hourUnit = t('playlist.hourUnit', 'h');
    if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        return rest ? `${hours} ${hourUnit} ${rest} ${minUnit}` : `${hours} ${hourUnit}`;
    }
    return `${minutes} ${minUnit}`;
}

function trackCountLabel(count) {
    const lang = window.I18n ? window.I18n.getLang() : 'en';
    if (lang === 'ru') {
        const n10 = count % 10;
        const n100 = count % 100;
        if (n10 === 1 && n100 !== 11) return t('playlist.trackOne', 'трек');
        if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return t('playlist.trackFew', 'трека');
        return t('playlist.trackMany', 'треков');
    }
    return count === 1 ? t('playlist.trackOne', 'track') : t('playlist.tracks', 'tracks');
}

/* ---------- views ---------- */
function showView(name) {
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    const target = document.getElementById('view-' + name);
    if (target) target.classList.add('active');

    document.querySelectorAll('.side-nav a').forEach(link => {
        const isActive = link.dataset.view === name;
        link.classList.toggle('active', isActive);
        if (isActive) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });

    const main = appUi.main;
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
    closeMobileMenu();
}

/* ---------- navigation ---------- */
document.querySelectorAll('.side-nav a').forEach(link => {
    link.addEventListener('click', () => {
        const view = link.dataset.view;
        const hash = location.hash;
        const isCurrent = view === 'home'
            ? (hash === '' || hash === '#')
            : hash === '#' + view;
        if (isCurrent) showView(view);
        closeMobileMenu();
    });
});

document.querySelectorAll('[data-view-link]').forEach(link => {
    link.addEventListener('click', (event) => {
        if (location.hash === '' || location.hash === '#') {
            event.preventDefault();
            showView('home');
            history.replaceState(null, '', location.pathname + location.search);
        }
    });
});

/* ---------- mobile menu ---------- */
const menuBtn = document.getElementById('menuBtn');
const sideMenu = document.getElementById('sideMenu');
const menuOverlay = document.getElementById('menuOverlay');
const menuClose = document.getElementById('menuClose');

function openMobileMenu() {
    if (!sideMenu) return;
    sideMenu.classList.add('open');
    if (menuOverlay) menuOverlay.classList.add('open');
    if (menuBtn) {
        menuBtn.classList.add('open');
        menuBtn.setAttribute('aria-expanded', 'true');
    }
    document.body.classList.add('menu-open');
    const firstLink = sideMenu.querySelector('.side-nav a');
    if (firstLink) setTimeout(() => firstLink.focus({ preventScroll: true }), 200);
}

function closeMobileMenu() {
    if (!sideMenu || !sideMenu.classList.contains('open')) return;
    sideMenu.classList.remove('open');
    if (menuOverlay) menuOverlay.classList.remove('open');
    if (menuBtn) {
        menuBtn.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
    }
    document.body.classList.remove('menu-open');
    if (menuBtn && sideMenu.contains(document.activeElement)) {
        menuBtn.focus({ preventScroll: true });
    }
}

if (menuBtn && sideMenu) {
    menuBtn.addEventListener('click', () => {
        if (sideMenu.classList.contains('open')) closeMobileMenu();
        else openMobileMenu();
    });
    if (menuOverlay) menuOverlay.addEventListener('click', closeMobileMenu);
    if (menuClose) menuClose.addEventListener('click', closeMobileMenu);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && sideMenu.classList.contains('open')) closeMobileMenu();
    });
    const desktopQuery = window.matchMedia('(min-width: 901px)');
    const onDesktop = (event) => { if (event.matches) closeMobileMenu(); };
    if (desktopQuery.addEventListener) desktopQuery.addEventListener('change', onDesktop);
}

/* ---------- project helpers ---------- */
function getProjectIcon(project, size) {
    size = size || 128;
    if (project.icon && typeof project.icon === 'object') {
        const sizes = Object.keys(project.icon).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
        if (project.icon[size]) return project.icon[size];
        const bigger = sizes.find(s => s >= size);
        return project.icon[bigger || sizes[sizes.length - 1]] || '';
    }
    return project.logo || project.cover || '';
}

function getProjectCover(project) {
    return project.cover
        || (Array.isArray(project.screenshots) && project.screenshots[0])
        || project.logo
        || getProjectIcon(project, 512)
        || '';
}

function findProject(projectId) {
    if (!projectId) return null;
    return appState.projects.find(project => project.id === projectId) || null;
}

function getPlaylistCover(projectId, firstTrack) {
    const project = findProject(projectId);
    if (project) {
        const cover = getProjectCover(project);
        if (cover) return cover;
        const icon = getProjectIcon(project, 256);
        if (icon) return icon;
    }
    return firstTrack && firstTrack.cover ? firstTrack.cover : '';
}

function getPlaylistTitle(projectId) {
    const project = findProject(projectId);
    return (project && project.title) || projectId || 'Playlist';
}

function getLinkIcon(type, url) {
    const ICON_DOWNLOAD = '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>';
    const ICON_EXTERNAL = '<path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>';
    const ICON_DRIVE = '<path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>';
    if (url && (url.includes('drive.google.com') || url.includes('yandex'))) return ICON_DRIVE;
    return type === 'external' ? ICON_EXTERNAL : ICON_DOWNLOAD;
}

function normalizeLinks(links) {
    if (!Array.isArray(links)) return [];
    return links.map(link => {
        if (!link || typeof link !== 'object') return null;
        const url = typeof link.url === 'string' ? link.url.trim() : '';
        if (!url || /^javascript:/i.test(url)) return null;
        const isExternal = /^(https?:)?\/\//i.test(url) || /^(mailto:|tel:)/i.test(url);
        return {
            label: String(link.label || link.url || 'Download'),
            url,
            isExternal,
            type: isExternal ? 'external' : 'download'
        };
    }).filter(Boolean);
}

/* ---------- project loading ---------- */
function loadProjectRecords() {
    if (projectRecordsPromise) return projectRecordsPromise;

    projectRecordsPromise = (async () => {
        const indexResponse = await fetch(PROJECTS_INDEX, { cache: 'no-cache' });
        if (!indexResponse.ok) throw new Error(`${t('errors.projectsNotFound', 'Projects index not found')} (${indexResponse.status})`);

        const entries = await indexResponse.json();
        if (!Array.isArray(entries)) throw new Error('projects/index.json must be an array');

        const results = await Promise.allSettled(entries.map(entry => {
            const file = typeof entry === 'string'
                ? `${entry.trim()}.json`
                : entry && typeof entry.file === 'string' ? entry.file.trim() : '';
            if (!file || file.startsWith('/') || file.split('/').includes('..')) {
                return Promise.reject(new Error(`Invalid project file: ${file}`));
            }
            const url = PROJECTS_DIR + file.split('/').map(encodeURIComponent).join('/');
            return fetch(url, { cache: 'no-cache' }).then(response => {
                if (!response.ok) throw new Error(`404: ${file}`);
                return response.json();
            });
        }));

        const records = results
            .filter(result => result.status === 'fulfilled' && result.value && result.value.id)
            .map(result => result.value);
        const failed = results.filter(result => result.status === 'rejected');
        if (failed.length) console.warn('[projects] failed:', failed.map(item => item.reason && item.reason.message));
        return records;
    })();

    projectRecordsPromise.catch(() => { projectRecordsPromise = null; });
    return projectRecordsPromise;
}

async function loadProjects() {
    try {
        appState.projects = await loadProjectRecords();
        renderProjectGrids();
    } catch (error) {
        console.error('[projects]', error);
        const message = `<div class="empty-state empty-state-error">${escapeHtml(error.message)}</div>`;
        if (appUi.projectsGrid) appUi.projectsGrid.innerHTML = message;
        if (appUi.homeProjects) appUi.homeProjects.innerHTML = message;
    }
}

function createProjectCard(project, index) {
    const card = document.createElement('article');
    card.className = 'project-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'link');
    card.setAttribute('aria-label', `${t('projects.open', 'Open project')}: ${project.title || ''}`);
    if (project.id) card.dataset.projectId = project.id;
    card.style.setProperty('--i', String(index || 0));

    const cover = getProjectCover(project);
    const category = project.category || '';
    const version = project.version || '';
    const updated = project.updated || '';
    const title = project.title || '';
    const letter = title.trim().charAt(0).toUpperCase() || '?';

    card.innerHTML = `
        <div class="project-card-media">
            ${cover
                ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async">`
                : `<span class="project-card-fallback" aria-hidden="true">${escapeHtml(letter)}</span>`}
            <span class="project-card-shade" aria-hidden="true"></span>
            ${category ? `<span class="project-card-tag">${escapeHtml(category)}</span>` : ''}
            <span class="project-card-open" aria-hidden="true">
                <span>${escapeHtml(t('projects.open', 'Open project'))}</span>
                <svg viewBox="0 0 24 24"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
            </span>
        </div>
        <div class="project-card-body">
            <h3 class="project-card-title">${escapeHtml(title)}</h3>
            <p class="project-card-desc">${escapeHtml(project.description || '')}</p>
            <div class="project-card-foot">
                ${version ? `<span class="project-card-ver">v${escapeHtml(version)}</span>` : '<span></span>'}
                ${updated ? `<span>${escapeHtml(updated)}</span>` : ''}
            </div>
        </div>
    `;

    const open = () => {
        if (!project.id) return;
        location.hash = '#project/' + encodeURIComponent(project.id);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
        }
    });

    return card;
}

function createCatalogNote() {
    const note = document.createElement('article');
    note.className = 'project-card project-card-note';
    note.innerHTML = `
        <div class="note-link">
            <span class="note-eyebrow">${escapeHtml(t('projects.soonEyebrow', 'Catalog'))}</span>
            <span class="note-title">${escapeHtml(t('projects.soonTitle', 'New projects coming soon'))}</span>
            <span class="note-desc">${escapeHtml(t('projects.soonDesc', "We're working on new games and will show them soon."))}</span>
        </div>
    `;
    return note;
}

function renderProjectGrids() {
    const projects = appState.projects;

    if (appUi.projectsGrid) {
        appUi.projectsGrid.innerHTML = '';
        if (!projects.length) {
            appUi.projectsGrid.innerHTML = `<div class="empty-state">${escapeHtml(t('projects.empty', 'No projects yet.'))}</div>`;
        } else {
            const fragment = document.createDocumentFragment();
            projects.forEach((project, index) => fragment.appendChild(createProjectCard(project, index)));
            if (projects.length < 4) fragment.appendChild(createCatalogNote());
            appUi.projectsGrid.appendChild(fragment);
        }
    }

    if (appUi.homeProjects) {
        appUi.homeProjects.innerHTML = '';
        if (projects.length) {
            const fragment = document.createDocumentFragment();
            projects.slice(0, 3).forEach((project, index) => fragment.appendChild(createProjectCard(project, index)));
            if (projects.length < 4) fragment.appendChild(createCatalogNote());
            appUi.homeProjects.appendChild(fragment);
        }
        if (appUi.homeWorkSection) appUi.homeWorkSection.hidden = !projects.length;
    }
}

/* ---------- project page ---------- */
function openProject(id) {
    const project = appState.projects.find(item => item.id === id);
    if (!project) {
        showView('projects');
        return;
    }

    window.__currentProjectId = project.id;

    const cover = getProjectCover(project);
    const bigIcon = getProjectIcon(project, 256) || cover;
    const links = normalizeLinks(project.links);

    const linksHtml = links.map(link => {
        const icon = getLinkIcon(link.type, link.url);
        const attrs = link.isExternal
            ? `href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer"`
            : `href="${escapeHtml(link.url)}" download`;
        return `
            <a class="play-link" ${attrs}>
                <span class="play-link-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></span>
                <span class="play-link-text">
                    <span class="play-link-label">${escapeHtml(link.label)}</span>
                    ${link.isExternal ? `<span class="play-link-hint">${escapeHtml(t('projects.externalHint', 'opens in a new tab'))}</span>` : ''}
                </span>
                <svg class="play-link-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
            </a>
        `;
    }).join('');

    const tags = [
        project.category ? `<span class="play-tag">${escapeHtml(project.category)}</span>` : '',
        project.version ? `<span class="play-tag">v${escapeHtml(project.version)}</span>` : ''
    ].filter(Boolean).join('');

    const metaParts = [
        project.updated ? `${escapeHtml(t('projects.updated', 'Updated'))} ${escapeHtml(project.updated)}` : '',
        project.size ? escapeHtml(project.size) : ''
    ].filter(Boolean);

    const metaNextToButton = metaParts.length
        ? `<span class="download-meta">${metaParts.join(' <span class="meta-dot">•</span> ')}</span>`
        : '';

    const facts = [
        [t('projects.version', 'Version'), project.version ? 'v' + project.version : ''],
        [t('projects.size', 'Size'), project.size || ''],
        [t('projects.updated', 'Updated'), project.updated || ''],
        [t('projects.developer', 'Developer'), project.developer || ''],
        [t('projects.category', 'Category'), project.category || '']
    ].filter(([, value]) => value);

    const factsHtml = facts.length
        ? `<aside class="project-facts">
                <h2>${escapeHtml(t('projects.details', 'Details'))}</h2>
                <dl>
                    ${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}
                </dl>
            </aside>`
        : '';

    const screenshots = (Array.isArray(project.screenshots) ? project.screenshots : []).filter(Boolean);
    const screenshotsHtml = screenshots.length
        ? `<div class="play-section">
                <div class="play-section-head">
                    <h2>${escapeHtml(t('projects.screenshots', 'Screenshots'))}</h2>
                    <span class="section-count">${screenshots.length}</span>
                </div>
                <div class="screenshots-carousel-wrapper">
                    <button class="carousel-arrow carousel-prev" id="carouselPrev" aria-label="Previous screenshots">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                    </button>
                    <div class="screenshots-grid" id="screenshotsGrid">
                        ${screenshots.map((src, index) => `
                            <button class="screenshot-item" type="button" data-index="${index}" aria-label="${escapeHtml(t('projects.screenshots', 'Screenshots'))} ${index + 1}">
                                <img src="${escapeHtml(src)}" alt="${escapeHtml(project.title || '')} — ${index + 1}" loading="lazy" decoding="async">
                            </button>
                        `).join('')}
                    </div>
                    <button class="carousel-arrow carousel-next" id="carouselNext" aria-label="Next screenshots">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>
                    </button>
                </div>
            </div>`
        : '';

    appUi.projectPage.innerHTML = `
        <button class="back-btn" id="backBtn">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
            ${escapeHtml(t('projects.back', 'Back to projects'))}
        </button>

        <div class="play-banner">
            ${cover ? `<div class="play-banner-bg" style="background-image:url('${escapeCssUrl(cover)}')"></div>` : ''}
            <div class="play-banner-content">
                <div class="play-icon">
                    ${bigIcon ? `<img src="${escapeHtml(bigIcon)}" alt="${escapeHtml(project.title || '')}" decoding="async">` : ''}
                </div>
                <div class="play-header-info">
                    <div class="play-eyebrow">${escapeHtml(t('projects.eyebrow', 'Project'))}</div>
                    <h1>${escapeHtml(project.title || '')}</h1>
                    ${project.developer ? `<div class="play-developer">${escapeHtml(project.developer)}</div>` : ''}
                    <div class="play-tags">${tags}</div>
                </div>
            </div>
        </div>

        ${links.length ? `
            <div class="download-section">
                <div class="download-row">
                    <button class="download-btn" id="downloadBtn" aria-expanded="false" aria-controls="downloadSources">
                        <span>${escapeHtml(t('projects.download', 'Download'))}</span>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>
                    </button>
                    ${metaNextToButton}
                </div>
                <div class="download-sources" id="downloadSources">
                    <div class="download-sources-inner">
                        <div class="download-hint">${escapeHtml(t('projects.sourcesHint', 'Available download sources'))}</div>
                        ${linksHtml}
                    </div>
                </div>
            </div>
        ` : ''}

        <div class="project-layout">
            <section class="play-section project-about">
                <h2>${escapeHtml(t('projects.description', 'Description'))}</h2>
                <p class="play-description">${escapeHtml(project.fullDescription || project.description || '')}</p>
            </section>
            ${factsHtml}
        </div>

        ${screenshotsHtml}
    `;

    showView('project-page');

    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.addEventListener('click', () => { location.hash = '#projects'; });

    const downloadBtn = document.getElementById('downloadBtn');
    const downloadSources = document.getElementById('downloadSources');
    if (downloadBtn && downloadSources) {
        downloadBtn.addEventListener('click', () => {
            const isOpen = downloadSources.classList.toggle('open');
            downloadBtn.classList.toggle('active', isOpen);
            downloadBtn.setAttribute('aria-expanded', String(isOpen));
        });
    }

    if (screenshots.length) {
        const grid = document.getElementById('screenshotsGrid');
        const prevBtn = document.getElementById('carouselPrev');
        const nextBtn = document.getElementById('carouselNext');

        const updateArrows = () => {
            if (!grid || !prevBtn || !nextBtn) return;
            const maxScroll = grid.scrollWidth - grid.clientWidth;
            prevBtn.disabled = grid.scrollLeft <= 4;
            nextBtn.disabled = grid.scrollLeft >= maxScroll - 4;
        };

        if (screenshots.length <= 1) {
            if (prevBtn) prevBtn.hidden = true;
            if (nextBtn) nextBtn.hidden = true;
        } else {
            const scrollAmount = () => Math.max(240, grid.clientWidth * 0.8);
            if (prevBtn) prevBtn.addEventListener('click', () => grid.scrollBy({ left: -scrollAmount(), behavior: 'smooth' }));
            if (nextBtn) nextBtn.addEventListener('click', () => grid.scrollBy({ left: scrollAmount(), behavior: 'smooth' }));
            grid.addEventListener('scroll', updateArrows, { passive: true });
            window.addEventListener('resize', updateArrows);
            grid.querySelectorAll('img').forEach(img => img.addEventListener('load', updateArrows, { once: true }));
            requestAnimationFrame(updateArrows);
            setTimeout(updateArrows, 400);
        }

        appUi.projectPage.querySelectorAll('.screenshot-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = Number(item.dataset.index) || 0;
                openLightbox(screenshots, index);
            });
        });
    }
}

/* ---------- lightbox ---------- */
function openLightbox(images, startIndex) {
    const list = images.filter(Boolean);
    if (!list.length) return;

    let current = Math.max(0, Math.min(startIndex, list.length - 1));
    const previousFocus = document.activeElement;

    const lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-label', 'Screenshots');
    lightbox.innerHTML = `
        <div class="lightbox-backdrop"></div>
        <button class="lightbox-arrow lightbox-prev" aria-label="Previous image">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
        </button>
        <figure class="lightbox-figure">
            <img src="${escapeHtml(list[current])}" alt="">
        </figure>
        <button class="lightbox-arrow lightbox-next" aria-label="Next image">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>
        </button>
        <div class="lightbox-counter">${current + 1} / ${list.length}</div>
        <button class="lightbox-close" aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>
        </button>
    `;

    document.body.appendChild(lightbox);
    document.body.classList.add('lightbox-open');
    requestAnimationFrame(() => lightbox.classList.add('open'));

    const imageEl = lightbox.querySelector('img');
    const counterEl = lightbox.querySelector('.lightbox-counter');
    const prevBtn = lightbox.querySelector('.lightbox-prev');
    const nextBtn = lightbox.querySelector('.lightbox-next');
    const closeBtn = lightbox.querySelector('.lightbox-close');

    if (list.length <= 1) {
        prevBtn.hidden = true;
        nextBtn.hidden = true;
        counterEl.hidden = true;
    }

    const render = () => {
        imageEl.src = list[current];
        counterEl.textContent = `${current + 1} / ${list.length}`;
        [current - 1, current + 1].forEach((neighbor) => {
            if (neighbor >= 0 && neighbor < list.length) {
                const img = new Image();
                img.src = list[neighbor];
            }
        });
    };

    const goPrev = () => { current = (current - 1 + list.length) % list.length; render(); };
    const goNext = () => { current = (current + 1) % list.length; render(); };

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        lightbox.classList.remove('open');
        document.body.classList.remove('lightbox-open');
        document.removeEventListener('keydown', onKey);
        if (previousFocus && previousFocus.focus) previousFocus.focus({ preventScroll: true });
        setTimeout(() => lightbox.remove(), 260);
    };

    const onKey = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            goPrev();
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            goNext();
        }
    };

    lightbox.querySelector('.lightbox-backdrop').addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    prevBtn.addEventListener('click', goPrev);
    nextBtn.addEventListener('click', goNext);
    document.addEventListener('keydown', onKey);
    closeBtn.focus({ preventScroll: true });

    let touchStartX = 0;
    let touchStartY = 0;
    lightbox.addEventListener('touchstart', (event) => {
        touchStartX = event.changedTouches[0].screenX;
        touchStartY = event.changedTouches[0].screenY;
    }, { passive: true });
    lightbox.addEventListener('touchend', (event) => {
        const deltaX = touchStartX - event.changedTouches[0].screenX;
        const deltaY = touchStartY - event.changedTouches[0].screenY;
        if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
            if (deltaX > 0) goNext();
            else goPrev();
        }
    }, { passive: true });
}

/* ---------- tracks / playlists ---------- */
function ytIdFromUrl(url) {
    const match = String(url || '').match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i);
    return match ? match[1] : null;
}

function normalizeTrack(item, globalIndex) {
    const youtubeId = ytIdFromUrl(item.url);
    const projectId = item.project || 'Default';
    const knownDuration = Number(item.duration);

    const base = {
        title: item.title || 'Untitled',
        author: item.author || 'Unknown',
        cover: item.cover || '',
        project: projectId,
        duration: Number.isFinite(knownDuration) && knownDuration > 0 ? knownDuration : null,
        _globalIndex: globalIndex
    };

    if (youtubeId) {
        return {
            ...base,
            type: 'youtube',
            id: youtubeId,
            cover: item.cover || `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`
        };
    }

    return {
        ...base,
        type: 'audio',
        src: item.url
    };
}

async function loadTracks() {
    if (appUi.trackList) {
        appUi.trackList.innerHTML = `<div class="empty-state">${escapeHtml(t('playlist.loading', 'Loading...'))}</div>`;
    }

    try {
        const [response, projects] = await Promise.all([
            fetch(MUSIC_FILE, { cache: 'no-cache' }),
            loadProjectRecords().catch(error => {
                console.warn('[music] project playlists unavailable:', error);
                return [];
            })
        ]);
        if (!response.ok) throw new Error(`${t('errors.musicNotFound', 'Music file not found')} (${response.status})`);

        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('music.json must be an array');

        const projectTracks = projects.flatMap(project =>
            Array.isArray(project.tracks)
                ? project.tracks.map(track => ({ ...track, project: track.project || project.id }))
                : []
        );
        const projectsWithTracks = new Set(projectTracks.map(track => track.project));
        const combinedTracks = [
            ...data.filter(track => !track || !projectsWithTracks.has(track.project)),
            ...projectTracks
        ];
        const tracks = combinedTracks
            .filter(item => item && typeof item.url === 'string' && item.url.trim())
            .map((item, index) => normalizeTrack(item, index));

        appState.tracks = tracks;

        const playlists = {};
        tracks.forEach((track, index) => {
            const id = track.project || 'Default';
            if (!playlists[id]) playlists[id] = [];
            playlists[id].push(index);
        });
        appState.playlists = playlists;

        const names = Object.keys(playlists);
        if (!appState.currentPlaylist || !playlists[appState.currentPlaylist]) {
            appState.currentPlaylist = names[0] || null;
        }

        if (window.Player && typeof window.Player.setTracks === 'function') {
            window.Player.setTracks(tracks);

            const pendingIndex = window.Player.state._pendingIndex;
            if (typeof pendingIndex === 'number' && tracks[pendingIndex]) {
                const pendingProject = tracks[pendingIndex].project;
                if (playlists[pendingProject]) appState.currentPlaylist = pendingProject;
            }

            const currentIndices = appState.currentPlaylist ? playlists[appState.currentPlaylist] : [];
            window.Player.setQueue(currentIndices || []);
        }

        if (window.Player && typeof window.Player.restorePending === 'function') {
            window.Player.restorePending();
        }
    } catch (error) {
        console.error('[tracks]', error);
        if (appUi.trackList) {
            appUi.trackList.innerHTML = `<div class="empty-state empty-state-error">${escapeHtml(error.message)}</div>`;
        }
    }
}

function updateDurationInPlaylist(track) {
    const cell = document.querySelector(`.playlist-track[data-index="${track._globalIndex}"] .track-dur`);
    if (cell) cell.textContent = formatTime(track.duration);
    updatePlaylistHeaderMeta();
}

/* ---------- playlist page ---------- */
function renderPlaylistPage() {
    const container = appUi.trackList;
    if (!container) return;

    const playlists = appState.playlists;
    const names = Object.keys(playlists);

    if (!names.length) {
        container.innerHTML = `<div class="empty-state">${escapeHtml(t('playlist.empty', 'No tracks.'))}</div>`;
        return;
    }

    if (!appState.musicDetailOpen) {
        container.innerHTML = `
            <section class="music-library">
                <header class="music-library-head">
                    <div>
                        <div class="playlist-hero-eyebrow">${escapeHtml(t('playlist.eyebrow', 'Music library'))}</div>
                        <h1 class="music-library-title">${escapeHtml(t('playlist.title', 'Music'))}</h1>
                    </div>
                    <span class="music-library-count">${names.length} ${escapeHtml(t('playlist.albums', 'albums'))}</span>
                </header>
                <div class="music-album-grid">
                    ${names.map(name => {
                        const albumIndices = playlists[name] || [];
                        const first = appState.tracks[albumIndices[0]] || {};
                        const cover = getPlaylistCover(name, first);
                        const duration = formatTotalDuration(albumIndices);
                        return `
                            <article class="music-album-card">
                                <button class="music-album-open" type="button" data-album="${escapeHtml(name)}" aria-label="${escapeHtml(t('playlist.openAlbum', 'Open album'))}: ${escapeHtml(getPlaylistTitle(name))}">
                                    <span class="music-album-art">
                                        ${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async">` : ''}
                                        <span class="music-album-art-index">${String(albumIndices.length).padStart(2, '0')}</span>
                                    </span>
                                    <span class="music-album-info">
                                        <span class="music-album-title">${escapeHtml(getPlaylistTitle(name))}</span>
                                        <span class="music-album-meta">${albumIndices.length} ${escapeHtml(trackCountLabel(albumIndices.length))}${duration ? ` · ${escapeHtml(duration)}` : ''}</span>
                                    </span>
                                </button>
                                <button class="music-album-play" type="button" data-play-album="${escapeHtml(name)}" aria-label="${escapeHtml(t('playlist.play', 'Play'))}: ${escapeHtml(getPlaylistTitle(name))}">
                                    <svg viewBox="0 0 24 24" aria-hidden="true">${PLAY_ICON}</svg>
                                </button>
                            </article>
                        `;
                    }).join('')}
                </div>
            </section>
        `;

        container.querySelectorAll('[data-album]').forEach(button => {
            button.addEventListener('click', () => {
                appState.currentPlaylist = button.dataset.album;
                appState.musicDetailOpen = true;
                renderPlaylistPage();
            });
        });
        container.querySelectorAll('[data-play-album]').forEach(button => {
            button.addEventListener('click', () => {
                if (!window.Player) return;
                const album = button.dataset.playAlbum;
                const queue = playlists[album] || [];
                if (!queue.length) return;
                appState.currentPlaylist = album;
                window.Player.setQueue(queue);
                window.Player.selectTrack(queue[0]);
                window.Player.playTrack();
                appState.musicDetailOpen = true;
                renderPlaylistPage();
            });
        });
        return;
    }

    const current = appState.currentPlaylist && playlists[appState.currentPlaylist]
        ? appState.currentPlaylist
        : names[0];
    appState.currentPlaylist = current;

    const indices = playlists[current] || [];
    const firstTrack = appState.tracks[indices[0]] || {};
    const cover = getPlaylistCover(current, firstTrack);
    const title = getPlaylistTitle(current);
    const authors = [...new Set(indices.map(index => appState.tracks[index].author).filter(Boolean))].join(', ');
    const totalDuration = formatTotalDuration(indices);

    const rowsHtml = indices.map((globalIndex, localIndex) => {
        const track = appState.tracks[globalIndex];
        const coverImg = track.cover
            ? `<img src="${escapeHtml(track.cover)}" alt="" loading="lazy" decoding="async">`
            : '';
        const duration = track.duration ? formatTime(track.duration) : '—';
        return `
            <div class="playlist-track" data-index="${globalIndex}" tabindex="0" role="button" aria-label="${escapeHtml(track.title)} — ${escapeHtml(track.author)}">
                <div class="track-num">
                    <span class="num-text">${localIndex + 1}</span>
                    <svg class="row-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
                    <span class="eq" aria-hidden="true"><span></span><span></span><span></span></span>
                </div>
                <div class="track-cover-cell"><div class="track-cover">${coverImg}</div></div>
                <div class="track-main-cell">
                    <div class="track-title">${escapeHtml(track.title)}</div>
                    <div class="track-author">${escapeHtml(track.author)}</div>
                </div>
                <div class="track-dur">${duration}</div>
                <div class="track-eq-cell" aria-hidden="true"><div class="track-eq"><span></span><span></span><span></span><span></span></div></div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <button class="music-back-button" id="musicLibraryBack" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
            <span>${escapeHtml(t('playlist.backToAlbums', 'All albums'))}</span>
        </button>
        <div class="playlist-hero">
            <div class="playlist-hero-cover">
                ${cover ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(title)}" decoding="async">` : ''}
            </div>
            <div class="playlist-hero-info">
                <div class="playlist-hero-eyebrow">${escapeHtml(t('playlist.title', 'Playlist'))}</div>
                <h1 class="playlist-hero-title">${escapeHtml(title)}</h1>
                <div class="playlist-hero-meta">${escapeHtml(authors || 'CoreTeam')}${totalDuration ? ` · ${totalDuration}` : ''} · ${indices.length} ${trackCountLabel(indices.length)}</div>
                <div class="playlist-hero-actions">
                    <button class="pl-play-btn" id="playlistPlayBtn">
                        <svg viewBox="0 0 24 24" aria-hidden="true">${PLAY_ICON}</svg>
                        <span class="pl-label">${escapeHtml(t('playlist.play', 'Play'))}</span>
                    </button>
                </div>
            </div>
        </div>

        <div class="playlist-list">
            <div class="playlist-list-head" aria-hidden="true">
                <span class="col-num">#</span>
                <span class="col-cover"></span>
                <span class="col-title">${escapeHtml(t('playlist.song', 'Track'))}</span>
                <span class="col-dur">
                    <svg viewBox="0 0 24 24" class="dur-icon"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                </span>
                <span class="col-eq"></span>
            </div>
            ${rowsHtml}
        </div>
    `;

    container.querySelector('#musicLibraryBack')?.addEventListener('click', () => {
        appState.musicDetailOpen = false;
        renderPlaylistPage();
    });

    const playBtn = container.querySelector('#playlistPlayBtn');
    if (playBtn) {
        playBtn.addEventListener('click', () => {
            if (!window.Player) return;
            window.Player.setQueue(indices);
            const isCurrentInQueue = indices.includes(window.Player.state.currentIndex);
            if (isCurrentInQueue && window.Player.state.isPlaying) {
                window.Player.pauseTrack();
            } else if (isCurrentInQueue) {
                window.Player.playTrack();
            } else if (indices.length) {
                window.Player.selectTrack(indices[0]);
                window.Player.playTrack();
            }
        });
    }

    container.querySelectorAll('.playlist-track').forEach(row => {
        const activate = () => {
            if (!window.Player) return;
            const index = Number(row.dataset.index);
            window.Player.setQueue(indices);
            if (window.Player.state.currentIndex === index) {
                window.Player.togglePlay();
            } else {
                window.Player.selectTrack(index);
                window.Player.playTrack();
            }
        };

        row.addEventListener('click', activate);
        row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activate();
            }
        });
    });

    syncPlaylistPlaying();
}

function syncPlaylistPlaying() {
    if (!window.Player) return;

    const { currentIndex, isPlaying } = window.Player.state;
    const queue = (appState.playlists[appState.currentPlaylist] || []);
    const isCurrentPlaylistPlaying = isPlaying && queue.includes(currentIndex);

    document.querySelectorAll('.playlist-track').forEach(row => {
        const index = Number(row.dataset.index);
        const isActive = index === currentIndex && isPlaying;
        row.classList.toggle('is-playing', isActive);
        row.setAttribute('aria-current', isActive ? 'true' : 'false');
    });

    document.querySelectorAll('.playlist-hero-cover').forEach(cover => {
        cover.classList.toggle('is-playing', isCurrentPlaylistPlaying);
    });

    const btn = document.getElementById('playlistPlayBtn');
    if (btn) {
        const inQueue = queue.includes(currentIndex);
        const isActive = inQueue && isPlaying;
        btn.classList.toggle('is-playing', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
        const label = btn.querySelector('.pl-label');
        const icon = btn.querySelector('svg');
        if (label) label.textContent = isActive ? t('playlist.pause', 'Pause') : t('playlist.play', 'Play');
        if (icon) icon.innerHTML = isActive ? PAUSE_ICON : PLAY_ICON;
    }
}

function updatePlaylistHeaderMeta() {
    const meta = document.querySelector('.playlist-hero-meta');
    const current = appState.currentPlaylist;
    if (!meta || !current) return;

    const indices = appState.playlists[current] || [];
    const authors = [...new Set(indices.map(index => appState.tracks[index].author).filter(Boolean))].join(', ');
    const totalDuration = formatTotalDuration(indices);
    meta.textContent = `${authors || 'CoreTeam'}${totalDuration ? ` · ${totalDuration}` : ''} · ${indices.length} ${trackCountLabel(indices.length)}`;
}

/* ---------- home vinyl ---------- */
function updateHeroVinyl() {
    const label = document.getElementById('heroVinylLabel');
    const title = document.getElementById('heroVinylTitle');
    const names = Object.keys(appState.playlists);
    if (!names.length) return;

    const playlistId = names[0];
    const indices = appState.playlists[playlistId] || [];
    const firstTrack = appState.tracks[indices[0]] || {};
    const cover = getPlaylistCover(playlistId, firstTrack);

    if (label && cover) label.style.backgroundImage = `url("${String(cover).replace(/"/g, '%22')}")`;
    if (title) title.textContent = `${getPlaylistTitle(playlistId)} — OST`;
}

/* ---------- credits ---------- */
const SOCIAL_ICONS = {
    github: '<path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.01c-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.08 0 4.41-2.69 5.38-5.25 5.67.41.35.78 1.05.78 2.12v3.14c0 .31.21.68.8.56A10.52 10.52 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z"/>',
    telegram: '<path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/>',
    youtube: '<path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6z"/>',
    discord: '<path d="M19 8H5a3 3 0 0 0-3 3v5a3 3 0 0 0 3 3h1l2 3h8l2-3h1a3 3 0 0 0 3-3v-5a3 3 0 0 0-3-3zM7.5 15A1.5 1.5 0 1 1 9 13.5 1.5 1.5 0 0 1 7.5 15zm9 0A1.5 1.5 0 1 1 18 13.5 1.5 1.5 0 0 1 16.5 15z"/>',
    twitter: '<path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L2.8 2h6.4l4.4 5.8L18.9 2zm-1.1 18h1.7L8.3 3.8H6.5L17.8 20z"/>',
    instagram: '<path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.3 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.3 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.3-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.3-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zM12 5.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4zm0 10.2a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.7a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z"/>',
    tiktok: '<path d="M16.6 5.8c.9.6 2 1 3.2 1v2.7c-1.3 0-2.6-.4-3.7-1.1v5.8c0 2.9-2.4 5.3-5.3 5.3s-5.3-2.4-5.3-5.3 2.4-5.3 5.3-5.3c.3 0 .5 0 .8.1v2.7c-.3-.1-.5-.2-.8-.2-1.5 0-2.7 1.2-2.7 2.7s1.2 2.7 2.7 2.7 2.7-1.2 2.7-2.7V2h2.6c0 1.4.5 2.7 1.5 3.8z"/>',
    facebook: '<path d="M13.5 22v-8h2.7l.4-3h-3.1V9.1c0-.9.3-1.5 1.6-1.5h1.6V5c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4V11H7.7v3h2.6v8h3.2z"/>',
    twitch: '<path d="M4 3h16v11l-4 4h-4l-3 3H6v-3H4V3zm3 3v8h3v2h2l2-2h3V6H7z"/>',
    linkedin: '<path d="M4 4h4v16H4zM10 8h4v2.1c.6-1.2 2-2.1 3.7-2.1 3 0 4.3 1.8 4.3 5V20h-4v-6.2c0-1.6-.6-2.6-1.9-2.6-1.4 0-2.1 1-2.1 2.6V20h-4V8z"/>',
    vk: '<path d="M20 4H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3v3l4-3h7a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>',
    website: '<path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/>',
    email: '<path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/>',
    donation: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>',
    external: '<path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>'
};

const SOCIAL_ALIASES = {
    x: 'twitter',
    tw: 'twitch',
    fb: 'facebook',
    li: 'linkedin',
    in: 'linkedin',
    tg: 'telegram',
    yt: 'youtube',
    ig: 'instagram',
    site: 'website',
    web: 'website',
    mail: 'email',
    donate: 'donation',
    donatealerts: 'donation'
};

function safeMediaUrl(value) {
    const url = String(value || '').trim();
    if (!url || /^javascript:/i.test(url)) return '';
    return url;
}

function getSocialIcon(icon) {
    const key = SOCIAL_ALIASES[icon] || icon || 'external';
    return SOCIAL_ICONS[key] || '';
}

function socialIconMarkup(icon) {
    const path = getSocialIcon(icon);
    return path ? `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>` : '';
}

function socialLinksMarkup(socials) {
    return normalizeSocials(socials).map(social => `
        <a class="credit-social" href="${escapeHtml(social.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(social.label)}" aria-label="${escapeHtml(social.label)}">
            ${socialIconMarkup(social.icon)}
            <span>${escapeHtml(social.label)}</span>
        </a>
    `).join('');
}

function normalizeSocials(socials) {
    if (!Array.isArray(socials)) return [];
    return socials.map(social => {
        if (!social || typeof social !== 'object') return null;
        let url = String(social.url || social.link || social.href || '').trim();
        if (!url || /^javascript:/i.test(url)) return null;

        const rawLabel = social.label != null ? social.label : (social.name != null ? social.name : social.network);
        const labelSource = typeof rawLabel === 'string' ? rawLabel.trim() : '';
        const rawNetwork = social.icon || social.type || social.network || labelSource || '';
        const network = typeof rawNetwork === 'string' ? rawNetwork.toLowerCase().trim() : '';

        if (!/^(https?:|mailto:)/i.test(url)) {
            if ((network === 'telegram' || network === 'tg') && /^@?[\w.]+$/.test(url)) {
                url = 'https://t.me/' + url.replace(/^@/, '');
            } else {
                url = 'https://' + url.replace(/^\/+/, '');
            }
        }
        return {
            label: labelSource || network || 'Link',
            url,
            icon: network
        };
    }).filter(Boolean);
}

function sortCredits(items) {
    return items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
            const aId = Number(a.item.id);
            const bId = Number(b.item.id);
            const aHasId = a.item.id !== null && a.item.id !== undefined && a.item.id !== '' && Number.isFinite(aId);
            const bHasId = b.item.id !== null && b.item.id !== undefined && b.item.id !== '' && Number.isFinite(bId);

            if (aHasId && bHasId && aId !== bId) return aId - bId;
            if (aHasId !== bHasId) return aHasId ? -1 : 1;
            return a.index - b.index;
        })
        .map(entry => entry.item);
}

async function loadCredits() {
    if (appState.creditsLoaded || appState.creditsLoading) return;
    appState.creditsLoading = true;

    try {
        const response = await fetch(CREDITS_FILE, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`credits.json (${response.status})`);
        const data = await response.json();
        const items = Array.isArray(data) ? data.filter(item => item && typeof item === 'object') : [];
        appState.credits = sortCredits(items);
        appState.creditsLoaded = true;
        renderCredits();
    } catch (error) {
        console.warn('[credits]', error);
        if (appUi.creditsGrid) {
            appUi.creditsGrid.innerHTML = `<div class="empty-state">${escapeHtml(t('credits.empty', 'Credits are coming soon.'))}</div>`;
        }
    } finally {
        appState.creditsLoading = false;
    }
}

function getCreditData(credit) {
    const name = typeof credit.name === 'string' && credit.name.trim() ? credit.name.trim() : '—';
    const role = typeof credit.role === 'string' ? credit.role.trim() : '';
    const bio = typeof credit.bio === 'string' ? credit.bio.trim() : '';
    const fullBio = typeof credit.fullBio === 'string' && credit.fullBio.trim() ? credit.fullBio.trim() : bio;
    return {
        name,
        role,
        bio,
        fullBio,
        avatar: safeMediaUrl(credit.avatar),
        banner: safeMediaUrl(credit.banner),
        initial: name.trim().charAt(0).toUpperCase() || '?',
        socials: credit.socials
    };
}

function renderCredits() {
    const container = appUi.creditsGrid;
    if (!container) return;

    if (!appState.credits.length) {
        container.innerHTML = `<div class="empty-state">${escapeHtml(t('credits.empty', 'The people behind our projects will appear here soon.'))}</div>`;
        return;
    }

    container.innerHTML = appState.credits.map((credit, index) => {
        const data = getCreditData(credit);
        const socialsHtml = socialLinksMarkup(credit.socials);

        return `
            <article class="credit-card" data-index="${index}" data-credit-id="${credit.id != null ? escapeHtml(String(credit.id)) : ''}" tabindex="0" role="button" aria-label="${escapeHtml(t('credits.openProfile', 'Open profile'))}: ${escapeHtml(data.name)}">
                <div class="credit-banner">
                    ${data.banner ? `<img src="${escapeHtml(data.banner)}" alt="" loading="lazy" decoding="async">` : ''}
                    <span class="credit-shade" aria-hidden="true"></span>
                    <span class="credit-open" aria-hidden="true">
                        <svg viewBox="0 0 24 24"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
                    </span>
                </div>
                <div class="credit-body">
                    <div class="credit-avatar">
                        ${data.avatar ? `<img src="${escapeHtml(data.avatar)}" alt="${escapeHtml(data.name)}" loading="lazy" decoding="async">` : ''}
                        <span class="credit-avatar-fallback" aria-hidden="true">${escapeHtml(data.initial)}</span>
                    </div>
                    <h2 class="credit-name">${escapeHtml(data.name)}</h2>
                    ${data.role ? `<div class="credit-role">${escapeHtml(data.role)}</div>` : ''}
                    ${data.bio ? `<p class="credit-bio">${escapeHtml(data.bio)}</p>` : ''}
                    ${socialsHtml ? `<div class="credit-socials">${socialsHtml}</div>` : ''}
                </div>
            </article>
        `;
    }).join('');

    container.querySelectorAll('.credit-avatar img, .credit-banner img').forEach(img => {
        img.addEventListener('error', () => { img.hidden = true; }, { once: true });
    });

    container.querySelectorAll('.credit-card').forEach(card => {
        const credit = appState.credits[Number(card.dataset.index)];
        const open = (event) => {
            if (event.target.closest && event.target.closest('.credit-social')) return;
            openCreditProfile(credit, card);
        };
        card.addEventListener('click', open);
        card.addEventListener('keydown', (event) => {
            if (event.target.closest && event.target.closest('.credit-social')) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openCreditProfile(credit, card);
            }
        });
        card.querySelectorAll('.credit-social').forEach(link => {
            link.addEventListener('click', (event) => event.stopPropagation());
        });
    });
}

function openCreditProfile(credit, sourceCard) {
    if (!credit) return;
    const data = getCreditData(credit);
    const socialsHtml = socialLinksMarkup(credit.socials);
    const previousFocus = sourceCard || document.activeElement;

    const oldModal = document.querySelector('.credit-modal');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.className = 'credit-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'creditProfileName');
    modal.innerHTML = `
        <div class="credit-modal-backdrop"></div>
        <article class="credit-modal-panel">
            <button class="credit-modal-close" aria-label="${escapeHtml(t('credits.close', 'Close'))}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>
            </button>
            <div class="credit-modal-banner">
                ${data.banner ? `<img src="${escapeHtml(data.banner)}" alt="" decoding="async">` : ''}
                <span class="credit-shade" aria-hidden="true"></span>
            </div>
            <div class="credit-modal-body">
                <div class="credit-avatar credit-avatar-lg">
                    ${data.avatar ? `<img src="${escapeHtml(data.avatar)}" alt="${escapeHtml(data.name)}" decoding="async">` : ''}
                    <span class="credit-avatar-fallback" aria-hidden="true">${escapeHtml(data.initial)}</span>
                </div>
                <h2 class="credit-modal-name" id="creditProfileName">${escapeHtml(data.name)}</h2>
                ${data.role ? `<div class="credit-modal-role">${escapeHtml(data.role)}</div>` : ''}
                ${data.fullBio ? `<p class="credit-modal-bio">${escapeHtml(data.fullBio)}</p>` : ''}
                ${socialsHtml ? `<div class="credit-socials credit-socials-lg">${socialsHtml}</div>` : ''}
            </div>
        </article>
    `;

    document.body.appendChild(modal);
    document.body.classList.add('credit-modal-open');
    const closeButton = modal.querySelector('.credit-modal-close');
    requestAnimationFrame(() => {
        modal.classList.add('open');
        closeButton.focus({ preventScroll: true });
    });

    modal.querySelectorAll('.credit-avatar img, .credit-modal-banner img').forEach(img => {
        img.addEventListener('error', () => { img.hidden = true; }, { once: true });
    });

    let closed = false;

    const close = () => {
        if (closed) return;
        closed = true;
        modal.classList.remove('open');
        document.body.classList.remove('credit-modal-open');
        document.removeEventListener('keydown', onKey);
        if (previousFocus && previousFocus.focus) previousFocus.focus({ preventScroll: true });
        setTimeout(() => modal.remove(), 260);
    };

    const onKey = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
        }
    };

    modal.querySelector('.credit-modal-backdrop').addEventListener('click', close);
    closeButton.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
}

/* ---------- donate art ---------- */
function findDonateImage(project) {
    const base = project.assetPath || `./data/projects/${project.id}/images`;
    const paths = [`${base}/donate.webp`, `${base}/donate.png`];

    return new Promise(resolve => {
        const tryPath = (index) => {
            if (index >= paths.length) { resolve(null); return; }
            const testImage = new Image();
            testImage.onload = () => resolve(paths[index]);
            testImage.onerror = () => tryPath(index + 1);
            testImage.src = paths[index];
        };
        tryPath(0);
    });
}

async function pickDonateArt() {
    const img = document.getElementById('donateArt');
    if (!img || img.src) return;

    const projects = appState.projects;
    if (!projects.length) return;

    const start = Math.floor(Math.random() * projects.length);
    for (let offset = 0; offset < projects.length; offset++) {
        const project = projects[(start + offset) % projects.length];
        const path = await findDonateImage(project);
        if (!path) continue;

        img.decoding = 'async';
        img.src = path;
        img.alt = 'CoreTeam.LLC';
        img.hidden = false;
        img.classList.add('is-loaded');
        return;
    }
}

/* ---------- routing ---------- */
let donateArtRequested = false;

function routeFromHash() {
    const hash = location.hash;

    if (hash.startsWith('#project/')) {
        let id = hash.slice('#project/'.length);
        try { id = decodeURIComponent(id); } catch (e) { /* keep raw */ }
        if (appState.projects.length) openProject(id);
        else showView('projects');
        return;
    }

    if (hash === '#projects') {
        showView('projects');
    } else if (hash === '#music') {
        showView('playlist');
        if (Object.keys(appState.playlists).length) {
            renderPlaylistPage();
        }
    } else if (hash === '#donate') {
        showView('donate');
        if (!donateArtRequested && appState.projects.length) {
            donateArtRequested = true;
            pickDonateArt();
        }
    } else if (hash === '#credits') {
        showView('credits');
        loadCredits();
    } else {
        showView('home');
    }
}

/* ---------- player events ---------- */
window.addEventListener('player:statechange', syncPlaylistPlaying);

window.addEventListener('player:duration', (event) => {
    const { index, duration } = event.detail || {};
    const track = appState.tracks[index];
    if (track && duration) {
        track.duration = duration;
        updateDurationInPlaylist(track);
    }
});

document.addEventListener('i18n:applied', () => {
    if (window.Player) window.Player.refreshLabels();
    if (appState.projects.length) renderProjectGrids();

    const hash = location.hash;
    if (hash.startsWith('#project/') && window.__currentProjectId) {
        openProject(window.__currentProjectId);
    } else if (hash === '#music' && Object.keys(appState.playlists).length) {
        renderPlaylistPage();
    } else if (hash === '#credits') {
        if (appState.creditsLoaded) renderCredits();
        else loadCredits();
    }
});

/* ---------- start ---------- */
document.addEventListener('DOMContentLoaded', () => {
    const i18nReady = (async () => {
        try {
            if (window.I18n) {
                await window.I18n.init();
                window.I18n.bindEvents();
            }
        } catch (error) {
            console.warn('[i18n]', error);
        }
    })();

    try {
        if (window.Player) window.Player.init();
    } catch (error) {
        console.warn('[player] init:', error);
    }

    const dataReady = Promise.all([
        loadProjects(),
        loadTracks()
    ]);

    Promise.all([i18nReady, dataReady]).then(() => {
        updateHeroVinyl();
        routeFromHash();
    });
});

window.addEventListener('hashchange', routeFromHash);

/* ---------- appearance ---------- */
(function initTheme() {
    const root = document.documentElement;
    const button = document.getElementById('themeToggle');
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    const storageKey = 'ct-theme';
    const systemTheme = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    const setTheme = (theme, persist) => {
        const value = theme === 'light' || theme === 'dark' ? theme : systemTheme();
        root.dataset.theme = value;
        if (persist) { try { localStorage.setItem(storageKey, value); } catch (error) {} }
        if (button) {
            button.setAttribute('aria-pressed', String(value === 'light'));
            button.setAttribute('data-active-theme', value);
            const key = value === 'light' ? 'theme.dark' : 'theme.light';
            button.setAttribute('data-i18n-title', key);
            button.setAttribute('data-i18n-aria-label', key);
            button.title = t(key, value === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
            button.setAttribute('aria-label', button.title);
        }
        if (metaTheme) metaTheme.setAttribute('content', value === 'light' ? '#f5f7f9' : '#08090c');
    };
    let saved = null;
    try { saved = localStorage.getItem(storageKey); } catch (error) {}
    setTheme(saved || systemTheme(), false);
    if (button) button.addEventListener('click', () => setTheme(root.dataset.theme === 'light' ? 'dark' : 'light', true));
})();
