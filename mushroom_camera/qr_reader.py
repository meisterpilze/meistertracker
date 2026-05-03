"""
QR code detection and decoding.

decode_qr_codes() returns a list of (barcode_int, centroid_x, centroid_y) tuples
for every QR code in the frame whose payload is a plain integer.  The centroid
coordinates allow the pipeline to spatially attribute nearby YOLO detections
to the correct bag.
"""
import logging
from dataclasses import dataclass

import cv2
import numpy as np

log = logging.getLogger(__name__)


@dataclass
class QRResult:
    barcode: int          # numeric barcode value encoded in the QR
    cx: float             # centroid x in pixels
    cy: float             # centroid y in pixels


def decode_qr_codes(frame: np.ndarray) -> list[QRResult]:
    detector = cv2.QRCodeDetector()
    ok, decoded_list, points_list, _ = detector.detectAndDecodeMulti(frame)
    if not ok or not decoded_list:
        return []

    results = []
    for text, pts in zip(decoded_list, points_list):
        text = (text or "").strip()
        if not text:
            continue
        try:
            barcode = int(text)
        except ValueError:
            log.debug("QR payload is not an integer barcode: %r", text)
            continue
        if pts is not None and len(pts) > 0:
            corner_pts = np.array(pts[0], dtype=float).reshape(-1, 2)
            cx = float(corner_pts[:, 0].mean())
            cy = float(corner_pts[:, 1].mean())
        else:
            h, w = frame.shape[:2]
            cx, cy = w / 2.0, h / 2.0
        results.append(QRResult(barcode=barcode, cx=cx, cy=cy))
    return results
