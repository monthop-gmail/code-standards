"""Configuration loading and validation.

Connection settings are read from environment variables only; nothing
sensitive is ever hard-coded or logged.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from typing import Final

DEFAULT_PORT: Final[int] = 5432
DEFAULT_CONNECT_TIMEOUT: Final[int] = 10
DEFAULT_STATEMENT_TIMEOUT_MS: Final[int] = 60_000


class ConfigError(ValueError):
    """Raised when the runtime configuration is missing or invalid."""


@dataclass(frozen=True, slots=True)
class DatabaseConfig:
    """Immutable PostgreSQL connection settings."""

    host: str
    port: int
    dbname: str
    user: str
    password: str
    sslmode: str = "prefer"
    connect_timeout: int = DEFAULT_CONNECT_TIMEOUT
    statement_timeout_ms: int = DEFAULT_STATEMENT_TIMEOUT_MS

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "DatabaseConfig":
        """Build a config from environment variables.

        Recognised variables: PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD,
        PGSSLMODE, DB_CONNECT_TIMEOUT, DB_STATEMENT_TIMEOUT_MS.
        """
        source = os.environ if env is None else env

        missing = [key for key in ("PGDATABASE", "PGUSER", "PGPASSWORD") if not source.get(key)]
        if missing:
            raise ConfigError(
                "Missing required environment variable(s): " + ", ".join(sorted(missing))
            )

        return cls(
            host=source.get("PGHOST", "localhost"),
            port=_positive_int(source.get("PGPORT"), DEFAULT_PORT, "PGPORT"),
            dbname=source["PGDATABASE"],
            user=source["PGUSER"],
            password=source["PGPASSWORD"],
            sslmode=source.get("PGSSLMODE", "prefer"),
            connect_timeout=_positive_int(
                source.get("DB_CONNECT_TIMEOUT"), DEFAULT_CONNECT_TIMEOUT, "DB_CONNECT_TIMEOUT"
            ),
            statement_timeout_ms=_positive_int(
                source.get("DB_STATEMENT_TIMEOUT_MS"),
                DEFAULT_STATEMENT_TIMEOUT_MS,
                "DB_STATEMENT_TIMEOUT_MS",
            ),
        )

    def to_conninfo_kwargs(self) -> dict[str, object]:
        """Return keyword arguments suitable for ``psycopg.connect``."""
        return {
            "host": self.host,
            "port": self.port,
            "dbname": self.dbname,
            "user": self.user,
            "password": self.password,
            "sslmode": self.sslmode,
            "connect_timeout": self.connect_timeout,
            "options": f"-c statement_timeout={self.statement_timeout_ms}",
        }

    def __repr__(self) -> str:  # pragma: no cover - trivial
        # Never leak the password into logs or tracebacks.
        return (
            f"DatabaseConfig(host={self.host!r}, port={self.port}, "
            f"dbname={self.dbname!r}, user={self.user!r}, password='***')"
        )


@dataclass(frozen=True, slots=True)
class ReportRequest:
    """Validated parameters describing which months to report on."""

    start: date
    end: date
    currency: str | None = None

    def __post_init__(self) -> None:
        if self.start > self.end:
            raise ConfigError(f"start ({self.start}) must not be after end ({self.end})")
        if self.start.day != 1:
            raise ConfigError("start must be the first day of a month")


def _positive_int(raw: str | None, default: int, name: str) -> int:
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc
    if value <= 0:
        raise ConfigError(f"{name} must be positive, got {value}")
    return value
