#!/usr/bin/env python3
"""
CTF 工具箱：地址生成 + Luhn 信用卡生成
========================================
类实现，用法：

    from ctf_toolkit import LuhnCardGenerator, AddressGenerator

    # 信用卡
    card = LuhnCardGenerator()
    print(card.generate())          # 1张Visa
    print(card.generate_batch(5))   # 5张

    # 日本姓名
    name = JapaneseNameGenerator()
    print(name.generate())          # kanji/hiragana/romaji 配对姓名

    # 地址
    addr = AddressGenerator(proxy="127.0.0.1:7897")
    print(addr.us())                # 美国随机地址
    print(addr.jp())                # 日本随机地址
    print(addr.jp_hot("Tokyo"))     # 日本东京地址

CLI:
    python ctf_toolkit.py card              # 1 张卡
    python ctf_toolkit.py card 5            # 5 张卡
    python ctf_toolkit.py card --json       # JSON 格式
    python ctf_toolkit.py name              # 日本 kanji/hiragana/romaji 配对姓名
    python ctf_toolkit.py addr --us         # 美国地址
    python ctf_toolkit.py addr --jp         # 日本地址
    python ctf_toolkit.py addr --jp Tokyo   # 日本东京地址
"""

import json
import random
import sys
from datetime import datetime
from typing import Optional

import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


# ═══════════════════════════════════════════════════════════════════
#  Luhn 信用卡生成器
# ═══════════════════════════════════════════════════════════════════

class LuhnCardGenerator:
    """Luhn 算法生成合法 Visa 信用卡"""

    # Visa BIN 前缀
    VISA_BINS = (
        [4],
        [4, 0, 0], [4, 0, 1], [4, 0, 2],
        [4, 1, 4, 7], [4, 1, 0, 0],
        [4, 2, 6], [4, 3, 1, 9],
        [4, 5, 1, 4], [4, 8, 0, 0], [4, 9, 1, 7],
    )
    CARD_LENGTH = 16

    def __init__(self, bin_prefixes: Optional[list[list[int]]] = None):
        self.bin_prefixes = bin_prefixes or self.VISA_BINS

    # ── 核心算法 ────────────────────────────────────────────────

    @staticmethod
    def luhn_checksum(digits: list[int]) -> int:
        """计算 Luhn 校验位"""
        total = 0
        for i, d in enumerate(reversed(digits)):
            if i % 2 == 0:
                d *= 2
                if d > 9:
                    d -= 9
            total += d
        return (10 - (total % 10)) % 10

    @classmethod
    def validate(cls, card_number: str) -> bool:
        """验证卡号是否通过 Luhn 校验"""
        digits = [int(ch) for ch in card_number if ch.isdigit()]
        if len(digits) != cls.CARD_LENGTH:
            return False
        *payload, check = digits
        return cls.luhn_checksum(payload) == check

    # ── 生成 ────────────────────────────────────────────────────

    def _random_prefix(self) -> list[int]:
        return random.choice(self.bin_prefixes)[:]

    def _random_digits(self, count: int) -> list[int]:
        return [random.randint(0, 9) for _ in range(count)]

    def _random_month(self) -> str:
        return f"{random.randint(1, 12):02d}"

    def _random_year(self) -> str:
        yy = datetime.now().year % 100
        return str(yy + random.randint(2, 5))

    def _random_cvv(self) -> str:
        return str(random.randint(100, 999))

    def generate_card_number(self) -> str:
        """生成一个 16 位合法 Visa 卡号"""
        digits = self._random_prefix()
        digits += self._random_digits(self.CARD_LENGTH - 1 - len(digits))
        digits.append(self.luhn_checksum(digits))
        return "".join(str(d) for d in digits)

    def generate(self) -> dict:
        """生成一张完整卡信息"""
        number = self.generate_card_number()
        return {
            "number": number,
            "expiry": f"{self._random_month()} / {self._random_year()}",
            "cvv": self._random_cvv(),
            "luhn_valid": self.validate(number),
        }

    def generate_batch(self, count: int) -> list[dict]:
        """批量生成"""
        return [self.generate() for _ in range(max(1, count))]


# ═══════════════════════════════════════════════════════════════════
#  日本姓名生成器
# ═══════════════════════════════════════════════════════════════════

