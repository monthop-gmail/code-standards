# Monthly Sales CSV Export

สคริปต์ Python สำหรับดึงยอดขายรายเดือนจาก PostgreSQL แล้วสรุปออกมาเป็นไฟล์ CSV

## โครงสร้าง

```
monthly_sales/
  config.py    # อ่าน/ตรวจ config จาก environment variables
  queries.py   # SQL ทั้งหมดอยู่ที่เดียว (แก้ชื่อ table/column ที่นี่)
  report.py    # logic ล้วน ๆ: month arithmetic, row model, เขียน CSV
  db.py        # connection + รัน query (import psycopg แบบ lazy)
  cli.py       # argparse entry point
tests/         # unit tests (stdlib unittest, ไม่ต้องต่อ DB จริง)
schema.sql     # schema ที่สคริปต์นี้สมมติไว้
```

## ข้อสมมติเรื่อง schema

ตาราง `orders` มีคอลัมน์ `order_date (timestamptz)`, `status (text)`,
`customer_id (bigint)`, `currency (char(3))`, `total_amount (numeric(12,2))`
นับเฉพาะ status ที่เป็นรายได้จริง: `paid`, `completed`, `shipped`
(ยกเลิก/คืนเงิน ไม่ถูกนับ) — ปรับได้ที่ `monthly_sales/queries.py`

## วิธีใช้

```bash
pip install -r requirements.txt
cp .env.example .env && set -a && . ./.env && set +a

# 12 เดือนเต็มล่าสุด (ไม่รวมเดือนปัจจุบันที่ยังไม่จบ)
python -m monthly_sales -o monthly_sales.csv

# ระบุช่วงเอง + เฉพาะสกุลเงิน THB + เติมเดือนที่ไม่มียอดขายเป็น 0
python -m monthly_sales --start 2025-01 --end 2025-12 --currency THB --fill-gaps -o 2025.csv
```

Exit codes: `0` สำเร็จ, `2` config ผิด, `3` ต่อ DB / query ไม่สำเร็จ

## ผลลัพธ์

| month | currency | order_count | customer_count | gross_revenue | avg_order_value |
|-------|----------|-------------|----------------|---------------|-----------------|
| 2025-01 | THB | 412 | 350 | 1284500.00 | 3117.72 |

## Test

```bash
python -m unittest discover -s tests -t .
```

## หมายเหตุด้านความปลอดภัย/ความถูกต้อง

- ไม่มี credential ใน source; อ่านจาก env เท่านั้น และ `repr()` ปิดบัง password
- Parameter ทุกตัว bind ผ่าน psycopg (`%(name)s`) — ไม่มี string interpolation ใน SQL
- Connection ตั้งเป็น read-only + มี `statement_timeout` กัน query ค้าง
- เงินใช้ `Decimal` ตลอดทาง ไม่ใช้ float
- เขียน CSV แบบ atomic (temp file + `os.replace`) ไม่เหลือไฟล์ครึ่ง ๆ กลาง ๆ
- `date_trunc('month', ...)` ทำงานตาม timezone ของ session — ตั้ง `PGTZ`/`SET TIME ZONE`
  ให้ตรงกับ timezone ที่ฝ่ายบัญชีใช้ ถ้าข้อมูลเป็น `timestamptz`
