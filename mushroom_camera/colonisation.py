"""
Colonisation analysis for incubation-zone bags.

Fully colonised substrate is white/cream; fresh substrate is dark brown/grey.
We measure the fraction of each bag's visible face that has turned white using
an HSV threshold, then combine that with elapsed time to produce a readiness
score between 0 and 1.

No YOLO needed — this is pure pixel classification.
"""
import logging

import cv2
import numpy as np

log = logging.getLogger(__name__)

# HSV range for "white / cream" mycelium in OpenCV scale
# H: 0–180, S: 0–255, V: 0–255
_WHITE_HSV_LOW  = np.array([0,   0, 170], dtype=np.uint8)
_WHITE_HSV_HIGH = np.array([180, 50, 255], dtype=np.uint8)


def colonisation_fraction(frame: np.ndarray, cx: float, cy: float, bag_radius_px: float) -> float:
    """
    Estimate the fraction of substrate that has turned white within a circular
    region of radius bag_radius_px centred on the QR code.

    The QR code sits on the bag face, so its centroid is a reliable anchor.
    bag_radius_px should be set to roughly half the bag width in pixels.
    """
    h, w = frame.shape[:2]
    # Build a circular mask
    mask_circ = np.zeros((h, w), dtype=np.uint8)
    cv2.circle(mask_circ, (int(cx), int(cy)), int(bag_radius_px), 255, -1)

    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask_white = cv2.inRange(hsv, _WHITE_HSV_LOW, _WHITE_HSV_HIGH)

    bag_px   = float(cv2.countNonZero(mask_circ))
    white_px = float(cv2.countNonZero(cv2.bitwise_and(mask_white, mask_white, mask=mask_circ)))

    if bag_px == 0:
        return 0.0
    return white_px / bag_px


def readiness_score(
    colonisation_frac: float,
    elapsed_days: float,
    expected_days: float,
    col_weight: float = 0.65,
    time_weight: float = 0.35,
) -> float:
    """
    Weighted composite score in [0, 1].

    colonisation_frac alone is unreliable when the camera only sees the front
    face; blending with elapsed-time fraction hedges against that blind spot.
    """
    time_frac = min(elapsed_days / expected_days, 1.0) if expected_days > 0 else 0.0
    return col_weight * colonisation_frac + time_weight * time_frac


def is_ready_to_fruit(
    score: float,
    colonisation_frac: float,
    *,
    score_threshold: float = 0.85,
    min_colonisation: float = 0.70,
) -> bool:
    """
    Two-gate check: composite score AND raw colonisation must both exceed their
    thresholds so that a very long elapsed time alone can't trigger the flag.
    """
    return score >= score_threshold and colonisation_frac >= min_colonisation
