import logging
import random
import secrets
import json
import csv
import re
from datetime import datetime
from datetime import timezone
import importlib.util
from pathlib import Path

from aiohttp import web


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
LOG_DIR = BASE_DIR / "log"
DB_DIR = BASE_DIR / "db"
VISA_CARD_GEN_PATH = BASE_DIR / "visa_card_gen.py"
LOGGER = logging.getLogger("ctf_dashboard.server.app")
TOKEN_PATTERN = re.compile(r"^crx-[0-9a-fA-F]{32}$")
TOKEN_CSV_HEADERS = [
    "status",
    "created_at",
    "user_agent",
    "remote",
    "token",
    "extension_version",
    "extension_version_name",
    "window_snapshot_json",
]

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


def utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


async def index(_request: web.Request) -> web.FileResponse:
    LOGGER.info("Serving dashboard index page.")
    return web.FileResponse(STATIC_DIR / "index.html")


async def api_status(_request: web.Request) -> web.Response:
    return web.json_response(build_payload())


def build_log_file_path() -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    return LOG_DIR / f"{datetime.now().strftime('%Y-%m-%d')}.jsonl"


def append_jsonl_log(payload: dict) -> Path:
    log_file = build_log_file_path()
    with log_file.open("a", encoding="utf-8") as fp:
        fp.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return log_file


def build_named_log_file_path(prefix: str) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    return LOG_DIR / f"{prefix}-{datetime.now().strftime('%Y-%m-%d')}.jsonl"


def append_named_jsonl_log(prefix: str, payload: dict) -> Path:
    log_file = build_named_log_file_path(prefix)
    with log_file.open("a", encoding="utf-8") as fp:
        fp.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return log_file


def build_ctf_card_params() -> dict:
    now = datetime.now()
    month = f"{random.randint(1, 12):02d}"
    year = str((now.year + random.randint(2, 5)) % 100).zfill(2)
    suffix = f"{random.randint(0, 9999):04d}"
    marker = secrets.token_hex(2).upper()

    return {
        "challenge_id": f"ctf-visa-{now.strftime('%Y%m%d-%H%M%S')}-{marker}",
        "source_file": VISA_CARD_GEN_PATH.name,
        "mode": "ctf-safe-nonpayment",
        "number": f"4147-{marker}-CTF-{suffix}",
        "expiry": f"{month} / {year}",
        "cvv": f"X{random.randint(10, 99)}",
        "notes": [
            "This payload follows the field shape from visa_card_gen.py.",
            "The generated values are intentionally non-payment and non-Luhn.",
            "Use these as CTF challenge parameters or display fixtures only.",
        ],
    }


