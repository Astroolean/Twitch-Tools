import os
import sys
import subprocess
import threading
import tkinter as tk
from tkinter import messagebox, filedialog
from PIL import Image, ImageTk
import cv2 # Used for image processing (grayscale conversion, absolute difference)
from ffpyplayer.player import MediaPlayer
import time
import queue # Import for thread-safe queue
import numpy as np # Used for image array manipulation

class FreeTwitch(tk.Tk):
    """
    A Tkinter application developed as a *theoretical prototype* to explore the concept of
    running Twitch streams locally via Streamlink and implementing an experimental,
    heuristic-based ad-blocking mechanism. This code represents a brainstorming
    effort and a theoretical framework for how such a system *could* potentially
    bypass ads by detecting them and re-establishing the stream connection.

    The "ad-blocking" functionality within this prototype is purely theoretical
    and illustrative. It demonstrates a concept that would require significant
    further development, advanced machine learning, and adaptation to
    Twitch's evolving ad delivery methods to be truly effective.
    """
    def __init__(self):
        """
        Initializes the FreeTwitch application, setting up the main window,
        global state variables, and checking for Streamlink installation.
        """
        super().__init__()
        self.title("Twitch Stream Recorder & Ad Blocker (Theoretical Prototype)")

        # --- Color Palette ---
        self.colors = {
            "bg_light": "#E0FFFF",          # Light Cyan / very light aqua - Main background
            "bg_medium": "#ADD8E6",         # Light Blue - For label frames etc.
            "fg_dark": "#003366",           # Dark Blue - General foreground text
            "button_bg": "#4682B4",         # Steel Blue - Button normal background
            "button_active_bg": "#87CEEB",  # Sky Blue - Button active background
            "status_bg": "#B0E0E6",         # Powder Blue - Lighter background for status bar
            "status_text_idle": "#003366",  # Dark Blue
            "status_text_success": "#2ECC71",    # Green
            "status_text_error": "#C0392B",      # Red
            "status_text_warning": "#F39C12",    # Orange
            "status_text_info": "#2980B9",       # Light Blue
            "entry_bg": "white",                 # Entry background
            "entry_fg": "#003366",               # Entry foreground
            "label_frame_bg": "#ADD8E6",    # Label frame background
            "slider_trough": "#87CEEB",     # Slider trough color
            "slider_active_bg": "#4682B4",  # Slider active/knob color
            "border_color": "#004080",      # A darker blue for borders
        }

        # --- Stream Quality Options ---
        # "best" will always be used as the quality for recording/playback.
        self.QUALITIES = ["best"] # Simplified as slider is removed for this theoretical prototype

        # --- Global Application State Variables ---
        self.stream_process = None
        self.output_filename = None
        self.stop_recording_flag = False
        self.player_running = False # Indicates if video playback is active (from file)
        self.MAX_FILE_SIZE_MB = 500   # Default max file size
        self.playback_paused = False # State for pause/play functionality for recorded file playback
        self.is_fullscreen = True # Starts in fullscreen mode
        self.ad_detection_active = True # Toggle for theoretical ad detection
        self.consecutive_ad_frames = 0 # Counter for consecutive frames theoretically identified as an ad
        # AD_FRAME_THRESHOLD: This value is a theoretical parameter. In a real scenario, it would need
        # extensive calibration based on observed ad characteristics (e.g., how long an ad screen
        # typically remains static and dark). A higher threshold reduces false positives but might
        # delay ad bypass.
        self.AD_FRAME_THRESHOLD = 100 # How many consecutive frames indicate a theoretical ad (tuned for more robust detection)
        self.current_stream_url = "" # To store the URL for restarting stream
        self.previous_frame = None # Stores the previous frame for theoretical motion detection

        # --- Global Video Playback Variables ---
        self.player = None  # ffpyplayer MediaPlayer object for recorded file playback
        self.video_reader_thread = None # Thread for reading video frames (now uses ffpyplayer exclusively)
        # frame_queue: A thread-safe queue is essential for passing video frames from a background
        # decoding thread to the main Tkinter GUI thread, preventing GUI freezes.
        self.frame_queue = queue.Queue(maxsize=10) # Queue to pass frames from reader thread to display loop
        self.initial_window_geometry = "900x700" # Store the initial windowed geometry

        # --- Tkinter Widget References (will be set in _create_widgets) ---
        self.url_entry = None
        self.status_label = None
        self.video_frame = None
        self.video_label = None
        self.max_size_entry = None
        self.play_pause_button = None # Reference to the Pause/Play button
        self.volume_slider = None # Reference to the volume slider
        self.volume_var = None # Tkinter variable for volume
        self.ad_toggle_button = None # Reference to the ad detection toggle button

        # References for frames that need to be hidden/shown in fullscreen
        self.top_frame_ref = None
        self.status_label_ref = None
        self.btn_frame_ref = None
        self.config_frame_ref = None
        self.main_content_frame = None # Frame for video

        # --- Configuration for Error Handling ---
        # CONSECUTIVE_ERROR_THRESHOLD: This determines how many consecutive frame read errors
        # (e.g., due to stream buffering, network issues, or a sudden stream end)
        # will trigger a "reconnect" attempt. This is a pragmatic approach to handling
        # stream interruptions beyond just ad detection.
        self.CONSECUTIVE_ERROR_THRESHOLD = 100 # How many consecutive read errors before stopping playback

        # Set window to be borderless from the start for a more immersive playback experience.
        self.overrideredirect(True) 
        
        # Configure root window background for aesthetic consistency.
        self.config(bg=self.colors["bg_light"])

        # Bind Escape key to exit fullscreen, providing an intuitive user control.
        self.bind("<Escape>", self.toggle_fullscreen)
        
        # Handle graceful shutdown on window close, ensuring processes are terminated.
        self.protocol("WM_DELETE_WINDOW", self.on_closing)

        # Check for Streamlink Installation before creating widgets. Streamlink is the backbone
        # of this theoretical prototype, responsible for fetching the stream data.
        if not self._check_streamlink_installed():
            self.destroy()
        else:
            self._create_widgets()
            # Set the window to fullscreen initially after widgets are created for immediate immersion.
            screen_width = self.winfo_screenwidth()
            screen_height = self.winfo_screenheight()
            self.geometry(f"{screen_width}x{screen_height}+0+0")
            
            # Ensure the main_content_frame expands correctly in initial fullscreen mode.
            self.main_content_frame.grid(row=4, column=0, columnspan=1, sticky="nsew", padx=0, pady=0)
            self.grid_rowconfigure(4, weight=1)
            self.grid_columnconfigure(0, weight=1) # Video column takes all width

    @staticmethod
    def _get_channel_name(url):
        """Extracts the channel name from a Twitch URL. This is used for naming the recorded file."""
        if "twitch.tv/" in url:
            return url.rstrip("/").split("/")[-1]
        return "" # Return empty if not a valid Twitch URL format

    def _check_streamlink_installed(self):
        """
        Checks if Streamlink is installed and available in the system's PATH.
        This is a prerequisite for the theoretical prototype to function.
        """
        try:
            subprocess.run(["streamlink", "--version"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        except FileNotFoundError:
            messagebox.showerror("Error", "Streamlink is not installed.\nPlease install it using:\npip install streamlink")
            return False
        except Exception as e:
            messagebox.showerror("Error", f"An unexpected error occurred while checking Streamlink: {e}")
            return False

    def _monitor_file_size(self, filepath):
        """
        Monitors the size of the theoretically recorded file. This ensures that
        local storage is not overused during continuous recording sessions.
        """
        while not self.stop_recording_flag:
            if os.path.exists(filepath):
                try:
                    size_mb = os.path.getsize(filepath) / (1024 * 1024)
                    if size_mb > self.MAX_FILE_SIZE_MB:
                        self.stop_recording()
                        self.update_status(f"Recording stopped: Exceeded {self.MAX_FILE_SIZE_MB}MB limit.", self.colors["status_text_warning"])
                        break
                except OSError as e:
                    self.update_status(f"Error checking file size: {e}", self.colors["status_text_error"])
            time.sleep(5) # Check every 5 seconds

    def _record_stream(self, channel_url, quality):
        """
        Initiates the stream recording process using Streamlink.
        This represents the core mechanism for bringing the Twitch stream
        data onto the local machine for processing. It always uses "best" quality
        to ensure maximum data capture for theoretical ad analysis.
        """
        self.stop_recording_flag = False
        self.current_stream_url = channel_url # Store URL for potential re-connection during theoretical ad bypass
        channel_name = self._get_channel_name(channel_url)
        self.output_filename = f"{channel_name}_stream.ts"

        if not channel_url:
            self.update_status("Please enter a Twitch channel URL.", self.colors["status_text_error"])
            return

        if not channel_url.startswith("https://www.twitch.tv/"):
            self.update_status("Invalid Twitch URL format. Please use 'https://www.twitch.tv/channel_name'.", self.colors["status_text_error"])
            return

        # Attempt to remove old file if it exists to ensure a clean slate for new recordings.
        if os.path.exists(self.output_filename):
            try:
                os.remove(self.output_filename)
            except OSError as e:
                self.update_status(f"Warning: Could not delete old file '{self.output_filename}': {e}", self.colors["status_text_warning"])

        try:
            # Command to use Streamlink to output the stream to a local .ts file.
            # This is the "local processing" part of the theory.
            command = ["streamlink", channel_url, "best", "-o", self.output_filename]
            
            self.update_status(f"Recording '{channel_name}' at best quality to {self.output_filename}...", self.colors["status_text_info"])

            # subprocess.Popen is used to run Streamlink as a separate process in the background.
            # stdout=subprocess.DEVNULL and stderr=subprocess.PIPE ensure Streamlink's output
            # doesn't clutter the console, but errors can still be captured if needed.
            self.stream_process = subprocess.Popen(
                command, 
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE 
            )
            
            # Start monitoring file size in a separate thread to manage storage.
            threading.Thread(target=self._monitor_file_size, args=(self.output_filename,), daemon=True).start()
            
        except Exception as e:
            self.update_status(f"An error occurred during recording: {e}", self.colors["status_text_error"])
        finally:
            pass 

    def start_recording(self):
        """Starts the theoretical stream recording process in a new thread."""
        if self.stream_process and self.stream_process.poll() is None:
            messagebox.showinfo("Info", "A recording is already in progress.")
            return
        
        channel_url = self.url_entry.get().strip()
        # Quality is now hardcoded to "best" for consistency in this theoretical model.
        threading.Thread(target=self._record_stream, args=(channel_url, "best"), daemon=True).start()

    def stop_recording(self):
        """
        Stops the currently active recording process and deletes the recorded file.
        This is a critical step in the theoretical ad bypass: once an ad is "detected,"
        the current segment (potentially containing the ad) is discarded.
        """
        self.stop_recording_flag = True
        if self.stream_process and self.stream_process.poll() is None: 
            try:
                # Terminate the Streamlink process gracefully first.
                self.stream_process.terminate()
                self.stream_process.wait(timeout=5)
                # If it doesn't terminate, kill it forcefully.
                if self.stream_process.poll() is None: 
                    self.stream_process.kill()
                self.update_status("Recording stopped.", self.colors["status_text_success"])
            except Exception as e:
                self.update_status(f"Error stopping recording: {e}", self.colors["status_text_error"])
            finally:
                self.stream_process = None 
        else:
            self.update_status("No active recording to stop.", self.colors["status_text_warning"])
        
        # Stop video playback immediately when recording stops.
        self.stop_video_playback()

        # Delete the recorded file: This is key for the theoretical ad-blocking.
        # By deleting the file, we ensure the ad segment is not retained, and
        # the next playback attempt will start from a fresh, newly recorded segment.
        if self.output_filename and os.path.exists(self.output_filename):
            try:
                os.remove(self.output_filename)
            except OSError:
                # File might still be in use by other processes or already gone if
                # called rapidly. Suppress error for smooth theoretical restart.
                pass


    def update_status(self, msg, color):
        """Updates the status label in the GUI in a thread-safe manner."""
        # Use after() to ensure thread-safe update to Tkinter GUI elements.
        self.after(0, lambda: self.status_label.config(text=msg, fg=color))
        self.after(0, self.update_idletasks)

    def _check_for_ad_screen(self, current_pil_image):
        """
        Heuristic-based *theoretical* ad screen detection. This function implements
        a simplified model of how an ad screen *could* be identified.

        The theory: Twitch ads often involve:
        1.  Dark screens: Ads might start with a black screen or a very dark background.
        2.  Low motion: Static images, logos, or slow animations are common in ad breaks,
            especially compared to typical live gameplay or commentary.

        This approach is a basic heuristic. In a robust theoretical ad blocker,
        more sophisticated methods would be needed, such as:
        -   **Machine Learning:** Training a model on thousands of ad vs. non-ad frames.
        -   **OCR (Optical Character Recognition):** Detecting text patterns common in ads (e.g., "Advertisement", "Ad will end in X seconds").
        -   **Audio Analysis:** Identifying specific ad jingles or sudden changes in audio characteristics.
        -   **Metadata Analysis:** If stream metadata was accessible, it might explicitly indicate ad breaks.
        -   **Fingerprinting:** Identifying known ad frames or patterns.

        Limitations of this prototype's theoretical ad detection:
        -   False positives: A legitimate dark game screen or a static menu might be mistaken for an ad.
        -   False negatives: Ads that are bright, contain high motion, or blend seamlessly might be missed.
        -   Twitch's countermeasures: Twitch could easily change ad characteristics to defeat simple heuristics.
        """
        if current_pil_image is None:
            return False

        # Convert PIL Image to grayscale NumPy array for easier processing.
        current_frame_np = np.array(current_pil_image.convert('L')) # 'L' for grayscale

        # --- Theoretical Brightness Check ---
        # Calculate the average brightness of the entire frame.
        average_brightness = np.mean(current_frame_np)
        BRIGHTNESS_THRESHOLD = 30 # Tune this: Lower values mean darker. 0-255 scale.
        is_dark = average_brightness < BRIGHTNESS_THRESHOLD

        # --- Theoretical Motion Detection Check ---
        is_static = False
        # Only perform motion detection if a previous frame exists and has the same dimensions.
        if self.previous_frame is not None and self.previous_frame.shape == current_frame_np.shape:
            # Calculate absolute difference between current and previous frame.
            frame_diff = cv2.absdiff(current_frame_np, self.previous_frame)
            
            # Sum of absolute differences (SAD) to quantify theoretical motion.
            # A low total difference indicates low motion (static scene).
            MOTION_THRESHOLD_PER_PIXEL_AVG = 5 # Average pixel change threshold
            MOTION_THRESHOLD = MOTION_THRESHOLD_PER_PIXEL_AVG * (current_frame_np.shape[0] * current_frame_np.shape[1])
            total_diff = np.sum(frame_diff)
            is_static = total_diff < MOTION_THRESHOLD
        
        # Update previous frame for next iteration of motion detection.
        self.previous_frame = current_frame_np.copy()

        # A theoretical ad screen is detected if it's dark AND static.
        detected = is_dark and is_static
        return detected

    def _video_reader_thread(self, filepath):
        """
        Reads video frames and audio from the local file and puts them into a queue.
        This thread is responsible for the actual playback of the recorded stream.
        It also incorporates the theoretical ad detection and stream interruption handling.
        """
        # Ensure any previous player instance is stopped and cleaned up before starting a new one.
        if self.player:
            self.player = None # Allow previous player to be garbage collected

        # Reset previous frame for new playback session to ensure motion detection works correctly.
        self.previous_frame = None 

        try:
            # Initialize MediaPlayer to play the local .ts file.
            # ff_opts={'sync': 'audio'} helps synchronize video to audio.
            self.player = MediaPlayer(filepath, ff_opts={'sync': 'audio'})
        except Exception as e:
            self.update_status(f"Error initializing MediaPlayer: {e}", self.colors["status_text_error"])
            self.player_running = False
            return

        time.sleep(0.5) # Give ffpyplayer a moment to initialize and load metadata.

        # Check if the player successfully opened the file.
        if not self.player or not self.player.get_metadata():
            self.update_status("Could not open video file for playback (ffpyplayer).", self.colors["status_text_error"])
            self.player_running = False
            return
        
        # Set the initial volume based on the slider value.
        if self.player and self.volume_var:
            self.player.set_volume(self.volume_var.get() / 100.0)

        consecutive_read_errors = 0 
        self.consecutive_ad_frames = 0 # Reset ad frame counter for new playback session

        while self.player_running:
            # If playback is paused, simply wait and continue the loop.
            if self.playback_paused:
                time.sleep(0.1) 
                continue 

            try:
                ffp_frame, val = self.player.get_frame() 

                # --- Theoretical Stream Interruption/Ad Detection ---
                # This block handles various scenarios that would trigger a theoretical reconnection:
                # 1. 'eof': End of file reached (normal stream end or quick ad segment).
                # 2. Consecutive frame errors: Indicates persistent issues reading frames,
                #    which could be due to stream corruption, network drops, or the end of a segment.
                # If any of these conditions are met, and it's not an intentional stop,
                # trigger the reconnection logic.
                if (val == 'eof' or (ffp_frame is None and consecutive_read_errors >= self.CONSECUTIVE_ERROR_THRESHOLD)):
                    self.player_running = False # Signal to stop current playback loop
                    # Only attempt a reconnect if a stream URL is set and recording wasn't intentionally stopped.
                    if not self.stop_recording_flag and self.current_stream_url:
                        self.update_status("Stream interrupted. Attempting reconnect...", self.colors["status_text_warning"])
                        self.after(500, self._reconnect_stream_after_ad) # Call reconnect on main thread after a short delay
                    else:
                        self.update_status("Playback finished.", self.colors["status_text_success"])
                    break # Exit this video reading loop immediately
                
                # If ffp_frame is None but error threshold not yet met, increment and continue.
                # This allows for transient frame drops without immediately re-connecting.
                if ffp_frame is None: 
                    consecutive_read_errors += 1
                    time.sleep(0.01) # Small delay to prevent busy-waiting
                    # If it's a live stream (process still active) and the output file exists,
                    # keep trying to read, as new data might be written.
                    if (self.stream_process and self.stream_process.poll() is None) and \
                       (filepath == self.output_filename) and os.path.exists(filepath):
                        pass 
                    continue 
                else:
                    consecutive_read_errors = 0 # Reset error counter if a frame is successfully read.

                # Extract image data from ffpyplayer frame.
                img_data, t = ffp_frame 
                w, h = img_data.get_size()
                raw_bytes = bytes(img_data.to_bytearray()[0]) 
                # Convert raw bytes to PIL Image for processing and display.
                pil_img = Image.frombytes('RGB', (w, h), raw_bytes)
                
                # --- Theoretical Ad Detection Logic within the Playback Loop ---
                if self.ad_detection_active:
                    if self._check_for_ad_screen(pil_img):
                        self.consecutive_ad_frames += 1
                        # If enough consecutive "ad-like" frames are detected, trigger a reconnection.
                        if self.consecutive_ad_frames >= self.AD_FRAME_THRESHOLD:
                            self.update_status("Ad detected! Attempting to reconnect stream...", self.colors["status_text_warning"])
                            self.player_running = False # Signal to stop current playback loop
                            # Trigger a restart of the stream on the main Tkinter thread.
                            # This is the core "bypass" mechanism: stop, delete ad segment, restart.
                            if not self.stop_recording_flag and self.current_stream_url:
                                self.after(500, self._reconnect_stream_after_ad) 
                            break # Exit this video reading loop immediately
                    else:
                        self.consecutive_ad_frames = 0 # Reset counter if a non-ad frame is detected.

                # Ensure main window and its children have processed layout updates for accurate dimensions.
                self.update_idletasks() 
                
                # Get current size of the video_label to dynamically resize the video frame.
                label_width = self.video_label.winfo_width()
                label_height = self.video_label.winfo_height()
                
                # Provide sensible default sizes if widget not yet fully rendered (0 or small dimensions).
                # This ensures the video always attempts to fit the available space.
                if label_width < 100 or label_height < 100:
                    current_window_width = self.winfo_width()
                    current_window_height = self.winfo_height()

                    total_control_height = 0
                    if not self.is_fullscreen:
                        # Calculate the space taken by control elements when not in fullscreen.
                        if self.top_frame_ref and self.status_label_ref and self.btn_frame_ref and self.config_frame_ref:
                            self.top_frame_ref.update_idletasks()
                            self.status_label_ref.update_idletasks()
                            self.btn_frame_ref.update_idletasks()
                            self.config_frame_ref.update_idletasks()
                            total_control_height = self.top_frame_ref.winfo_height() + \
                                                   self.status_label_ref.winfo_height() + \
                                                   self.btn_frame_ref.winfo_height() + \
                                                   self.config_frame_ref.winfo_height() + 80 
                        
                    available_height = max(10, current_window_height - total_control_height)
                    label_width = current_window_width 
                    label_height = int(available_height)

                    # Maintain aspect ratio when resizing the image.
                    if pil_img.width > 0 and pil_img.height > 0:
                        img_aspect = pil_img.width / pil_img.height
                        frame_aspect = label_width / label_height

                        if img_aspect > frame_aspect: 
                            label_height = int(label_width / img_aspect)
                        else: 
                            label_width = int(label_height * img_aspect)

                # Resize the image using LANCZOS filter for high quality.
                resized_img = pil_img.resize((label_width, label_height), Image.LANCZOS)
                imgtk = ImageTk.PhotoImage(image=resized_img)
                
                # Put the processed frame into the queue for the display loop.
                try:
                    while not self.frame_queue.empty():
                        self.frame_queue.get_nowait() # Clear old frames to prevent lag
                    self.frame_queue.put(imgtk, block=False)
                except queue.Full:
                    pass # If queue is full, drop the frame; better to drop than lag.
                
                time.sleep(0.001) # Small delay to yield control and prevent busy-waiting.

            except Exception as e:
                self.update_status(f"Error in video reader thread: {e}", self.colors["status_text_error"])
                self.player_running = False 
                # If an error occurs, and it's a live stream not intentionally stopped, attempt reconnect.
                if not self.stop_recording_flag and self.current_stream_url:
                    self.after(500, self._reconnect_stream_after_ad)
                break 

        # Final cleanup after loop exits.
        self.player = None 
        # Update status if playback finished naturally, not due to a reconnect attempt.
        if not self.stop_recording_flag and not self.current_stream_url:
            self.update_status("Playback finished.", self.colors["status_text_success"])
        
        if self.play_pause_button:
            self.play_pause_button.config(text="Play") 
        
        self.after(10, lambda: self.video_label.config(image='')) # Clear the video display

    def _stream_display_loop(self):
        """
        Main loop for video display, updates the video_label (runs on main Tkinter thread).
        This loop continuously pulls frames from the queue and updates the GUI.
        """
        if not self.player_running and self.frame_queue.empty():
            if self.video_label: 
                self.video_label.config(image='') # Clear display if no longer playing
            return

        try:
            imgtk = self.frame_queue.get(block=False) # Get frame without blocking
            self.video_label.imgtk = imgtk # Keep a reference to prevent garbage collection
            self.video_label.configure(image=imgtk) # Update the label with the new frame
        except queue.Empty:
            pass # No new frame available, just wait for the next cycle
        except Exception as e:
            self.update_status(f"Error displaying frame: {e}", self.colors["status_text_error"])
            self.stop_video_playback() # Stop playback on display error
            return
        
        self.after(10, self._stream_display_loop) # Schedule next update after 10ms


    def set_volume_level(self, val):
        """Sets the volume of the MediaPlayer based on the slider value."""
        if self.player:
            try:
                self.player.set_volume(float(val) / 100.0) # Volume is 0.0 to 1.0
            except Exception:
                pass # Suppress errors if player is not ready or volume cannot be set


    def play_pause_toggle(self, filepath):
        """
        Starts or toggles pause/play for the theoretically recorded stream file.
        """
        if not self.player_running:
            if not filepath or not os.path.exists(filepath):
                self.update_status("Error: Recorded file not found for playback.", self.colors["status_text_error"])
                messagebox.showerror("Error", "Recorded file not found. Please record a stream first or select a file.")
                return

            # If a previous playback thread is still alive, stop it cleanly.
            if self.video_reader_thread and self.video_reader_thread.is_alive():
                self.stop_video_playback() 
                time.sleep(0.1) 

            self.player_running = True
            self.playback_paused = False
            self.update_status(f"Playing: {os.path.basename(filepath)}", self.colors["status_text_info"])

            # Start the video reader thread to begin decoding and queueing frames.
            self.video_reader_thread = threading.Thread(target=self._video_reader_thread, args=(filepath,), daemon=True)
            self.video_reader_thread.start()
            
            # Start the display loop on the main Tkinter thread.
            self.after(10, self._stream_display_loop) 
            self.play_pause_button.config(text="Pause") # Update button text
        else:
            # Toggle pause/play state.
            if self.playback_paused:
                self.playback_paused = False
                if self.player: 
                    self.player.set_pause(False) # Resume playback
                self.update_status("Playback resumed.", self.colors["status_text_info"])
                self.play_pause_button.config(text="Pause")
            else:
                self.playback_paused = True
                if self.player: 
                    self.player.set_pause(True) # Pause playback
                self.update_status("Playback paused.", self.colors["status_text_warning"])
                self.play_pause_button.config(text="Play")

    def stop_video_playback(self):
        """
        Stops the active video playback and cleans up resources.
        Ensures a clean shutdown of the playback thread and clears the display.
        """
        if self.player_running:
            self.player_running = False 
            self.playback_paused = False 
            
            # Attempt to join the video reader thread to ensure it finishes.
            if self.video_reader_thread and self.video_reader_thread.is_alive():
                self.video_reader_thread.join(timeout=2) 
                if self.video_reader_thread.is_alive():
                    self.update_status("Warning: Playback thread did not terminate gracefully.", self.colors["status_text_warning"])

            # Clear any remaining frames in the queue.
            while not self.frame_queue.empty():
                try:
                    self.frame_queue.get_nowait()
                except queue.Empty:
                    break
            
            self.player = None # Release the MediaPlayer object
            if self.video_label: 
                self.video_label.config(image='') # Clear video display
            self.update_status("Playback stopped.", self.colors["status_text_success"])
            if self.play_pause_button:
                self.play_pause_button.config(text="Play") # Reset button text

    def set_max_file_size(self):
        """Sets the maximum file size for recording based on user input."""
        try:
            new_size = int(self.max_size_entry.get())
            if new_size <= 0:
                messagebox.showerror("Invalid Input", "Max size must be a positive number.")
                return
            self.MAX_FILE_SIZE_MB = new_size
            self.update_status(f"Max file size set to {self.MAX_FILE_SIZE_MB}MB.", self.colors["status_text_info"])
        except ValueError:
            messagebox.showerror("Invalid Input", "Please enter a valid number for max size.")

    def toggle_fullscreen(self, event=None):
        """Toggles fullscreen mode for the application."""
        self.is_fullscreen = not self.is_fullscreen
        
        if self.is_fullscreen:
            # Save current geometry and go fullscreen.
            self.initial_window_geometry = self.geometry()
            screen_width = self.winfo_screenwidth()
            screen_height = self.winfo_screenheight()
            self.geometry(f"{screen_width}x{screen_height}+0+0")
            
            # Hide control frames in fullscreen mode for an unobstructed view.
            self.top_frame_ref.grid_forget()
            self.status_label_ref.grid_forget()
            self.btn_frame_ref.grid_forget()
            self.config_frame_ref.grid_forget()

            # Make the main content frame (video) expand to fill the entire window.
            self.main_content_frame.grid(row=0, column=0, columnspan=1, rowspan=1, sticky="nsew")
            self.grid_rowconfigure(0, weight=1)
            self.grid_columnconfigure(0, weight=1)

            self.main_content_frame.grid_columnconfigure(0, weight=1)
            self.main_content_frame.grid_rowconfigure(0, weight=1)

            self.video_frame.grid(row=0, column=0, sticky="nsew") 
            
        else:
            # Restore original geometry and show control frames.
            self.geometry(self.initial_window_geometry)

            # Re-grid control frames.
            self.top_frame_ref.grid(row=0, column=0, columnspan=1, pady=10)
            self.status_label_ref.grid(row=1, column=0, columnspan=1, sticky="ew", padx=15, pady=5)
            self.btn_frame_ref.grid(row=2, column=0, columnspan=1, pady=15)
            self.config_frame_ref.grid(row=3, column=0, columnspan=1, sticky="ew", pady=10, padx=15)

            # Re-grid main content frame with its original row and weight.
            self.main_content_frame.grid(row=4, column=0, columnspan=1, sticky="nsew", padx=0, pady=0)
            self.grid_rowconfigure(4, weight=1) 
            self.grid_columnconfigure(0, weight=1) 

            self.main_content_frame.grid_columnconfigure(0, weight=1) 
            self.main_content_frame.grid_rowconfigure(0, weight=1)

            self.video_frame.grid(row=0, column=0, sticky="nsew", padx=0, pady=0)

        # Re-trigger the display loop to adjust to new window dimensions.
        self.after(10, self._stream_display_loop)

    def _reconnect_stream_after_ad(self):
        """
        This method outlines the *theoretical* stream reconnection strategy
        after an ad is detected or the stream is otherwise interrupted.

        The theory: By stopping the current recording/playback, deleting the
        current (potentially ad-containing) segment, and then restarting
        the entire Streamlink process, we aim to obtain a fresh connection
        to the Twitch stream. The 5-second delay is a theoretical waiting
        period, assuming that a brief interruption might allow the ad to
        finish or for Twitch's ad injection to reset, allowing the main
        content to resume upon reconnection.

        This approach bypasses traditional ad blockers by not trying to
        filter content, but rather by interrupting and re-fetching the
        stream from its source, simulating a "new viewer" entering the stream.
        This is a common strategy in certain ad-bypass techniques that rely
        on connection resets.
        """
        if self.current_stream_url:
            self.update_status("Stream interrupted. Reconnecting stream to bypass ad/issue...", self.colors["status_text_info"])
            
            # Ensure any previous recording/playback is fully stopped before restarting.
            # This is crucial for releasing file handles and subprocesses.
            self.stop_recording() 
            self.stop_video_playback() 
            
            # Critical delay to allow file handles and processes to release,
            # and for Streamlink to potentially re-negotiate with Twitch.
            # This 5-second wait is part of the theoretical ad bypass strategy.
            time.sleep(5) 

            # Restart the stream recording automatically. This will create a new .ts file.
            self.start_recording() 

            # Only attempt to play if the Streamlink process seems active and the new file exists.
            # There might be a slight delay before Streamlink starts writing data to the file,
            # so waiting for a moment might be necessary in a real scenario.
            if self.stream_process and self.stream_process.poll() is None and os.path.exists(self.output_filename):
                self.play_pause_button.config(text="Pause") # Visually indicate playback will resume
                self.play_pause_toggle(self.output_filename) # Trigger playback of the new stream
            else:
                self.update_status("Reconnection failed: Streamlink not active or file not ready.", self.colors["status_text_error"])
        else:
            self.update_status("Cannot reconnect: No stream URL set.", self.colors["status_text_error"])

    def toggle_ad_detection(self):
        """
        Toggles the theoretical ad detection on/off.
        This allows the user to enable/disable the experimental ad-blocking feature.
        """
        self.ad_detection_active = not self.ad_detection_active
        if self.ad_detection_active:
            self.ad_toggle_button.config(text="Ad Blocker: ON", bg=self.colors["status_text_success"])
            self.update_status("Ad detection active.", self.colors["status_text_info"])
        else:
            self.ad_toggle_button.config(text="Ad Blocker: OFF", bg=self.colors["status_text_error"])
            self.update_status("Ad detection inactive.", self.colors["status_text_warning"])


    def on_closing(self):
        """Handles graceful shutdown when the window is closed."""
        if messagebox.askokcancel("Quit", "Do you want to quit? Any active recording or playback will stop."):
            self.stop_recording()
            self.stop_video_playback()
            
            # Delete the recorded file on exit only if it still exists.
            # This ensures cleanup of temporary stream files.
            if self.output_filename and os.path.exists(self.output_filename):
                try:
                    os.remove(self.output_filename)
                except OSError:
                    pass # Ignore if file cannot be deleted (e.g., already deleted or in use)

            self.destroy() # Destroy the Tkinter window and exit the application.

    def _create_widgets(self):
        """
        Creates all the GUI elements.
        Uses grid layout for overall structure to manage visibility and resizing.
        """
        # Configure root grid for responsiveness: Row 4 for main content (video) takes extra space.
        self.grid_rowconfigure(4, weight=1) 
        self.grid_columnconfigure(0, weight=1) # Video column takes all width

        # --- Top Frame: URL Entry ---
        self.top_frame_ref = tk.Frame(self, bg=self.colors["bg_light"])
        self.top_frame_ref.grid(row=0, column=0, columnspan=1, pady=10)

        tk.Label(self.top_frame_ref, text="Twitch Channel URL:", bg=self.colors["bg_light"], fg=self.colors["fg_dark"], font=("Helvetica", 10, "bold")).pack(side=tk.LEFT, padx=5)
        self.url_entry = tk.Entry(self.top_frame_ref, width=50, bg=self.colors["entry_bg"], fg=self.colors["entry_fg"],
                                  insertbackground=self.colors["fg_dark"], bd=2, relief=tk.FLAT, font=("Helvetica", 10))
        self.url_entry.insert(0, "https://www.twitch.tv/lacy") # Example URL for quick testing
        self.url_entry.pack(side=tk.LEFT, padx=10, ipady=2) 


        # --- Status Label ---
        self.status_label_ref = tk.Label(self, text="Idle", fg=self.colors["status_text_idle"], bg=self.colors["status_bg"],
                                         relief=tk.FLAT, bd=0, anchor=tk.W, font=("Helvetica", 10, "bold"), padx=10, pady=5)
        self.status_label_ref.grid(row=1, column=0, columnspan=1, sticky="ew", padx=15, pady=5)
        self.status_label = self.status_label_ref 

        # --- Buttons Frame ---
        self.btn_frame_ref = tk.Frame(self, bg=self.colors["bg_light"])
        self.btn_frame_ref.grid(row=2, column=0, columnspan=1, pady=15)

        # Define a consistent style for buttons.
        button_style = {
            "bg": self.colors["button_bg"],
            "fg": "white",
            "width": 18, 
            "height": 2,
            "font": ("Helvetica", 10, "bold"),
            "relief": tk.RAISED,
            "bd": 3,
            "activebackground": self.colors["button_active_bg"],
            "activeforeground": self.colors["fg_dark"] 
        }

        tk.Button(self.btn_frame_ref, text="Start Recording", command=self.start_recording, **button_style).grid(row=0, column=0, padx=10, pady=5)
        tk.Button(self.btn_frame_ref, text="Stop Recording", command=self.stop_recording, **button_style).grid(row=0, column=1, padx=10, pady=5)
        
        self.play_pause_button = tk.Button(self.btn_frame_ref, text="Play", command=lambda: self.play_pause_toggle(self.output_filename), **button_style)
        self.play_pause_button.grid(row=0, column=2, padx=10, pady=5)

        tk.Button(self.btn_frame_ref, text="Exit Program", command=self.on_closing, **button_style).grid(row=0, column=3, padx=10, pady=5)
        
        # --- Max File Size Configuration & Volume ---
        self.config_frame_ref = tk.LabelFrame(self, text="Settings", padx=15, pady=15,
                                               bg=self.colors["label_frame_bg"], fg=self.colors["fg_dark"],
                                               font=("Helvetica", 10, "bold"), relief=tk.GROOVE, bd=2)
        self.config_frame_ref.grid(row=3, column=0, columnspan=1, sticky="ew", pady=10, padx=15)

        tk.Label(self.config_frame_ref, text="Max Recording Size (MB):", bg=self.colors["label_frame_bg"], fg=self.colors["fg_dark"], font=("Helvetica", 9)).grid(row=0, column=0, sticky=tk.W, padx=5, pady=5)
        self.max_size_entry = tk.Entry(self.config_frame_ref, width=10, bg=self.colors["entry_bg"], fg=self.colors["entry_fg"],
                                       insertbackground=self.colors["fg_dark"], bd=1, relief=tk.SOLID)
        self.max_size_entry.insert(0, str(self.MAX_FILE_SIZE_MB))
        self.max_size_entry.grid(row=0, column=1, padx=5, sticky=tk.W, pady=5)
        tk.Button(self.config_frame_ref, text="Set Size", command=self.set_max_file_size, bg=self.colors["button_bg"], fg="white",
                  relief=tk.RAISED, bd=2, activebackground=self.colors["button_active_bg"], activeforeground=self.colors["fg_dark"]).grid(row=0, column=2, padx=5, pady=5)

        tk.Label(self.config_frame_ref, text="Volume:", bg=self.colors["label_frame_bg"], fg=self.colors["fg_dark"], font=("Helvetica", 9)).grid(row=0, column=3, sticky=tk.W, padx=(20, 5), pady=5) 
        self.volume_var = tk.DoubleVar(value=50) 
        self.volume_slider = tk.Scale(self.config_frame_ref, from_=0, to=100, orient=tk.HORIZONTAL,
                                      command=self.set_volume_level, variable=self.volume_var, length=150, 
                                      bg=self.colors["label_frame_bg"], fg=self.colors["fg_dark"],
                                      troughcolor=self.colors["slider_trough"], relief=tk.FLAT, bd=0,
                                      activebackground=self.colors["slider_active_bg"], highlightbackground=self.colors["slider_active_bg"]) 
        self.volume_slider.grid(row=0, column=4, padx=5, sticky=tk.W, pady=5)

        # Ad Blocker Toggle Button: Controls the theoretical ad detection.
        self.ad_toggle_button = tk.Button(self.config_frame_ref, text="Ad Blocker: ON", command=self.toggle_ad_detection,
                                         bg=self.colors["status_text_success"], fg="white",
                                         relief=tk.RAISED, bd=2, activebackground=self.colors["button_active_bg"],
                                         activeforeground=self.colors["fg_dark"], font=("Helvetica", 9, "bold"))
        self.ad_toggle_button.grid(row=1, column=0, columnspan=2, padx=5, pady=5, sticky="ew") # Placed in settings frame


        # --- Main Content Frame: Video Display Area ---
        self.main_content_frame = tk.Frame(self, bg="black")
        self.main_content_frame.grid(row=4, column=0, columnspan=1, sticky="nsew", padx=0, pady=0)
        self.grid_rowconfigure(4, weight=1) 
        self.main_content_frame.grid_columnconfigure(0, weight=1) 
        self.main_content_frame.grid_rowconfigure(0, weight=1)

        # --- Video Frame (inside main content frame) ---
        self.video_frame = tk.Frame(self.main_content_frame, bg="black", relief=tk.SUNKEN, bd=3, highlightbackground=self.colors["border_color"], highlightthickness=2)
        self.video_frame.grid(row=0, column=0, sticky="nsew", padx=0, pady=0)
        
        # Video label where frames will be displayed.
        self.video_label = tk.Label(self.video_frame, bg="black")
        self.video_label.pack(expand=True, fill="both")


if __name__ == "__main__":
    app = FreeTwitch()
    app.mainloop()
