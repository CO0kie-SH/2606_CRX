import logging
import os
import sys
from pathlib import Path


LOG_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"


def init_logging(level: int = logging.INFO) -> logging.Logger:
    logging.basicConfig(level=level, format=LOG_FORMAT, force=True)
    logger = logging.getLogger("ctf_dashboard")
    logger.info("Logger initialized.")
    logger.info("Current working directory: %s", os.getcwd())
    logger.info("Interpreter directory: %s", Path(sys.executable).parent)
    logger.info("Interpreter executable: %s", sys.executable)
    return logger


if __name__ == "__main__":
    logger = init_logging()
    try:
        from server.runner import run

        logger.info("Imported server.runner successfully.")
        run()
    except Exception:
        logger.exception("Application startup failed.")
        raise
