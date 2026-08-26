## แผนก่อนลงมือ

โจทย์นี้เป็น endpoint รับเงิน — จุดที่พลาดแล้วเสียเงินจริง เลยวางไว้ 3 เรื่องก่อนเขียน:

1. **verify signature จาก raw bytes ก่อน parse JSON** — payload ที่ไม่ verify คือใครส่งมาก็ได้ ถ้า parse ก่อนแล้ว stringify ใหม่มา verify ไบต์จะไม่ตรงกับที่ gateway เซ็น
2. **idempotency** — gateway ทุกเจ้ายิงซ้ำเป็นเรื่องปกติ ถ้าไม่กัน ลูกค้าจะได้อีเมลยืนยันหลายใบ
3. **อีเมลล้มต้องไม่ทำให้สถานะเงินหาย** — เป็นคนละ transaction กัน

data flow: `POST /api/v1/webhooks/payments` → verify HMAC → zod validate → transaction เดียว (บันทึก event id + ล็อกแถว order + เทียบยอด + update เป็น paid) → commit → ส่งอีเมล → บันทึกว่าส่งแล้ว

> หมายเหตุ: ปกติผมจะขอ confirm เรื่อง gateway/DB ก่อน แต่รอบนี้เดินตามสมมติฐานที่ระบุไว้ท้ายเอกสารไปเลย ถ้าไม่ตรงบอกได้ครับ แก้ไม่เยอะ

## โครงสร้าง

```
payment-webhook/
├── migrations/001_orders_and_payment_webhook_events.sql
├── src/
│   ├── config.ts                    # validate env ด้วย zod ตอน boot (fail fast)
│   ├── logger.ts                    # structured JSON log + maskEmail
│   ├── db.ts                        # pg Pool + withTransaction
│   ├── http/app.ts                  # express app, request id, error handler, /healthz
│   ├── index.ts                     # bootstrap + graceful shutdown
│   ├── payments/
│   │   ├── signature.ts             # HMAC verify (pure — ที่เดียวที่รู้รูปแบบ signature)
│   │   ├── webhookRoute.ts          # raw body, zod schema, outcome → status code
│   │   ├── paymentService.ts        # business logic ล้วน ไม่รู้จัก express/pg
│   │   └── orderRepository.ts       # SQL parameterized ทั้งหมด
│   └── email/mailer.ts              # nodemailer + template
└── tests/{signature,paymentService}.test.ts
```

เส้นแบ่งเดียวที่ตั้งใจลาก คือ **business logic ↔ framework/IO** — `paymentService.ts` รับ dependency เป็นฟังก์ชันธรรมดา เลยเทสต์ทุก branch ที่เกี่ยวกับเงินได้โดยไม่ต้องมี Postgres/SMTP ไม่มี DI container ไม่มี interface สำหรับ provider หลายเจ้า (ตอนนี้มีเจ้าเดียว — ถ้าจะเพิ่มค่อยแตกทีหลัง)

## การตัดสินใจที่อยากให้รู้

**1. แถว `payment_webhook_events` ถูก insert ใน transaction เดียวกับการ update order**
ถ้าแยก commit จะเกิดเคสที่ event ถูกมาร์คว่า "ทำแล้ว" แต่ order ไม่เคยถูกอัปเดต แล้ว retry ของ gateway จะถูกกันทิ้งทั้งหมด — order นั้นจะค้างเป็น pending ตลอดกาล พอมัดรวมเป็น transaction เดียว เวลา rollback แถว event หายไปด้วย retry จึงยังทำงานได้

**2. ไม่เชื่อยอดเงินที่ gateway ส่งมา** — เทียบกับยอดใน DB ก่อนเสมอ ถ้าไม่ตรงจะไม่อัปเดตเป็น paid, ตอบ 409 และ log ระดับ error ไว้ให้ตั้ง alert

**3. `UPDATE ... WHERE id = $1 AND status = 'pending'`** — เงื่อนไขท้ายทำให้ปลอดภัยเมื่อยิงซ้ำ และไม่ไปทับ order ที่ถูกยกเลิก/คืนเงินไปแล้ว (`SELECT ... FOR UPDATE` ล็อกแถวไว้กัน webhook สองใบเข้าพร้อมกัน)

**4. อีเมลส่งหลัง commit และ "ล้มได้"** — order เป็น paid ไปแล้ว การตอบ 5xx กลับไปมีแต่ทำให้ gateway retry ซึ่งจะถูก idempotency กันอยู่ดี จึง log ให้ดังพอตั้ง alert แล้วปล่อยผ่าน โดยแถวที่ `status='paid' AND confirmation_email_sent_at IS NULL` คือคิวให้ job ตามส่งทีหลัง (ใส่ partial index รองรับไว้แล้ว แต่ **ตัว worker ยังไม่ได้เขียน**)

