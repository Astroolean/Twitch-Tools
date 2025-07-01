// ==UserScript==
// @name          Twitch Tools
// @namespace     https://astroolean.github.io/
// @description   Automatically mutes Twitch ads, bypass ads, auto-claim channel points, auto-select highest quality, auto-close "Continue Watching?" dialog, and applies dark mode.
// @include       https://www.twitch.tv/*
// @include       https://twitch.tv/*
// @version       1.0.1 // Twitch made an update... changed a few things.
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
    const _tmuteVars = {
        timerCheck: 500, // Checking rate of ad in progress (in milliseconds; recommended value: 250 - 1000; default: 500)
        adInProgress: false, // Track if an ad is in progress or not (directly linked to player mute state)
        adsDisplayed: 0, // Number of ads displayed
        disableDisplay: false, // Disable the player display during an ad (true = yes, false = no (default))
        anticipatePreroll: false, // Temporarily mute and/or hide the player when loading a new stream to anticipate a pre-roll ad (true = yes, false = no (default))
        anticipateTimer: 2000, // Time where the player is muted and/or hidden when loading a new stream to anticipate a pre-roll ad (in milliseconds; default: 2000)
        anticipateInProgress: false, // Used to check if we're currently anticipating a pre-roll ad
        anticipatePrematureEnd: false, // Used to check if we prematurely ended a pre-roll ad anticipation
        alreadyMuted: false, // Used to check if the player is muted at the start of an ad
        adElapsedTime: undefined, // Used to check if Twitch forgot to remove the ad notice
        adUnlockAt: 270, // Unlock the player if this amount of seconds elapsed during an ad (in seconds; default: 270)
        adMinTime: 2, // Minimum amount of seconds the player will be muted/hidden since an ad started (in seconds; default: 2)
        playerIdAds: 0, // Player ID where ads may be displayed (default 0, varying on squads page)
        highwindPlayer: undefined, // If you've the Highwind Player or not
        currentPage: undefined, // Current page to know if we need to reset ad detection on init, or add the ads options back
        currentChannel: undefined, // Current channel to avoid pre-roll ad anticipation to trigger if we visit channel pages
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
            if (currentSelector === null) {
                clearInterval(_tmuteVars.autoCheck);
                return;
            }
        } else {
            const isViewing = Boolean(document.getElementsByClassName(currentSelector.player).length);
            if (isViewing === false) return;
        }

        // Initialize adNotice if not set
        if (currentSelector.adNotice === undefined) {
            initializeAdNotice();
            if (currentSelector.adNotice === undefined) return; // If still not found, wait for next check
        }

        const advert = document.getElementsByClassName(currentSelector.adNotice)[_tmuteVars.playerIdAds];
        if (!advert) return; // Ensure advert element exists

        if (_tmuteVars.adElapsedTime !== undefined) {
            _tmuteVars.adElapsedTime += _tmuteVars.timerCheck / 1000;
            if (_tmuteVars.adElapsedTime >= _tmuteVars.adUnlockAt && advert.childNodes[1] !== undefined) {
                for (let i = 0; i < advert.childElementCount; i++) {
                    if (advert.childNodes[i] && !advert.childNodes[i].classList.contains(currentSelector.adNotice)) advert.removeChild(advert.childNodes[i]);
                }
            }
        }

        if ((advert.childElementCount > 2 && _tmuteVars.adInProgress === false) || (_tmuteVars.adInProgress === true && advert.childElementCount <= 2)) {
            if (advert.childElementCount > 2) {
                if (_tmuteVars.anticipateInProgress !== false) {
                    clearTimeout(_tmuteVars.anticipateInProgress);
                    _tmuteVars.anticipateInProgress = false;
                    _tmuteVars.anticipatePrematureEnd = true;
                } else {
                    isAlreadyMuted();
                }
            } else if (_tmuteVars.adElapsedTime !== undefined && _tmuteVars.adElapsedTime < _tmuteVars.adMinTime) return;

            mutePlayer();
        }
    }

    /**
     * Finds the ad notice class and sets up the autoCheck interval.
     */
    function initializeAdNotice() {
        if (document.querySelector(currentSelector.adNoticeFinder) !== null) {
            currentSelector.adNotice = document.querySelector(currentSelector.adNoticeFinder).parentNode.className;
            clearInterval(_tmuteVars.autoCheck); // Clear any old interval
            _tmuteVars.autoCheck = setInterval(checkAd, _tmuteVars.timerCheck);
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
                actionHidePlayer(); // Only hides if _tmuteVars.disableDisplay is true
                unmuteAdPlayer();
            } else {
                _tmuteVars.adElapsedTime = undefined;
                actionHidePlayer(false); // Always attempts to show if _tmuteVars.disableDisplay is false
                resetMuteOnStreamDuringAd();
            }
        } else {
            // No volume button found
        }
    }

    /**
     * Mute the stream shown top right during the ad to prevent double audio (after ad finishes).
     */
    function resetMuteOnStreamDuringAd() {
        const playerDuringAd = document.getElementsByClassName(currentSelector.playerDuringAd)[0];
        if (playerDuringAd !== undefined && playerDuringAd.childNodes[0]) {
            playerDuringAd.childNodes[0].muted = true;
        }
    }

    /**
     * Unmute (and unhide) the stream showing top right during an ad if the player was initially unmuted.
     */
    function unmuteAdPlayer(firstCall = true) {
        const playerDuringAd = document.getElementsByClassName(currentSelector.playerDuringAd)[0];
        if (playerDuringAd !== undefined && playerDuringAd.childNodes[0]) {
            playerDuringAd.childNodes[0].setAttribute('controls', true);
            if (_tmuteVars.alreadyMuted === false) {
                playerDuringAd.childNodes[0].volume = _tmuteVars.volumePremute;
                playerDuringAd.childNodes[0].muted = false;
            }
            // Switch the eventual previous PiP to the smaller stream available during an ad
            if (_tmuteVars.restorePiP === true) playerDuringAd.childNodes[0].requestPictureInPicture();
            // Check the player is not hidden by Twitch, else force display it
            const playerHidden = document.getElementsByClassName(currentSelector.playerHidingDuringAd)[0];
            if (playerHidden !== undefined) {
                playerHidden.classList.remove(currentSelector.playerHidingDuringAd);
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
            _tmuteVars.anticipateInProgress = setTimeout(() => {
                anticipatePreroll(false);
            }, _tmuteVars.anticipateTimer);
        } else {
            _tmuteVars.anticipateInProgress = false;
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
            // Could not find video element or mute button for mute action.
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
                togglePiP();
            } else {
                // Could not find video element for hide action in actionHidePlayer.
            }
        } else {
            // If disableDisplay is false, ensure the player is visible, regardless of `hideIt`
            const videoEl = document.querySelectorAll(currentSelector.playerVideo)[_tmuteVars.playerIdAds];
            if (videoEl) {
                videoEl.style.visibility = 'visible';
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
            } else {
                _tmuteVars.alreadyMuted = false;
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
                return smallPlayerVideo;
            }
        }

        // Otherwise, target the main player
        const mainPlayerVideo = document.querySelectorAll(currentSelector.playerVideo)[_tmuteVars.playerIdAds];
        if (mainPlayerVideo) {
            return mainPlayerVideo;
        }

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
            } else {
                videoElement.requestFullscreen().catch(err => {
                    // Error attempting fullscreen
                });
            }
        } else {
            // Cannot fullscreen: No active video element found.
        }
    }

    /**
     * Attempts to bypass or end the current ad immediately.
     */
    function bypassAd() {
        const advert = document.getElementsByClassName(currentSelector.adNotice)[0];

        if (_tmuteVars.adInProgress === false && (!advert || advert.childElementCount <= 2)) {
            return;
        }

        // Force the ad timer to its end to trigger ad conclusion on next check
        _tmuteVars.adElapsedTime = _tmuteVars.adUnlockAt;

        // If an ad is in progress, attempt to trigger mutePlayer to end it immediately
        if (_tmuteVars.adInProgress === true) {
            mutePlayer(); // This should trigger the ad finished logic
        }
    }

    // --- Bonus Claiming ---

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
                    break;
                }
            }

            if (bonusButton && !bonusButton.hasAttribute('data-claimed-by-adblock')) {
                try {
                    bonusButton.click();
                    bonusButton.setAttribute('data-claimed-by-adblock', 'true');
                } catch (error) {
                    bonusButton.setAttribute('data-claimed-by-adblock', 'error');
                }
            } else if (bonusButton) {
                // Bonus button found but already marked or claimed.
            } else {
                // No bonus button found with current selectors.
            }
        };

        const observer = new MutationObserver(checkAndClaim);
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setInterval(checkAndClaim, 1000);
    };

    // --- New Features ---

    /**
     * Auto-selects the highest available video quality.
     */
    function autoSetHighestQuality() {
        const settingsButtonSelector = 'button[data-a-target="player-settings-button"]';
        const qualityMenuItemSelector = 'div[data-a-target="player-settings-menu-item"]'; // Selector for the "Quality" menu item
        const qualityOptionSelector = 'div[data-a-target="player-settings-menu-item"], div[role="menuitem"]'; // General selector for menu items within quality

        const observeSettingsMenu = (mutations, observer) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Check if the settings menu popover has appeared
                    const settingsMenu = document.querySelector('.quality-selector__menu, .video-player__popover-content');
                    if (settingsMenu) {
                        // Find the "Quality" menu item and click it
                        const qualityOption = Array.from(settingsMenu.querySelectorAll(qualityMenuItemSelector))
                            .find(item => item.textContent.includes('Quality'));

                        if (qualityOption) {
                            qualityOption.click();

                            // After clicking Quality, wait for the quality options to appear
                            const observeQualityOptions = new MutationObserver((mutationsList, innerObserver) => {
                                for (const innerMutation of mutationsList) {
                                    if (innerMutation.type === 'childList' && innerMutation.addedNodes.length > 0) {
                                        const qualityOptionsContainer = document.querySelector('.quality-selector__menu'); // Or appropriate container
                                        if (qualityOptionsContainer) {
                                            // Filter for actual resolution options (e.g., "1080p", "720p")
                                            const availableQualities = Array.from(qualityOptionsContainer.querySelectorAll(qualityOptionSelector))
                                                .filter(item => item.textContent.match(/\d+p/) && !item.textContent.includes('Source') && !item.textContent.includes('Auto'))
                                                .sort((a, b) => {
                                                    // Extract resolution number for sorting
                                                    const getResolution = (text) => parseInt(text.match(/(\d+)p/)?.[1] || 0);
                                                    return getResolution(b.textContent) - getResolution(a.textContent);
                                                });

                                            if (availableQualities.length > 0) {
                                                availableQualities[0].click(); // Click the highest quality option
                                                innerObserver.disconnect(); // Stop observing quality options
                                                observer.disconnect(); // Stop observing settings menu
                                                // Re-attach observer for settings button to catch future menu openings
                                                attachSettingsButtonObserver();
                                                return;
                                            }
                                        }
                                    }
                                }
                            });
                            // Observe the body for the quality options menu to appear
                            observeQualityOptions.observe(document.body, { childList: true, subtree: true });
                            observer.disconnect(); // Disconnect the initial settings menu observer while waiting for quality options
                            return;
                        }
                    }
                }
            }
        };

        const attachSettingsButtonObserver = () => {
            const observer = new MutationObserver((mutationsList, observerInstance) => {
                const settingsButton = document.querySelector(settingsButtonSelector);
                if (settingsButton) {
                    settingsButton.addEventListener('click', () => {
                        // When settings button is clicked, observe for the menu to open
                        const menuObserver = new MutationObserver(observeSettingsMenu);
                        menuObserver.observe(document.body, { childList: true, subtree: true });
                        // Disconnect this observer as soon as we click the settings button
                        observerInstance.disconnect();
                    }, { once: true }); // Use once: true to automatically remove the listener after it fires
                }
            });
            // Observe the body for the settings button to appear (e.g., on page load or player changes)
            observer.observe(document.body, { childList: true, subtree: true });
        };

        // Initial attachment of the settings button observer
        attachSettingsButtonObserver();
    }

    /**
     * Auto-closes the "Continue Watching?" dialog.
     */
    function autoCloseContinueWatchingDialog() {
        const dialogSelector = 'div[data-test-selector="disconnect-overlay"]'; // Selector for the disconnect overlay
        const continueButtonSelector = 'button[data-a-target="player-overlay-continue-watching-button"]'; // Selector for the "Continue Watching" button

        const checkAndCloseDialog = () => {
            const dialog = document.querySelector(dialogSelector);
            if (dialog) {
                const continueButton = dialog.querySelector(continueButtonSelector);
                if (continueButton) {
                    continueButton.click();
                }
            }
        };

        // Use a MutationObserver to react to DOM changes, which is generally more efficient for detecting dynamically added elements
        const observer = new MutationObserver(checkAndCloseDialog);
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Also run once every few seconds as a fallback, in case the MutationObserver misses something or for elements that are not added via childList mutations
        setInterval(checkAndCloseDialog, 3000);
    }

    /**
     * Automatically applies dark mode to the Twitch site.
     */
    function autoApplyDarkMode() {
        const htmlElement = document.documentElement;
        // Check if dark mode is already active by looking for the class and data-attribute
        if (!htmlElement.classList.contains('tw-root--dark')) {
            htmlElement.classList.add('tw-root--dark');
            htmlElement.setAttribute('data-a-theme', 'dark'); // Ensure data-a-theme is also set
        }
    }


    // --- Main Initialization Sequence ---

    window.addEventListener('DOMContentLoaded', () => {
        // Initialize player detection and current selector based on existing player on page load
        _tmuteVars.highwindPlayer = document.getElementsByClassName(_tmuteSelectors.hw.player).length > 0;
        currentSelector = (_tmuteVars.highwindPlayer === true) ? _tmuteSelectors.hw : null;

        if (!currentSelector) {
            // Player type could not be identified, some features may not work.
            return;
        }

        // MutationObserver to detect URL changes and re-initialize ad detection and anticipation
        const urlChangeObserver = new MutationObserver(() => {
            // Check if the URL path has actually changed
            if (window.location.pathname !== _tmuteVars.currentPage) {
                // If an ad was in progress on the previous page, reset player state
                if (_tmuteVars.adInProgress === true) {
                    resetPlayerState();
                }
                // Update current page and channel for new navigation
                _tmuteVars.currentPage = window.location.pathname;
                _tmuteVars.currentChannel = window.location.pathname.split('/')[1];

                // Re-initialize ad notice detection and interval for the new page/channel
                initializeAdNotice();
                // Anticipate a pre-roll ad on the newly loaded stream
                anticipatePreroll();
            }
        });
        // Observe the body for URL changes (indicated by title or other changes, then checking path)
        urlChangeObserver.observe(document.body, { childList: true, subtree: true });

        // Initial setup for current page/channel, ad detection, and pre-roll anticipation when the DOM is ready
        _tmuteVars.currentPage = window.location.pathname;
        _tmuteVars.currentChannel = window.location.pathname.split('/')[1];
        initializeAdNotice(); // Set up initial ad notice detection and interval for ad muting
        anticipatePreroll(); // Initial anticipation for pre-roll ads on first load

        // Activate new and existing features
        autoClaimBonus();
        autoSetHighestQuality();
        autoCloseContinueWatchingDialog();
        autoApplyDarkMode(); // Activate the new dark mode feature
    });

})();
