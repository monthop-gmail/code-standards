"""Exception hierarchy for the monthly sales report tool.

ทุก error ที่ตั้งใจให้ CLI จับและแปลงเป็น exit code ต้องสืบทอดจาก ``SalesReportError``
ส่วน exception อื่น ๆ ถือเป็น bug และปล่อยให้ traceback ขึ้นมาเต็ม ๆ
"""

from __future__ import annotations


class SalesReportError(Exception):
    """Base class ของทุก expected failure ในเครื่องมือนี้."""


class ConfigError(SalesReportError):
    """ค่า config/env var หายหรือผิดรูปแบบ."""


class InvalidPeriodError(SalesReportError):
    """ช่วงเดือนที่ผู้ใช้ระบุไม่ถูกต้อง."""


class DatabaseError(SalesReportError):
    """ติดต่อ PostgreSQL ไม่ได้ หรือ query ล้มเหลว."""


class ReportError(SalesReportError):
    """ข้อมูลที่ได้จาก DB ไม่ตรงกับที่ report layer คาดไว้."""


class ExportError(SalesReportError):
    """เขียนไฟล์ CSV ปลายทางไม่ได้."""
