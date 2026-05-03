"""
Contamination label management and YOLO training-data export.

Workflow:
  1. Operator scans a contaminated bag in MeisterTracker as normal.
     This creates a row in contamination_reports (existing table).
  2. sync_labels_from_reports() runs at the end of every camera cycle.
     It finds new reports that have a saved camera frame, crops the bag
     region, and writes a camera_contamination_labels row.
  3. Once enough labels accumulate, export_yolo_dataset() writes the
     images and YOLO-format .txt annotation files ready for fine-tuning.

Clean (healthy) samples are added automatically from camera_measurements
rows where no contamination report exists for that bag at that time.
"""
import logging
import os
import shutil
import json
from datetime import datetime, timezone

import cv2
import numpy as np

log = logging.getLogger(__name__)


def sync_labels_from_reports(con, bag_radius_px: int) -> int:
    """
    Find contamination_reports that have a recent camera frame but no label
    record yet, and create label rows.  Returns count of new labels created.
    """
    new_rows = con.execute(
        """
        SELECT
            cr.id         AS report_id,
            cr.bag_id,
            cr.type_id    AS contam_type_id,
            cr.reported_at,
            cr.user_id    AS labelled_by,
            cm.id         AS measurement_id,
            cm.frame_path,
            cm.captured_at
        FROM contamination_reports cr
        JOIN camera_measurements cm
          ON cm.bag_id = cr.bag_id
         AND cm.frame_path IS NOT NULL
         -- nearest frame within ±4 hours of the report
         AND ABS(
               (julianday(cm.captured_at) - julianday(cr.reported_at)) * 24
             ) <= 4
        LEFT JOIN camera_contamination_labels lbl
          ON lbl.report_id = cr.report_id
        WHERE lbl.id IS NULL
          AND cr.bag_id IS NOT NULL
        ORDER BY cr.reported_at, ABS(julianday(cm.captured_at) - julianday(cr.reported_at))
        """
    ).fetchall()

    count = 0
    seen_reports = set()
    for row in new_rows:
        if row["report_id"] in seen_reports:
            continue  # keep only the nearest frame per report
        seen_reports.add(row["report_id"])

        crop_coords = _crop_coords_from_frame(row["frame_path"], bag_radius_px)
        con.execute(
            """INSERT INTO camera_contamination_labels
               (report_id, measurement_id, frame_path,
                crop_x, crop_y, crop_w, crop_h,
                contam_type_id, is_clean, labelled_at, labelled_by)
               VALUES(?,?,?,?,?,?,?,?,0,?,?)""",
            (
                row["report_id"], row["measurement_id"], row["frame_path"],
                *crop_coords,
                row["contam_type_id"],
                datetime.now(timezone.utc).isoformat(),
                row["labelled_by"],
            ),
        )
        count += 1

    if count:
        con.commit()
        log.info("Created %d contamination label(s) from reports.", count)
    return count


def add_clean_labels(con, bag_radius_px: int, max_per_run: int = 20) -> int:
    """
    Tag recent frames of healthy bags as clean training samples.
    Only adds a sample if no open contamination report exists for that bag.
    Runs at the end of each cycle to keep the clean:contaminated ratio balanced.
    """
    candidates = con.execute(
        """
        SELECT cm.id AS measurement_id, cm.bag_id, cm.frame_path, cm.captured_at
        FROM camera_measurements cm
        WHERE cm.frame_path IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM contamination_reports cr
              WHERE cr.bag_id = cm.bag_id
                AND cr.reported_at <= cm.captured_at
                AND (cr.resolved_at IS NULL OR cr.resolved_at > cm.captured_at)
          )
          AND NOT EXISTS (
              SELECT 1 FROM camera_contamination_labels lbl
              WHERE lbl.measurement_id = cm.id
          )
        ORDER BY cm.captured_at DESC
        LIMIT ?
        """,
        (max_per_run,),
    ).fetchall()

    count = 0
    now = datetime.now(timezone.utc).isoformat()
    for row in candidates:
        crop_coords = _crop_coords_from_frame(row["frame_path"], bag_radius_px)
        con.execute(
            """INSERT INTO camera_contamination_labels
               (report_id, measurement_id, frame_path,
                crop_x, crop_y, crop_w, crop_h,
                contam_type_id, is_clean, labelled_at)
               VALUES(NULL,?,?,?,?,?,?,NULL,1,?)""",
            (row["measurement_id"], row["frame_path"], *crop_coords, now),
        )
        count += 1

    if count:
        con.commit()
        log.debug("Added %d clean training label(s).", count)
    return count


