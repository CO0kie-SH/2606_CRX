import logging
import secrets
import json
import csv
import re
import asyncio
import os
from datetime import datetime
from datetime import timezone
import importlib.util
from pathlib import Path

from aiohttp import web


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
LOG_DIR = BASE_DIR / "log"
DB_DIR = BASE_DIR / "db"
CTF_TOOLKIT_PATH = BASE_DIR / "ctf_toolkit.py"
DEFAULT_ADDRESS_PROXY = os.getenv("CTF_ADDRESS_PROXY", "127.0.0.1:7897")
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


async def api_get_crc_token(request: web.Request) -> web.Response:
    if request.content_type == "application/json":
        try:
            payload = await request.json()
            if is_jsonrpc_request(payload):
                token = f"crx-{secrets.token_hex(16)}"
                result = {
                    "ok": True,
                    "token": token,
                    "issued_at": utc_iso_now(),
                }
                return json_response_with_cors(build_jsonrpc_response(result, payload.get("id")))
        except json.JSONDecodeError:
            pass

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

    if is_jsonrpc_request(payload):
        rpc_id = payload.get("id")
        params = payload.get("params")

        if not isinstance(params, dict):
            return json_response_with_cors(
                build_jsonrpc_error(-32602, "Invalid params: must be an object.", rpc_id),
                status=400
            )

        token = str(params.get("token", "")).strip()
        tabs = params.get("tabs")
    else:
        token = str(payload.get("token", "")).strip()
        tabs = payload.get("tabs")
        rpc_id = None

    if not is_valid_token(token):
        error_response = {
            "ok": False,
            "error": "Token already exists or invalid.",
            "token": token,
        }
        if rpc_id is not None:
            return json_response_with_cors(
                build_jsonrpc_error(-32602, "Token already exists or invalid.", rpc_id),
                status=400
            )
        return json_response_with_cors(error_response, status=400)

    if not isinstance(tabs, list):
        error_response = {
            "ok": False,
            "error": "tabs must be an array.",
            "token": token,
        }
        if rpc_id is not None:
            return json_response_with_cors(
                build_jsonrpc_error(-32602, "tabs must be an array.", rpc_id),
                status=400
            )
        return json_response_with_cors(error_response, status=400)

    DB_DIR.mkdir(parents=True, exist_ok=True)
    csv_file = build_token_csv_path(token)
    if csv_file.exists():
        error_response = {
            "ok": False,
            "error": "Token already exists or invalid.",
            "token": token,
        }
        if rpc_id is not None:
            return json_response_with_cors(
                build_jsonrpc_error(-32602, "Token already exists or invalid.", rpc_id),
                status=400
            )
        return json_response_with_cors(error_response, status=400)

    params_or_payload = payload.get("params") if rpc_id is not None else payload
    created_at = params_or_payload.get("time") if isinstance(params_or_payload.get("time"), str) and params_or_payload.get("time") else utc_iso_now()
    extension_version = str(params_or_payload.get("extension_version", ""))
    extension_version_name = str(params_or_payload.get("extension_version_name", ""))
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
        error_response = {
            "ok": False,
            "error": "Token already exists or invalid.",
            "token": token,
        }
        if rpc_id is not None:
            return json_response_with_cors(
                build_jsonrpc_error(-32602, "Token already exists or invalid.", rpc_id),
                status=400
            )
        return json_response_with_cors(error_response, status=400)

    LOGGER.info("Created token CSV. token=%s file=%s tabs=%s", token, csv_file, len(tabs))

    result = {
        "ok": True,
        "token": token,
        "saved_to": display_token_csv_path(csv_file),
        "folder": display_token_csv_path(build_token_dir_path(token)),
    }

    if rpc_id is not None:
        return json_response_with_cors(build_jsonrpc_response(result, rpc_id))

    return json_response_with_cors(result)


