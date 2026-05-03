"""
Hourly camera pipeline: capture → QR decode → detect/analyse → persist.

run_cycle() handles two separate zone types in one pass:

Fruiting zones  — YOLOv8 mushroom detection, cap diameter + color, pinning
                  events, growth-stall harvest flags, strain model learning.

Incubation zones — HSV colonisation fraction, readiness score, fruiting-ready
                   flags when score exceeds threshold.  No YOLO required.
"""
import logging
import os
from datetime import datetime, timezone

import cv2
import numpy as np

from . import config as cfg
from . import capture, qr_reader, detector, analyser, colonisation, labeller
from . import db as camdb

log = logging.getLogger(__name__)


def run_cycle(con) -> None:
    captured_at = datetime.now(timezone.utc).isoformat()
    log.info("Camera cycle starting at %s", captured_at)

    fruiting_bags   = {row["bag_id"]: dict(row) for row in camdb.get_fruiting_bags(con)}
    incubating_bags = {row["bag_id"]: dict(row) for row in camdb.get_incubating_bags(con)}

    if not fruiting_bags and not incubating_bags:
        log.info("No bags in fruiting or incubation zones — skipping cycle.")
        return

    for cam_cfg in cfg.CAMERAS:
        cam_id = camdb.upsert_camera(
            con, cam_cfg["name"], cam_cfg["rtsp_url"], cam_cfg.get("zone_id")
        )
        zone_role = cam_cfg.get("zone_role", "fruiting")   # add zone_role to CAMERAS config
        if zone_role == "incubation":
            _process_incubation_camera(con, cam_id, cam_cfg, incubating_bags, captured_at)
        else:
            _process_fruiting_camera(con, cam_id, cam_cfg, fruiting_bags, captured_at)

    _learn_from_new_harvests(con)
    _sync_contamination_labels(con)
    _check_unseen_bags(con)
    log.info("Camera cycle complete.")


def _sync_contamination_labels(con) -> None:
    """Pick up any new contamination reports and tag nearby frames as training data."""
    new_contam = labeller.sync_labels_from_reports(con, cfg.INCUBATION_BAG_RADIUS_PX)
    new_clean  = labeller.add_clean_labels(con, cfg.INCUBATION_BAG_RADIUS_PX)
    if new_contam or new_clean:
        stats = labeller.label_stats(con)
        log.info("Label dataset: %s", stats)


def _check_unseen_bags(con) -> None:
    """Notify if bags in incubation or fruiting haven't been seen for >24 h."""
    for role in ("incubation", "fruiting"):
        unseen = camdb.get_unseen_bags(con, role, hours=cfg.UNSEEN_BAG_ALERT_HOURS)
        for row in unseen:
            last = row["last_seen_at"] or "never"
            log.warning("Bag %s (%s) not seen for >%dh (last: %s)", row["bag_id"], role, cfg.UNSEEN_BAG_ALERT_HOURS, last)
            camdb.create_notification(
                con,
                user_id=cfg.NOTIFY_USER_ID,
                type_="camera_bag_not_visible",
                title=f"Bag {row['bag_id']} not visible",
                body=f"No camera reading for >{cfg.UNSEEN_BAG_ALERT_HOURS}h — may be occluded. Last seen: {last[:10] if last != 'never' else 'never'}.",
                link_type="bag",
                link_id=row["bag_id"],
            )


def _process_incubation_camera(
    con, cam_id: int, cam_cfg: dict, incubating_bags: dict, captured_at: str
) -> None:
    frame = capture.grab_frame(cam_cfg["rtsp_url"])
    if frame is None:
        log.warning("No frame from incubation camera '%s'", cam_cfg["name"])
        return

    qr_results = qr_reader.decode_qr_codes(frame)
    if not qr_results:
        log.info("Incubation camera '%s': no QR codes visible.", cam_cfg["name"])

    bag_radius_px = cfg.INCUBATION_BAG_RADIUS_PX

    for qr in qr_results:
        bag_id = camdb.lookup_bag_by_barcode(con, qr.barcode)
        if bag_id is None or bag_id not in incubating_bags:
            continue

        bag_meta     = incubating_bags[bag_id]
        batch_id     = bag_meta["batch_id"]
        expected_days = bag_meta.get("expected_days")

        # Elapsed days since batch was created
        elapsed_days: float | None = None
        if bag_meta.get("batch_created"):
            try:
                created_dt = datetime.fromisoformat(bag_meta["batch_created"])
                now_dt     = datetime.fromisoformat(captured_at)
                elapsed_days = (now_dt - created_dt).total_seconds() / 86400.0
            except Exception:
                pass

        col_frac = colonisation.colonisation_fraction(frame, qr.cx, qr.cy, bag_radius_px)
        score    = colonisation.readiness_score(
            col_frac,
            elapsed_days or 0.0,
            expected_days or 0,
        )

        frame_path = _maybe_save_frame(frame, bag_id, captured_at)
        camdb.insert_incubation_snapshot(
            con,
            camera_id=cam_id,
            bag_id=bag_id,
            batch_id=batch_id,
            captured_at=captured_at,
            colonisation_frac=col_frac,
            readiness_score=score,
            elapsed_days=elapsed_days,
            expected_days=expected_days,
            frame_path=frame_path,
        )
        log.info(
            "Incubation bag %s: col=%.0f%% score=%.2f elapsed=%.1fd",
            bag_id, col_frac * 100, score, elapsed_days or 0,
        )

        if colonisation.is_ready_to_fruit(
            score, col_frac,
            score_threshold=cfg.COLONISATION_SCORE_THRESHOLD,
            min_colonisation=cfg.COLONISATION_MIN_FRACTION,
        ) and camdb.get_open_fruiting_ready_flag(con, bag_id) is None:
            _raise_fruiting_ready_flag(con, bag_id, batch_id, captured_at, score, elapsed_days, expected_days)