def export_yolo_dataset(con, output_dir: str, val_fraction: float = 0.15) -> dict:
    """
    Export labelled frames as a YOLO image-classification dataset:

        output_dir/
          train/
            clean/        *.jpg
            <type_name>/  *.jpg   (one folder per contamination type)
          val/
            clean/
            <type_name>/

    Returns a dict with counts per class.
    """
    labels = con.execute(
        """
        SELECT lbl.id, lbl.frame_path, lbl.crop_x, lbl.crop_y, lbl.crop_w, lbl.crop_h,
               lbl.is_clean, ct.name AS type_name
        FROM camera_contamination_labels lbl
        LEFT JOIN contamination_types ct ON ct.id = lbl.contam_type_id
        WHERE lbl.frame_path IS NOT NULL
        ORDER BY lbl.labelled_at
        """
    ).fetchall()

    if not labels:
        log.warning("No labels to export.")
        return {}

    counts: dict[str, int] = {}
    class_counts: dict[str, int] = {}

    for idx, row in enumerate(labels):
        class_name = "clean" if row["is_clean"] else (row["type_name"] or "unknown")
        is_val = (idx % max(1, int(1 / val_fraction))) == 0
        split = "val" if is_val else "train"

        dest_dir = os.path.join(output_dir, split, class_name)
        os.makedirs(dest_dir, exist_ok=True)

        dest_path = os.path.join(dest_dir, f"label_{row['id']:06d}.jpg")
        crop = _load_crop(
            row["frame_path"],
            row["crop_x"], row["crop_y"],
            row["crop_w"], row["crop_h"],
        )
        if crop is None:
            continue
        cv2.imwrite(dest_path, crop)
        class_counts[class_name] = class_counts.get(class_name, 0) + 1

    # Write a dataset.yaml for Ultralytics
    class_names = [k for k in class_counts if k != "clean"]
    class_names = ["clean"] + sorted(class_names)
    yaml_path = os.path.join(output_dir, "dataset.yaml")
    with open(yaml_path, "w") as f:
        f.write(f"path: {os.path.abspath(output_dir)}\n")
        f.write(f"train: train\nval: val\n")
        f.write(f"nc: {len(class_names)}\n")
        f.write(f"names: {json.dumps(class_names)}\n")

    log.info("Exported dataset to %s: %s", output_dir, class_counts)
    return class_counts


def label_stats(con) -> dict:
    """Return counts per contamination type (for progress reporting)."""
    rows = con.execute(
        """
        SELECT
            CASE WHEN lbl.is_clean = 1 THEN 'clean' ELSE COALESCE(ct.name, 'unknown') END AS class,
            COUNT(*) AS n
        FROM camera_contamination_labels lbl
        LEFT JOIN contamination_types ct ON ct.id = lbl.contam_type_id
        GROUP BY 1
        ORDER BY 2 DESC
        """
    ).fetchall()
    return {row["class"]: row["n"] for row in rows}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _crop_coords_from_frame(frame_path: str, bag_radius_px: int) -> tuple[int, int, int, int]:
    """
    For now, assume the whole frame is the crop area (0, 0, w, h).
    Once we store QR centroid positions per measurement we can refine this to
    a tight crop around the bag face.
    """
    if frame_path and os.path.exists(frame_path):
        img = cv2.imread(frame_path)
        if img is not None:
            h, w = img.shape[:2]
            return (0, 0, w, h)
    return (0, 0, 0, 0)


def _load_crop(
    frame_path: str,
    x: int, y: int, w: int, h: int,
) -> np.ndarray | None:
    if not frame_path or not os.path.exists(frame_path):
        return None
    img = cv2.imread(frame_path)
    if img is None:
        return None
    ih, iw = img.shape[:2]
    if w == 0 or h == 0:
        return img  # no crop recorded, return full frame
    x2 = min(x + w, iw)
    y2 = min(y + h, ih)
    return img[y:y2, x:x2]
