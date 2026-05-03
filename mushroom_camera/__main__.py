"""
Entry point: python -m mushroom_camera [--now]

  --now   Run one cycle immediately and exit (good for cron).
  (none)  Start the APScheduler daemon that runs every hour.
"""
import argparse
import logging
import sys

from . import config as cfg
from . import db as camdb
from .pipeline import run_cycle
from .scheduler import run as run_scheduler


def main() -> None:
    parser = argparse.ArgumentParser(description="MeisterTracker camera module")
    parser.add_argument(
        "--now",
        action="store_true",
        help="Run one measurement cycle immediately and exit.",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    if args.now:
        con = camdb.connect(cfg.DB_PATH)
        camdb.ensure_schema(con)
        run_cycle(con)
        sys.exit(0)
    else:
        run_scheduler()


main()
