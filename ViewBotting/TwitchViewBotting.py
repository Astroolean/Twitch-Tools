import sys
import requests
import warnings
import time
import os
import random
from PyQt6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout,
                             QHBoxLayout, QLabel, QLineEdit, QSpinBox, QComboBox,
                             QPushButton, QProgressBar, QTextEdit, QCheckBox, QMessageBox, QFrame)
from PyQt6.QtCore import Qt, QThread, pyqtSignal
from PyQt6.QtGui import QFont, QPalette, QColor

# Selenium imports
from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.firefox import GeckoDriverManager
from selenium.webdriver.firefox.service import Service
from selenium.common.exceptions import WebDriverException

warnings.filterwarnings("ignore", category=DeprecationWarning)

class TwitchViewBotting(QMainWindow):
    """
    The main GUI window for the Twitch Viewer Bot application with a premium, modern design.
    This class encapsulates all GUI elements and manages the ViewerWorker thread
    as a nested class to keep the GUI responsive.
    """

    # ViewerWorker remains a QThread subclass, now nested within TwitchViewBotting
    class ViewerWorker(QThread):
        """
        Worker thread to handle Selenium browser automation in the background.
        This prevents the main GUI from freezing during browser operations.
        """
        progress = pyqtSignal(str)
        viewer_started = pyqtSignal(int)
        finished = pyqtSignal()
        error_occurred = pyqtSignal(str)

        def __init__(self, proxy_url, channel, viewer_count, headless, rapid_mode):
            super().__init__()
            self.proxy_url = proxy_url
            self.channel = channel
            self.viewer_count = viewer_count
            self.headless = headless
            self.rapid_mode = rapid_mode
            self.drivers = []
            self.running = True
            self.user_agents = [
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:91.0) Gecko/20100101 Firefox/91.0",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:91.0) Gecko/20100101 Firefox/91.0",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/92.0", # Hybrid for variety
                "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/99.0" # Mobile user agent
            ]
            self.gecko_driver_path = None # To store the path after installation

        def simulate_viewer_activity(self, driver, viewer_index):
            """
            Simulates human-like activity within the browser to make the viewer appear more legitimate.
            Actions include scrolling, mouse movements, and occasional video quality changes/interactions.
            """
            try:
                # Simulate scrolling
                scroll_amount = random.randint(100, 500)
                driver.execute_script(f"window.scrollTo(0, {scroll_amount});")
                time.sleep(random.uniform(2, 4))

                # Simulate mouse movement by dispatching a mousemove event
                driver.execute_script("""
                    var event = new MouseEvent('mousemove', {
                        'view': window,
                        'bubbles': true,
                        'cancelable': true,
                        'clientX': arguments[0],
                        'clientY': arguments[1]
                    });
                    document.dispatchEvent(event);
                """, random.randint(100, 800), random.randint(100, 600))

                # Occasionally attempt to change video quality
                if random.random() < 0.3:
                    try:
                        # Find the settings button for the video player
                        quality_button = driver.find_element(By.CSS_SELECTOR, '[data-a-target="player-settings-button"]')
                        quality_button.click()
                        time.sleep(1)
                        # Attempt to click a generic quality option. This selector might need refinement
                        # based on Twitch's current UI, as it can change.
                        # A more robust approach might involve finding all quality options and picking one.
                        quality_menu_option = driver.find_element(By.XPATH, "//div[contains(@class, 'quality-option')]")
                        quality_menu_option.click()
                    except Exception as e:
                        # Fail silently if quality interaction fails, as it's an optional activity
                        pass

                # Simulate video interaction (play/seek)
                if random.random() < 0.2:
                    driver.execute_script("""
                        var video = document.querySelector('video');
                        if(video) {
                            if(video.paused) {
                                video.play(); // Play if paused
                            } else {
                                video.currentTime += Math.random() * 10; // Seek forward randomly
                            }
                        }
                    }
                """)

                # Longer pause between activity bursts
                time.sleep(random.uniform(8, 20))
            except Exception as e:
                self.progress.emit(f"Activity simulation error for viewer {viewer_index}: {str(e)}")

        def setup_firefox_options(self):
            """
            Configures Firefox options for each browser instance, including anti-detection measures,
            performance optimizations, random window sizes, and user agents.
            """
            firefox_options = webdriver.FirefoxOptions()

            firefox_options.add_argument('--disable-gpu')
            firefox_options.add_argument('--disable-infobars')
            firefox_options.add_argument('--disable-notifications')
            firefox_options.add_argument('--ignore-certificate-errors')
            firefox_options.add_argument('--mute-audio')
            firefox_options.add_argument('--allow-running-insecure-content')

            # Set Firefox preferences for certain behaviors
            firefox_options.set_preference("media.volume_scale", "0.0") # Mute audio
            firefox_options.set_preference("dom.webdriver.enabled", False) # Attempt to hide WebDriver
            firefox_options.set_preference("useAutomationExtension", False) # Attempt to hide WebDriver
            firefox_options.set_preference("general.useragent.override", random.choice(self.user_agents)) # Set user agent via preference

            # Additional stability options
            firefox_options.add_argument('--disable-extensions')

            # Random window size to vary browser fingerprints
            width = random.randint(1024, 1920)
            height = random.randint(768, 1080)
            firefox_options.add_argument(f'--width={width}')
            firefox_options.add_argument(f'--height={height}')

            # Enable headless mode if selected by the user (no visible browser windows)
            if self.headless:
                firefox_options.add_argument('--headless')

            return firefox_options

        def run(self):
            """
            The main execution loop for the thread. It initializes and manages browser instances.
            """
            # Install Gecko Driver once for all instances to avoid repeated downloads
            if not self.gecko_driver_path:
                try:
                    self.gecko_driver_path = GeckoDriverManager().install()
                except Exception as e:
                    self.error_occurred.emit(f"Failed to download or initialize GeckoDriver (Firefox): {str(e)}. "
                                             "Please ensure you have Firefox installed, it's up to date, "
                                             "and you have an active internet connection and sufficient permissions. "
                                             "Also, check Windows Defender's 'Controlled folder access' settings.")
                    self.finished.emit()
                    return

            for i in range(self.viewer_count):
                if not self.running:
                    break

                firefox_options = self.setup_firefox_options()

                try:
                    # Create a new Service instance for each driver to avoid "Session is already started"
                    service = Service(self.gecko_driver_path, log_output=os.devnull)
                    driver = webdriver.Firefox(service=service, options=firefox_options)
                    self.drivers.append(driver)

                    driver.get(self.proxy_url)

                    wait = WebDriverWait(driver, 30)
                    text_box = wait.until(EC.presence_of_element_located((By.ID, 'url')))

                    twitch_url = f'https://www.twitch.tv/{self.channel}'
                    text_box.send_keys(twitch_url)
                    text_box.send_keys(Keys.RETURN)

                    self.progress.emit(f"Viewer {i + 1}/{self.viewer_count} initialized successfully")
                    self.viewer_started.emit(i + 1)

                    if not self.rapid_mode:
                        time.sleep(random.uniform(3, 7))
                        self.simulate_viewer_activity(driver, i)

                except WebDriverException as e:
                    self.progress.emit(f"Error initializing viewer {i + 1}: {e.msg}. "
                                       "This often means Firefox could not be launched. "
                                       "Please ensure Firefox is installed and up to date, and try running in headless mode. "
                                       "Also, check Windows Defender's 'Controlled folder access' settings.")
                    continue
                except Exception as e:
                    self.progress.emit(f"An unexpected error occurred initializing viewer {i + 1}: {str(e)}. "
                                       "This might be related to file access permissions or resource limitations.")
                    continue

            while self.running:
                for i, driver in enumerate(list(self.drivers)):
                    if not self.running:
                        break
                    try:
                        self.simulate_viewer_activity(driver, i)
                        time.sleep(random.uniform(1, 3))
                    except Exception as e:
                        self.progress.emit(f"Error during activity for viewer {i+1}: {str(e)}. Attempting to close and remove this viewer.")
                        try:
                            driver.quit()
                            self.drivers.remove(driver)
                            self.progress.emit(f"Viewer {i+1} browser instance closed due to error.")
                        except:
                            pass
                        continue
                time.sleep(1)

            self.finished.emit()

        def stop(self):
            self.running = False
            for driver in list(self.drivers):
                try:
                    driver.quit()
                    self.drivers.remove(driver)
                except Exception as e:
                    self.progress.emit(f"Error quitting a browser instance: {str(e)}")
                    continue

    def __init__(self):
        super().__init__()
        self.setWindowTitle("Twitch Viewer Bot - Premium Edition")
        self.setMinimumSize(900, 700) # Increased size for better layout

        # Main widget and layout for the window
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        layout = QVBoxLayout(main_widget)
        layout.setContentsMargins(30, 30, 30, 30) # Add padding around the main content
        layout.setSpacing(20) # Add spacing between major sections

        # Apply a premium, modern dark theme styling using QSS (Qt Style Sheets)
        self.setStyleSheet("""
            QMainWindow {
                background-color: #121212; /* Very dark background for premium feel */
                border-radius: 15px; /* Slightly rounded window corners */
            }
            QLabel {
                color: #E0E0E0; /* Soft white for labels */
                font-size: 14px;
                font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
            }
            QLineEdit, QSpinBox, QComboBox {
                padding: 12px; /* More padding for a softer look */
                background-color: #282828; /* Darker input fields */
                border: 1px solid #444444; /* Subtle border */
                border-radius: 8px; /* More rounded corners */
                color: #F0F0F0; /* Lighter text in inputs */
                font-size: 14px;
                font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
                selection-background-color: #9147ff; /* Twitch purple for selection */
            }
            QLineEdit::placeholder-text { /* Style for placeholder text */
                color: #A0A0A0; /* Lighter grey for placeholder */
            }
            QComboBox::drop-down {
                border: 0px; /* Remove default arrow border */
            }
            QComboBox::down-arrow {
                /* Custom down arrow using base64 encoded SVG */
                image: url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSIjRTBFMEUwIj48cGF0aCBkPSJNNyAxMGw1IDUgNS01eiIvPjwvc3ZnPg==);
                width: 16px;
                height: 16px;
                margin-right: 5px;
            }
            QComboBox QAbstractItemView { /* Style for dropdown list items */
                background-color: #282828;
                color: #F0F0F0;
                selection-background-color: #9147ff;
                border: 1px solid #444444;
                border-radius: 8px;
                padding: 5px;
            }
            QPushButton {
                padding: 15px 30px; /* Larger padding for a more substantial button */
                background-color: #9147ff; /* Primary Twitch purple */
                border: none;
                border-radius: 10px; /* More rounded buttons */
                color: white;
                font-size: 16px; /* Larger font for buttons */
                font-weight: bold;
                font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
                box-shadow: 0px 5px 15px rgba(145, 71, 255, 0.3); /* Subtle purple shadow */
                transition: all 0.2s ease-in-out; /* Smooth transition for hover (QSS limited, but good practice) */
            }
            QPushButton:hover {
                background-color: #772ce8; /* Darker purple on hover */
                box-shadow: 0px 8px 20px rgba(145, 71, 255, 0.5); /* More pronounced shadow on hover */
                transform: translateY(-2px); /* Slight lift effect (conceptual for QSS) */
            }
            QPushButton:pressed {
                background-color: #6a25d0; /* Even darker when pressed */
                box-shadow: 0px 2px 5px rgba(0, 0, 0, 0.2); /* Flat shadow when pressed */
                transform: translateY(0px);
            }
            QPushButton:disabled {
                background-color: #444444; /* Darker grey when disabled */
                color: #A0A0A0;
                box-shadow: none;
            }
            QTextEdit {
                background-color: #282828;
                color: #E0E0E0;
                border: 1px solid #444444;
                border-radius: 8px;
                font-family: "Consolas", "Courier New", monospace; /* Monospace for logs */
                padding: 10px;
            }
            QProgressBar {
                border: 1px solid #444444;
                border-radius: 8px;
                text-align: center;
                background-color: #282828;
                color: #F0F0F0;
                height: 25px; /* Taller progress bar */
                font-size: 13px;
            }
            QProgressBar::chunk {
                background-color: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #9147ff, stop:1 #772ce8); /* Gradient for chunk */
                border-radius: 7px; /* Slightly smaller than bar for inner effect */
            }
            QCheckBox {
                color: #E0E0E0;
                font-size: 14px;
                font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
                spacing: 8px; /* Space between checkbox and text */
            }
            QCheckBox::indicator {
                width: 18px;
                height: 18px;
                border-radius: 4px;
                border: 1px solid #9147ff; /* Twitch purple border */
                background-color: #282828;
            }
            QCheckBox::indicator:checked {
                background-color: #9147ff; /* Solid purple when checked */
                border: 1px solid #9147ff;
                image: url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNGRkZGRkYiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cG9seWxpbmUgcG9pbnRzPSI2IDEyIDEwLjUgMTYuNSAxOCg4Ij48L3BvbHlsaW5lPjwvc3ZnPg==); /* White checkmark SVG (corrected for better visibility) */
            }
            QFrame#inputFrame { /* Styled frame for input grouping */
                background-color: #1E1E1E;
                border: 1px solid #333333;
                border-radius: 12px;
                padding: 20px;
                box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.2);
            }
            QFrame#logFrame { /* Styled frame for log output */
                background-color: #1E1E1E;
                border: 1px solid #333333;
                border-radius: 12px;
                padding: 15px;
                box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.2);
            }
        """)

        # Application title
        title = QLabel("Twitch Viewer Bot")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setStyleSheet("font-size: 32px; font-weight: bold; color: #9147ff; margin-bottom: 20px;") # Larger, bolder, purple title
        layout.addWidget(title)

        # Input Section Frame
        input_frame = QFrame()
        input_frame.setObjectName("inputFrame") # Set object name for QSS targeting
        input_layout = QVBoxLayout(input_frame)
        input_layout.setSpacing(15) # Spacing within the input frame

        # Channel Name Input
        channel_layout = QHBoxLayout()
        channel_label = QLabel("Channel Name:")
        channel_label.setFixedWidth(120) # Fixed width for labels for alignment
        self.channel_input = QLineEdit()
        self.channel_input.setPlaceholderText("e.g., your_twitch_channel")
        channel_layout.addWidget(channel_label)
        channel_layout.addWidget(self.channel_input)
        input_layout.addLayout(channel_layout)

        # Number of Viewers Input
        viewers_layout = QHBoxLayout()
        viewers_label = QLabel("Number of Viewers:")
        viewers_label.setFixedWidth(120)
        self.viewers_spin = QSpinBox()
        self.viewers_spin.setRange(1, 50)
        self.viewers_spin.setValue(5)
        viewers_layout.addWidget(viewers_label)
        viewers_layout.addWidget(self.viewers_spin)
        input_layout.addLayout(viewers_layout)

        # Proxy Server Selection
        proxy_layout = QHBoxLayout()
        proxy_label = QLabel("Proxy Server:")
        proxy_label.setFixedWidth(120)
        self.proxy_combo = QComboBox()
        self.proxy_combo.addItems([
            "CroxyProxy.com (Recommended)",
            "CroxyProxy.rocks",
            "Croxy.network",
            "Croxy.org",
            "CroxyProxy.net",
            "Blockaway.net",
            "YoutubeUnblocked.live"
        ])
        proxy_layout.addWidget(proxy_label)
        proxy_layout.addWidget(self.proxy_combo)
        input_layout.addLayout(proxy_layout)

        # Launch Mode Selection
        mode_layout = QHBoxLayout()
        mode_label = QLabel("Launch Mode:")
        mode_label.setFixedWidth(120)
        self.mode_combo = QComboBox()
        self.mode_combo.addItems(["Stealth Mode (stable)", "Rapid Mode (faster)"])
        mode_layout.addWidget(mode_label)
        mode_layout.addWidget(self.mode_combo)
        input_layout.addLayout(mode_layout)

        # Headless Mode Checkbox
        self.headless_check = QCheckBox("Run in Headless Mode (no visible windows)")
        input_layout.addWidget(self.headless_check)

        layout.addWidget(input_frame) # Add the input frame to the main layout

        # Progress Bar
        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        layout.addWidget(self.progress_bar)

        # Log Output Section Frame
        log_frame = QFrame()
        log_frame.setObjectName("logFrame") # Set object name for QSS targeting
        log_layout = QVBoxLayout(log_frame)

        log_label = QLabel("Activity Log:")
        log_label.setStyleSheet("font-size: 16px; font-weight: bold; margin-bottom: 5px;")
        log_layout.addWidget(log_label)

        self.log_output = QTextEdit()
        self.log_output.setReadOnly(True)
        log_layout.addWidget(self.log_output)

        layout.addWidget(log_frame) # Add the log frame to the main layout

        # Buttons
        button_layout = QHBoxLayout()
        button_layout.setSpacing(15) # Spacing between buttons
        button_layout.setAlignment(Qt.AlignmentFlag.AlignCenter) # Center the buttons

        self.start_button = QPushButton("Start Viewers")
        self.stop_button = QPushButton("Stop Viewers")
        self.stop_button.setEnabled(False) # Stop button is initially disabled

        button_layout.addWidget(self.start_button)
        button_layout.addWidget(self.stop_button)
        layout.addLayout(button_layout)

        # Connect signals from buttons to their respective methods
        self.start_button.clicked.connect(self.start_viewers)
        self.stop_button.clicked.connect(self.stop_viewers)

        self.viewer_thread = None # Initialize viewer_thread attribute

    def log(self, message):
        """Appends a message to the log output area."""
        self.log_output.append(message)

    def show_message_box(self, title, message):
        """Displays a custom styled QMessageBox."""
        msg_box = QMessageBox()
        msg_box.setWindowTitle(title)
        msg_box.setText(message)
        msg_box.setIcon(QMessageBox.Icon.Critical) # Use a critical icon for errors
        msg_box.setStyleSheet("""
            QMessageBox {
                background-color: #2a2a2a;
                color: #ffffff;
            }
            QMessageBox QLabel {
                color: #ffffff;
            }
            QMessageBox QPushButton {
                background-color: #9147ff;
                color: white;
                border-radius: 4px;
                padding: 5px 10px;
            }
            QMessageBox QPushButton:hover {
                background-color: #772ce8;
            }
        """)
        msg_box.exec() # Show the message box and wait for user interaction

    def update_progress(self, value):
        """Updates the progress bar based on the number of viewers started."""
        total_viewers = self.viewers_spin.value()
        if total_viewers > 0:
            progress = int((value / total_viewers) * 100)
            self.progress_bar.setValue(progress)
        else:
            self.progress_bar.setValue(0)

    def start_viewers(self):
        """Initiates the viewer bot operation."""
        if not self.channel_input.text():
            self.show_message_box("Input Error", "Please enter a Twitch channel name.")
            return

        if self.viewers_spin.value() > 15:
            self.log("Warning: Running more than 15 viewers might cause instability and resource issues.")

        # Disable start button and enable stop button
        self.start_button.setEnabled(False)
        self.stop_button.setEnabled(True)
        self.progress_bar.setValue(0) # Reset progress bar
        self.log_output.clear() # Clear previous logs

        # Map selected proxy text to its base URL
        selected_proxy_text = self.proxy_combo.currentText()
        proxy_url_map = {
            "CroxyProxy.com (Recommended)": "https://www.croxyproxy.com",
            "CroxyProxy.rocks": "https://www.croxyproxy.rocks",
            "Croxy.network": "https://www.croxy.network",
            "Croxy.org": "https://www.croxy.org",
            "CroxyProxy.net": "https://www.croxyproxy.net",
            "Blockaway.net": "https://www.blockaway.net",
            "YoutubeUnblocked.live": "https://www.youtubeunblocked.live"
        }
        # Get the URL, default to CroxyProxy.com if not found (shouldn't happen with fixed list)
        proxy_url = proxy_url_map.get(selected_proxy_text, "https://www.croxyproxy.com")

        # Create and start the worker thread instance (nested class)
        self.viewer_thread = self.ViewerWorker(
            proxy_url,
            self.channel_input.text(),
            self.viewers_spin.value(),
            self.headless_check.isChecked(),
            self.mode_combo.currentIndex() == 1 # True if "Rapid Mode" is selected
        )

        # Connect signals from the worker thread to GUI update slots
        self.viewer_thread.progress.connect(self.log)
        self.viewer_thread.viewer_started.connect(self.update_progress)
        self.viewer_thread.finished.connect(self.on_viewers_finished)
        # Connect the new error signal to a method that shows a message box and resets
        self.viewer_thread.error_occurred.connect(self.show_message_box_and_reset)
        self.viewer_thread.start()

    def stop_viewers(self):
        """Sends a stop signal to the worker thread."""
        if self.viewer_thread:
            self.log("Stopping viewers...")
            self.viewer_thread.stop()

    def on_viewers_finished(self):
        """Resets the GUI state when the viewer session ends."""
        self.start_button.setEnabled(True)
        self.stop_button.setEnabled(False)
        self.log("Viewer session ended")
        self.progress_bar.setValue(100) # Set progress to 100% when finished

    def show_message_box_and_reset(self, error_message):
        """Displays a critical error message and resets the GUI."""
        self.show_message_box("Critical Error", error_message)
        self.on_viewers_finished() # Reset GUI buttons and progress

# Main execution block
if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = TwitchViewBotting() # Instantiate the main singular class
    window.show()
    sys.exit(app.exec()) # Start the application event loop