def _raise_fruiting_ready_flag(con, bag_id, batch_id, captured_at, score, elapsed_days, expected_days):
    camdb.insert_fruiting_ready_flag(
        con,
        bag_id=bag_id,
        batch_id=batch_id,
        flagged_at=captured_at,
        peak_score=score,
    )
    body_parts = [f"Visible colonisation ≥ 70 %."]
    if elapsed_days is not None and expected_days:
        body_parts.append(f"Day {elapsed_days:.0f} of {expected_days}.")
    camdb.create_notification(
        con,
        user_id=cfg.NOTIFY_USER_ID,
        type_="camera_fruiting_ready",
        title=f"Ready to fruit — bag {bag_id}",
        body=" ".join(body_parts),
        link_type="bag",
        link_id=bag_id,
    )
    log.info("Fruiting-ready flag raised for bag %s (score=%.2f).", bag_id, score)


def _process_fruiting_camera(con, cam_id: int, cam_cfg: dict, fruiting_bags: dict, captured_at: str) -> None:
    frame = capture.grab_frame(cam_cfg["rtsp_url"])
    if frame is None:
        log.warning("No frame from camera '%s'", cam_cfg["name"])
        return

    qr_results = qr_reader.decode_qr_codes(frame)
    if not qr_results:
        log.info("Camera '%s': no QR codes visible in frame.", cam_cfg["name"])

    all_detections = detector.detect_mushrooms(frame, cfg.YOLO_MODEL, cfg.YOLO_CONF_THRESHOLD)
    frame_h, frame_w = frame.shape[:2]
    frame_area = float(frame_h * frame_w)

    for qr in qr_results:
        bag_id = camdb.lookup_bag_by_barcode(con, qr.barcode)
        if bag_id is None:
            log.debug("Barcode %d not found in barcodes table.", qr.barcode)
            continue
        if bag_id not in fruiting_bags:
            log.debug("Bag %s is visible but not in a fruiting zone — skipping.", bag_id)
            continue

        bag_meta = fruiting_bags[bag_id]
        batch_id = bag_meta["batch_id"]
        strain_id = bag_meta.get("strain_id")

        # Attribute YOLO detections to this bag by spatial proximity to the QR centroid.
        nearby = detector.detections_near(all_detections, qr.cx, qr.cy, cfg.QR_ASSIGN_RADIUS_PX)

        if nearby:
            # Use the largest detection as the representative cap for diameter/color.
            best = max(nearby, key=lambda d: d.cap_diameter_px)
            cap_mm = detector.px_to_mm(best.cap_diameter_px, cfg.PX_PER_MM)
            h, s, v = best.cap_color_hsv
            conf = best.confidence
        else:
            cap_mm = None
            h = s = v = conf = None

        frame_path = _maybe_save_frame(frame, bag_id, captured_at)
        meas_id = camdb.insert_measurement(
            con,
            camera_id=cam_id,
            bag_id=bag_id,
            batch_id=batch_id,
            captured_at=captured_at,
            cap_diameter_mm=cap_mm,
            cap_color_h=h,
            cap_color_s=s,
            cap_color_v=v,
            detection_conf=conf,
            mushroom_count=len(nearby),
            frame_path=frame_path,
        )

        _handle_pinning(con, bag_id, batch_id, strain_id, nearby, frame_area, captured_at, meas_id)
        _handle_harvest_flag(con, bag_id, batch_id, strain_id, captured_at)


def _handle_pinning(con, bag_id, batch_id, strain_id, detections, frame_area, captured_at, meas_id):
    if not analyser.is_pinning(detections, frame_area, cfg.PIN_MAX_AREA_RATIO):
        return

    pending = camdb.get_pending_pinning_event(con, bag_id)
    if pending is None:
        flush = camdb.current_flush_number(con, bag_id)
        camdb.insert_pinning_event(
            con,
            bag_id=bag_id,
            batch_id=batch_id,
            flush_number=flush,
            detected_at=captured_at,
            measurement_id=meas_id,
        )
        camdb.create_notification(
            con,
            user_id=cfg.NOTIFY_USER_ID,
            type_="camera_pinning",
            title=f"Pins detected — bag {bag_id}",
            body=f"First pins spotted on {captured_at[:10]}. Check again next reading to confirm.",
            link_type="bag",
            link_id=bag_id,
        )
        log.info("Pinning tentatively detected on bag %s.", bag_id)
    else:
        camdb.confirm_pinning_event(con, pending["id"])
        log.info("Pinning confirmed on bag %s.", bag_id)
        camdb.create_notification(
            con,
            user_id=cfg.NOTIFY_USER_ID,
            type_="camera_pinning_confirmed",
            title=f"Pinning confirmed — bag {bag_id}",
            body=f"Pins confirmed on {captured_at[:10]}.",
            link_type="bag",
            link_id=bag_id,
        )