def generate_visa_card_payload() -> dict:
    spec = importlib.util.spec_from_file_location("visa_card_gen_module", VISA_CARD_GEN_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module from {VISA_CARD_GEN_PATH}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    if not hasattr(module, "generate_visa_card"):
        raise RuntimeError("visa_card_gen.py does not export generate_visa_card()")

    card = module.generate_visa_card()
    marker = secrets.token_hex(2).upper()
    now = datetime.now()

    return {
        "challenge_id": f"visa-question-{now.strftime('%Y%m%d-%H%M%S')}-{marker}",
        "title": "Visa 卡号识别题",
        "prompt": "请使用下面生成的 Visa 测试卡数据作为题目进行后续校验或展示。",
        "source_file": VISA_CARD_GEN_PATH.name,
        "mode": "ctf-visa-question",
        "number": card.get("number", ""),
        "expiry": card.get("expiry", ""),
        "cvv": card.get("cvv", ""),
        "notes": [
            "该数据由 visa_card_gen.py 动态生成。",
            "卡号以 4 开头，并按当前生成器逻辑通过 Luhn 校验。",
            "仅用于本地 CTF / 测试题面，不应接入真实支付场景。",
        ],
    }


def build_visa_api_payload() -> dict:
    payload = generate_visa_card_payload()
    number = str(payload.get("number", "")).replace(" ", "")
    digits = [int(ch) for ch in number if ch.isdigit()]

    return {
        "ok": True,
        "challenge_id": payload["challenge_id"],
        "issued_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "title": payload["title"],
        "prompt": payload["prompt"],
        "visa": {
            "number": payload["number"],
            "expiry": payload["expiry"],
            "cvv": payload["cvv"],
        },
        "features": {
            "prefix": number[:4],
            "last4": number[-4:],
            "length": len(number),
            "digit_sum": sum(digits),
            "luhn_valid": True,
        },
        "key_material": {
            "challenge_id_suffix": payload["challenge_id"].split("-")[-1],
            "number_tail": number[-8:],
            "expiry_compact": payload["expiry"].replace(" ", "").replace("/", ""),
            "cvv": payload["cvv"],
        },
        "notes": [
            "每次 GET /api/visa 都会随机生成一组新的 Visa 测试数据。",
            "key_material 字段可直接用于你后续自定义的比赛答案 key 计算逻辑。",
            "当前卡号来自 visa_card_gen.py，并按现有生成逻辑通过 Luhn 校验。",
        ],
    }


async def api_tool_visa_card_params(_request: web.Request) -> web.Response:
    if not VISA_CARD_GEN_PATH.exists():
        LOGGER.warning("visa_card_gen.py not found. path=%s", VISA_CARD_GEN_PATH)
        return web.json_response(
            {
                "ok": False,
                "error": "visa_card_gen.py not found."
            },
            status=404,
        )

    LOGGER.info("Serving Visa card challenge payload generated from visa_card_gen.py.")
    return web.json_response(
        {
            "ok": True,
            "generator": VISA_CARD_GEN_PATH.name,
            "payload": generate_visa_card_payload(),
        }
    )


async def api_visa(_request: web.Request) -> web.Response:
    if not VISA_CARD_GEN_PATH.exists():
        LOGGER.warning("visa_card_gen.py not found. path=%s", VISA_CARD_GEN_PATH)
        return web.json_response(
            {
                "ok": False,
                "error": "visa_card_gen.py not found."
            },
            status=404,
        )

    LOGGER.info("Serving random Visa challenge data via /api/visa.")
    return web.json_response(build_visa_api_payload())


async def api_get_crc_token(_request: web.Request) -> web.Response:
    token = f"crx-{secrets.token_hex(16)}"
    return json_response_with_cors(
        {
            "ok": True,
            "token": token,
            "issued_at": utc_iso_now(),
        }
    )


def build_token_csv_path(token: str) -> Path:
    return DB_DIR / f"{token}.csv"


def build_token_dir_path(token: str) -> Path:
    return DB_DIR / token


def display_token_csv_path(csv_file: Path) -> str:
    try:
        return csv_file.relative_to(BASE_DIR).as_posix()
    except ValueError:
        return str(csv_file)


def is_valid_token(token: str) -> bool:
    return bool(TOKEN_PATTERN.fullmatch(token))


async def api_token_create(request: web.Request) -> web.Response:
    if request.content_type != "application/json":
        return json_response_with_cors(
            {
                "ok": False,
                "error": "Content-Type must be application/json."
            },
            status=415,
        )

    try:
        payload = await request.json()
    except json.JSONDecodeError:
        return json_response_with_cors(
            {
                "ok": False,
                "error": "Invalid JSON body."
            },
            status=400,
        )

    if not isinstance(payload, dict):
        return json_response_with_cors(
            {
                "ok": False,
                "error": "JSON body must be an object."
            },
            status=400,
        )

    token = str(payload.get("token", "")).strip()
    if not is_valid_token(token):
        return json_response_with_cors(
            {
                "ok": False,
                "error": "Token already exists or invalid.",
                "token": token,
            },
            status=400,
        )

    tabs = payload.get("tabs")
    if not isinstance(tabs, list):
        return json_response_with_cors(
            {
                "ok": False,
                "error": "tabs must be an array.",
                "token": token,
            },
            status=400,
        )

    DB_DIR.mkdir(parents=True, exist_ok=True)
    csv_file = build_token_csv_path(token)
    if csv_file.exists():
        return json_response_with_cors(
            {
                "ok": False,
                "error": "Token already exists or invalid.",
                "token": token,
            },
            status=400,
        )

    created_at = payload.get("time") if isinstance(payload.get("time"), str) and payload.get("time") else utc_iso_now()
    extension_version = str(payload.get("extension_version", ""))
    extension_version_name = str(payload.get("extension_version_name", ""))
    window_snapshot_json = json.dumps(tabs, ensure_ascii=False, separators=(",", ":"))
    row = [
        "登录成功",
        created_at,
        request.headers.get("User-Agent", ""),
        request.remote or "",
        token,
        extension_version,
        extension_version_name,
        window_snapshot_json,
    ]

    try:
        with csv_file.open("x", newline="", encoding="utf-8") as fp:
            writer = csv.writer(fp)
            writer.writerow(TOKEN_CSV_HEADERS)
            writer.writerow(row)
        build_token_dir_path(token).mkdir(parents=True, exist_ok=False)
    except FileExistsError:
        return json_response_with_cors(
            {
                "ok": False,
                "error": "Token already exists or invalid.",
                "token": token,
            },
            status=400,
        )

    LOGGER.info("Created token CSV. token=%s file=%s tabs=%s", token, csv_file, len(tabs))
    return json_response_with_cors(
        {
            "ok": True,
            "token": token,
            "saved_to": display_token_csv_path(csv_file),
            "folder": display_token_csv_path(build_token_dir_path(token)),
        }
    )


async def api_log(request: web.Request) -> web.Response:
    if request.content_type != "application/json":
        return json_response_with_cors(
            {
                "ok": False,
                "error": "Content-Type must be application/json."
            },
            status=415,
        )

    try:
        payload = await request.json()
    except json.JSONDecodeError:
        return json_response_with_cors(
            {
                "ok": False,
                "error": "Invalid JSON body."
            },
            status=400,
        )

    if not isinstance(payload, dict):
        return json_response_with_cors(
            {
                "ok": False,
                "error": "JSON body must be an object."
            },
            status=400,
        )

    required_fields = [
        "event_name",
        "time",
        "extension_version",
        "logger_build",
        "backend_base_url",
        "details",
    ]
    missing_fields = [field for field in required_fields if field not in payload]
    if missing_fields:
        return json_response_with_cors(
            {
                "ok": False,
                "error": f"Missing required fields: {', '.join(missing_fields)}"
            },
            status=400,
        )

    if not isinstance(payload.get("details"), dict):
        return json_response_with_cors(
            {
                "ok": False,
                "error": "details must be an object."
            },
            status=400,
        )

    received_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    enriched_payload = {
        **payload,
        "received_at": received_at,
        "remote": request.remote or "",
        "user_agent": request.headers.get("User-Agent", ""),
    }

    log_file = append_jsonl_log(enriched_payload)
    LOGGER.info(
        "Saved extension log. event_name=%s file=%s",
        payload.get("event_name", ""),
        log_file,
    )
    return json_response_with_cors(
        {
            "ok": True,
            "saved_to": str(log_file),
            "received_at": received_at,
        }
    )


def sanitize_capture_time(raw_time: str) -> str:
    value = raw_time if isinstance(raw_time, str) and raw_time.strip() else utc_iso_now()
    value = value.strip()
    return re.sub(r"[^0-9A-Za-z._-]+", "-", value)


def display_path(path: Path) -> str:
    try:
        return path.relative_to(BASE_DIR).as_posix()
    except ValueError:
        return str(path)


async def save_html_file_capture(payload: dict, content: str, request: web.Request) -> web.Response:
    token = str(payload.get("token", "")).strip()
    if not is_valid_token(token):
        return json_response_with_cors(
            {
                "ok": False,
                "error": "Valid token is required.",
                "token": token,
            },
            status=400,
        )

    token_dir = build_token_dir_path(token)
    if not token_dir.exists() or not token_dir.is_dir():
        return json_response_with_cors(
            {
                "ok": False,
                "error": "Token folder not found.",
                "token": token,
            },
            status=404,
        )

    capture_time = payload.get("time") if isinstance(payload.get("time"), str) else ""
    html_file = token_dir / f"{sanitize_capture_time(capture_time)}.html"
    if html_file.exists():
        suffix = secrets.token_hex(2)
        html_file = token_dir / f"{sanitize_capture_time(capture_time)}-{suffix}.html"

    html_file.write_text(content, encoding="utf-8")
    LOGGER.info(
        "Saved HTML file capture. token=%s file=%s bytes=%s",
        token,
        html_file,
        len(content.encode("utf-8")),
    )
    return json_response_with_cors(
        {
            "ok": True,
            "saved_to": display_path(html_file),
            "received_at": utc_iso_now(),
            "bytes": len(content.encode("utf-8")),
            "token": token,
            "user_agent": request.headers.get("User-Agent", ""),
        }
    )


async def api_html_capture(request: web.Request, capture_type: str) -> web.Response:
    if request.content_type != "application/json":
        return json_response_with_cors(
            {
                "ok": False,
                "error": "Content-Type must be application/json."
            },
            status=415,
        )

    try:
        payload = await request.json()
    except json.JSONDecodeError:
        return json_response_with_cors(
            {
                "ok": False,
                "error": "Invalid JSON body."
            },
            status=400,
        )

    if not isinstance(payload, dict):
        return json_response_with_cors(
            {
                "ok": False,
                "error": "JSON body must be an object."
            },
            status=400,
        )

    content_field = "text" if capture_type == "text" else "html"
    content = payload.get(content_field)
    if not isinstance(content, str):
        return json_response_with_cors(
            {
                "ok": False,
                "error": f"{content_field} must be a string."
            },
            status=400,
        )

    if capture_type == "all":
        return await save_html_file_capture(payload, content, request)

    enriched_payload = {
        "event_name": f"html_{capture_type}_captured",
        "capture_type": capture_type,
        "received_at": utc_iso_now(),
        "remote": request.remote or "",
        "user_agent": request.headers.get("User-Agent", ""),
        **payload,
    }
    log_file = append_named_jsonl_log(f"html-{capture_type}", enriched_payload)
    LOGGER.info(
        "Saved HTML capture. type=%s file=%s bytes=%s",
        capture_type,
        log_file,
        len(content.encode("utf-8")),
    )
    return json_response_with_cors(
        {
            "ok": True,
            "saved_to": str(log_file),
            "received_at": enriched_payload["received_at"],
            "bytes": len(content.encode("utf-8")),
        }
    )


async def api_html_text(request: web.Request) -> web.Response:
    return await api_html_capture(request, "text")


async def api_html_all(request: web.Request) -> web.Response:
    return await api_html_capture(request, "all")


def json_response_with_cors(data: dict, status: int = 200) -> web.Response:
    response = web.json_response(data, status=status)
    add_cors_headers(response)
    return response


def add_cors_headers(response: web.StreamResponse) -> None:
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Private-Network"] = "true"


async def api_log_options(_request: web.Request) -> web.Response:
    response = web.Response(status=204)
    add_cors_headers(response)
    return response


def create_app() -> web.Application:
    LOGGER.info("Creating aiohttp application. static_dir=%s", STATIC_DIR)
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/api/status", api_status)
    app.router.add_get("/api/visa", api_visa)
    app.router.add_options("/api/get_crc_token", api_log_options)
    app.router.add_get("/api/get_crc_token", api_get_crc_token)
    app.router.add_options("/api/token/create", api_log_options)
    app.router.add_post("/api/token/create", api_token_create)
    app.router.add_options("/api/html/text", api_log_options)
    app.router.add_post("/api/html/text", api_html_text)
    app.router.add_options("/api/html/all", api_log_options)
    app.router.add_post("/api/html/all", api_html_all)
    app.router.add_options("/api/log", api_log_options)
    app.router.add_post("/api/log", api_log)
    app.router.add_options("/api/report", api_log_options)
    app.router.add_post("/api/report", api_log)
    app.router.add_get("/api/tools/visa-card-gen/params", api_tool_visa_card_params)
    app.router.add_static("/static/", path=STATIC_DIR)
    return app
