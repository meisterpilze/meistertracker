"""
YOLOv8 mushroom detection and per-detection measurement extraction.

The model is loaded once and cached.  Swap YOLO_MODEL in config.py for a
fine-tuned checkpoint once you have labelled mushroom training data.
"""
import logging
import math
from dataclasses import dataclass, field

import cv2
import numpy as np

log = logging.getLogger(__name__)

# Model cache: path → YOLO instance
_model_cache: dict = {}


def _get_model(model_path: str):
    if model_path not in _model_cache:
        from ultralytics import YOLO
        log.info("Loading YOLO model: %s", model_path)
        _model_cache[model_path] = YOLO(model_path)
    return _model_cache[model_path]


@dataclass
class Detection:
    # Pixel coordinates of the bounding box (top-left, bottom-right)
    x1: int
    y1: int
    x2: int
    y2: int
    confidence: float
    # Longest edge of bounding box in pixels — proxy for cap diameter
    cap_diameter_px: float
    # Mean HSV of the cap region: H in 0–360, S and V in 0–1
    cap_color_hsv: tuple[float, float, float] = field(default_factory=lambda: (0.0, 0.0, 0.0))

    @property
    def cx(self) -> float:
        return (self.x1 + self.x2) / 2.0

    @property
    def cy(self) -> float:
        return (self.y1 + self.y2) / 2.0

    @property
    def area_px(self) -> float:
        return float((self.x2 - self.x1) * (self.y2 - self.y1))


def detect_mushrooms(
    frame: np.ndarray,
    model_path: str,
    conf_threshold: float = 0.4,
) -> list[Detection]:
    model = _get_model(model_path)
    results = model(frame, conf=conf_threshold, verbose=False)
    detections: list[Detection] = []
    for r in results:
        for box in r.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            conf = float(box.conf[0])
            cap_diameter_px = float(max(x2 - x1, y2 - y1))
            roi = frame[max(0, y1):y2, max(0, x1):x2]
            hsv = _mean_hsv(roi)
            detections.append(Detection(
                x1=x1, y1=y1, x2=x2, y2=y2,
                confidence=conf,
                cap_diameter_px=cap_diameter_px,
                cap_color_hsv=hsv,
            ))
    return detections


def px_to_mm(px: float, px_per_mm: float) -> float:
    return px / px_per_mm if px_per_mm else 0.0


def detections_near(
    detections: list[Detection],
    cx: float,
    cy: float,
    radius_px: float,
) -> list[Detection]:
    """Return detections whose centroid is within radius_px of (cx, cy)."""
    result = []
    for d in detections:
        dist = math.hypot(d.cx - cx, d.cy - cy)
        if dist <= radius_px:
            result.append(d)
    return result


def _mean_hsv(roi: np.ndarray) -> tuple[float, float, float]:
    if roi.size == 0:
        return (0.0, 0.0, 0.0)
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    mean = hsv.mean(axis=(0, 1))
    h = float(mean[0]) * 2.0    # OpenCV stores hue 0–180; expand to 0–360
    s = float(mean[1]) / 255.0
    v = float(mean[2]) / 255.0
    return (h, s, v)
