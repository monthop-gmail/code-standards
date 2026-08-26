## แผน (ก่อนลงมือ)

เป็นงาน greenfield ไม่มี repo เดิม ไม่มี DB จริง จึงสมมติ schema แล้วประกาศไว้ให้ชัดในโค้ดและ README

- **ไฟล์ที่สร้าง**: package `monthly_sales_report` แบบ `src/` layout + `tests/` + `pyproject.toml` + `.env.example`
- **Data flow**: CLI args → `resolve_month_range` (pure) → `fetch_monthly_totals` (GROUP BY ฝั่ง Postgres) → `build_report` (เติมเดือนที่ขาด + คำนวณ MoM, pure) → `write_csv`
- **ตัดสินใจ**:
  - aggregate ที่ DB ไม่ใช่ดึงออเดอร์ดิบมา group ใน Python — แถวที่วิ่งกลับมาเท่ากับจำนวนเดือน
  - DSN อ่านจาก env เท่านั้น ไม่รับทาง CLI argument (argv โผล่ใน `ps aux` และ shell history)
  - แยก 6 module ตาม "เหตุผลที่จะต้องแก้" ไม่ใช่ตามจำนวนบรรทัด — ผลคือ business logic ทั้งหมด test ได้โดยไม่ต้องมี PostgreSQL
  - dependency runtime มีตัวเดียวคือ `psycopg[binary]` (ไม่ลาก pandas/SQLAlchemy มาเพื่อ query เดียว)

> ปกติจุดนี้จะขอ confirm schema ก่อน แต่รอบนี้ไม่มีช่องให้ถาม จึงเลือกสมมติฐานที่พบบ่อยที่สุดแล้วทำต่อ
> พร้อมทำตารางไว้ใน README ว่าถ้าสมมติฐานข้อไหนไม่จริงต้องแก้ตรงไหน

## โครงสร้าง

```
monthly-sales-report/
├── pyproject.toml
├── .env.example
├── .gitignore
├── README.md
├── src/monthly_sales_report/
│   ├── __init__.py
│   ├── __main__.py
│   ├── cli.py          # argparse + catch-all ชั้นนอกสุด (exit code 0/1)
│   ├── config.py       # env var + mask password ก่อน log
│   ├── periods.py      # ตีความช่วงเดือน, ขอบเขต half-open, timezone (pure)
│   ├── report.py       # เติมเดือนที่ขาด, avg order value, MoM growth (pure)
│   ├── csv_export.py   # เขียน CSV ลงไฟล์หรือ stdout
│   ├── db.py           # ที่เดียวที่รู้จัก psycopg และ schema จริง
│   └── errors.py       # SalesReportError hierarchy
└── tests/
    ├── test_periods.py
    ├── test_report.py
    ├── test_csv_export.py
    ├── test_config.py
    └── test_cli.py
```

## Schema ที่สมมติไว้ (ต้องยืนยันก่อนใช้จริง)

```sql
CREATE TABLE sales.orders (
    id           bigserial PRIMARY KEY,
    customer_id  bigint        NOT NULL,
    order_date   timestamptz   NOT NULL,
    status       text          NOT NULL,
    total_amount numeric(14,2) NOT NULL
);
CREATE INDEX orders_order_date_status_idx ON sales.orders (order_date, status);
```

- นับเป็นยอดขายเฉพาะ status `paid` / `completed` / `shipped` → แก้ที่ `COUNTED_ORDER_STATUSES`
- `total_amount` เป็นยอดสุทธิต่อออเดอร์อยู่แล้ว ไม่ต้อง join line item
- ตัดเดือนตาม `Asia/Bangkok` (ออเดอร์ 4 ทุ่มวันที่ 31 ต้องอยู่เดือนนั้น ไม่ใช่เดือนถัดไป) → เปลี่ยนได้ที่ env `SALES_REPORT_TZ`
- สมมติสกุลเงินเดียวทั้งตาราง — ถ้ามีหลายสกุลต้องเพิ่ม `GROUP BY currency`