class JapaneseNameGenerator:
    """生成适合 CTF 表单和日志使用的日本测试姓名"""

    FAMILY_NAMES = (
        {
            "kanji": "佐藤",
            "hiragana": "さとう",
            "romaji": "Sato",
            "meaning": "Assistant + wisteria",
        },
        {
            "kanji": "鈴木",
            "hiragana": "すずき",
            "romaji": "Suzuki",
            "meaning": "Bell + tree",
        },
        {
            "kanji": "高橋",
            "hiragana": "たかはし",
            "romaji": "Takahashi",
            "meaning": "High + bridge",
        },
        {
            "kanji": "田中",
            "hiragana": "たなか",
            "romaji": "Tanaka",
            "meaning": "Rice field + middle",
        },
        {
            "kanji": "伊藤",
            "hiragana": "いとう",
            "romaji": "Ito",
            "meaning": "That + wisteria",
        },
        {
            "kanji": "渡辺",
            "hiragana": "わたなべ",
            "romaji": "Watanabe",
            "meaning": "Crossing + area",
        },
        {
            "kanji": "山本",
            "hiragana": "やまもと",
            "romaji": "Yamamoto",
            "meaning": "Mountain + base",
        },
        {
            "kanji": "中村",
            "hiragana": "なかむら",
            "romaji": "Nakamura",
            "meaning": "Middle + village",
        },
        {
            "kanji": "小林",
            "hiragana": "こばやし",
            "romaji": "Kobayashi",
            "meaning": "Small + forest",
        },
        {
            "kanji": "加藤",
            "hiragana": "かとう",
            "romaji": "Kato",
            "meaning": "Add + wisteria",
        },
        {
            "kanji": "吉田",
            "hiragana": "よしだ",
            "romaji": "Yoshida",
            "meaning": "Lucky + rice field",
        },
        {
            "kanji": "山田",
            "hiragana": "やまだ",
            "romaji": "Yamada",
            "meaning": "Mountain + rice field",
        },
        {
            "kanji": "松本",
            "hiragana": "まつもと",
            "romaji": "Matsumoto",
            "meaning": "Pine + base",
        },
        {
            "kanji": "井上",
            "hiragana": "いのうえ",
            "romaji": "Inoue",
            "meaning": "Well + above",
        },
        {
            "kanji": "木村",
            "hiragana": "きむら",
            "romaji": "Kimura",
            "meaning": "Tree + village",
        },
        {
            "kanji": "清水",
            "hiragana": "しみず",
            "romaji": "Shimizu",
            "meaning": "Pure + water",
        },
    )

    GIVEN_NAMES = (
        {
            "kanji": "太郎",
            "hiragana": "たろう",
            "romaji": "Taro",
            "meaning": "Great + son",
            "gender": "male",
        },
        {
            "kanji": "健太",
            "hiragana": "けんた",
            "romaji": "Kenta",
            "meaning": "Healthy + great",
            "gender": "male",
        },
        {
            "kanji": "翔太",
            "hiragana": "しょうた",
            "romaji": "Shota",
            "meaning": "Soar + great",
            "gender": "male",
        },
        {
            "kanji": "悠真",
            "hiragana": "ゆうま",
            "romaji": "Yuma",
            "meaning": "Calm + truth",
            "gender": "male",
        },
        {
            "kanji": "陽翔",
            "hiragana": "はると",
            "romaji": "Haruto",
            "meaning": "Sun + flight",
            "gender": "male",
        },
        {
            "kanji": "花子",
            "hiragana": "はなこ",
            "romaji": "Hanako",
            "meaning": "Flower + child",
            "gender": "female",
        },
        {
            "kanji": "美咲",
            "hiragana": "みさき",
            "romaji": "Misaki",
            "meaning": "Beauty + blossom",
            "gender": "female",
        },
        {
            "kanji": "結衣",
            "hiragana": "ゆい",
            "romaji": "Yui",
            "meaning": "Tie + garment",
            "gender": "female",
        },
        {
            "kanji": "陽菜",
            "hiragana": "ひな",
            "romaji": "Hina",
            "meaning": "Sun + greens",
            "gender": "female",
        },
        {
            "kanji": "彩花",
            "hiragana": "あやか",
            "romaji": "Ayaka",
            "meaning": "Color + flower",
            "gender": "female",
        },
        {
            "kanji": "空",
            "hiragana": "そら",
            "romaji": "Sora",
            "meaning": "Sky",
            "gender": "unisex",
        },
        {
            "kanji": "葵",
            "hiragana": "あおい",
            "romaji": "Aoi",
            "meaning": "Hollyhock",
            "gender": "unisex",
        },
        {
            "kanji": "楓",
            "hiragana": "かえで",
            "romaji": "Kaede",
            "meaning": "Maple",
            "gender": "unisex",
        },
        {
            "kanji": "椿",
            "hiragana": "つばき",
            "romaji": "Tsubaki",
            "meaning": "Camellia",
            "gender": "unisex",
        },
        {
            "kanji": "光",
            "hiragana": "ひかる",
            "romaji": "Hikaru",
            "meaning": "Light",
            "gender": "unisex",
        },
    )

    NAME_TYPES = {"fullName", "firstName", "lastName"}
    GENDERS = {"male", "female", "unisex"}

    def _normalize_name_type(self, name_type: str) -> str:
        aliases = {
            "full": "fullName",
            "fullname": "fullName",
            "given": "firstName",
            "givenName": "firstName",
            "first": "firstName",
            "surname": "lastName",
            "family": "lastName",
            "familyName": "lastName",
            "last": "lastName",
        }
        value = aliases.get(str(name_type or "").strip(), str(name_type or "").strip())
        return value if value in self.NAME_TYPES else "fullName"

    def _normalize_gender(self, gender: str) -> str:
        value = str(gender or "").strip().lower()
        if value in ("any", "all", "neutral"):
            value = "unisex"
        return value if value in self.GENDERS else "unisex"

    def _pick_given_name(self, gender: str) -> dict:
        if gender == "unisex":
            pool = self.GIVEN_NAMES
        else:
            pool = [item for item in self.GIVEN_NAMES if item["gender"] in (gender, "unisex")]
        return random.choice(pool)

    @staticmethod
    def _join_name(family: dict, given: dict, key: str, name_type: str) -> str:
        if name_type == "firstName":
            return given[key]
        if name_type == "lastName":
            return family[key]
        return f"{family[key]} {given[key]}"

    @staticmethod
    def _join_meaning(family: dict, given: dict, name_type: str) -> str:
        if name_type == "firstName":
            return given["meaning"]
        if name_type == "lastName":
            return family["meaning"]
        return f"{family['meaning']} + {given['meaning']}"

    def generate(self, name_type: str = "fullName", gender: str = "unisex") -> dict:
        """返回类似页面生成器的姓名结构，并兼容旧字段"""
        normalized_type = self._normalize_name_type(name_type)
        normalized_gender = self._normalize_gender(gender)
        family = random.choice(self.FAMILY_NAMES)
        given = self._pick_given_name(normalized_gender)
        effective_gender = given["gender"] if normalized_gender == "unisex" else normalized_gender
        kanji = self._join_name(family, given, "kanji", normalized_type)
        hiragana = self._join_name(family, given, "hiragana", normalized_type)
        romaji = self._join_name(family, given, "romaji", normalized_type)

        return {
            "kanji": kanji,
            "hiragana": hiragana,
            "romaji": romaji,
            "meaning": self._join_meaning(family, given, normalized_type),
            "nameType": normalized_type,
            "gender": normalized_gender,
            "effectiveGender": effective_gender,
            "kanjiGiven": given["kanji"],
            "kanjiFamily": family["kanji"],
            "hiraganaGiven": given["hiragana"],
            "hiraganaFamily": family["hiragana"],
            "romajiGiven": given["romaji"],
            "romajiFamily": family["romaji"],
            "kanaGiven": given["hiragana"],
            "kanaFamily": family["hiragana"],
            "kanjiFull": f"{family['kanji']} {given['kanji']}",
            "kanaFull": f"{family['hiragana']} {given['hiragana']}",
            "hiraganaFull": f"{family['hiragana']} {given['hiragana']}",
            "romajiFull": f"{family['romaji']} {given['romaji']}",
        }

    def generate_batch(self, count: int = 1, name_type: str = "fullName", gender: str = "unisex") -> list[dict]:
        """批量生成姓名，count 限制在 1 到 50 之间"""
        safe_count = min(50, max(1, int(count or 1)))
        return [self.generate(name_type=name_type, gender=gender) for _ in range(safe_count)]


