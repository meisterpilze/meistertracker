"""
RTSP frame capture via OpenCV.

grab_frame() opens the stream, skips a handful of frames so the camera's
auto-exposure settles, returns one BGR numpy array, then closes the stream.
Returns None on any failure so the caller can log and continue.
"""
import logging

import cv2
import numpy as np

log = logging.getLogger(__name__)

_RTSP_TIMEOUT_MS = 10_000
_WARMUP_FRAMES = 5


def grab_frame(rtsp_url: str) -> np.ndarray | None:
    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, _RTSP_TIMEOUT_MS)
    cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, _RTSP_TIMEOUT_MS)
    try:
        if not cap.isOpened():
            log.error("Cannot open RTSP stream: %s", rtsp_url)
            return None
        for _ in range(_WARMUP_FRAMES):
            cap.grab()
        ok, frame = cap.read()
        if not ok or frame is None:
            log.error("Failed to read frame from %s", rtsp_url)
            return None
        return frame
    finally:
        cap.release()
