# สรุปยอดขายรายเดือน → CSV

## แผน (ไม่มีขั้นตอน approval ในรอบนี้ จึงบันทึกแผนไว้แล้วลงมือเลย)

- เป็น "script" ตามที่ขอ → ไฟล์เดียว `monthly_sales_report.py` ไม่แตกเป็น package/layer
- data flow: CLI args (`--start/--end`) → validate → query aggregate ที่ฝั่ง PostgreSQL (เดือนละแถว) → เติมเดือนที่ไม่มียอดให้เป็น 0 → เขียน CSV
- ตัดสินใจที่มีทางเลือกอื่น:
  - **GROUP BY ที่ DB** ไม่ใช่ดึง order ทุกแถวมารวมใน Python — ข้อมูลที่วิ่งกลับมาคือเดือนละแถว ไม่ว่าจะมีออเดอร์ล้านรายการ
  - **import `psycopg2` ข้างในฟังก์ชัน** ไม่ใช่ระดับ module — ทำให้ logic ส่วนคำนวณ/ฟอร์แมต test ได้โดยไม่ต้องมี driver หรือ DB จริง
  - **ตัดเดือนตาม `Asia/Bangkok`** ไม่ใช่ UTC — ออเดอร์ตอน 6 โมงเช้าวันที่ 1 (= 23:00 UTC ของวันสิ้นเดือน) ต้องนับเป็นเดือนใหม่ ไม่งั้นยอดสิ้นเดือนเพี้ยนทุกเดือน

```
outputs/
├── monthly_sales_report.py       # script หลัก
├── test_monthly_sales_report.py  # เทสส่วนที่ผิดแล้วตัวเลขผิด
├── requirements.txt
└── .env.example                  # ชื่อ env var (ไม่มีค่าจริง)
```

## วิธีใช้

```bash
pip install -r requirements.txt
export DATABASE_URL="postgresql://readonly_user:xxx@host:5432/shop"
python monthly_sales_report.py --start 2025-01 --end 2025-12 -o sales_2025.csv
```

ผลลัพธ์ (คอลัมน์: `month, order_count, customer_count, net_sales, avg_order_value`)

```csv
month,order_count,customer_count,net_sales,avg_order_value
2025-01,412,318,1284530.00,3116.58
2025-02,0,0,0.00,0.00
2025-03,530,401,1702110.50,3211.53
```

## สมมติฐานเรื่อง schema — ถ้าไม่ตรง แก้แค่ `MONTHLY_SALES_SQL` ก้อนเดียว

```
orders(id, customer_id, status text, ordered_at timestamptz, total_amount numeric)
```

- `ordered_at` เป็น `timestamptz` (เก็บ UTC) — ถ้าระบบเก็บเป็น `timestamp` เปล่า ให้ตัด `AT TIME ZONE` ออกทั้ง 3 จุด
- `total_amount` = ยอดสุทธิต่อออเดอร์หลังหักส่วนลดแล้ว — ถ้ายอดขายอยู่ที่ `order_items` ต้อง join แล้ว `sum(quantity * unit_price)` แทน
- นับเฉพาะสถานะใน `COUNTED_STATUSES = ("paid", "shipped", "completed")` — **จุดนี้น่าจะต้องแก้ให้ตรงกับ workflow จริงของคุณมากที่สุด** (ถ้ามี refund แยกตาราง ยอดจะยังไม่ถูกหัก)

## เรื่องที่จงใจทำ

- **ไม่ hardcode connection string** — อ่านจาก `DATABASE_URL` เท่านั้น, log ไม่พ่น dsn ออกมาเพราะมี password อยู่ข้างใน
- **parameterized ทั้งหมด** ทั้ง timezone / ช่วงวัน / รายการสถานะ — ไม่มีการต่อ SQL ด้วย string
- **เติมเดือนที่ไม่มีออเดอร์เป็น 0** — เดือนที่หายไปเงียบ ๆ ทำให้คนอ่านคิดว่า "ข้อมูลยังไม่มา" แทนที่จะรู้ว่าเดือนนั้นขายไม่ได้จริง ๆ
- **เงินเป็น `Decimal` ปัดแบบ half-up** ไม่ใช่ float และไม่ใช่ banker's rounding ที่เป็นค่า default ของ Python
- **CSV เขียนแบบ `utf-8-sig`** ให้ Excel บนวินโดวส์เปิดแล้วภาษาไทยไม่เพี้ยน
- `statement_timeout` 60 วิ + `connect_timeout` 10 วิ กันค้างถ้าตารางใหญ่หรือขาด index
- ถ้ายังไม่มี index แนะนำ `CREATE INDEX ON orders (ordered_at) WHERE status IN ('paid','shipped','completed');`

## เจอบั๊กระหว่างเขียน 2 จุด และแก้แล้ว

1. `int("๒๕๖๘")` ใน Python ได้ 2568 — พิมพ์เดือนด้วยเลขไทยหรือปี พ.ศ. จะได้ CSV ว่างเปล่าโดยไม่มี error ตอนนี้ validate ด้วย `[0-9]{4}-[0-9]{2}` (ไม่ใช่ `\d` เพราะ `\d` match เลขไทยด้วย) และจำกัดปี 1970-2100 พร้อมข้อความบอกว่าให้ใช้ ค.ศ.
2. `with psycopg2.connect(...)` ปิดแค่ transaction **ไม่ได้ปิด connection** — ครอบด้วย `closing()` เพิ่ม

## Test

รันจริงด้วย pytest 8.3.5:

```
19 passed in 0.04s
```

ครอบ: validate เดือน (เลขไทย / ปี พ.ศ. / เดือน 13 / format ผิด), ช่วงเดือนข้ามปี, เติมเดือนที่ไม่มียอด, หารเฉลี่ยตอน 0 ออเดอร์, การปัดเงิน half-up, และเนื้อไฟล์ CSV ที่เขียนออกมา

**ส่วนที่ยังไม่ได้ทดสอบ**: ตัว query กับ PostgreSQL จริง — เครื่องนี้ไม่มี `psycopg2` และไม่มี DB ให้ต่อ ผมไม่ได้ mock ไว้เพราะ mock cursor จะเทสแค่ว่า "เรียก execute จริงไหม" ไม่ได้ยืนยันว่า SQL ถูก ตอนเอาไปใช้จริง รบกวนลองรันช่วงสั้น ๆ (เช่นเดือนเดียว) เทียบกับตัวเลขที่รู้อยู่แล้วก่อนใช้ยาว

## ถ้าอยากได้เพิ่ม (ยังไม่ได้ทำ เพราะเกินที่ขอ)

แยกยอดตามช่องทาง/สาขา/หมวดสินค้า, ใส่คอลัมน์ % เติบโต MoM, หรือ export เป็น .xlsx หลายชีท — บอกได้ว่าจะเอาแบบไหน เดี๋ยวต่อยอดจากไฟล์เดิม
