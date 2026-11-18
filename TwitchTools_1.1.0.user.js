// ==UserScript==
// @name         Twitch Tools
// @namespace    none
// @version      1.1.0
// @description  Twitch ad muting and live Picture-in-Picture controls, channel point claiming, quality selection, continue-watching assistance, and dark mode.
// @author       Astroolean
// @license      MIT
// @homepageURL  https://github.com/Astroolean/Twitch-Tools
// @match        https://www.twitch.tv/*
// @match        https://twitch.tv/*
// @grant        none
// @noframes
// @run-at       document-start
// ==/UserScript==

/*
 * Twitch Tools 1.1.0 — reliability refactor of the user-provided 1.0.1 script.
 * No remote requests, third-party script downloads, hidden network actions,
 * credential access, storage scraping, or modified stream/network traffic.
 *
 * IMPORTANT: This script cannot guarantee that Twitch will not deliver ads.
 * It manages presentation of detectable ads and gives the user a direct
 * browser Picture-in-Picture control for Twitch's live picture-by-picture feed.
 * The browser normally requires a click to open Picture-in-Picture.
 */
(() => {
    'use strict';

    // Guard against duplicate injection of this version on one page.
    const instanceKey = '__astrooleanTwitchTools_1_1_0';
    if (window[instanceKey]) return;
    window[instanceKey] = true;

    // Keep these defaults in one place. Edit them here if desired.
    const SETTINGS = Object.freeze({
        adPollMs: 500,
        adEndGraceMs: 1200,
        muteAds: true,
        hideAds: false,
        autoClaimPoints: true,
        autoContinueWatching: true,
        autoBestQuality: true,
        forceDarkMode: true,
        showPlayerControls: true,
        debug: false,
    });

    // Twitch controls/DOM are not a public API. Keep fallbacks narrow and safe.
    const SELECTORS = Object.freeze({
        player: '.video-player__container',
        mini: '.pbyp-player-instance, [data-a-target="picture-by-picture-player"], .picture-by-picture-player',
        adLabels: '[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"], [data-a-target="player-ad-notice"], [data-a-target="ad-countdown"], [data-test-selector="ad-banner-default-text"], [data-test-selector="ad-overlay"], [data-a-target="ad-banner-default-text"]',
        adOverlay: '[data-a-target="ax-overlay"]',
        settings: 'button[data-a-target="player-settings-button"]',
        points: 'button[aria-label="Claim Bonus"], button[data-a-target="claimable-bonus"], .community-points-summary .claimable-bonus__button',
        continueOverlay: '[data-test-selector="disconnect-overlay"]',
        continueButton: 'button[data-a-target="player-overlay-continue-watching-button"]',
    });

    const state = {
        lastPath: location.pathname,
        adActive: false,
        lastAdEvidenceMs: 0,
        main: null,
        mainOriginalMuted: false,
        mainOriginalVisibility: '',
        mainOriginalVolume: 1,
        mini: null,
        miniOriginalMuted: true,
        miniOriginalVolume: 1,
        pipSwitchedFromMain: false,
        lastPointsAt: 0,
        lastContinueAt: 0,
        lastDarkAt: 0,
        lastUIAt: 0,
        lastQualityAt: 0,
        qualityBusy: false,
        qualityDone: false,
        qualityPlayer: null,
        pointAttempts: new WeakMap(),
        ui: null,
        uiPlayer: null,
        uiPlayerPosition: '',
        lastStatus: '',
        started: false,
        interval: null,
        lastErrorAt: 0,
    };

    function log(...args) {
        if (SETTINGS.debug) console.debug('[Twitch Tools]', ...args);
    }

    function query(selector, root = document) {
        try { return root.querySelector(selector); }
        catch (_) { return null; }
    }

    function queryAll(selector, root = document) {
        try { return Array.from(root.querySelectorAll(selector)); }
        catch (_) { return []; }
    }

    function playerElement() { return query(SELECTORS.player); }

    function miniVideo() {
        for (const container of queryAll(SELECTORS.mini)) {
            const video = query('video', container);
            if (video && video.isConnected) return video;
        }
        return null;
    }

    function mainVideo() {
        const player = playerElement();
        if (!player) return null;
        // Exclude Twitch's separate picture-by-picture stream video.
        const videos = queryAll('video', player).filter(v => !v.closest(SELECTORS.mini));
        if (!videos.length) return null;
        return videos.find(v => v.readyState > 0 && v.getBoundingClientRect().width > 0) || videos[0];
    }

    function looksLikeAd(text) {
        if (!text) return false;
        return /(?:^|\b)(?:advertisement|commercial break|playing ads?|ad break|ads?\s+\d+(?:\s+of\s+\d+)?)(?:\b|$)/i.test(text.trim());
    }

    function hasAdEvidence(main, mini) {
        if (!main) return false;
        // Twitch's picture-by-picture live feed is displayed during ad breaks.
        if (mini && mini !== main) return true;
        const player = playerElement();
        if (!player) return false;
        for (const el of queryAll(SELECTORS.adLabels, player)) {
            // Selector itself is specific; allow labeled ad controls with any text.
            if (el.getAttribute('data-a-target') === 'video-ad-countdown' ||
                el.getAttribute('data-a-target') === 'video-ad-label' ||
                looksLikeAd(`${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`)) return true;
        }
        const overlay = query(SELECTORS.adOverlay, player);
        if (overlay) {
            // Do not rely on childElementCount: non-ad overlays can have children.
            const label = `${overlay.getAttribute('aria-label') || ''} ${overlay.textContent || ''}`;
            if (looksLikeAd(label)) return true;
            const parent = overlay.parentElement;
            if (parent && looksLikeAd((parent.textContent || '').slice(0, 160))) return true;
        }
        return false;
    }

    function saveMain(main) {
        state.main = main;
        state.mainOriginalMuted = Boolean(main.muted);
        state.mainOriginalVolume = main.volume;
        state.mainOriginalVisibility = main.style.visibility;
    }

    function saveMini(mini) {
        state.mini = mini;
        state.miniOriginalMuted = Boolean(mini.muted);
        state.miniOriginalVolume = mini.volume;
    }

    function restoreMain() {
        if (!state.main) return;
        const v = state.main;
        // Restore the old video even if Twitch detached it; SPA navigation may reuse it.
        if (SETTINGS.muteAds) v.muted = state.mainOriginalMuted;
        if (SETTINGS.hideAds) v.style.visibility = state.mainOriginalVisibility;
        state.main = null;
    }

    function restoreMini() {
        if (!state.mini) return;
        const v = state.mini;
        v.muted = state.miniOriginalMuted;
        v.volume = state.miniOriginalVolume;
        state.mini = null;
    }

    function updateAdAudio(main, mini) {
        if (main !== state.main) {
            restoreMain();
            if (main) saveMain(main);
        }
        if (state.main) {
            if (SETTINGS.muteAds) state.main.muted = true;
            if (SETTINGS.hideAds) state.main.style.visibility = 'hidden';
        }
        if (mini !== state.mini) {
            restoreMini();
            if (mini) saveMini(mini);
        }
        if (state.mini) {
            // Preserve the user's existing stream volume/mute preference.
            state.mini.volume = state.main ? state.mainOriginalVolume : state.miniOriginalVolume;
            state.mini.muted = state.main ? state.mainOriginalMuted : state.miniOriginalMuted;
        }
    }

    function enterAd(main, mini) {
        state.adActive = true;
        updateAdAudio(main, mini);
        // If a browser PiP session already exists, try switching to Twitch's
        // separate live feed. Do not exit the current PiP before trying.
        if (mini && document.pictureInPictureElement === main &&
            typeof mini.requestPictureInPicture === 'function') {
            Promise.resolve().then(() => mini.requestPictureInPicture()).then(() => {
                state.pipSwitchedFromMain = true;
            }).catch(e => log('Cannot automatically switch PiP', e));
        }
        setStatus('Ad detected • live stream PiP available' + (mini ? '' : ' when Twitch provides it'));
        log('Ad detected');
    }

    function leaveAd() {
        if (!state.adActive && !state.main && !state.mini) return;
        state.adActive = false;
        // Switch PiP back while PiP is still active. This may fail if the
        // browser requires a fresh user action; preserve the existing video.
        if (state.pipSwitchedFromMain && document.pictureInPictureElement === state.mini &&
            state.main && state.main.isConnected &&
            typeof state.main.requestPictureInPicture === 'function') {
            const target = state.main;
            Promise.resolve().then(() => target.requestPictureInPicture())
                .catch(e => log('Cannot restore original PiP automatically', e));
        }
        state.pipSwitchedFromMain = false;
        restoreMini();
        restoreMain();
        setStatus('Stream ready');
    }

    function pollAd(now) {
        const main = mainVideo();
        const mini = miniVideo();
        const found = hasAdEvidence(main, mini);
        if (found) {
            state.lastAdEvidenceMs = now;
            if (!state.adActive) enterAd(main, mini);
            else updateAdAudio(main, mini);
        } else if (state.adActive && now - state.lastAdEvidenceMs >= SETTINGS.adEndGraceMs) {
            leaveAd();
        }
    }

    function autoClaimPoints(now) {
        if (!SETTINGS.autoClaimPoints || now - state.lastPointsAt < 1300) return;
        state.lastPointsAt = now;
        for (const button of queryAll(SELECTORS.points)) {
            if (button.disabled || !button.isConnected) continue;
            const rec = state.pointAttempts.get(button) || { count: 0, last: 0 };
            // Twitch may reuse the same button for a later bonus. Retry after
            // a longer cooldown rather than permanently blacklisting it.
            if (now - rec.last > 90000) rec.count = 0;
            if (rec.count >= 3 || now - rec.last < 3000) continue;
            // Prevent rapid duplicate clicks even if Twitch keeps the button.
            state.pointAttempts.set(button, { count: rec.count + 1, last: now });
            try { button.click(); log('Claimed channel points'); }
            catch (e) { log('Channel points claim failed', e); }
        }
    }

    function autoContinueWatching(now) {
        if (!SETTINGS.autoContinueWatching || now - state.lastContinueAt < 2400) return;
        state.lastContinueAt = now;
        const overlay = query(SELECTORS.continueOverlay);
        if (!overlay) return;
        const button = query(SELECTORS.continueButton, overlay);
        if (button && !button.disabled) {
            try { button.click(); log('Continue Watching clicked'); }
            catch (e) { log('Continue Watching click failed', e); }
        }
    }

    function applyDarkMode(now) {
        if (!SETTINGS.forceDarkMode || now - state.lastDarkAt < 2500) return;
        state.lastDarkAt = now;
        const html = document.documentElement;
        if (!html.classList.contains('tw-root--dark')) html.classList.add('tw-root--dark');
        if (html.getAttribute('data-a-theme') !== 'dark') html.setAttribute('data-a-theme', 'dark');
    }

    function visible(node) {
        if (!node || !node.isConnected) return false;
        const s = getComputedStyle(node);
        return s.display !== 'none' && s.visibility !== 'hidden';
    }

    function menuItems() {
        return queryAll('[data-a-target="player-settings-menu-item"], [role="menuitem"], [role="menuitemradio"], .quality-selector__menu button, .quality-selector__menu label')
            .filter(visible);
    }

    function qualityRank(s) {
        const value = s.trim();
        if (/^(?:source|original)(?:\s*\(.+\))?$/i.test(value)) return 999999;
        if (/\bauto\b/i.test(value)) return -1;
        const match = value.match(/(?:^|\s)(\d{3,4})p\s*(\d{2,3})?/i);
        if (!match) return -1;
        return Number(match[1]) * 100 + Number(match[2] || 0);
    }

    async function waitFor(find, timeoutMs = 1000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const value = find();
            if (value) return value;
            await new Promise(resolve => setTimeout(resolve, 80));
        }
        return null;
    }

    async function chooseBestQuality() {
        if (state.qualityBusy) return false;
        const settings = query(SELECTORS.settings);
        if (!settings || !visible(settings)) return false;
        // Do not interrupt a menu the user is already using.
        if (query('.video-player__popover-content, .quality-selector__menu')) return false;
        state.qualityBusy = true;
        let openedByUs = false;
        let selected = false;
        try {
            settings.click();
            openedByUs = true;
            const qualityMenu = await waitFor(() =>
                menuItems().find(e => /^quality(?:\s|$|:)/i.test((e.textContent || '').trim())), 1100);
            if (!qualityMenu) return false;
            qualityMenu.click();
            const options = await waitFor(() => {
                const possible = menuItems().map(el => ({ el, label: (el.textContent || '').trim() }))
                    .filter(x => qualityRank(x.label) >= 0 && x.label.length < 90)
                    .sort((a, b) => qualityRank(b.label) - qualityRank(a.label));
                return possible.length ? possible : null;
            }, 1100);
            if (!options) return false;
            options[0].el.click();
            selected = true;
            state.qualityDone = true;
            log('Selected quality', options[0].label);
            return true;
        } catch (e) {
            log('Quality selection failed', e);
            return false;
        } finally {
            state.qualityBusy = false;
            // If nothing was selected, close the menu we opened.
            if (!selected && openedByUs && settings.isConnected) {
                try { settings.click(); } catch (_) { /* page changed */ }
            }
        }
    }

    function scheduleQuality(now) {
        if (!SETTINGS.autoBestQuality || state.qualityBusy ||
            document.visibilityState !== 'visible' || state.adActive) return;
        const current = mainVideo();
        if (!current || !query(SELECTORS.settings)) return;
        if (current !== state.qualityPlayer) {
            state.qualityPlayer = current;
            state.qualityDone = false;
            state.lastQualityAt = 0;
        }
        // Do not repeatedly open Twitch's quality menu after succeeding.
        if (state.qualityDone || now - state.lastQualityAt < 30000) return;
        state.lastQualityAt = now;
        chooseBestQuality().catch(e => log('Best quality attempt failed', e));
    }

    function setStatus(message) {
        state.lastStatus = message;
        if (state.ui && state.ui.status && state.ui.status.textContent !== message)
            state.ui.status.textContent = message;
    }

    function styleUI() {
        if (document.getElementById('astroolean-tt-style')) return;
        const style = document.createElement('style');
        style.id = 'astroolean-tt-style';
        style.textContent = `
            #astroolean-tt {position:absolute;z-index:2147483600;top:70px;right:14px;
                color:#f8f8fe;font:12px/1.4 system-ui, sans-serif;text-align:left;pointer-events:auto;}
            #astroolean-tt button {font:600 12px/1.3 system-ui,sans-serif;cursor:pointer;color:#fff;
                background:#24233b;border:1px solid #5d5391;border-radius:7px;padding:8px 10px;}
            #astroolean-tt button:hover, #astroolean-tt button:focus-visible {background:#39315e;}
            #astroolean-tt .tt-open {background:#201d36d9;border-color:#b29fff;}
            #astroolean-tt .tt-panel {background:#161425ef;border:1px solid #72639b;
                padding:12px;border-radius:10px;box-shadow:0 4px 22px #0009;
                width:245px;margin-top:7px;max-width:calc(100vw - 32px);}
            #astroolean-tt .tt-grid {display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px;}
            #astroolean-tt .tt-status {font-size:11px;color:#bcf1ee;margin:6px 0;}
            #astroolean-tt .tt-note {font-size:10px;color:#b9b6c5;margin-top:9px;}
            #astroolean-tt [hidden] {display:none !important;}
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function statusMessage(message) {
        setStatus(message);
        log(message);
    }

    function openLivePiP() {
        const main = mainVideo();
        const mini = miniVideo();
        const target = state.adActive ? mini : main;
        if (!target) {
            statusMessage(state.adActive ? 'Live preview unavailable during this ad' : 'No active video found');
            return;
        }
        if (!document.pictureInPictureEnabled || typeof target.requestPictureInPicture !== 'function') {
            statusMessage('This browser does not support video PiP here');
            return;
        }
        if (state.adActive && main && mini && main !== mini) {
            // The user's documented technique pauses the ad, then opens the
            // live preview. This is an explicit click, never a background hack.
            try { main.pause(); } catch (e) { log('Ad pause was blocked', e); }
        }
        try {
            if (document.pictureInPictureElement === target) {
                const result = document.exitPictureInPicture();
                Promise.resolve(result).then(() => statusMessage('Picture-in-Picture closed'))
                    .catch(() => statusMessage('Could not close Picture-in-Picture'));
                return;
            }
            const result = target.requestPictureInPicture(); // MUST be in this click handler.
            Promise.resolve(result).then(() => statusMessage('Live Picture-in-Picture enabled'))
                .catch(e => { log('PiP request failed', e); statusMessage('PiP blocked — use the browser PiP button'); });
        } catch (e) {
            log('PiP request error', e);
            statusMessage('PiP could not be started');
        }
    }

    function fullscreenLive() {
        const target = state.adActive ? miniVideo() : mainVideo();
        if (!target) return statusMessage('No live video available for fullscreen');
        try {
            const request = document.fullscreenElement ? document.exitFullscreen() : target.requestFullscreen();
            Promise.resolve(request).catch(e => log('Fullscreen denied', e));
        } catch (e) { log('Fullscreen failed', e); }
    }

    function buildUI() {
        const root = document.createElement('div');
        root.id = 'astroolean-tt';
        root.setAttribute('data-twitch-tools', '1');
        const toggle = document.createElement('button');
        toggle.className = 'tt-open';
        toggle.type = 'button';
        toggle.textContent = 'Twitch Tools';
        toggle.setAttribute('aria-expanded', 'false');
        const panel = document.createElement('div');
        panel.className = 'tt-panel';
        panel.hidden = true;
        const heading = document.createElement('strong');
        heading.textContent = 'Astroolean • Twitch Tools';
        const status = document.createElement('div');
        status.className = 'tt-status';
        status.textContent = state.lastStatus || 'Stream ready';
        const grid = document.createElement('div');
        grid.className = 'tt-grid';
        function button(label, handler) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.addEventListener('click', (event) => {
                event.preventDefault(); event.stopPropagation(); handler();
            });
            grid.appendChild(b);
        }
        button('Live PiP', openLivePiP);
        button('Fullscreen live', fullscreenLive);
        button('Best quality', () => { chooseBestQuality().then(ok => {
            if (!ok) statusMessage('Could not find Twitch quality options');
            else statusMessage('Best available quality selected');
        }); });
        button('Close', () => {
            panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
        });
        const note = document.createElement('div');
        note.className = 'tt-note';
        note.textContent = 'During an ad, Live PiP selects Twitch’s separate live preview when available.';
        panel.append(heading, status, grid, note);
        toggle.addEventListener('click', event => {
            event.preventDefault(); event.stopPropagation();
            panel.hidden = !panel.hidden;
            toggle.setAttribute('aria-expanded', String(!panel.hidden));
        });
        root.append(toggle, panel);
        return { root, status };
    }

    function ensureUI(now) {
        if (!SETTINGS.showPlayerControls || now - state.lastUIAt < 1200) return;
        state.lastUIAt = now;
        const player = playerElement();
        if (!player) return;
        styleUI();
        if (!state.ui) state.ui = buildUI();
        if (state.uiPlayer !== player || !state.ui.root.isConnected) {
            if (state.uiPlayer && state.uiPlayer.isConnected) {
                state.uiPlayer.style.position = state.uiPlayerPosition;
            }
            state.uiPlayerPosition = player.style.position;
            if (getComputedStyle(player).position === 'static') player.style.position = 'relative';
            player.appendChild(state.ui.root);
            state.uiPlayer = player;
        }
    }

    function handleNavigation() {
        if (location.pathname === state.lastPath) return;
        leaveAd();
        state.lastPath = location.pathname;
        state.lastQualityAt = 0;
        state.qualityDone = false;
        state.qualityPlayer = null;
        state.lastAdEvidenceMs = 0;
        log('Navigation', state.lastPath);
    }

    function tick() {
        try {
            const now = Date.now();
            handleNavigation();
            pollAd(now);
            autoClaimPoints(now);
            autoContinueWatching(now);
            applyDarkMode(now);
            ensureUI(now);
            scheduleQuality(now);
        } catch (e) {
            // One missing/deprecated Twitch selector must not stop all features.
            if (now - state.lastErrorAt >= 10000) {
                state.lastErrorAt = now;
                console.warn('[Twitch Tools] Recovered from player update:', e);
            }
        }
    }

    function start() {
        if (state.started || !document.body) return;
        state.started = true;
        tick();
        state.interval = setInterval(tick, SETTINGS.adPollMs);
        window.addEventListener('pagehide', leaveAd);
        log('Twitch Tools 1.1.0 started');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
