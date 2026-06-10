import logging
from datetime import datetime
from pathlib import Path

from aiohttp import web


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
LOGGER = logging.getLogger("ctf_dashboard.server.app")

STATE = {
    "passed_count": 0,
    "connections": [
        # {
        #     "user": "example-01",
        #     "address": "127.0.0.1:54001",
        #     "status": "connected",
        #     "connected_at": "2026-06-08 18:00:00",
        # },
    ],
}


def build_payload() -> dict:
    return {
        "passed_count": STATE["passed_count"],
        "connections": STATE["connections"],
        "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


async def index(_request: web.Request) -> web.FileResponse:
    LOGGER.info("Serving dashboard index page.")
    return web.FileResponse(STATIC_DIR / "index.html")


async def api_status(_request: web.Request) -> web.Response:
    return web.json_response(build_payload())


def create_app() -> web.Application:
    LOGGER.info("Creating aiohttp application. static_dir=%s", STATIC_DIR)
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/api/status", api_status)
    app.router.add_static("/static/", path=STATIC_DIR)
    return app