async def api_at_save(request: web.Request) -> web.Response:
    """
    保存 AccessToken 到 db/crx-xxx/at-YYYY-MM-DD.csv
    """
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

    if is_jsonrpc_request(payload):
        rpc_id = payload.get("id")
        params = payload.get("params")

        if not isinstance(params, dict):
            return json_response_with_cors(
                build_jsonrpc_error(-32602, "Invalid params: must be an object.", rpc_id),
                status=400
            )

        token = str(params.get("token", "")).strip()
        user = str(params.get("user", "")).strip()
        access_token = str(params.get("accessToken", "")).strip()
        time_str = params.get("time")
    else:
        token = str(payload.get("token", "")).strip()
        user = str(payload.get("user", "")).strip()
        access_token = str(payload.get("accessToken", "")).strip()
        time_str = payload.get("time")
        rpc_id = None

    if not is_valid_token(token):
        error_response = {
            "ok": False,
            "error": "Invalid token format.",
            "token": token,
        }
        if rpc_id is not None:
            return json_response_with_cors(
                build_jsonrpc_error(-32602, "Invalid token format.", rpc_id),
                status=400
            )
        return json_response_with_cors(error_response, status=400)

    if not access_token:
        error_response = {
            "ok": False,
            "error": "accessToken is required.",
        }
        if rpc_id is not None:
            return json_response_with_cors(
                build_jsonrpc_error(-32602, "accessToken is required.", rpc_id),
                status=400
            )
        return json_response_with_cors(error_response, status=400)

    token_dir = build_token_dir_path(token)
    if not token_dir.exists():
        error_response = {
            "ok": False,
            "error": f"Token directory does not exist: {token}",
            "token": token,
        }
        if rpc_id is not None:
            return json_response_with_cors(
                build_jsonrpc_error(-32602, f"Token directory does not exist: {token}", rpc_id),
                status=400
            )
        return json_response_with_cors(error_response, status=400)

    # 构建 CSV 文件路径: db/crx-xxx/at-YYYY-MM-DD.csv
    today_str = datetime.now().strftime("%Y-%m-%d")
    at_csv_file = token_dir / f"at-{today_str}.csv"

    created_at = time_str if isinstance(time_str, str) and time_str else utc_iso_now()

    # CSV 表头
    at_csv_headers = ["time", "user", "accessToken"]

    # 写入或追加 CSV
    file_exists = at_csv_file.exists()
    try:
        with at_csv_file.open("a", newline="", encoding="utf-8") as fp:
            writer = csv.writer(fp)
            if not file_exists:
                writer.writerow(at_csv_headers)
            writer.writerow([created_at, user, access_token])
    except Exception as e:
        error_response = {
            "ok": False,
            "error": f"Failed to write AT CSV: {str(e)}",
        }
        if rpc_id is not None:
            return json_response_with_cors(
                build_jsonrpc_error(-32000, f"Failed to write AT CSV: {str(e)}", rpc_id),
                status=500
            )
        return json_response_with_cors(error_response, status=500)

    LOGGER.info("Saved AccessToken. token=%s user=%s file=%s", token, user, at_csv_file)

    result = {
        "ok": True,
        "token": token,
        "user": user,
        "saved_to": display_token_csv_path(at_csv_file),
    }

    if rpc_id is not None:
        return json_response_with_cors(build_jsonrpc_response(result, rpc_id))

    return json_response_with_cors(result)


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


def build_jsonrpc_response(result: dict, rpc_id: int) -> dict:
    return {
        "jsonrpc": "2.0",
        "result": result,
        "id": rpc_id
    }


def build_jsonrpc_error(code: int, message: str, rpc_id: int = None) -> dict:
    return {
        "jsonrpc": "2.0",
        "error": {
            "code": code,
            "message": message
        },
        "id": rpc_id
    }


def is_jsonrpc_request(payload: dict) -> bool:
    return payload.get("jsonrpc") == "2.0" and "method" in payload and "id" in payload


