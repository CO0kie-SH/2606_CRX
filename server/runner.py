import argparse
import logging
import os

from aiohttp import web

from .app import create_app


LOGGER = logging.getLogger("ctf_dashboard.server.runner")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the aiohttp CTF dashboard.")
    parser.add_argument("--host", default=os.getenv("APP_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("APP_PORT", "8080")))
    return parser.parse_args()


def run() -> None:
    args = parse_args()
    LOGGER.info("Starting aiohttp server on http://%s:%s", args.host, args.port)
    web.run_app(create_app(), host=args.host, port=args.port)
