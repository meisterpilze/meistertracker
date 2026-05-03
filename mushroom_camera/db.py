"""
SQLite schema and write helpers for the camera module.

All new tables are prefixed camera_ so they are easy to identify and never
collide with existing MeisterTracker tables.  The schema is applied on every
startup via ensure_schema(), which uses CREATE TABLE IF NOT EXISTS throughout,
so it is safe to call repeatedly.
"""
import sqlite3
import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# New tables — all prefixed camera_
# ---------------------------------------------------------------------------
SCHEMA_SQL = """
-- Physical cameras (one row per device).
CREATE TABLE IF NOT EXISTS camera_cameras (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  rtsp_url  TEXT NOT NULL,
  -- Links to the zone this camera covers; NULL if not restricted to one zone.
  zone_id   TEXT REFERENCES zones(id) ON DELETE SET NULL,
  enabled   INTEGER DEFAULT 1,
  created   TEXT NOT NULL
);

-- Hourly per-bag measurement snapshot.
-- cap_diameter_mm is the largest detected cap visible for this bag in this frame.
-- cap_color_h/s/v are the mean HSV of the cap ROI (H in 0-360, S/V in 0-1).
CREATE TABLE IF NOT EXISTS camera_measurements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at     TEXT NOT NULL,
  camera_id       INTEGER NOT NULL REFERENCES camera_cameras(id) ON DELETE CASCADE,
  bag_id          TEXT NOT NULL REFERENCES bags(bag_id) ON DELETE CASCADE,
  batch_id        TEXT REFERENCES batches(batch_id) ON DELETE SET NULL,
  cap_diameter_mm REAL,
  cap_color_h     REAL,
  cap_color_s     REAL,
  cap_color_v     REAL,
  detection_conf  REAL,
  mushroom_count  INTEGER DEFAULT 0,
  -- Optional path to a saved annotated frame thumbnail.
  frame_path      TEXT,
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_cam_meas_bag  ON camera_measurements(bag_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_cam_meas_time ON camera_measurements(captured_at);

-- First-pins event per bag and flush cycle.
-- detected_at = first reading that looked like pins.
-- confirmed_at = set on the *next* reading that also shows pins (reduces false positives).
CREATE TABLE IF NOT EXISTS camera_pinning_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  bag_id         TEXT NOT NULL REFERENCES bags(bag_id) ON DELETE CASCADE,
  batch_id       TEXT REFERENCES batches(batch_id) ON DELETE SET NULL,
  flush_number   INTEGER DEFAULT 1,
  detected_at    TEXT NOT NULL,
  confirmed_at   TEXT,
  measurement_id INTEGER REFERENCES camera_measurements(id) ON DELETE SET NULL,
  notes          TEXT
);
CREATE INDEX IF NOT EXISTS idx_cam_pin_bag ON camera_pinning_events(bag_id);

-- Harvest-ready flags raised when growth stalls.
-- resolved_at is set (by the pipeline or manually) once the bag is harvested.
CREATE TABLE IF NOT EXISTS camera_harvest_flags (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  bag_id               TEXT NOT NULL REFERENCES bags(bag_id) ON DELETE CASCADE,
  batch_id             TEXT REFERENCES batches(batch_id) ON DELETE SET NULL,
  flush_number         INTEGER DEFAULT 1,
  flagged_at           TEXT NOT NULL,
  -- Model-predicted harvest window start (ISO8601).
  predicted_harvest_at TEXT,
  resolved_at          TEXT,
  peak_diameter_mm     REAL,
  notes                TEXT
);
CREATE INDEX IF NOT EXISTS idx_cam_flag_bag      ON camera_harvest_flags(bag_id);
CREATE INDEX IF NOT EXISTS idx_cam_flag_resolved ON camera_harvest_flags(resolved_at);

-- Per-strain learned pin-to-harvest duration model.
-- Updated in an online (Welford) fashion each time a bag is actually harvested.
CREATE TABLE IF NOT EXISTS camera_strain_models (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  strain_id                INTEGER NOT NULL REFERENCES mushroom_strains(id) ON DELETE CASCADE,
  sample_count             INTEGER DEFAULT 0,
  avg_pin_to_harvest_hours REAL,
  stddev_hours             REAL,
  updated_at               TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cam_model_strain ON camera_strain_models(strain_id);

-- Incubation colonisation snapshots (one row per bag per cycle while incubating).
-- colonisation_frac: fraction of visible bag face that has turned white (0–1).
-- readiness_score:   weighted composite of colonisation + elapsed time (0–1).
CREATE TABLE IF NOT EXISTS camera_incubation_snapshots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at       TEXT NOT NULL,
  camera_id         INTEGER NOT NULL REFERENCES camera_cameras(id) ON DELETE CASCADE,
  bag_id            TEXT NOT NULL REFERENCES bags(bag_id) ON DELETE CASCADE,
  batch_id          TEXT REFERENCES batches(batch_id) ON DELETE SET NULL,
  colonisation_frac REAL NOT NULL,
  readiness_score   REAL NOT NULL,
  elapsed_days      REAL,
  expected_days     INTEGER,
  frame_path        TEXT
);
CREATE INDEX IF NOT EXISTS idx_cam_inc_bag  ON camera_incubation_snapshots(bag_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_cam_inc_time ON camera_incubation_snapshots(captured_at);

-- Fruiting-readiness flags raised when a bag is ready to move out of incubation.
CREATE TABLE IF NOT EXISTS camera_fruiting_ready_flags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bag_id       TEXT NOT NULL REFERENCES bags(bag_id) ON DELETE CASCADE,
  batch_id     TEXT REFERENCES batches(batch_id) ON DELETE SET NULL,
  flagged_at   TEXT NOT NULL,
  resolved_at  TEXT,                  -- set once bag is scanned into fruiting
  peak_score   REAL,
  notes        TEXT
);
CREATE INDEX IF NOT EXISTS idx_cam_frf_bag      ON camera_fruiting_ready_flags(bag_id);
CREATE INDEX IF NOT EXISTS idx_cam_frf_resolved ON camera_fruiting_ready_flags(resolved_at);

-- Contamination training labels, built automatically from contamination_reports.
-- is_clean=1 rows are healthy samples; is_clean=0 rows are contamination examples.
-- contam_type_id links to the existing contamination_types table.
-- Once a model is trained, model_* columns store its prediction for comparison.
CREATE TABLE IF NOT EXISTS camera_contamination_labels (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id               INTEGER REFERENCES contamination_reports(id) ON DELETE CASCADE,
  measurement_id          INTEGER REFERENCES camera_measurements(id) ON DELETE SET NULL,
  frame_path              TEXT,
  crop_x                  INTEGER DEFAULT 0,
  crop_y                  INTEGER DEFAULT 0,
  crop_w                  INTEGER DEFAULT 0,
  crop_h                  INTEGER DEFAULT 0,
  contam_type_id          INTEGER REFERENCES contamination_types(id) ON DELETE SET NULL,
  is_clean                INTEGER NOT NULL DEFAULT 0,
  labelled_at             TEXT NOT NULL,
  labelled_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  model_predicted_type_id INTEGER REFERENCES contamination_types(id) ON DELETE SET NULL,
  model_confidence        REAL,
  model_run_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_cam_lbl_report ON camera_contamination_labels(report_id);
CREATE INDEX IF NOT EXISTS idx_cam_lbl_type   ON camera_contamination_labels(contam_type_id);
CREATE INDEX IF NOT EXISTS idx_cam_lbl_clean  ON camera_contamination_labels(is_clean);

-- Automated contamination detections produced once the model is trained.
-- reviewed=0 means the operator hasn't confirmed or dismissed it yet.
CREATE TABLE IF NOT EXISTS camera_contamination_detections (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  detected_at    TEXT NOT NULL,
  measurement_id INTEGER NOT NULL REFERENCES camera_measurements(id) ON DELETE CASCADE,
  bag_id         TEXT NOT NULL REFERENCES bags(bag_id) ON DELETE CASCADE,
  contam_type_id INTEGER REFERENCES contamination_types(id) ON DELETE SET NULL,
  confidence     REAL NOT NULL,
  reviewed       INTEGER DEFAULT 0,
  confirmed      INTEGER,                -- 1=confirmed contam, 0=false positive
  reviewed_at    TEXT,
  reviewed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_cam_det_bag      ON camera_contamination_detections(bag_id);
CREATE INDEX IF NOT EXISTS idx_cam_det_time     ON camera_contamination_detections(detected_at);
CREATE INDEX IF NOT EXISTS idx_cam_det_reviewed ON camera_contamination_detections(reviewed);
"""