**5. status code ที่ตอบ gateway** เลือกตามว่า "retry แล้วช่วยไหม"
| สถานการณ์ | status |
| --- | --- |
| สำเร็จ / event ซ้ำ / order จ่ายแล้ว / type ที่ไม่สนใจ | `200` (จบแล้ว ไม่ต้อง retry) |
| signature ผิด/หาย/หมดอายุ | `401` |
| JSON พัง / ผิด schema | `400` |
| ไม่พบ order | `404` (rollback ไว้ เผื่อ webhook มาถึงก่อน order commit → retry แล้วสำเร็จได้) |
| ยอดไม่ตรง | `409` |

## เรื่อง test — ยังรันไม่ได้

รัน `npm test` ไม่ได้เพราะยังไม่ได้ `npm install` (ไม่มี vitest ในเครื่อง) เลย **ไม่มีตัวเลขผ่าน/ไม่ผ่านให้** เขียนไว้ 2 ไฟล์:
- `tests/signature.test.ts` — signature ถูก/ผิด secret/payload ถูกแก้/header หาย/header เพี้ยน/timestamp เกิน tolerance ทั้งสองทาง/ขอบ tolerance พอดี/body ว่าง/payload ภาษาไทย+emoji
- `tests/paymentService.test.ts` — happy path, event ซ้ำ, ไม่พบ order (ต้อง rollback), ยอดไม่ตรง, สกุลเงินไม่ตรง, order จ่ายแล้ว, order cancelled/refunded/failed, แพ้ race ตอน update, ส่งอีเมลล้ม, DB ล่มต้องเด้งขึ้นไปชั้นบน

ที่ยืนยันได้ตอนนี้มีแค่: ทุกไฟล์ผ่าน syntax check ของ Node แล้ว และผมรัน logic หลัก (signature + service) ผ่านสคริปต์ชั่วคราวนอกโปรเจกต์ดูพฤติกรรมแล้วตรงตามที่ออกแบบ — แต่นั่นไม่ใช่การรัน test suite จริง ยังไม่ได้ผ่าน `tsc` ด้วย (ไม่มี typescript ในเครื่อง) หลัง `npm install` รบกวนรัน `npm run typecheck && npm test` อีกรอบ

## ต้องตั้งค่าเพิ่ม

```bash
npm install
cp .env.example .env
psql "$DATABASE_URL" -f migrations/001_orders_and_payment_webhook_events.sql
```
env ที่จำเป็น: `DATABASE_URL`, `PAYMENT_WEBHOOK_SECRET` (≥16 ตัว), `SMTP_URL`, `MAIL_FROM` — ถ้าขาดตัวใดตัวหนึ่ง process จะไม่ start ให้เลย (ตั้งใจ) และ `.env` อยู่ใน `.gitignore` แล้ว

## สิ่งที่สมมติไว้ ถ้าไม่ตรงบอกได้

1. **รูปแบบ signature** — `X-Payment-Signature: t=<unix>,v1=<hex hmac-sha256>` โดยเซ็น `<t>.<raw body>` (สูตร Stripe/Omise) ถ้า gateway จริงเป็น 2C2P/GB Prime Pay ที่ใช้สูตรอื่น แก้แค่ `src/payments/signature.ts` ไฟล์เดียว ที่เหลือไม่รู้จักรูปแบบ signature เลย
2. **Postgres + `pg`** (ไม่ได้ใช้ ORM) และ **nodemailer** — ถ้าโปรเจกต์จริงใช้ Prisma หรือส่งอีเมลผ่าน SendGrid API บอกได้ ผมเปลี่ยนให้เฉพาะ repository/mailer
3. **ตาราง `orders`** — ผมร่าง schema ให้ใน migration พร้อมคอลัมน์ `confirmation_email_sent_at` ถ้ามีตารางอยู่แล้ว ให้เอาเฉพาะ `payment_webhook_events` กับคอลัมน์ที่ขาดไปใช้
4. **เงินเก็บเป็นสตางค์ (integer)** ทั้ง DB และ payload และสมมติสกุลเงินทศนิยม 2 ตำแหน่ง (ถ้าต้องรองรับ JPY ต้องเพิ่มตาราง exponent ใน `mailer.ts`)
5. `order_id` ใน payload เป็น UUID เดียวกับ `orders.id`

## ที่ยังไม่ได้ทำ (ตั้งใจ)

- **job ตามส่งอีเมลที่ค้าง** — schema/index พร้อมแล้ว เหลือ worker
- **rate limit / IP allowlist ที่ชั้น edge** — signature กันของปลอมได้ แต่ไม่กันคนยิงถล่ม
- **integration test ที่ยิง HTTP จริง** (ต้องใช้ supertest + Postgres ในเทสต์)
- **ESLint/Prettier config**

ทั้งสามอย่างแรกเป็นงานแยก ถ้าจะเอาบอกได้ครับ
