"""
Camera module configuration.

Edit the CAMERAS list and DB_PATH here, or override with environment variables.
"""
import os

# Path to the shared MeisterTracker SQLite database.
# The Node.js app writes here; we write to our own tables in the same file.
DB_PATH = os.getenv("MEISTERTRACKER_DB", "/opt/meistertracker/data/meistertracker.db")

# One entry per physical camera.  zone_id must match an id in the zones table.
CAMERAS = [
    {
        "name": "Tent Camera 1",
        "rtsp_url": os.getenv("CAM1_RTSP", "rtsp://admin:password@192.168.1.10/stream1"),
        "zone_id": "TENT1",
    },
    {
        "name": "Tent Camera 2",
        "rtsp_url": os.getenv("CAM2_RTSP", "rtsp://admin:password@192.168.1.11/stream1"),
        "zone_id": "TENT2",
    },
]

# YOLOv8 model weights file.  Set to a local path after fine-tuning on
# mushroom images; the default downloads the nano pretrained model.
YOLO_MODEL = os.getenv("YOLO_MODEL", "yolov8n.pt")

# Only report detections above this confidence score.
YOLO_CONF_THRESHOLD = float(os.getenv("YOLO_CONF_THRESHOLD", "0.4"))

# Spatial calibration: how many pixels correspond to 1 mm in the frame.
# Measure once by placing a ruler in the frame and counting pixels.
PX_PER_MM = float(os.getenv("PX_PER_MM", "2.0"))

# Harvest stall detection:
#   flag a bag for harvest when cap growth rate stays below HARVEST_GROWTH_THRESHOLD_PCT
#   for HARVEST_STALL_READINGS consecutive hourly readings.
HARVEST_GROWTH_THRESHOLD_PCT = float(os.getenv("HARVEST_GROWTH_THRESHOLD_PCT", "2.0"))
HARVEST_STALL_READINGS = int(os.getenv("HARVEST_STALL_READINGS", "3"))

# Pinning detection:
#   a detection is treated as pins (rather than mature caps) when its bounding-box
#   area is less than PIN_MAX_AREA_RATIO × the total frame area.
PIN_MAX_AREA_RATIO = float(os.getenv("PIN_MAX_AREA_RATIO", "0.04"))

# Minimum pixel distance between a QR code centroid and a detection centroid
# for the detection to be attributed to that bag.
QR_ASSIGN_RADIUS_PX = int(os.getenv("QR_ASSIGN_RADIUS_PX", "400"))

# Directory for saving annotated frame thumbnails.  Set to empty string to skip.
FRAME_SAVE_DIR = os.getenv("FRAME_SAVE_DIR", "/opt/meistertracker/data/camera_frames")

# MeisterTracker user_id that receives in-app harvest/pinning notifications.
# 1 is the first created user (usually the admin).
NOTIFY_USER_ID = int(os.getenv("NOTIFY_USER_ID", "1"))