def connect(db_path: str) -> sqlite3.Connection:
    con = sqlite3.connect(db_path, timeout=10, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def ensure_schema(con: sqlite3.Connection) -> None:
    """Create camera tables if absent. Safe to call on every startup."""
    con.executescript(SCHEMA_SQL)
    con.commit()
    log.info("Camera schema ensured.")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Camera config helpers
# ---------------------------------------------------------------------------

def upsert_camera(con: sqlite3.Connection, name: str, rtsp_url: str, zone_id: str | None) -> int:
    """Insert or update a camera row; return the camera id."""
    row = con.execute("SELECT id FROM camera_cameras WHERE name=?", (name,)).fetchone()
    if row:
        con.execute(
            "UPDATE camera_cameras SET rtsp_url=?, zone_id=?, enabled=1 WHERE id=?",
            (rtsp_url, zone_id, row["id"]),
        )
        con.commit()
        return row["id"]
    cur = con.execute(
        "INSERT INTO camera_cameras(name, rtsp_url, zone_id, created) VALUES(?,?,?,?)",
        (name, rtsp_url, zone_id, _now()),
    )
    con.commit()
    return cur.lastrowid


# ---------------------------------------------------------------------------
# Measurement writes
# ---------------------------------------------------------------------------

def insert_measurement(
    con: sqlite3.Connection,
    *,
    camera_id: int,
    bag_id: str,
    batch_id: str | None,
    captured_at: str,
    cap_diameter_mm: float | None,
    cap_color_h: float | None,
    cap_color_s: float | None,
    cap_color_v: float | None,
    detection_conf: float | None,
    mushroom_count: int,
    frame_path: str | None = None,
    notes: str | None = None,
) -> int:
    cur = con.execute(
        """INSERT INTO camera_measurements
           (captured_at, camera_id, bag_id, batch_id,
            cap_diameter_mm, cap_color_h, cap_color_s, cap_color_v,
            detection_conf, mushroom_count, frame_path, notes)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            captured_at, camera_id, bag_id, batch_id,
            cap_diameter_mm, cap_color_h, cap_color_s, cap_color_v,
            detection_conf, mushroom_count, frame_path, notes,
        ),
    )
    con.commit()
    return cur.lastrowid


def get_recent_measurements(con: sqlite3.Connection, bag_id: str, n: int = 5) -> list:
    return con.execute(
        """SELECT * FROM camera_measurements
           WHERE bag_id=?
           ORDER BY captured_at DESC
           LIMIT ?""",
        (bag_id, n),
    ).fetchall()


# ---------------------------------------------------------------------------
# Pinning event writes
# ---------------------------------------------------------------------------

def insert_pinning_event(
    con: sqlite3.Connection,
    *,
    bag_id: str,
    batch_id: str | None,
    flush_number: int,
    detected_at: str,
    measurement_id: int | None = None,
    notes: str | None = None,
) -> int:
    cur = con.execute(
        """INSERT INTO camera_pinning_events
           (bag_id, batch_id, flush_number, detected_at, measurement_id, notes)
           VALUES(?,?,?,?,?,?)""",
        (bag_id, batch_id, flush_number, detected_at, measurement_id, notes),
    )
    con.commit()
    log.info("Pinning event recorded: bag=%s flush=%d at %s", bag_id, flush_number, detected_at)
    return cur.lastrowid


def confirm_pinning_event(con: sqlite3.Connection, event_id: int) -> None:
    con.execute(
        "UPDATE camera_pinning_events SET confirmed_at=? WHERE id=? AND confirmed_at IS NULL",
        (_now(), event_id),
    )
    con.commit()


def get_pending_pinning_event(con: sqlite3.Connection, bag_id: str) -> sqlite3.Row | None:
    """Return the most recent unconfirmed pinning event for a bag, or None."""
    return con.execute(
        """SELECT id FROM camera_pinning_events
           WHERE bag_id=? AND confirmed_at IS NULL
           ORDER BY detected_at DESC
           LIMIT 1""",
        (bag_id,),
    ).fetchone()


# ---------------------------------------------------------------------------
# Harvest flag writes
# ---------------------------------------------------------------------------

def insert_harvest_flag(
    con: sqlite3.Connection,
    *,
    bag_id: str,
    batch_id: str | None,
    flush_number: int,
    flagged_at: str,
    predicted_harvest_at: str | None = None,
    peak_diameter_mm: float | None = None,
) -> int:
    cur = con.execute(
        """INSERT INTO camera_harvest_flags
           (bag_id, batch_id, flush_number, flagged_at, predicted_harvest_at, peak_diameter_mm)
           VALUES(?,?,?,?,?,?)""",
        (bag_id, batch_id, flush_number, flagged_at, predicted_harvest_at, peak_diameter_mm),
    )
    con.commit()
    log.info("Harvest flag set: bag=%s flush=%d", bag_id, flush_number)
    return cur.lastrowid


def get_open_harvest_flag(con: sqlite3.Connection, bag_id: str) -> sqlite3.Row | None:
    return con.execute(
        """SELECT id FROM camera_harvest_flags
           WHERE bag_id=? AND resolved_at IS NULL
           ORDER BY flagged_at DESC
           LIMIT 1""",
        (bag_id,),
    ).fetchone()


def resolve_harvest_flag(con: sqlite3.Connection, bag_id: str, flush_number: int) -> None:
    """Mark the open harvest flag as resolved (called after actual harvest scan)."""
    con.execute(
        """UPDATE camera_harvest_flags
           SET resolved_at=?
           WHERE bag_id=? AND flush_number=? AND resolved_at IS NULL""",
        (_now(), bag_id, flush_number),
    )
    con.commit()


# ---------------------------------------------------------------------------
# Strain model (online learning)
# ---------------------------------------------------------------------------

def update_strain_model(con: sqlite3.Connection, strain_id: int, new_hours: float) -> None:
    """
    Update the rolling-average pin-to-harvest model for a strain using
    Welford's online algorithm so we never need to replay historical data.
    """
    row = con.execute(
        """SELECT sample_count, avg_pin_to_harvest_hours, stddev_hours
           FROM camera_strain_models
           WHERE strain_id=?""",
        (strain_id,),
    ).fetchone()
    if row is None:
        con.execute(
            """INSERT INTO camera_strain_models
               (strain_id, sample_count, avg_pin_to_harvest_hours, stddev_hours, updated_at)
               VALUES(?,1,?,0.0,?)""",
            (strain_id, new_hours, _now()),
        )
    else:
        n = row["sample_count"] + 1
        old_avg = row["avg_pin_to_harvest_hours"] or new_hours
        new_avg = old_avg + (new_hours - old_avg) / n
        new_std = ((row["stddev_hours"] or 0.0) * (n - 1) + abs(new_hours - new_avg)) / n
        con.execute(
            """UPDATE camera_strain_models
               SET sample_count=?, avg_pin_to_harvest_hours=?, stddev_hours=?, updated_at=?
               WHERE strain_id=?""",
            (n, new_avg, new_std, _now(), strain_id),
        )
    con.commit()


# ---------------------------------------------------------------------------
# Bag / barcode lookups
# ---------------------------------------------------------------------------

def lookup_bag_by_barcode(con: sqlite3.Connection, barcode: int) -> str | None:
    """Return bag_id for a numeric QR barcode, or None if not found."""
    row = con.execute(
        "SELECT entity_id FROM barcodes WHERE entity_type='bag' AND barcode=?",
        (barcode,),
    ).fetchone()
    return row["entity_id"] if row else None


def get_fruiting_bags(con: sqlite3.Connection) -> list:
    """
    Return all bags currently in a zone whose role='fruiting'.

    Current zone is determined by the last scan_log entry for each bag that
    has a non-NULL 'to' value — the same replay logic the Node.js app uses.
    """
    return con.execute(
        """
        SELECT b.bag_id, b.batch_id, ba.species, ba.strain, ba.strain_id
        FROM bags b
        JOIN batches ba ON b.batch_id = ba.batch_id
        WHERE (
            SELECT "to"
            FROM scan_log
            WHERE bag = b.bag_id
              AND "to" IS NOT NULL
            ORDER BY id DESC
            LIMIT 1
        ) IN (SELECT id FROM zones WHERE role = 'fruiting')
        """
    ).fetchall()


def current_flush_number(con: sqlite3.Connection, bag_id: str) -> int:
    """Estimate flush number as (number of harvests recorded for this bag) + 1."""
    row = con.execute(
        "SELECT COUNT(*) AS c FROM harvests WHERE bag=?",
        (bag_id,),
    ).fetchone()
    return (row["c"] if row else 0) + 1


# ---------------------------------------------------------------------------
# Notifications (write into the existing MeisterTracker notifications table)
# ---------------------------------------------------------------------------
# Incubation / colonisation helpers
# ---------------------------------------------------------------------------

def insert_incubation_snapshot(
    con: sqlite3.Connection,
    *,
    camera_id: int,
    bag_id: str,
    batch_id: str | None,
    captured_at: str,
    colonisation_frac: float,
    readiness_score: float,
    elapsed_days: float | None,
    expected_days: int | None,
    frame_path: str | None = None,
) -> int:
    cur = con.execute(
        """INSERT INTO camera_incubation_snapshots
           (captured_at, camera_id, bag_id, batch_id,
            colonisation_frac, readiness_score, elapsed_days, expected_days, frame_path)
           VALUES(?,?,?,?,?,?,?,?,?)""",
        (
            captured_at, camera_id, bag_id, batch_id,
            colonisation_frac, readiness_score, elapsed_days, expected_days, frame_path,
        ),
    )
    con.commit()
    return cur.lastrowid


def get_recent_incubation_snapshots(con: sqlite3.Connection, bag_id: str, n: int = 3) -> list:
    return con.execute(
        """SELECT * FROM camera_incubation_snapshots
           WHERE bag_id=?
           ORDER BY captured_at DESC
           LIMIT ?""",
        (bag_id, n),
    ).fetchall()


def get_open_fruiting_ready_flag(con: sqlite3.Connection, bag_id: str) -> sqlite3.Row | None:
    return con.execute(
        """SELECT id FROM camera_fruiting_ready_flags
           WHERE bag_id=? AND resolved_at IS NULL
           ORDER BY flagged_at DESC
           LIMIT 1""",
        (bag_id,),
    ).fetchone()


def insert_fruiting_ready_flag(
    con: sqlite3.Connection,
    *,
    bag_id: str,
    batch_id: str | None,
    flagged_at: str,
    peak_score: float | None = None,
) -> int:
    cur = con.execute(
        """INSERT INTO camera_fruiting_ready_flags
           (bag_id, batch_id, flagged_at, peak_score)
           VALUES(?,?,?,?)""",
        (bag_id, batch_id, flagged_at, peak_score),
    )
    con.commit()
    log.info("Fruiting-ready flag set: bag=%s", bag_id)
    return cur.lastrowid


def get_incubating_bags(con: sqlite3.Connection) -> list:
    """
    Return all bags currently in an incubation zone, with batch metadata
    needed for elapsed-days and expected-days calculation.
    """
    return con.execute(
        """
        SELECT b.bag_id, b.batch_id, ba.species, ba.strain, ba.strain_id,
               ba.created AS batch_created, ba.days AS expected_days
        FROM bags b
        JOIN batches ba ON b.batch_id = ba.batch_id
        WHERE (
            SELECT "to"
            FROM scan_log
            WHERE bag = b.bag_id
              AND "to" IS NOT NULL
            ORDER BY id DESC
            LIMIT 1
        ) IN (SELECT id FROM zones WHERE role = 'incubation')
        """
    ).fetchall()


# ---------------------------------------------------------------------------

def create_notification(
    con: sqlite3.Connection,
    *,
    user_id: int,
    type_: str,
    title: str,
    body: str | None = None,
    link_type: str | None = None,
    link_id: str | None = None,
) -> None:
    con.execute(
        """INSERT INTO notifications(user_id, type, title, body, link_type, link_id, created, read)
           VALUES(?,?,?,?,?,?,?,0)""",
        (user_id, type_, title, body, link_type, link_id, _now()),
    )
    con.commit()


# ---------------------------------------------------------------------------
# Camera visibility / occlusion tracking
# ---------------------------------------------------------------------------

def get_unseen_bags(con: sqlite3.Connection, role: str, hours: int = 24) -> list:
    """
    Return bags in zones of the given role that haven't appeared in any camera
    frame for more than `hours` hours.  These are likely occluded by other bags
    and need a physical check.
    """
    return con.execute(
        """
        SELECT b.bag_id, b.batch_id, ba.species,
               MAX(cm.captured_at) AS last_seen_at
        FROM bags b
        JOIN batches ba ON b.batch_id = ba.batch_id
        LEFT JOIN camera_measurements cm ON cm.bag_id = b.bag_id
        WHERE (
            SELECT "to"
            FROM scan_log
            WHERE bag = b.bag_id AND "to" IS NOT NULL
            ORDER BY id DESC LIMIT 1
        ) IN (SELECT id FROM zones WHERE role = ?)
        GROUP BY b.bag_id
        HAVING last_seen_at IS NULL
           OR last_seen_at < datetime('now', ? || ' hours')
        ORDER BY last_seen_at ASC NULLS FIRST
        """,
        (role, f"-{hours}"),
    ).fetchall()


def insert_contamination_detection(
    con: sqlite3.Connection,
    *,
    detected_at: str,
    measurement_id: int,
    bag_id: str,
    contam_type_id: int | None,
    confidence: float,
) -> int:
    cur = con.execute(
        """INSERT INTO camera_contamination_detections
           (detected_at, measurement_id, bag_id, contam_type_id, confidence)
           VALUES(?,?,?,?,?)""",
        (detected_at, measurement_id, bag_id, contam_type_id, confidence),
    )
    con.commit()
    return cur.lastrowid


# ---------------------------------------------------------------------------
# Admin user helpers
# ---------------------------------------------------------------------------

def get_admin_user_ids(con: sqlite3.Connection) -> list[int]:
    """Return IDs of all users with role='admin'."""
    rows = con.execute("SELECT id FROM users WHERE role='admin'").fetchall()
    return [row["id"] for row in rows]


def notify_admins(
    con: sqlite3.Connection,
    *,
    type_: str,
    title: str,
    body: str | None = None,
    link_type: str | None = None,
    link_id: str | None = None,
) -> None:
    """Send a notification to every admin user and no one else."""
    admin_ids = get_admin_user_ids(con)
    if not admin_ids:
        log.warning("notify_admins: no admin users found in users table.")
        return
    for uid in admin_ids:
        create_notification(
            con,
            user_id=uid,
            type_=type_,
            title=title,
            body=body,
            link_type=link_type,
            link_id=link_id,
        )
