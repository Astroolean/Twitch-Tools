# Twitch Ad Muter & Enhancer

---

## 📝 Description

The **Twitch Ad Muter & Enhancer** is a powerful UserScript designed to significantly improve your Twitch viewing experience. It automatically mutes ads, attempts to bypass them, and even auto-claims your channel points, allowing for a more seamless and uninterrupted watching experience.

---

## ✨ Features

* **Automatic Ad Muting:** Automatically mutes the stream volume when a Twitch ad is detected.
* **Ad Bypass (Experimental):** Attempts to fast-forward or bypass ads when possible.
* **Player Hiding (Optional):** Can hide the video player during ads for a completely blacked-out ad experience (configurable).
* **Pre-roll Ad Anticipation:** Temporarily mutes/hides the player when loading a new stream to anticipate and mitigate pre-roll ads.
* **Picture-in-Picture (PiP) Management:** Smartly handles PiP mode during ads, ensuring your viewing preference is respected.
* **Auto-Claim Channel Points:** Automatically clicks the "Claim Bonus" button to collect your channel points.
* **In-Player Options:** Provides convenient buttons directly within the Twitch player interface to manually bypass ads or toggle fullscreen.

---

## 🚀 Installation

To use this UserScript, you'll need a browser extension that supports UserScripts, such as **Greasemonkey** (Firefox) or **Tampermonkey** (Chrome, Edge, Opera, Firefox).

1.  **Install a UserScript Manager:**
    * **Tampermonkey (Recommended):**
        * [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
        * [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
        * [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpbldcldadghiekaagalnnlpgr)
    * **Greasemonkey (Firefox only):**
        * [Firefox](https://addons.mozilla.org/en-US/firefox/addon/greasemonkey/)

2.  **Install the UserScript:**
    * Click on the **Raw** button of the `twitch-ad-muter-enhancer.user.js` file in this repository. Your UserScript manager should automatically prompt you to install it.
    * Alternatively, you can create a new script in your UserScript manager and copy-paste the entire code into it.

---

## 🛠️ Usage

Once installed, the script runs automatically in the background when you visit `twitch.tv`.

* **Ad Muting & Hiding:** Ads will be automatically muted. If `disableDisplay` is set to `true` (within the script's configuration, see below), the player will also be hidden.
* **Channel Points:** Channel point bonuses will be claimed automatically when they appear.
* **In-Player Options:** Look for the "Ads Options" button near the viewer count on a live stream page. Clicking it will reveal additional buttons:
    * **Bypass Ad:** Attempts to immediately end any detected ad.
    * **Fullscreen Current Stream:** Toggles fullscreen for the currently active stream (even the small PiP stream during an ad).

---

## ⚠️ Important Notes

* **Twitch Updates:** Twitch frequently updates its website, which might temporarily break or reduce the effectiveness of this script. I will do my best to keep it updated.

* **Ad Blockers:** This script works by muting and managing the player during ads. It's not a traditional ad blocker that prevents ads from loading, but rather handles their presentation. Using it alongside a standard ad blocker might yield mixed results or conflicts.

* **Debugging:** `DEBUG_MODE` is set to `true` by default in the script. This will output extensive logs to your browser's console (F12, then "Console" tab), which can be helpful for troubleshooting. Remember to set `DEBUG_MODE` to `false` once you're satisfied with the script's behavior to reduce console noise.

---

## 📸 Screenshots



---

## 🙏 Acknowledgements

* Inspired by various Twitch ad-muting solutions.

* Developed with assistance from Google Gemini.

---

## ⚙️ Configuration (for advanced users)

You can customize some behaviors by editing the script directly in your UserScript manager. Look for the `_tmuteVars` object near the top of the script:

```javascript
const _tmuteVars = {
    timerCheck: 500,        // Checking rate of ad in progress (in milliseconds; recommended: 250 - 1000)
    disableDisplay: false,  // Disable the player display during an ad (true = yes, false = no (default))
    anticipatePreroll: false, // Temporarily mute and/or hide the player when loading a new stream to anticipate a pre-roll ad (true = yes, false = no (default))
    anticipateTimer: 2000,  // Time where the player is muted/hidden when loading a new stream for pre-roll anticipation (in milliseconds)
    adUnlockAt: 270,        // Unlock the player if this amount of seconds elapsed during an ad (in seconds)
    adMinTime: 2,           // Minimum amount of seconds the player will be muted/hidden since an ad started (in seconds)
    // ... other internal variables
};
