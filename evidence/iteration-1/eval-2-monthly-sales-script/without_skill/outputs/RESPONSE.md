เขียนให้แล้วครับ เป็น package เล็ก ๆ แยก layer ชัดเจน ไม่ใช่ไฟล์เดียวรวด เพราะส่วน logic จะได้เทสต์ได้โดยไม่ต้องมี DB จริง

**โครงสร้าง**

```
monthly_sales/
  config.py    # อ่าน/validate config จาก env
  queries.py   # SQL ทั้งหมดอยู่ที่เดียว
  report.py    # month arithmetic + row model + เขียน CSV (pure logic)
  db.py        # connect + execute (import psycopg แบบ lazy)
  cli.py       # argparse entry point
tests/         # 27 unit tests ผ่านหมด รันด้วย stdlib ไม่ต้องต่อ DB
schema.sql     # schema ที่สมมติไว้ + index + grant สำหรับ read-only role
```

**ข้อสมมติเรื่อง schema** (ถ้าของจริงไม่ตรง แก้ที่ `queries.py` ที่เดียวจบ)

ตาราง `orders(order_date timestamptz, status text, customer_id bigint, currency char(3), total_amount numeric(12,2))` และนับเฉพาะออเดอร์ที่เป็นรายได้จริงคือ status `paid` / `completed` / `shipped` ส่วนที่ยกเลิกหรือคืนเงินไม่นับ

**วิธีรัน**

```bash
pip install -r requirements.txt
cp .env.example .env && set -a && . ./.env && set +a

# 12 เดือนเต็มล่าสุด (ตัดเดือนปัจจุบันที่ยังไม่จบออก จะได้ไม่เอาเดือนครึ่ง ๆ ไปปนกับเดือนเต็ม)
python -m monthly_sales -o monthly_sales.csv

# ระบุช่วงเอง เฉพาะ THB และเติมเดือนที่ไม่มียอดขายเป็น 0
python -m monthly_sales --start 2025-01 --end 2025-12 --currency THB --fill-gaps
```

**คอลัมน์ที่ได้:** `month, currency, order_count, customer_count, gross_revenue, avg_order_value`

**จุดที่ตั้งใจทำไว้**

- credential อ่านจาก env อย่างเดียว ไม่ฝังในโค้ด และ `repr()` ของ config ปิดบัง password ไม่ให้หลุดไป log
- SQL bind parameter ทุกตัวผ่าน psycopg ไม่มี string format — กัน SQL injection
- connection ตั้ง read-only และมี `statement_timeout` กัน query ค้างค้างคาบน production replica
- ยอดเงินใช้ `Decimal` ตลอดสาย ไม่แตะ float
- เขียน CSV แบบ atomic (เขียน temp แล้ว `os.replace`) ถ้าพังกลางทางจะไม่เหลือไฟล์ครึ่ง ๆ ให้เอาไปใช้ผิด
- exit code แยก: 0 สำเร็จ / 2 config ผิด / 3 DB พัง เอาไปใส่ cron แล้ว alert ได้เลย

**เรื่องที่อยากให้เช็คก่อนเอาไปใช้จริง**

1. ชื่อ status ในระบบคุณตรงกับที่สมมติไว้ไหม ถ้ามีเช่น `partially_refunded` ต้องตัดสินใจว่านับหรือไม่นับ
2. `date_trunc('month', ...)` อิง timezone ของ session ถ้าข้อมูลเป็น `timestamptz` ควรตั้ง `PGTZ` ให้ตรงกับที่บัญชีใช้ ไม่งั้นออเดอร์ปลายเดือนตอนดึกจะตกไปอีกเดือน
3. `total_amount` เป็นยอดรวมภาษีแล้วยังไม่รวมค่าส่ง ถ้าต้องการแยก net/vat/shipping บอกได้ เพิ่มคอลัมน์ให้ไม่ยาก

รันเทสต์: `python -m unittest discover -s tests -t .` (27 tests ผ่านหมด)