def extract_city_from_text(text: str) -> dict | None:
    """
    从页面文本中提取 city 和 region name 信息。
    支持 ipinfo.dkly.net 的 JSON 片段，也兼容 mayips 这类普通文本标签。
    """
    if not isinstance(text, str) or not text.strip():
        return None

    pattern = r'"name":\s*"([^"]+)"\s*\}\s*,\s*"city":\s*"([^"]+)"'
    match = re.search(pattern, text, re.IGNORECASE)

    if match:
        return {
            "region_name": match.group(1),
            "city": match.group(2),
            "country": extract_country_from_text(text),
        }

    json_country = extract_country_from_text(text)
    json_city = extract_first_regex_value(
        text,
        [
            r'"city"\s*:\s*"([^"]+)"',
            r'"cityName"\s*:\s*"([^"]+)"',
        ],
    )
    json_region = extract_first_regex_value(
        text,
        [
            r'"region_name"\s*:\s*"([^"]+)"',
            r'"regionName"\s*:\s*"([^"]+)"',
            r'"region"\s*:\s*"([^"]+)"',
            r'"state"\s*:\s*"([^"]+)"',
            r'"province"\s*:\s*"([^"]+)"',
        ],
    )
    if json_city:
        return {
            "region_name": json_region,
            "city": json_city,
            "country": json_country,
        }

    label_country = extract_labeled_text_value(
        text,
        ["country", "country code", "国家", "国家代码"]
    )
    label_city = extract_labeled_text_value(
        text,
        ["city", "city name", "城市", "市区"]
    )
    label_region = extract_labeled_text_value(
        text,
        ["region", "region name", "state", "province", "区域", "地区", "州", "省"]
    )
    if label_city:
        return {
            "region_name": label_region,
            "city": label_city,
            "country": label_country,
        }

    return None


def extract_country_from_text(text: str) -> str:
    return extract_first_regex_value(
        text,
        [
            r'"country"\s*:\s*"([^"]+)"',
            r'"countryCode"\s*:\s*"([^"]+)"',
            r'"country_code"\s*:\s*"([^"]+)"',
        ],
    )


def extract_first_regex_value(text: str, patterns: list[str]) -> str:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return normalize_extracted_location_value(match.group(1))

    return ""


def extract_labeled_text_value(text: str, labels: list[str]) -> str:
    sorted_labels = sorted(labels, key=len, reverse=True)
    normalized_lines = [
        re.sub(r"\s+", " ", line).strip()
        for line in text.splitlines()
    ]
    normalized_lines = [line for line in normalized_lines if line]

    for index, line in enumerate(normalized_lines):
        for label in sorted_labels:
            label_pattern = re.escape(label)
            inline_match = re.match(
                rf"^{label_pattern}(?:\s*[:：\-]\s*|\s+)(.+)$",
                line,
                re.IGNORECASE,
            )
            if inline_match:
                value = normalize_extracted_location_value(inline_match.group(1))
                if value and value.lower() != label.lower():
                    return value

            if line.lower() == label.lower() and index + 1 < len(normalized_lines):
                value = normalize_extracted_location_value(normalized_lines[index + 1])
                if value:
                    return value

    return ""