def _handle_harvest_flag(con, bag_id, batch_id, strain_id, captured_at):
    if camdb.get_open_harvest_flag(con, bag_id) is not None:
        return  # already flagged; don't create duplicates

    recent = camdb.get_recent_measurements(con, bag_id, n=cfg.HARVEST_STALL_READINGS + 1)
    if not analyser.stall_detected(recent, cfg.HARVEST_GROWTH_THRESHOLD_PCT, cfg.HARVEST_STALL_READINGS):
        return

    peak = max(
        (r["cap_diameter_mm"] for r in recent if r["cap_diameter_mm"] is not None),
        default=None,
    )

    # Predict harvest time using learned strain model.
    predicted_at = None
    pinning_row = con.execute(
        """SELECT confirmed_at FROM camera_pinning_events
           WHERE bag_id=? AND confirmed_at IS NOT NULL
           ORDER BY confirmed_at DESC
           LIMIT 1""",
        (bag_id,),
    ).fetchone()
    if pinning_row and strain_id:
        model_row = con.execute(
            "SELECT avg_pin_to_harvest_hours FROM camera_strain_models WHERE strain_id=?",
            (strain_id,),
        ).fetchone()
        if model_row:
            predicted_at = analyser.predict_harvest_time(
                model_row["avg_pin_to_harvest_hours"],
                pinning_row["confirmed_at"],
            )

    flush = camdb.current_flush_number(con, bag_id)
    camdb.insert_harvest_flag(
        con,
        bag_id=bag_id,
        batch_id=batch_id,
        flush_number=flush,
        flagged_at=captured_at,
        predicted_harvest_at=predicted_at,
        peak_diameter_mm=peak,
    )

    body_parts = [f"Growth stalled after {cfg.HARVEST_STALL_READINGS} readings."]
    if peak:
        body_parts.append(f"Peak cap diameter: {peak:.1f} mm.")
    if predicted_at:
        body_parts.append(f"Predicted harvest: {predicted_at[:10]}.")

    camdb.create_notification(
        con,
        user_id=cfg.NOTIFY_USER_ID,
        type_="camera_harvest_ready",
        title=f"Ready to harvest — bag {bag_id}",
        body=" ".join(body_parts),
        link_type="bag",
        link_id=bag_id,
    )
    log.info("Harvest flag raised for bag %s.", bag_id)


def _learn_from_new_harvests(con) -> None:
    """
    Look for harvests that have a corresponding confirmed pinning event but
    no strain-model update yet.  Compute the pin→harvest duration and feed
    it into the rolling average.
    """
    rows = con.execute(
        """
        SELECT
            h.bag,
            h.time AS harvest_time,
            p.confirmed_at,
            ba.strain_id,
            p.id AS pin_event_id
        FROM harvests h
        JOIN bags b ON b.bag_id = h.bag
        JOIN batches ba ON ba.batch_id = b.batch_id
        JOIN camera_pinning_events p
          ON p.bag_id = h.bag
         AND p.confirmed_at IS NOT NULL
         AND p.confirmed_at < h.time
        -- Only process pairs we haven't already learned from.
        WHERE NOT EXISTS (
            SELECT 1 FROM camera_harvest_flags f
            WHERE f.bag_id = h.bag
              AND f.resolved_at IS NOT NULL
              AND f.resolved_at = h.time
        )
        ORDER BY h.time
        """
    ).fetchall()

    for row in rows:
        if not row["strain_id"]:
            continue
        try:
            harvest_dt = datetime.fromisoformat(row["harvest_time"])
            pin_dt = datetime.fromisoformat(row["confirmed_at"])
            hours = (harvest_dt - pin_dt).total_seconds() / 3600.0
            if hours > 0:
                camdb.update_strain_model(con, row["strain_id"], hours)
                log.info(
                    "Strain model updated: strain_id=%d, %.1f hours pin→harvest (bag %s)",
                    row["strain_id"],
                    hours,
                    row["bag"],
                )
        except Exception:
            log.exception("Failed to update strain model for bag %s", row["bag"])


def _maybe_save_frame(frame: np.ndarray, bag_id: str, captured_at: str) -> str | None:
    if not cfg.FRAME_SAVE_DIR:
        return None
    os.makedirs(cfg.FRAME_SAVE_DIR, exist_ok=True)
    ts = captured_at.replace(":", "-").replace(".", "-")
    filename = f"{bag_id}_{ts}.jpg"
    path = os.path.join(cfg.FRAME_SAVE_DIR, filename)
    cv2.imwrite(path, frame)
    return path
