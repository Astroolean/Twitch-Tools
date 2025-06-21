// ==UserScript==
// @name          Twitch Tools
// @namespace     https://astroolean.github.io/
// @description   Automatically mutes Twitch ads, bypass ads, and auto-claim channel points.
// @include       https://www.twitch.tv/*
// @include       https://twitch.tv/*
// @version       1.0.0
// @license       MIT
// @author        Astroolean / Google Gemini
// @grant         none
// @run-at        document-start
// ==/UserScript==
/* eslint-disable no-unused-vars */
/* eslint-disable no-case-declarations */
(function() {
    'use strict';

    // --- Configuration & Constants ---
    const DEBUG_MODE = true; // Set to true for extensive console logging
    const LOG_PREFIX = 'Twitch Tools:';

    const log = (level, ...args) => {
        if (!DEBUG_MODE) return;
        const msg = `[${LOG_PREFIX}${level}]`;
        if (console[level]) {
            console[level](msg, ...args);
        } else {
            console.log(msg, ...args);
        }
    };

    const _tmuteVars = {
        timerCheck: 500, // EDITABLE - Checking rate of ad in progress (in milliseconds; recommended value: 250 - 1000; default: 500)
        adInProgress: false, // Track if an ad is in progress or not (directly linked to player mute state)
        adsDisplayed: 0, // Number of ads displayed
        disableDisplay: false, // EDITABLE - Disable the player display during an ad (true = yes, false = no (default))
        anticipatePreroll: false, // EDITABLE - Temporarily mute and/or hide the player when loading a new stream to anticipate a pre-roll ad (true = yes, false = no (default))
        anticipateTimer: 2000, // EDITABLE - Time where the player is muted and/or hidden when loading a new stream to anticipate a pre-roll ad (in milliseconds; default: 2000)
        anticipateInProgress: false, // Used to check if we're currently anticipating a pre-roll ad
        anticipatePrematureEnd: false, // Used to check if we prematurely ended a pre-roll ad anticipation
        alreadyMuted: false, // Used to check if the player is muted at the start of an ad
        adElapsedTime: undefined, // Used to check if Twitch forgot to remove the ad notice
        adUnlockAt: 270, // EDITABLE - Unlock the player if this amount of seconds elapsed during an ad (in seconds; default: 270)
        adMinTime: 2, // EDITABLE - Minimum amount of seconds the player will be muted/hidden since an ad started (in seconds; default: 2)
        playerIdAds: 0, // Player ID where ads may be displayed (default 0, varying on squads page)
        displayingOptions: false, // Either ads options extended menu is currently displayed or not
        highwindPlayer: undefined, // If you've the Highwind Player or not
        currentPage: undefined, // Current page to know if we need to reset ad detection on init, or add the ads options back
        currentChannel: undefined, // Current channel to avoid pre-roll ad anticipation to trigger if we visit channel pages
        optionsInitialized: false, // Used to know if the ads options have been initialized on the current page
        optionsInitializing: false, // Used to track the ads options initialization
        volumePremute: undefined, // Main player volume, used to set the volume of the stream top right during an ad
        restorePiP: false, // Used to avoid displaying an ad if a stream is in Picture in Picture mode (require "disableDisplay" to true)
        autoCheck: undefined, // Holder for the setInterval for checkAd
    };

    // Selectors for the current player (hw: highwind player, only one existing currently)
    const _tmuteSelectors = {
        hw: {
            player: 'video-player__container', // Player class
            playerVideo: '.video-player__container video', // Player video selector
            playerDuringAd: 'pbyp-player-instance', // Top-right player class, existing sometimes during an ad
            playerHidingDuringAd: 'picture-by-picture-player--collapsed', // Class hiding the top-right player (during an ad)
            muteButton: 'button[data-a-target="player-mute-unmute-button"]', // (un)mute button selector
            volumeSlider: 'input[data-a-target="player-volume-slider"]', // Volume slider selector
            adNotice: undefined, // Ad notice class (dynamically set)
            adNoticeFinder: '[data-a-target="ax-overlay"]', // Ad notice selector to find the class
            viewersCount: 'metadata-layout__support', // Viewers count wrapper class
        },
    };
    let currentSelector = undefined;

    // --- Core Ad Muting and Hiding Logic ---

    /**
     * Main loop to check for active ads and trigger mute/hide actions.
     */
    function checkAd() {
        if (_tmuteVars.highwindPlayer === undefined) {
            const isHwPlayer = document.getElementsByClassName(_tmuteSelectors.hw.player).length;
            const isViewing = Boolean(isHwPlayer);
            if (isViewing === false) return;

            _tmuteVars.highwindPlayer = Boolean(isHwPlayer);
            currentSelector = (_tmuteVars.highwindPlayer === true) ? _tmuteSelectors.hw : null;
            log('info', `You're currently using the ${(_tmuteVars.highwindPlayer === true) ? 'Highwind' : 'new unknown'} player.`);
            if (currentSelector === null) {
                clearInterval(_tmuteVars.autoCheck);
                log('error', 'Script stopped. Failed to find the player, Twitch changed something. Feel free to contact the author of the script.');
                return;
            }
        } else {
            const isViewing = Boolean(document.getElementsByClassName(currentSelector.player).length);
            if (isViewing === false) return;
        }

        if (_tmuteVars.optionsInitialized === false || window.location.pathname !== _tmuteVars.currentPage) {
            initAdsOptions();
            if (currentSelector.adNotice === undefined) return;
        }

        const advert = document.getElementsByClassName(currentSelector.adNotice)[_tmuteVars.playerIdAds];

        if (_tmuteVars.adElapsedTime !== undefined) {
            _tmuteVars.adElapsedTime += _tmuteVars.timerCheck / 1000;
            if (_tmuteVars.adElapsedTime >= _tmuteVars.adUnlockAt && advert.childNodes[1] !== undefined) {
                for (let i = 0; i < advert.childElementCount; i++) {
                    if (!advert.childNodes[i].classList.contains(currentSelector.adNotice)) advert.removeChild(advert.childNodes[i]);
                }
                log('info', 'Unlocking Twitch player as Twitch forgot to remove the ad notice after the ad(s).');
            }
        }

        if ((advert.childElementCount > 2 && _tmuteVars.adInProgress === false) || (_tmuteVars.adInProgress === true && advert.childElementCount <= 2)) {
            if (advert.childElementCount > 2) {
                if (_tmuteVars.anticipateInProgress !== false) {
                    clearTimeout(_tmuteVars.anticipateInProgress);
                    _tmuteVars.anticipateInProgress = false;
                    _tmuteVars.anticipatePrematureEnd = true;
                    log('info', 'Pre-roll ad anticipation ended prematurely, ad detected.');
                } else {
                    isAlreadyMuted();
                }
            } else if (_tmuteVars.adElapsedTime !== undefined && _tmuteVars.adElapsedTime < _tmuteVars.adMinTime) return;

            mutePlayer();
        }
    }

    /**
     * Main function to (un)mute and (un)hide the player called by checkAd().
     */
    function mutePlayer() {
        if (document.querySelector(currentSelector.muteButton) !== null) {
            if (_tmuteVars.anticipatePrematureEnd === true) {
                _tmuteVars.anticipatePrematureEnd = false;
                _tmuteVars.adInProgress = !(_tmuteVars.adInProgress);
            } else {
                actionMuteClick();
            }

            if (_tmuteVars.adInProgress === true) {
                _tmuteVars.adsDisplayed++;
                _tmuteVars.adElapsedTime = 1;
                log('info', `Ad #${_tmuteVars.adsDisplayed} detected. Player ${(_tmuteVars.alreadyMuted === true ? 'already ' : '')}muted.`);
                actionHidePlayer(); // Only hides if _tmuteVars.disableDisplay is true
                unmuteAdPlayer();
            } else {
                log('info', `Ad #${_tmuteVars.adsDisplayed} finished (lasted ${(_tmuteVars.adElapsedTime ? _tmuteVars.adElapsedTime.toFixed(1) : 'N/A')}s).${(_tmuteVars.alreadyMuted === true ? '' : ' Player unmuted.')}`);
                _tmuteVars.adElapsedTime = undefined;
                actionHidePlayer(false); // Always attempts to show if _tmuteVars.disableDisplay is false
                resetMuteOnStreamDuringAd();
            }
        } else {
            log('warn', 'No volume button found (class changed ?).');
        }
    }

    /**
     * Mute the stream shown top right during the ad to prevent double audio (after ad finishes).
     */
    function resetMuteOnStreamDuringAd() {
        const playerDuringAd = document.getElementsByClassName(currentSelector.playerDuringAd)[0];
        if (playerDuringAd !== undefined) {
            playerDuringAd.childNodes[0].muted = true;
            log('debug', 'Small ad stream muted to prevent double audio.');
        }
    }

    /**
     * Unmute (and unhide) the stream showing top right during an ad if the player was initially unmuted.
     */
    function unmuteAdPlayer(firstCall = true) {
        const playerDuringAd = document.getElementsByClassName(currentSelector.playerDuringAd)[0];
        if (playerDuringAd !== undefined) {
            playerDuringAd.childNodes[0].setAttribute('controls', true);
            if (_tmuteVars.alreadyMuted === false) {
                playerDuringAd.childNodes[0].volume = _tmuteVars.volumePremute;
                playerDuringAd.childNodes[0].muted = false;
                log('info', 'Small ad stream unmuted (player was not muted initially).');
            }
            // Switch the eventual previous PiP to the smaller stream available during an ad
            if (_tmuteVars.restorePiP === true) playerDuringAd.childNodes[0].requestPictureInPicture();
            // Check the player is not hidden by Twitch, else force display it
            const playerHidden = document.getElementsByClassName(currentSelector.playerHidingDuringAd)[0];
            if (playerHidden !== undefined) {
                playerHidden.classList.remove(currentSelector.playerHidingDuringAd);
                log('info', 'Stream top right hidden detected during the ad. Unhidden.');
            }
        } else if (firstCall === true) { // Delaying a bit just in case it didn't load in DOM yet
            setTimeout(() => {
                unmuteAdPlayer(false);
            }, 2000);
        }
    }

    /**
     * (un)Mute (and (un)hide) the player when loading a stream to anticipate a pre-roll ad.
     */
    function anticipatePreroll(initCall = true) {
        if (_tmuteVars.anticipatePreroll === false || (_tmuteVars.anticipateInProgress !== false && initCall === true)) return;
        if (document.querySelector(currentSelector.muteButton) !== null) {
            if (initCall === true) isAlreadyMuted();
            actionMuteClick(true);
        }
        actionHidePlayer(initCall); // Will only hide if _tmuteVars.disableDisplay is true

        if (initCall === true) {
            log('info', `Pre-roll ad anticipation set for ${ _tmuteVars.anticipateTimer } ms. Player ${(_tmuteVars.alreadyMuted === true ? 'already ' : '')}muted.`);
            _tmuteVars.anticipateInProgress = setTimeout(() => {
                anticipatePreroll(false);
            }, _tmuteVars.anticipateTimer);
        } else {
            _tmuteVars.anticipateInProgress = false;
            log('info', 'Pre-roll ad anticipation ended.');
        }
    }

    /**
     * Click on the (un)mute button
     * @param {boolean} anticipatingCall - True if called during pre-roll anticipation.
     */
    function actionMuteClick(anticipatingCall = false) {
        const videoEl = document.querySelectorAll(currentSelector.playerVideo)[_tmuteVars.playerIdAds];
        const muteBtn = document.querySelectorAll(currentSelector.muteButton)[_tmuteVars.playerIdAds];

        if (videoEl && muteBtn) {
            _tmuteVars.volumePremute = videoEl.volume;
            if (_tmuteVars.alreadyMuted === false) muteBtn.click();
            if (anticipatingCall === false) _tmuteVars.adInProgress = !(_tmuteVars.adInProgress);
        } else {
            log('warn', 'Could not find video element or mute button for mute action.');
        }
    }

    /**
     * (un)Hide the player based on _tmuteVars.disableDisplay setting.
     * @param {boolean} hideIt - True to hide, false to show.
     */
    function actionHidePlayer(hideIt = true) {
        if (_tmuteVars.disableDisplay === true) {
            const videoEl = document.querySelectorAll(currentSelector.playerVideo)[_tmuteVars.playerIdAds];
            if (videoEl) {
                videoEl.style.visibility = (hideIt === true) ? 'hidden' : 'visible';
                log('debug', `Player visibility set to: ${videoEl.style.visibility} (controlled by disableDisplay option).`);
                togglePiP();
            } else {
                log('warn', 'Could not find video element for hide action in actionHidePlayer.');
            }
        } else {
            // If disableDisplay is false, ensure the player is visible, regardless of `hideIt`
            const videoEl = document.querySelectorAll(currentSelector.playerVideo)[_tmuteVars.playerIdAds];
            if (videoEl) {
                videoEl.style.visibility = 'visible';
                log('debug', 'Player visibility forced to: visible (disableDisplay is false).');
            }
        }
    }

    /**
     * Detects (and set) if the player is already muted or not.
     */
    function isAlreadyMuted() {
        if (_tmuteVars.highwindPlayer === true) {
            const volumeSlider = document.querySelector(currentSelector.volumeSlider);
            if (volumeSlider) {
                _tmuteVars.alreadyMuted = Boolean(volumeSlider.valueAsNumber === 0);
                log('debug', `Player initial mute state detected: ${_tmuteVars.alreadyMuted}`);
            } else {
                log('warn', 'Could not find volume slider to detect initial mute state.');
                _tmuteVars.alreadyMuted = false;
            }
        }
    }

    /**
     * Detect if the ads options have been initialized, and starts init if required
     */
    function initAdsOptions(lastCalls = 0, failSafeCall = false) {
        clearTimeout(_tmuteVars.optionsInitializing);
        const optionsInitialized = (document.getElementById('_tmads_options') === null) ? false : true;
        if (optionsInitialized === true) initUpdate();
        if (optionsInitialized === false) {
            _tmuteVars.optionsInitialized = false;
            adsOptions('init');
            _tmuteVars.optionsInitializing = setTimeout(() => {
                initAdsOptions();
            }, _tmuteVars.timerCheck);
        } else if (lastCalls < 5) {
            lastCalls++;
            if (lastCalls === 5) failSafeCall = true;
            _tmuteVars.optionsInitializing = setTimeout(() => {
                initAdsOptions(lastCalls, failSafeCall);
            }, Math.max(_tmuteVars.timerCheck, 500));
        } else if (failSafeCall === true) {
            _tmuteVars.optionsInitializing = setTimeout(() => {
                initAdsOptions(lastCalls, failSafeCall);
            }, 60000);
        }
    }

    /**
     * Update different values on init
     */
    function initUpdate() {
        if (window.location.pathname !== _tmuteVars.currentPage) {
            if (_tmuteVars.adInProgress === true) {
                resetPlayerState();
            } else if (_tmuteVars.adInProgress === false && (_tmuteVars.currentChannel === undefined || window.location.pathname.startsWith(`/${_tmuteVars.currentChannel}`) === false)) {
                anticipatePreroll();
            }
        }

        _tmuteVars.currentPage = window.location.pathname;
        _tmuteVars.currentChannel = window.location.pathname.split('/')[1];

        if (currentSelector.adNotice === undefined) {
            clearInterval(_tmuteVars.autoCheck);
            if (document.querySelector(currentSelector.adNoticeFinder) !== null) {
                currentSelector.adNotice = document.querySelector(currentSelector.adNoticeFinder).parentNode.className;
                log('info', `Ad notice class retrieved ("${currentSelector.adNotice}") and set.`);
                _tmuteVars.autoCheck = setInterval(checkAd, _tmuteVars.timerCheck);
            } else {
                log('warn', 'Script stopped. Failed to find the ad notice class, Twitch changed something. Feel free to contact the author of the script.');
            }
        }
    }

    /**
     * Toggle Picture in Picture mode during an ad if it's on beforehand with "disableDisplay" set to true
     */
    function togglePiP() {
        if (document.pictureInPictureElement) {
            _tmuteVars.restorePiP = true;
            document.exitPictureInPicture();
        } else if (_tmuteVars.restorePiP === true && document.pictureInPictureEnabled) {
            _tmuteVars.restorePiP = false;
            if (document.pictureInPictureElement) document.exitPictureInPicture();
            document.querySelectorAll(currentSelector.playerVideo)[_tmuteVars.playerIdAds].requestPictureInPicture();
        }
    }

    /**
     * Reset player state when switching stream during an ad
     */
    function resetPlayerState() {
        actionMuteClick();
        actionHidePlayer(false);
        log('info', 'Stream switched during an ad. Reverted player state.');
    }

    /**
     * Attempts to get the currently active video element that should be fullscreened.
     * Prioritizes the small picture-in-picture stream if an ad is playing on the main player.
     * @returns {HTMLVideoElement|null} The video element to fullscreen, or null if none found.
     */
    function getFullscreenTargetVideo() {
        // Check if the smaller player during ad is active and visible
        const smallPlayerContainer = document.getElementsByClassName(currentSelector.playerDuringAd)[0];
        if (smallPlayerContainer && smallPlayerContainer.childNodes[0] && smallPlayerContainer.childNodes[0].tagName === 'VIDEO') {
            const smallPlayerVideo = smallPlayerContainer.childNodes[0];
            // Check if it's actually displaying and not collapsed by Twitch itself
            if (!smallPlayerContainer.classList.contains(currentSelector.playerHidingDuringAd) && smallPlayerVideo.offsetParent !== null) {
                log('debug', 'Targeting small ad player for fullscreen.');
                return smallPlayerVideo;
            }
        }

        // Otherwise, target the main player
        const mainPlayerVideo = document.querySelectorAll(currentSelector.playerVideo)[_tmuteVars.playerIdAds];
        if (mainPlayerVideo) {
            log('debug', 'Targeting main player for fullscreen.');
            return mainPlayerVideo;
        }

        log('warn', 'No suitable video element found for fullscreen.');
        return null;
    }

    /**
     * Toggles fullscreen for the currently active stream video element.
     */
    function fullscreenCurrentPlayer() {
        const videoElement = getFullscreenTargetVideo();
        if (videoElement) {
            if (document.fullscreenElement) {
                document.exitFullscreen();
                log('info', 'Exiting fullscreen.');
            } else {
                videoElement.requestFullscreen().catch(err => {
                    log('error', `Error attempting fullscreen: ${err.message}`);
                });
                log('info', 'Attempting fullscreen.');
            }
        } else {
            log('warn', 'Cannot fullscreen: No active video element found.');
        }
    }

    /**
     * Attempts to bypass or end the current ad immediately.
     */
    function bypassAd() {
        const advert = document.getElementsByClassName(currentSelector.adNotice)[0];

        if (_tmuteVars.adInProgress === false && (!advert || advert.childElementCount <= 2)) {
            log('info', 'No ad detected to bypass. Ad notice not displayed or already ended.');
            return;
        }

        // Force the ad timer to its end to trigger ad conclusion on next check
        _tmuteVars.adElapsedTime = _tmuteVars.adUnlockAt;
        log('info', 'Bypass Ad requested. Forcing ad timer to end.');

        // If an ad is in progress, attempt to trigger mutePlayer to end it immediately
        if (_tmuteVars.adInProgress === true) {
            log('info', 'Ad in progress, attempting immediate ad termination via mutePlayer.');
            mutePlayer(); // This should trigger the ad finished logic
        }
    }

    /**
     * Manage ads options and UI.
     */
    function adsOptions(changeType = 'show') {
        switch (changeType) {
            case 'init': {
                initUpdate();

                if (document.getElementsByClassName(currentSelector.viewersCount)[0] === undefined) break;

                const optionsTemplate = document.createElement('div');
                optionsTemplate.id = '_tmads_options-wrapper';
                const buttonStyle = document.createElement('style');
                buttonStyle.textContent = `
                    #_tmads_options-wrapper {
                        margin-right: 10px;
                    }
                    ._tmads_button {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        padding: 0 10px; /* Adjusted padding */
                        margin: 5px 2px; /* Adjusted margin */
                        height: 32px; /* Adjusted height */
                        min-width: 80px; /* Adjusted min-width */
                        border-radius: 5px; /* Modern border-radius */
                        background-color: #6441a5; /* Twitch purple */
                        color: #ffffff;
                        border: none;
                        cursor: pointer;
                        font-size: 0.95em;
                        font-weight: 600;
                        transition: background-color 0.2s ease, transform 0.1s ease;
                    }
                    ._tmads_button:hover {
                        background-color: #772ce8; /* Lighter purple on hover */
                        transform: translateY(-1px);
                    }
                    ._tmads_button:active {
                        transform: translateY(0);
                    }`;
                document.head.appendChild(buttonStyle);

                // Replaced old buttons with new ones
                optionsTemplate.innerHTML = `
                    <span id="_tmads_options" style="display: none;">
                        <button type="button" id="_tmads_bypass" class="_tmads_button">Bypass Ad</button>
                        <button type="button" id="_tmads_fullscreen" class="_tmads_button">Fullscreen Current Stream</button>
                    </span>
                    <button type="button" id="_tmads_showoptions" class="_tmads_button">Ads Options</button>`;

                let attached = false;
                const targetParent = document.getElementsByClassName(currentSelector.viewersCount)[0];
                if (targetParent) {
                    try {
                        if (targetParent.parentNode && targetParent.parentNode.childNodes[1] &&
                            targetParent.parentNode.childNodes[1].childNodes[1] &&
                            targetParent.parentNode.childNodes[1].childNodes[1].childNodes[0] &&
                            targetParent.parentNode.childNodes[1].childNodes[1].childNodes[0].childNodes[0] &&
                            targetParent.parentNode.childNodes[1].childNodes[1].childNodes[0].childNodes[0].childNodes[1]) {
                            targetParent.parentNode.childNodes[1].childNodes[1].childNodes[0].childNodes[0].childNodes[1].appendChild(optionsTemplate);
                            attached = true;
                        }
                    } catch (e) {
                        log('debug', `Attempt 1 to attach options failed: ${e.message}`);
                    }

                    if (!attached) {
                        try {
                            if (targetParent.childNodes[2] && targetParent.childNodes[2].childNodes[0]) {
                                targetParent.childNodes[2].childNodes[0].appendChild(optionsTemplate);
                                attached = true;
                            }
                        } catch (e2) {
                            log('debug', `Attempt 2 to attach options failed: ${e2.message}`);
                        }
                    }

                    if (!attached) {
                        if (targetParent.parentNode && targetParent.parentNode.childNodes[1]) {
                            optionsTemplate.style.paddingTop = '5px';
                            targetParent.parentNode.childNodes[1].appendChild(optionsTemplate);
                            attached = true;
                        }
                    }
                }

                if (attached) {
                    document.getElementById('_tmads_showoptions').addEventListener('click', adsOptions.bind(null, 'show'), false);
                    // New event listeners for the new buttons
                    document.getElementById('_tmads_bypass').addEventListener('click', bypassAd, false);
                    document.getElementById('_tmads_fullscreen').addEventListener('click', fullscreenCurrentPlayer, false);
                    _tmuteVars.optionsInitialized = true;
                    log('info', 'Ads options initialized and attached to DOM with new buttons.');
                } else {
                    log('warn', 'Failed to attach Ads options to the DOM. Viewers count element parent not found or structure changed.');
                }
                break;
            }
            case 'show':
            default: {
                _tmuteVars.displayingOptions = !(_tmuteVars.displayingOptions);
                const optionsSpan = document.getElementById('_tmads_options');
                if (optionsSpan) {
                    optionsSpan.style.display = (_tmuteVars.displayingOptions === false) ? 'none' : 'inline-flex';
                }
                break;
            }
        }
    }

    // --- Bonus Claiming (Kept as non-disruptive) ---

    const autoClaimBonus = () => {
        const checkAndClaim = () => {
            const bonusButtonSelectors = [
                'button[aria-label="Claim Bonus"]',
                'button[data-a-target="claimable-bonus"]',
                '.community-points-summary .claimable-bonus__button',
                '.community-points-summary .community-points-summary__icon ~ button',
            ];

            let bonusButton = null;
            for (const selector of bonusButtonSelectors) {
                bonusButton = document.querySelector(selector);
                if (bonusButton) {
                    log('debug', `Found bonus button via selector: ${selector}`);
                    break;
                }
            }

            if (bonusButton && !bonusButton.hasAttribute('data-claimed-by-adblock')) {
                try {
                    bonusButton.click();
                    bonusButton.setAttribute('data-claimed-by-adblock', 'true');
                    log('info', 'Successfully claimed bonus points!');
                } catch (error) {
                    log('error', 'Error clicking bonus button:', error);
                    bonusButton.setAttribute('data-claimed-by-adblock', 'error');
                }
            } else if (bonusButton) {
                log('debug', 'Bonus button found but already marked or claimed.');
            } else {
                log('debug', 'No bonus button found with current selectors.');
            }
        };

        const observer = new MutationObserver(checkAndClaim);
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setInterval(checkAndClaim, 1000);
        log('info', 'Auto-claim bonus functionality initiated.');
    };

    // --- Main Initialization Sequence ---

    log('info', 'Initializing Twitch Ad Muter & Enhancer (v1.1700)...');

    window.addEventListener('DOMContentLoaded', () => {
        log('info', 'DOMContentLoaded fired. Activating DOM manipulation.');

        _tmuteVars.highwindPlayer = document.getElementsByClassName(_tmuteSelectors.hw.player).length > 0;
        currentSelector = (_tmuteVars.highwindPlayer === true) ? _tmuteSelectors.hw : null;
        if (!currentSelector) {
            log('error', 'Could not identify player type at DOMContentLoaded. Some features may not work.');
        }

        _tmuteVars.autoCheck = setInterval(checkAd, _tmuteVars.timerCheck);

        autoClaimBonus();

        initAdsOptions();
    });

    log('info', 'Script initialized successfully. Waiting for DOMContentLoaded.');
})();
