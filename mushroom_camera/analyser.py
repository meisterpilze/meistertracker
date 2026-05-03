"""
Growth analysis: pinning detection, harvest-stall detection, and strain-model
prediction.  All functions are pure (no DB access) so they are easy to test.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

log = logging.getLogger(__name__)


def is_pinning(detections: list, frame_area_px: float, pin_max_area_ratio: float) -> bool:
    """
    Return True if any detection looks like pins — tiny objects whose
    bounding-box area is below pin_max_area_ratio × frame_area_px.
    """
    for d in detections:
        if frame_area_px > 0 and (d.area_px / frame_area_px) < pin_max_area_ratio:
            return True
    return False


def growth_rate_pct(recent_rows: list) -> float | None:
    """
    Compute the percentage change in cap_diameter_mm between the oldest and
    newest rows in `recent_rows` (a list of sqlite3.Row, newest-first).

    Returns None when there are fewer than 2 usable readings.
    """
    diameters = [r["cap_diameter_mm"] for r in recent_rows if r["cap_diameter_mm"] is not None]
    if len(diameters) < 2:
        return None
    newest, oldest = diameters[0], diameters[-1]
    if oldest == 0:
        return None
    return abs((newest - oldest) / oldest) * 100.0


def stall_detected(recent_rows: list, threshold_pct: float, stall_readings: int) -> bool:
    """
    Return True when cap_diameter_mm has changed by less than threshold_pct
    for every consecutive pair within the last stall_readings rows.

    `recent_rows` is sorted newest-first.  We need at least stall_readings rows.
    """
    if len(recent_rows) < stall_readings:
        return False
    rows = recent_rows[:stall_readings]
    for i in range(len(rows) - 1):
        newer = rows[i]["cap_diameter_mm"]
        older = rows[i + 1]["cap_diameter_mm"]
        if newer is None or older is None or older == 0:
            return False
        rate = abs((newer - older) / older) * 100.0
        if rate >= threshold_pct:
            return False
    return True


def predict_harvest_time(
    avg_pin_to_harvest_hours: float | None,
    pinning_detected_at: str,
) -> str | None:
    """
    Given a strain's average pin-to-harvest duration and the ISO8601 timestamp
    when pins were first confirmed, return a predicted harvest timestamp.
    Returns None when no model data is available yet.
    """
    if avg_pin_to_harvest_hours is None:
        return None
    pinning_dt = datetime.fromisoformat(pinning_detected_at)
    if pinning_dt.tzinfo is None:
        pinning_dt = pinning_dt.replace(tzinfo=timezone.utc)
    predicted = pinning_dt + timedelta(hours=avg_pin_to_harvest_hours)
    return predicted.isoformat()
