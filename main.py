import logging
import os
import sys
from datetime import datetime
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
LOG_DIR = BASE_DIR / "log"
LOG_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"


def init_logging(level: int = logging.INFO) -> logging.Logger:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOG_DIR / f"runtime-{datetime.now().strftime('%Y-%m-%d')}.log"
    formatter = logging.Formatter(LOG_FORMAT)
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(formatter)
    logging.basicConfig(
        level=level,
        handlers=[console_handler, file_handler],
        force=True,
    )
    logger = logging.getLogger("ctf_dashboard")
    logger.info("Logger initialized.")
    logger.info("Runtime log file: %s", log_file)
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
