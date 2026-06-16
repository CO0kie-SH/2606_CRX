import random
import datetime


def generate_visa_card():
    """生成一张通过Luhn校验的Visa信用卡号（仅用于CTF/测试）"""
    prefixes = [
        [4, 1, 4, 7],
        [4, 1, 0, 0],
    ]
    digits = random.choice(prefixes)[:]

    # 填充到15位
    while len(digits) < 15:
        digits.append(random.randint(0, 9))

    # Luhn算法计算校验位
    reversed_digits = digits[::-1]
    total = 0
    for i, d in enumerate(reversed_digits):
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d

    check_digit = (10 - (total % 10)) % 10
    digits.append(check_digit)

    # 生成过期日期：月份01-12，年份=今年+2到今年+5
    month = f"{random.randint(1, 12):02d}"
    current_year = datetime.datetime.now().year % 100
    year = current_year + random.randint(1, 6)

    # 生成3位CVV
    cvv = str(random.randint(100, 999))

    return {
        "number": "".join(map(str, digits)),
        "expiry": f"{month} / {year}",
        "cvv": cvv,
    }


def luhn_check(card_number: str) -> bool:
    """验证卡号是否通过Luhn校验"""
    digits = [int(c) for c in card_number.replace(" ", "")]
    total = 0
    # 从右往左，每隔一位（从右边第2位开始）加倍
    for i, d in enumerate(digits[::-1]):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


if __name__ == "__main__":
    print("=" * 45)
    print("   Visa 信用卡号生成器 (CTF 测试用)")
    print("=" * 45)

    for i in range(2):
        card = generate_visa_card()
        valid = luhn_check(card["number"])
        print(f"\n[卡 {i + 1}]")
        print(f"  卡号  : {card['number']}")
        print(f"  有效期: {card['expiry']}")
        print(f"  CVV   : {card['cvv']}")
        print(f"  Luhn  : {'PASS' if valid else 'FAIL'}")

    print("\n" + "=" * 45)
    print("   完成 — 所有卡号均为随机生成，仅供CTF使用")
    print("=" * 45)
