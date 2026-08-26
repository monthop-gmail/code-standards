"""Runtime configuration ที่อ่านจาก environment variables เท่านั้น.

เหตุผลที่ไม่รับ DSN ทาง CLI argument: connection string มี password อยู่ข้างใน
ถ้าส่งผ่าน argv มันจะไปโผล่ใน shell history และใน ``ps aux`` ของทุก user บนเครื่อง
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .errors import ConfigError

DSN_ENV_VAR = "DATABASE_URL"
TIMEZONE_ENV_VAR = "SALES_REPORT_TZ"
STATEMENT_TIMEOUT_ENV_VAR = "SALES_REPORT_STATEMENT_TIMEOUT_MS"

DEFAULT_TIMEZONE = "Asia/Bangkok"
DEFAULT_STATEMENT_TIMEOUT_MS = 30_000
DEFAULT_CONNECT_TIMEOUT_SECONDS = 10


@dataclass(frozen=True)
class AppConfig:
    """ค่าที่จำเป็นต่อการรัน report หนึ่งครั้ง."""

    dsn: str
    timezone: ZoneInfo
    statement_timeout_ms: int
    connect_timeout_seconds: int = DEFAULT_CONNECT_TIMEOUT_SECONDS

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "AppConfig":
        """สร้าง config จาก env vars และ fail เร็วถ้าค่าผิด.

        รับ ``env`` เข้ามาได้เพื่อให้ test ไม่ต้องไปยุ่งกับ ``os.environ`` ของ process จริง.
        """
        source = os.environ if env is None else env

        dsn = (source.get(DSN_ENV_VAR) or "").strip()
        if not dsn:
            raise ConfigError(
                f"ไม่พบ environment variable {DSN_ENV_VAR} "
                "(ตัวอย่าง: postgresql://user:pass@host:5432/salesdb)"
            )

        timezone_name = (source.get(TIMEZONE_ENV_VAR) or DEFAULT_TIMEZONE).strip()
        try:
            timezone = ZoneInfo(timezone_name)
        except (ZoneInfoNotFoundError, ValueError) as cause:
            raise ConfigError(
                f"{TIMEZONE_ENV_VAR}={timezone_name!r} ไม่ใช่ชื่อ IANA timezone ที่รู้จัก"
            ) from cause

        return cls(
            dsn=dsn,
            timezone=timezone,
            statement_timeout_ms=_read_positive_int(
                source, STATEMENT_TIMEOUT_ENV_VAR, DEFAULT_STATEMENT_TIMEOUT_MS
            ),
        )


def _read_positive_int(source: dict[str, str], name: str, default: int) -> int:
    raw = (source.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as cause:
        raise ConfigError(f"{name}={raw!r} ต้องเป็นจำนวนเต็ม") from cause
    if value <= 0:
        raise ConfigError(f"{name}={value} ต้องมากกว่า 0")
    return value


def mask_dsn(dsn: str) -> str:
    """ซ่อน password ใน DSN ก่อนเอาไปแสดงผล/เขียน log."""
    scheme_separator = "://"
    scheme_end = dsn.find(scheme_separator)
    if scheme_end == -1:
        return dsn
    credentials_end = dsn.find("@", scheme_end)
    if credentials_end == -1:
        return dsn
    credentials = dsn[scheme_end + len(scheme_separator) : credentials_end]
    user = credentials.split(":", 1)[0]
    return f"{dsn[:scheme_end + len(scheme_separator)]}{user}:***{dsn[credentials_end:]}"