def normalize_extracted_location_value(value: str) -> str:
    cleaned = re.sub(r"<[^>]+>", " ", str(value or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" \t\r\n,;|")
    return cleaned[:128]


async def handle_jsonrpc_html_capture(request: web.Request, payload: dict, capture_type: str) -> web.Response:
    rpc_id = payload.get("id")
    params = payload.get("params")

    if not isinstance(params, dict):
        return json_response_with_cors(
            build_jsonrpc_error(-32602, "Invalid params: must be an object.", rpc_id),
            status=400
        )

    content_field = "text" if capture_type == "text" else "html"
    content = params.get(content_field)
    if not isinstance(content, str):
        return json_response_with_cors(
            build_jsonrpc_error(-32602, f"Invalid params: {content_field} must be a string.", rpc_id),
            status=400
        )

    if capture_type == "all":
        result = await save_html_file_capture_jsonrpc(params, content, request, rpc_id)
        return json_response_with_cors(build_jsonrpc_response(result, rpc_id))

    enriched_payload = {
        "event_name": f"html_{capture_type}_captured",
        "capture_type": capture_type,
        "received_at": utc_iso_now(),
        "remote": request.remote or "",
        "user_agent": request.headers.get("User-Agent", ""),
        "rpc_id": rpc_id,
        **params,
    }
    log_file = append_named_jsonl_log(f"html-{capture_type}", enriched_payload)
    LOGGER.info(
        "Saved HTML capture (JSON-RPC). type=%s file=%s bytes=%s rpc_id=%s",
        capture_type,
        log_file,
        len(content.encode("utf-8")),
        rpc_id,
    )

    result = {
        "ok": True,
        "saved_to": str(log_file),
        "received_at": enriched_payload["received_at"],
        "bytes": len(content.encode("utf-8")),
        "rpc_id": rpc_id,
    }

    city_info = extract_city_from_text(content)
    if city_info:
        result["city"] = city_info["city"]
        result["region_name"] = city_info["region_name"]
        result["country"] = city_info.get("country", "")
        LOGGER.info(
            "Extracted city info from text. rpc_id=%s country=%s city=%s region_name=%s",
            rpc_id,
            city_info.get("country", ""),
            city_info["city"],
            city_info["region_name"],
        )

    return json_response_with_cors(build_jsonrpc_response(result, rpc_id))


async def save_html_file_capture_jsonrpc(params: dict, content: str, request: web.Request, rpc_id: int) -> dict:
    token = str(params.get("token", "")).strip()
    if not is_valid_token(token):
        raise ValueError("Valid token is required.")

    token_dir = build_token_dir_path(token)
    if not token_dir.exists() or not token_dir.is_dir():
        raise ValueError("Token folder not found.")

    capture_time = params.get("time") if isinstance(params.get("time"), str) else ""
    html_file = token_dir / f"{sanitize_capture_time(capture_time)}.html"
    if html_file.exists():
        suffix = secrets.token_hex(2)
        html_file = token_dir / f"{sanitize_capture_time(capture_time)}-{suffix}.html"

    html_file.write_text(content, encoding="utf-8")
    LOGGER.info(
        "Saved HTML file capture (JSON-RPC). token=%s file=%s bytes=%s rpc_id=%s",
        token,
        html_file,
        len(content.encode("utf-8")),
        rpc_id,
    )

    return {
        "ok": True,
        "saved_to": display_path(html_file),
        "received_at": utc_iso_now(),
        "bytes": len(content.encode("utf-8")),
        "token": token,
        "rpc_id": rpc_id,
        "user_agent": request.headers.get("User-Agent", ""),
    }


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

    if is_jsonrpc_request(payload):
        return await handle_jsonrpc_html_capture(request, payload, capture_type)

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


def load_ctf_toolkit_module():
    if not CTF_TOOLKIT_PATH.exists():
        raise RuntimeError("ctf_toolkit.py not found.")

    spec = importlib.util.spec_from_file_location("ctf_toolkit_module", CTF_TOOLKIT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module from {CTF_TOOLKIT_PATH}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    if not hasattr(module, "AddressGenerator"):
        raise RuntimeError("ctf_toolkit.py does not export AddressGenerator.")
    if not hasattr(module, "LuhnCardGenerator"):
        raise RuntimeError("ctf_toolkit.py does not export LuhnCardGenerator.")
    if not hasattr(module, "JapaneseNameGenerator"):
        raise RuntimeError("ctf_toolkit.py does not export JapaneseNameGenerator.")

    return module


def sanitize_address_city(value: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z _.-]+", "", str(value or "")).strip()
    cleaned = re.sub(r"\s+", "-", cleaned)
    return cleaned[:64]


def generate_address_card_and_name_from_city(region_name: str, city: str, country: str = "JP") -> tuple[dict, dict, dict, str]:
    module = load_ctf_toolkit_module()
    proxy = DEFAULT_ADDRESS_PROXY or None
    address_generator = module.AddressGenerator(proxy=proxy, timeout=10)
    card_generator = module.LuhnCardGenerator()
    name_generator = module.JapaneseNameGenerator()
    normalized_country = str(country or "JP").upper()

    def attach_name(address: dict, name: dict) -> dict:
        address["full_name"] = name.get("kanjiFull", address.get("full_name", ""))
        address["name"] = name
        return address

    if normalized_country == "US":
        name = name_generator.generate()
        return attach_name(address_generator.us(), name), card_generator.generate(), name, ""

    preferred_city = sanitize_address_city(region_name) or sanitize_address_city(city)
    name = name_generator.generate()
    if preferred_city:
        return attach_name(address_generator.jp_hot(preferred_city), name), card_generator.generate(), name, preferred_city

    return attach_name(address_generator.jp(), name), card_generator.generate(), name, ""


def generate_japanese_names(name_type: str = "fullName", gender: str = "unisex", count: int = 1) -> list[dict]:
    module = load_ctf_toolkit_module()
    name_generator = module.JapaneseNameGenerator()

    if hasattr(name_generator, "generate_batch"):
        return name_generator.generate_batch(count=count, name_type=name_type, gender=gender)

    safe_count = min(50, max(1, int(count or 1)))
    return [name_generator.generate() for _ in range(safe_count)]


async def handle_jsonrpc_name_generate(request: web.Request, payload: dict) -> web.Response:
    rpc_id = payload.get("id")
    params = payload.get("params")

    if not isinstance(params, dict):
        return json_response_with_cors(
            build_jsonrpc_error(-32602, "Invalid params: must be an object.", rpc_id),
            status=400,
        )

    token = str(params.get("token", "")).strip()
    if not is_valid_token(token):
        return json_response_with_cors(
            build_jsonrpc_error(-32602, "Valid token is required.", rpc_id),
            status=400,
        )

    name_type = str(params.get("name_type", params.get("nameType", "fullName"))).strip() or "fullName"
    gender = str(params.get("gender", "unisex")).strip() or "unisex"

    try:
        count = int(params.get("count", 1) or 1)
    except (TypeError, ValueError):
        return json_response_with_cors(
            build_jsonrpc_error(-32602, "count must be an integer.", rpc_id),
            status=400,
        )

    try:
        names = await asyncio.to_thread(generate_japanese_names, name_type, gender, count)
    except Exception as error:
        LOGGER.exception("Name generation failed. name_type=%s gender=%s count=%s", name_type, gender, count)
        return json_response_with_cors(
            build_jsonrpc_error(-32000, f"Name generation failed: {error}", rpc_id),
            status=502,
        )

    primary_name = names[0] if names else {}
    enriched_payload = {
        "event_name": "name_generated",
        "received_at": utc_iso_now(),
        "remote": request.remote or "",
        "user_agent": request.headers.get("User-Agent", ""),
        "rpc_id": rpc_id,
        "token": token,
        "name_type": name_type,
        "gender": gender,
        "count": len(names),
        "name": primary_name,
        "names": names,
    }
    log_file = append_named_jsonl_log("name", enriched_payload)
    LOGGER.info(
        "Generated name. token=%s name_type=%s gender=%s count=%s file=%s",
        token,
        name_type,
        gender,
        len(names),
        log_file,
    )

    result = {
        "ok": True,
        "token": token,
        "name": primary_name,
        "names": names,
        "saved_to": display_path(log_file),
        "received_at": enriched_payload["received_at"],
        "rpc_id": rpc_id,
    }
    return json_response_with_cors(build_jsonrpc_response(result, rpc_id))


async def api_name_generate(request: web.Request) -> web.Response:
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

    if is_jsonrpc_request(payload):
        return await handle_jsonrpc_name_generate(request, payload)

    return json_response_with_cors(
        {
            "ok": False,
            "error": "JSON-RPC request is required."
        },
        status=400,
    )


async def handle_jsonrpc_address_from_city(request: web.Request, payload: dict) -> web.Response:
    rpc_id = payload.get("id")
    params = payload.get("params")

    if not isinstance(params, dict):
        return json_response_with_cors(
            build_jsonrpc_error(-32602, "Invalid params: must be an object.", rpc_id),
            status=400,
        )

    token = str(params.get("token", "")).strip()
    if not is_valid_token(token):
        return json_response_with_cors(
            build_jsonrpc_error(-32602, "Valid token is required.", rpc_id),
            status=400,
        )

    city = str(params.get("city", "")).strip()
    region_name = str(params.get("region_name", "")).strip()
    country = str(params.get("country", "JP")).strip() or "JP"

    if not city and not region_name:
        return json_response_with_cors(
            build_jsonrpc_error(-32602, "city or region_name is required.", rpc_id),
            status=400,
        )

    try:
        address, card, name, requested_city = await asyncio.to_thread(
            generate_address_card_and_name_from_city,
            region_name,
            city,
            country,
        )
    except Exception as error:
        LOGGER.exception("Address generation failed. city=%s region_name=%s", city, region_name)
        return json_response_with_cors(
            build_jsonrpc_error(-32000, f"Address generation failed: {error}", rpc_id),
            status=502,
        )

    enriched_payload = {
        "event_name": "address_from_city_generated",
        "received_at": utc_iso_now(),
        "remote": request.remote or "",
        "user_agent": request.headers.get("User-Agent", ""),
        "rpc_id": rpc_id,
        "token": token,
        "source_city": city,
        "source_region_name": region_name,
        "requested_city": requested_city,
        "country": country,
        "address": address,
        "name": name,
        "card": card,
    }
    log_file = append_named_jsonl_log("address", enriched_payload)
    LOGGER.info(
        "Generated address from city. token=%s city=%s region_name=%s requested_city=%s file=%s",
        token,
        city,
        region_name,
        requested_city,
        log_file,
    )

    result = {
        "ok": True,
        "token": token,
        "source_city": city,
        "source_region_name": region_name,
        "requested_city": requested_city,
        "country": country,
        "address": address,
        "name": name,
        "card": card,
        "saved_to": display_path(log_file),
        "received_at": enriched_payload["received_at"],
        "rpc_id": rpc_id,
    }
    return json_response_with_cors(build_jsonrpc_response(result, rpc_id))


async def api_address_from_city(request: web.Request) -> web.Response:
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

    if is_jsonrpc_request(payload):
        return await handle_jsonrpc_address_from_city(request, payload)

    return json_response_with_cors(
        {
            "ok": False,
            "error": "JSON-RPC request is required."
        },
        status=400,
    )


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
    app.router.add_options("/api/get_crc_token", api_log_options)
    app.router.add_get("/api/get_crc_token", api_get_crc_token)
    app.router.add_post("/api/get_crc_token", api_get_crc_token)
    app.router.add_options("/api/token/create", api_log_options)
    app.router.add_post("/api/token/create", api_token_create)
    app.router.add_options("/api/html/text", api_log_options)
    app.router.add_post("/api/html/text", api_html_text)
    app.router.add_options("/api/html/all", api_log_options)
    app.router.add_post("/api/html/all", api_html_all)
    app.router.add_options("/api/address/from-city", api_log_options)
    app.router.add_post("/api/address/from-city", api_address_from_city)
    app.router.add_options("/api/name/generate", api_log_options)
    app.router.add_post("/api/name/generate", api_name_generate)
    app.router.add_options("/api/at/save", api_log_options)
    app.router.add_post("/api/at/save", api_at_save)
    app.router.add_options("/api/log", api_log_options)
    app.router.add_post("/api/log", api_log)
    app.router.add_options("/api/report", api_log_options)
    app.router.add_post("/api/report", api_log)
    app.router.add_static("/static/", path=STATIC_DIR)
    return app