ถ้าชื่อ table/column ของจริงไม่ตรง แก้ที่ `MONTHLY_SALES_SQL` ใน `db.py` ก้อนเดียวจบ

## ตัวอย่างผลลัพธ์

```csv
month,order_count,unique_customers,gross_sales,avg_order_value,mom_growth_pct
2026-01,120,88,452300.75,3769.17,
2026-02,96,70,389120.00,4053.33,-13.97
2026-03,0,0,0.00,0.00,-100.00
2026-04,140,101,512000.10,3657.14,
```

## ทำไมถึงเขียนแบบนี้

- **ทุกเดือนในช่วงมีแถวเสมอ** — เดือนที่ไม่มีออเดอร์จะหายไปจากผล `GROUP BY` ถ้าปล่อยหาย คนอ่านจะเข้าใจผิดว่ากราฟต่อเนื่อง
- **`mom_growth_pct` ว่างแทนที่จะเป็น 0** เมื่อเดือนก่อนหน้ายอดเป็นศูนย์ — รายงาน "โต 100%" จากฐานศูนย์คือตัวเลขหลอกคนอ่าน
- **`Decimal` ตลอดเส้นทาง** ไม่มี float — ยอดขายที่เพี้ยน 0.01 บาทตอนกระทบยอดกับบัญชีคือบั๊กที่หาสาเหตุยากที่สุด
- **ช่วงเวลาเป็น half-open `[start, end)`** — ยัง sargable (ใช้ index ได้) และไม่ต้องกังวลเดือน 28/29/30/31 วัน
- **connection ตั้ง read-only + `statement_timeout` + `connect_timeout`** — เครื่องมือ report ไม่ควรมีทางเขียน DB และไม่ควรค้างกินทรัพยากร production
- **password ถูก mask ก่อนเข้าทุก log** และ DSN ไม่รับทาง argv
- **query เป็น parameterized ทั้งหมด** ไม่มีการต่อ string SQL

## Test

```
$ pytest -q
50 passed, 1 skipped in 0.12s
```

ครอบ edge case จริง: ข้ามปี, เดือน 28/31 วัน, timezone boundary, เดือนที่ไม่มียอดขาย, ยอดติดลบจาก refund,
หารด้วยศูนย์, การปัดเศษแบบ half-up, query คืนเดือนซ้ำ/นอกช่วง, DSN หาย, timezone ผิด, path ที่เขียนไม่ได้

ที่ skip คือ test ของ CLI parser ซึ่งต้องมี `psycopg` ติดตั้งก่อนถึงจะ import ได้ (เครื่องนี้ยังไม่มี)
นอกจากนี้ยังรัน smoke test ทั้ง pipeline ด้วย psycopg stub เพื่อยืนยันว่า error path, การ mask DSN
และ CSV ที่ออกมาถูกต้องจริง

## ต้องทำเพิ่มก่อนใช้จริง

1. `pip install -e ".[dev]"` — ยังไม่ได้ติดตั้ง `psycopg` บนเครื่องนี้ ส่วนที่ยิง DB จริงจึงยังไม่ได้รันกับ Postgres
2. `cp .env.example .env` แล้วใส่ `DATABASE_URL` ของ user ที่มีสิทธิ์ `SELECT` อย่างเดียว
3. ยืนยันชื่อ table/column และรายการ status ที่นับเป็นยอดขายกับเจ้าของข้อมูล — ถ้าไม่ตรง แก้ที่ `MONTHLY_SALES_SQL`
4. เช็คว่ามี index บน `(order_date, status)` แล้ว ไม่งั้น full scan ทุกครั้งที่รัน
5. ถ้าจะขึ้น cron ให้ชี้ไป replica ไม่ใช่ primary

ยังไม่ได้ทำ (ไม่ได้อยู่ในสิ่งที่ขอ): แยกยอดตามช่องทาง/สาขา/สินค้า, สรุปแบบรายไตรมาส, ส่งไฟล์เข้าอีเมล/S3
