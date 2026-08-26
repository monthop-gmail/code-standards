# monthly-sales-report

ดึงยอดขายรายเดือนจาก PostgreSQL แล้วสรุปออกเป็นไฟล์ CSV

## Schema ที่สมมติไว้

โค้ดนี้เขียนโดยสมมติตาราง `sales.orders` หน้าตาแบบนี้ — **ถ้าของจริงชื่อไม่ตรง แก้ที่ SQL ก้อนเดียว
ใน `src/monthly_sales_report/db.py` (`MONTHLY_SALES_SQL`) ที่เดียวจบ** ส่วนอื่นไม่ต้องแตะ

```sql
CREATE TABLE sales.orders (
    id           bigserial PRIMARY KEY,
    customer_id  bigint      NOT NULL,
    order_date   timestamptz NOT NULL,         -- เก็บเป็น UTC, แปลงเป็น Asia/Bangkok ตอนตัดเดือน
    status       text        NOT NULL,         -- paid | completed | shipped | cancelled | draft | refunded
    total_amount numeric(14,2) NOT NULL        -- ยอดสุทธิต่อออเดอร์ (รวมส่วนลดแล้ว, ไม่รวม refund)
);

-- index ที่ query นี้ต้องใช้ ไม่งั้น full scan ทุกครั้งที่รัน
CREATE INDEX orders_order_date_status_idx ON sales.orders (order_date, status);
```

สมมติฐานที่ต้องยืนยันกับฝ่ายที่เป็นเจ้าของข้อมูล:

| สมมติฐาน | ถ้าไม่จริงต้องแก้ที่ไหน |
| --- | --- |
| สถานะที่นับเป็นยอดขายคือ `paid`, `completed`, `shipped` | `COUNTED_ORDER_STATUSES` ใน `db.py` |
| `total_amount` เป็นยอดสุทธิต่อออเดอร์อยู่แล้ว (ไม่ต้อง join line item) | `MONTHLY_SALES_SQL` |
| ตัดเดือนตามเวลาไทย ไม่ใช่ UTC | env `SALES_REPORT_TZ` |
| ยอดขายเป็นสกุลเดียวทั้งตาราง | ถ้าหลายสกุลต้องเพิ่ม `GROUP BY currency` และเพิ่มคอลัมน์ใน CSV |
| refund/credit note ไม่ได้เก็บเป็นออเดอร์ยอดติดลบ | ถ้าเก็บ รายงานจะหักให้เองอัตโนมัติ |

## ติดตั้ง

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env      # แล้วใส่ค่าจริง — .env อยู่ใน .gitignore แล้ว
```

ควรใช้ database user ที่มีสิทธิ์ `SELECT` อย่างเดียว (connection ถูกตั้งเป็น read-only ในโค้ดอีกชั้น)

## ใช้งาน

```bash
export $(grep -v '^#' .env | xargs)        # หรือใช้ direnv / systemd EnvironmentFile

# 12 เดือนย้อนหลังถึงเดือนปัจจุบัน → monthly_sales.csv
monthly-sales-report

# ระบุช่วงเอง และเขียนลง path อื่น
monthly-sales-report --from 2025-01 --to 2025-12 -o reports/2025/sales.csv

# ส่งออก stdout เพื่อต่อ pipe
monthly-sales-report --from 2026-01 -o - | column -s, -t

# ไม่ได้ติดตั้งเป็น command ก็เรียกแบบ module ได้
python -m monthly_sales_report --from 2026-01
```

Exit code: `0` = สำเร็จ, `1` = ความผิดพลาดที่คาดไว้ (config ผิด, ช่วงเดือนผิด, ต่อ DB ไม่ได้, เขียนไฟล์ไม่ได้)
ข้อความ error ออก stderr เสมอ เพื่อไม่ปนกับ CSV ที่ออก stdout

## ผลลัพธ์

```csv
month,order_count,unique_customers,gross_sales,avg_order_value,mom_growth_pct
2026-01,120,88,452300.75,3769.17,
2026-02,96,70,389120.00,4053.33,-13.97
2026-03,0,0,0.00,0.00,-100.00
2026-04,140,101,512000.10,3657.14,
```

- ทุกเดือนในช่วงมีแถวเสมอ เดือนที่ไม่มีออเดอร์เติมเป็น 0 (ถ้าปล่อยหาย คนอ่านกราฟจะเข้าใจผิด)
- `mom_growth_pct` ว่างเมื่อเทียบไม่ได้ — เดือนแรกของช่วง หรือเดือนก่อนหน้ายอดเป็น 0 (หารด้วยศูนย์)
- ตัวเลขเงินคำนวณด้วย `Decimal` ตลอดเส้นทาง ไม่มี float มาปัดเศษให้เพี้ยน
- ไฟล์เขียนด้วย `utf-8-sig` เพื่อให้ Excel บน Windows อ่านภาษาไทยไม่เป็นขยะ

## โครงสร้าง

```
src/monthly_sales_report/
├── config.py      # อ่าน env var + mask password ก่อน log
├── periods.py     # ตีความช่วงเดือน (pure)
├── report.py      # เติมเดือนที่ขาด, avg order value, MoM growth (pure)
├── csv_export.py  # เขียน CSV ลงไฟล์/stdout
├── db.py          # ที่เดียวที่รู้จัก psycopg และ schema จริง
├── cli.py         # argparse + catch-all
└── errors.py      # exception hierarchy
```

แบ่งตาม "เหตุผลที่จะต้องแก้": สูตรคำนวณเปลี่ยนคนละจังหวะกับ schema ของ DB และคนละจังหวะกับรูปแบบไฟล์
ผลพลอยได้คือ business logic ทั้งหมด test ได้โดยไม่ต้องมี PostgreSQL

## Test

```bash
pytest          # 50 passed, 1 skipped (test ของ CLI ข้ามเมื่อยังไม่ได้ติดตั้ง psycopg)
ruff check .
mypy
```

test ครอบ: ขอบเขตเดือนข้ามปี/ข้ามเดือน 28-31 วัน, timezone, ช่วงว่าง, เดือนที่ไม่มียอดขาย,
ยอดติดลบจาก refund, หารด้วยศูนย์, การปัดเศษ, ผลลัพธ์ซ้ำ/นอกช่วงจาก query, และ path ที่เขียนไม่ได้

## หมายเหตุด้าน operation

- Query aggregate ฝั่ง DB ทั้งหมด — แถวที่วิ่งกลับมาเท่ากับจำนวนเดือน ไม่ใช่จำนวนออเดอร์
- ตั้ง `statement_timeout` และ `connect_timeout` ทุกครั้ง กัน query ค้างกินทรัพยากร DB production
- DSN อ่านจาก env เท่านั้น ไม่รับทาง argument เพราะ argv โผล่ใน `ps aux` และ shell history
- ก่อนขึ้น cron ควรรันกับ replica ไม่ใช่ primary
