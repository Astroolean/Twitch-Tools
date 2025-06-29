# 🎥 FreeTwitch Stream Recorder & Ad Blocker (Theoretical Prototype)

This repository hosts a **Python-based Tkinter application** developed as a **theoretical prototype**. Its goal is to demonstrate a conceptual framework for **locally playing and recording Twitch streams** and to experiment with an **ad-blocking mechanism** using heuristic-based detection.

> ⚠️ **Disclaimer**: This is a proof-of-concept, not a production-ready tool. The "ad-blocking" feature is experimental and illustrative. Real-world effectiveness would require significantly more advanced techniques (like machine learning) and constant adaptation to Twitch's platform.

---

## 📑 Table of Contents

1. [Introduction](#1-introduction)  
2. [Core Functionality](#2-core-functionality)  
3. [Theoretical Ad-Blocking (Deep Dive)](#3-the-theoretical-ad-blocking-mechanism-deep-dive)  
    - [3.1 Detection Theory](#31-the-theory-of-detection)  
    - [3.2 Limitations](#32-limitations-of-current-heuristics)  
    - [3.3 Bypass Strategy](#33-the-theoretical-bypass-strategy)  
    - [3.4 Future Expansion](#34-future-theoretical-expansion-of-ad-detection)  
4. [Installation & Prerequisites](#4-installation--prerequisites)  
5. [Usage](#5-usage)  
6. [Future Considerations](#6-future-considerations--expansion)

---

## 1. Introduction

**FreeTwitch** is a desktop application built with **Tkinter**, utilizing **Streamlink** to pull Twitch streams and **ffpyplayer** for local playback. This prototype enables real-time analysis of Twitch stream data, forming the theoretical basis for client-side ad detection and removal.

Rather than treating streams as untouchable feeds, it conceptualizes them as modifiable video data—opening up possibilities for ad-skipping and stream control.

---

## 2. Core Functionality

The application currently offers:

- 🎬 **Stream Recording (Streamlink)** – Saves a Twitch live stream locally as `.ts` for manipulation and playback.
- 📺 **Local Playback (ffpyplayer)** – Plays the locally recorded stream in near real-time.
- 💾 **File Size Monitoring** – Auto-stops recording once a specified file size limit is reached.
- 🔊 **Volume Control** – Real-time audio adjustment via slider.
- 🔄 **Fullscreen Toggle** – Switch between immersive and windowed modes.
- 🚫 **Theoretical Ad-Blocker Toggle** – Enables experimental ad detection and bypass behavior.

---

## 3. The Theoretical Ad-Blocking Mechanism (Deep Dive)

### 3.1 The Theory of Detection

The `_check_for_ad_screen()` function uses simple visual heuristics to detect ads:

- **Brightness Heuristic**: Ads often start with dark screens. A sustained drop in brightness may signal an ad.
- **Motion Heuristic**: Ads tend to be static (e.g., brand logos). Using frame difference (SAD – Sum of Absolute Differences), the app detects low motion.

If both low brightness and low motion persist for 100+ frames (~3.3s at 30fps), it flags an ad.

---

### 3.2 Limitations of Current Heuristics

- ❌ **False Positives**: Dark game scenes, loading screens, or BRB screens may look like ads.
- ❌ **False Negatives**: Many ads are now high motion and brightly lit, evading detection.
- 🔄 **Twitch Adaptation**: Twitch can change ad formats, rendering simple heuristics ineffective.

---

### 3.3 The Theoretical Bypass Strategy

Once an ad is detected, the app:

1. **Stops** all recording and playback.
2. **Deletes** the current `.ts` stream file (removing the ad segment).
3. **Waits** 5 seconds to:
   - Allow Twitch to cycle past the ad.
   - Simulate a new viewer joining post-ad.
4. **Restarts** the stream and playback from a new file.

This prevents ad display by discarding segments instead of blocking requests.

---

### 3.4 Future Theoretical Expansion of Ad Detection

- 🤖 **Machine Learning**:
  - CNNs for frame-based ad detection.
  - Reinforcement learning for pattern analysis.
- 🔊 **Audio Analysis**:
  - Jingle/keyword detection via audio fingerprinting.
- 🧠 **Metadata & Hybrid Systems**:
  - Combine visual, audio, and potential metadata for more reliable detection.

---

## 4. Installation & Prerequisites

### 🐍 Python

Ensure you have **Python 3.x** installed.  
👉 [Download Python](https://www.python.org/downloads/)

### 📦 Required Libraries

Install **Streamlink** and the required Python packages:

```bash
pip install streamlink opencv-python Pillow ffpyplayer numpy
```

**Breakdown of dependencies:**

- `streamlink` – for grabbing Twitch stream data.
- `opencv-python` – for image/frame processing.
- `Pillow` – for converting frames to Tkinter-compatible images.
- `ffpyplayer` – for local video/audio playback.
- `numpy` – for efficient numerical frame analysis.

---

## 5. Usage

1. **Save the Script**  
   Save the main script as `freetwitch.py` (or any `.py` filename you prefer).

2. **Run the Application**  
   Open a terminal or command prompt and run:

   ```bash
   python freetwitch.py
   ```

3. **Enter a Twitch URL**  
   In the app GUI, enter the full Twitch stream URL (e.g., `https://www.twitch.tv/example_channel`).

4. **Start Stream**  
   Click **Start Recording** to begin saving and playing the stream locally.

5. **Toggle Ad Blocker (Theoretical)**  
   Use the **Ad Blocker ON** button to enable experimental ad detection logic.

6. **Toggle Fullscreen**  
   Press the `Esc` key to switch between fullscreen and windowed mode.

7. **Stop or Exit**  
   - Click **Stop Recording** to end the session.
   - Click **Exit Program** to close the app and clean up the `.ts` file.

---

## 6. Future Considerations & Expansion

This project is just a starting point. Here's what could be added or improved:

### 🚀 Advanced Ad Detection

- **Machine Learning (ML)**:
  - Train a CNN model to detect ad segments using visual cues.
  - Use reinforcement learning to optimize stream reconnect timing.

- **Audio Cues**:
  - Detect silent gaps or repeated jingles common to ad segments.
  - Implement audio fingerprinting to recognize ad patterns.

- **Metadata (if accessible)**:
  - Analyze real-time metadata to identify ad breaks.
  - Hybrid approach combining visual, audio, and metadata analysis.

### 🧩 Other Improvements

- **User Interface Enhancements**:
  - Stream quality selection.
  - Channel search/browsing.
  - Real-time stream stats or ad detection indicators.

- **Real-Time Streaming Without Disk Writes**:
  - Pipe Streamlink output directly to ffpyplayer to reduce disk usage.

- **Cross-Platform Compatibility**:
  - Ensure smooth operation on Windows, macOS, and Linux.

- **Community Contributions**:
  - Open to pull requests, issues, and ideas for improving the theoretical framework.

---

> 🚧 This is a theoretical prototype intended for educational and research purposes. It aims to explore user-side stream control and ad-skipping concepts — not circumvent platform policies.