# ═══════════════════════════════════════════════════════════════════
#  地址生成器
# ═══════════════════════════════════════════════════════════════════

class AddressGenerator:
    """通过 meiguodizhi.com API 生成随机假地址"""

    API_URL = "https://www.meiguodizhi.com/api/v1/dz"
    UA = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/135.0.0.0 Safari/537.36"
    )
    TIMEOUT = 10

    def __init__(self, proxy: Optional[str] = None, timeout: int = 10):
        """
        proxy: "127.0.0.1:7897" 或 None（不走代理）
        timeout: 请求超时秒数
        """
        self.timeout = timeout
        handlers = []
        if proxy:
            handlers.append(urllib.request.ProxyHandler({
                "http": proxy,
                "https": proxy,
            }))
        self._opener = urllib.request.build_opener(*handlers)

    # ── 核心请求 ────────────────────────────────────────────────

    def _request(self, path: str) -> dict:
        """向 API 发请求，返回完整 address 字典"""
        body = json.dumps({"path": path, "method": "address"}).encode()
        req = urllib.request.Request(
            self.API_URL,
            data=body,
            headers={
                "Content-Type": "application/json",
                "User-Agent": self.UA,
            },
        )
        with self._opener.open(req, timeout=self.timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
        if data.get("status") != "ok":
            raise RuntimeError(f"API error: {data}")
        return data.get("address", {})

    # ── 公共接口 ────────────────────────────────────────────────

    def us(self) -> dict:
        """美国随机地址"""
        raw = self._request("/")
        return {
            "country":   "US",
            "street":    raw.get("Address", ""),
            "city":      raw.get("City", ""),
            "state":     raw.get("State", ""),
            "state_full": raw.get("State_Full", ""),
            "zip":       raw.get("Zip_Code", ""),
            "phone":     raw.get("Telephone", ""),
            "full_name": raw.get("Full_Name", ""),
            "raw":       raw,
        }

    def jp(self) -> dict:
        """日本随机地址"""
        raw = self._request("/jp-address")
        return self._parse_jp(raw)

    def jp_hot(self, city: str = "Tokyo") -> dict:
        """日本热门城市地址 (Tokyo / Hokkaido 等)"""
        raw = self._request(f"/jp-address/hot-city-{city}")
        return self._parse_jp(raw)

    # ── 解析 ────────────────────────────────────────────────────

    @staticmethod
    def _parse_jp(raw: dict) -> dict:
        return {
            "country":     "JP",
            "address":     raw.get("Address", ""),
            "address_en":  raw.get("Trans_Address", ""),
            "address_cn":  raw.get("Trans_Cn_Address", ""),
            "city":        raw.get("City", ""),
            "state":       raw.get("State", ""),
            "zip":         raw.get("Zip_Code", ""),
            "phone":       raw.get("Telephone", ""),
            "full_name":   raw.get("Full_Name", ""),
            "card_type":   raw.get("Credit_Card_Type", ""),
            "card_number": raw.get("Credit_Card_Number", ""),
            "raw":         raw,
        }


# ═══════════════════════════════════════════════════════════════════
#  CLI
# ═══════════════════════════════════════════════════════════════════

def _print_card(card: dict, idx: int = 1) -> None:
    num = card["number"]
    fmt = f"{num[0:4]} {num[4:8]} {num[8:12]} {num[12:16]}"
    tag = "[PASS]" if card["luhn_valid"] else "[FAIL]"
    print(
        f"Card #{idx}\n"
        f"  Number: {fmt}\n"
        f"  Expiry: {card['expiry']}\n"
        f"  CVV:    {card['cvv']}\n"
        f"  Luhn:   {tag}"
    )


if __name__ == "__main__":
    args = sys.argv[1:]

    if not args:
        print("Usage: python ctf_toolkit.py card [count] [--json]")
        print("       python ctf_toolkit.py name")
        print("       python ctf_toolkit.py addr --us|--jp [city]")
        sys.exit(0)

    mode = args[0]

    # ── card 模式 ──
    if mode == "card":
        count = 1
        as_json = False
        for a in args[1:]:
            if a in ("--json", "-j"):
                as_json = True
            elif a.isdigit():
                count = int(a)

        gen = LuhnCardGenerator()
        cards = gen.generate_batch(count)

        if as_json:
            out = cards[0] if count == 1 else cards
            print(json.dumps(out, indent=2, ensure_ascii=False))
        else:
            for i, c in enumerate(cards, 1):
                _print_card(c, i)
                if i < len(cards):
                    print()

    # ── name 模式 ──
    elif mode == "name":
        gen = JapaneseNameGenerator()
        print(json.dumps(gen.generate(), indent=2, ensure_ascii=False))

    # ── addr 模式 ──
    elif mode == "addr":
        gen = AddressGenerator(proxy="127.0.0.1:7897")
        region = args[1] if len(args) > 1 else "--us"
        city = args[2] if len(args) > 2 else "Tokyo"

        if region == "--us":
            result = gen.us()
        elif region == "--jp":
            if len(args) > 2:
                result = gen.jp_hot(city)
            else:
                result = gen.jp()
        else:
            print(f"Unknown region: {region}")
            sys.exit(1)

        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"Unknown mode: {mode}")
        sys.exit(1)
