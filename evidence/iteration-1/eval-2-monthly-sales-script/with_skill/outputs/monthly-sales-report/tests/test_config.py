from __future__ import annotations

import pytest

from monthly_sales_report.config import (
    DEFAULT_STATEMENT_TIMEOUT_MS,
    AppConfig,
    mask_dsn,
)
from monthly_sales_report.errors import ConfigError

DSN = "postgresql://reporter:s3cret@db.internal:5432/salesdb"


def test_reads_dsn_and_applies_defaults():
    config = AppConfig.from_env({"DATABASE_URL": DSN})

    assert config.dsn == DSN
    assert str(config.timezone) == "Asia/Bangkok"
    assert config.statement_timeout_ms == DEFAULT_STATEMENT_TIMEOUT_MS


@pytest.mark.parametrize("env", [{}, {"DATABASE_URL": ""}, {"DATABASE_URL": "   "}])
def test_missing_dsn_is_a_config_error(env):
    with pytest.raises(ConfigError, match="DATABASE_URL"):
        AppConfig.from_env(env)


def test_unknown_timezone_is_rejected():
    with pytest.raises(ConfigError, match="timezone"):
        AppConfig.from_env({"DATABASE_URL": DSN, "SALES_REPORT_TZ": "Mars/Olympus_Mons"})


def test_custom_timezone_is_accepted():
    config = AppConfig.from_env({"DATABASE_URL": DSN, "SALES_REPORT_TZ": "UTC"})
    assert str(config.timezone) == "UTC"


@pytest.mark.parametrize("raw", ["0", "-1", "abc", "1.5"])
def test_invalid_statement_timeout_is_rejected(raw):
    with pytest.raises(ConfigError):
        AppConfig.from_env({"DATABASE_URL": DSN, "SALES_REPORT_STATEMENT_TIMEOUT_MS": raw})


def test_mask_dsn_hides_password():
    assert mask_dsn(DSN) == "postgresql://reporter:***@db.internal:5432/salesdb"


def test_mask_dsn_tolerates_dsn_without_credentials():
    assert mask_dsn("postgresql:///salesdb") == "postgresql:///salesdb"
    assert mask_dsn("host=db dbname=salesdb") == "host=db dbname=salesdb"
