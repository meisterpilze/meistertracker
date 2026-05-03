"""
APScheduler-based runner for the hourly camera pipeline.

run() blocks until SIGTERM or SIGINT.
"""
import logging
import signal
import sys

from apscheduler.schedulers.blocking import BlockingScheduler

from . import config as cfg
from . import db as camdb
from .pipeline import run_cycle

log = logging.getLogger(__name__)


def run() -> None:
    con = camdb.connect(cfg.DB_PATH)
    camdb.ensure_schema(con)

    def job():
        try:
            run_cycle(con)
        except Exception:
            log.exception("Camera cycle failed — will retry next hour.")

    scheduler = BlockingScheduler(timezone="UTC")
    scheduler.add_job(job, "interval", hours=1, id="camera_cycle")

    def _shutdown(sig, frame):
        log.info("Shutdown requested — stopping scheduler.")
        scheduler.shutdown(wait=False)
        sys.exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    log.info(
        "Camera scheduler started.  Next run in 1 hour.  "
        "Use 'python -m mushroom_camera --now' to run immediately."
    )
    scheduler.start()
