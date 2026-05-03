"""
Entry point: python -m mushroom_camera [options]

  (none)            Start the APScheduler daemon (runs every hour).
  --now             Run one cycle immediately and exit (good for cron).
  --export-dataset  Export all labelled frames as a YOLO classification
                    dataset, print class counts, and exit.
  --label-stats     Print current label counts per contamination class.
"""
import argparse
import logging
import sys

from . import config as cfg
from . import db as camdb
from . import labeller
from .pipeline import run_cycle
from .scheduler import run as run_scheduler


def main() -> None:
    parser = argparse.ArgumentParser(description="MeisterTracker camera module")
    parser.add_argument("--now", action="store_true",
                        help="Run one measurement cycle immediately and exit.")
    parser.add_argument("--export-dataset", metavar="OUTPUT_DIR",
                        help="Export labelled frames as YOLO classification dataset.")
    parser.add_argument("--label-stats", action="store_true",
                        help="Print contamination label counts and exit.")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    con = camdb.connect(cfg.DB_PATH)
    camdb.ensure_schema(con)

    if args.label_stats:
        stats = labeller.label_stats(con)
        if not stats:
            print("No labels yet.  Log some contamination reports in MeisterTracker first.")
        else:
            total = sum(stats.values())
            print(f"Label dataset ({total} total):")
            for cls, n in sorted(stats.items(), key=lambda x: -x[1]):
                print(f"  {cls:<30} {n:>5}")
        sys.exit(0)

    if args.export_dataset:
        counts = labeller.export_yolo_dataset(con, args.export_dataset)
        if counts:
            print(f"Dataset written to {args.export_dataset}")
            for cls, n in sorted(counts.items(), key=lambda x: -x[1]):
                print(f"  {cls:<30} {n:>5}")
        sys.exit(0)

    if args.now:
        run_cycle(con)
        sys.exit(0)

    run_scheduler()


main()
