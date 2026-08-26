## แผน

- **Endpoint เดียว** `POST /api/v1/payments/webhook` → verify signature → validate payload → use case → ตอบ 200/4xx/5xx ตามว่าต้องการให้ gateway ส่งซ้ำหรือไม่
- **แยก 3 ชั้น**: `domain` (กติกาว่าจ่ายครบไหม — pure) / `application` (orchestration + idempotency + email) / `infrastructure` (Postgres, SMTP) — เส้นแบ่งอยู่ตรง business logic กับ IO เพราะกติกาการรับเงินคือส่วนที่ผิดแล้วเสียเงินจริง ต้อง test ได้โดยไม่ต้องมี DB
- **Idempotency**: เก็บ `event_id` เป็น PK ใน `payment_events` แล้ว claim ใน transaction เดียวกับการอัพเดท order — webhook ที่ส่งซ้ำ (ซึ่ง gateway ทุกเจ้าทำ) จะไม่ตัดสถานะซ้ำและไม่ส่งอีเมลซ้ำ
- **อีเมลอยู่นอก transaction และล้มได้**: SMTP ล่มต้องไม่ทำให้เงินที่ gateway เก็บไปแล้ว rollback และต้องไม่ทำให้ gateway retry วนไม่จบ
- **ไม่มี repo เดิม** → ตั้งโครงตาม convention ของ Node/TS สมัยใหม่ (ESM, strict, zod ที่ขอบระบบ, vitest)

> ปกติงานที่สร้างไฟล์ ~30 ไฟล์ + วาง schema ใหม่แบบนี้ผมจะขอ approve แผนก่อน แต่ขอบเขตที่สั่งมาชัดพอ (endpoint เดียว + 2 side effect) เลยลงมือต่อเลย และสรุปสิ่งที่ตัดสินใจแทนไว้ท้ายข้อความ

```
src/
├── domain/            # กติกาล้วน ไม่รู้จัก Express/pg
│   ├── order.ts       # decidePayment(): accept | already_applied | reject
│   └── money.ts       # เงินเป็น integer minor units เท่านั้น
├── application/
│   ├── ports.ts       # OrderRepository / OrderTransaction / EmailSender
│   └── confirm-order-payment.ts
├── infrastructure/
│   ├── postgres/      # pool + repository (parameterized ทั้งหมด)
│   └── email/         # nodemailer sender + template ที่ escape HTML
├── webhook/
│   ├── signature.ts   # HMAC-SHA256 + timing-safe + replay window
│   └── schema.ts      # zod ที่ขอบระบบ → typed object เข้าไปข้างใน
├── http/              # app, error handler, request id, route
├── config.ts          # env ผ่าน zod, พังตั้งแต่ boot ถ้าตั้งค่าไม่ครบ
└── index.ts           # wiring + graceful shutdown
migrations/001_orders_and_payment_events.sql
tests/                 # 5 ไฟล์
```

## การตัดสินใจที่สำคัญ (และเหตุผล)

**1. อ่าน raw body ไม่ใช่ JSON ที่ parse แล้ว** — `express.raw()` เฉพาะ route นี้ เพราะ signature เซ็นบน byte ที่ส่งมาจริง ถ้า parse แล้ว serialize กลับ ลำดับ key/ช่องว่างเปลี่ยน → verify ไม่ผ่านทุกครั้ง (บั๊กคลาสสิกของ webhook)

**2. Verify signature ก่อนแตะอะไรทั้งสิ้น** — payload ที่ยังไม่ verify คือใครส่งมาก็ได้ ใครก็ตั้ง order เป็น paid ได้ ใช้ HMAC-SHA256 + `timingSafeEqual` + timestamp อยู่ในสิ่งที่เซ็นและมี tolerance 5 นาที (กัน replay ของ payload จริงที่ดักไว้) และ **ไม่บอก client ว่าพลาดตรงไหน** — เหตุผลอยู่ใน log ฝั่งเรา

**3. เช็คยอดกับ order ใน DB เสมอ ไม่เชื่อยอดใน payload** — payload ที่ signature ถูกแต่ยอดไม่ตรง (จ่ายบางส่วน, gateway ตั้งค่าผิด, เอา payment ของ order ถูก ๆ มายิงใส่ order แพง ๆ) ต้องไม่ทำให้ order เป็น paid → log level `error` ให้คนมาเคลียร์

**4. อีเมลส่งจากที่อยู่ในตาราง orders ไม่ใช่ที่อยู่ใน payload** — ไม่งั้น endpoint นี้กลายเป็นช่องทางอ่านรายละเอียด order ของคนอื่น

**5. HTTP status = คำสั่งว่าจะ retry ไหม**
| ผลลัพธ์ | code | เหตุผล |
| --- | --- | --- |
| จ่ายสำเร็จ / ส่งซ้ำ / ยอดไม่ตรง / order ยกเลิกแล้ว | 200 | ส่งมาอีกกี่รอบผลก็เหมือนเดิม อย่า retry — เคสผิดปกติ log เป็น error ไว้ reconcile |
| body ไม่ใช่ JSON / ผิด schema | 400 | byte ชุดเดิมส่งใหม่ก็ผิดเหมือนเดิม |
| signature ผิด/หมดอายุ/ไม่มี | 401 | ไม่ใช่ผู้ส่งของเรา |
| DB ล่ม | 500 | อันนี้ต้องการให้ส่งซ้ำ |

**6. `SELECT ... FOR UPDATE` + unique index บน `payment_id`** — webhook สองใบมาพร้อมกันเป็นเรื่องปกติ ล็อกแถวกัน double-apply และ index กัน payment เดียวไปตัดสอง order

**7. ที่ไม่ทำ (YAGNI)** — ไม่มี interface ของ payment provider, ไม่มี DI container, ไม่มี event bus: ตอนนี้มี gateway เจ้าเดียวและ use case เดียว ส่วน `OrderRepository`/`EmailSender` มี implementer จริง 2 รายแล้ว (Postgres/SMTP กับ in-memory ใน test) จึงคุ้มที่จะมี

## Test

รัน vitest ไม่ได้เพราะยังไม่ได้ `npm install` ในเครื่องนี้ **แต่ไม่ได้รายงานว่าผ่านลอย ๆ** — โมดูลที่ไม่มี dependency ภายนอกผมรันจริงด้วย Node 22 type-stripping (`node --experimental-strip-types --test`) แล้ว:

- **25/25 ผ่าน** — signature (ถูกต้อง, body ถูกแก้, secret ผิด, replay เกิน window, header เพี้ยน 6 แบบ, ตัดท้าย hash, body ภาษาไทย+emoji), `decidePayment` ทุกกิ่ง, money
- **9/9 ผ่าน** — use case: mark paid + ส่งอีเมล, event ซ้ำ, payment เดิมคนละ event id, ยอดไม่ตรง, order ถูกยกเลิก, ไม่พบ order, **SMTP ล่มแล้ว order ยัง paid**, **DB ล่มแล้ว rollback จน claim event หายไปด้วยและ retry ผ่าน**, **สอง delivery พร้อมกันตัดเงินครั้งเดียว**
- **3/3 ผ่าน** — email template escape `<img onerror=...>` ที่ฝังมากับ order id

เจอของจริงจากการรัน 1 อย่าง: `Intl.NumberFormat` **ไม่ throw** กับ currency code แปลกที่รูปแบบถูก (`XYZ` → `XYZ 5.00`) จะ throw เฉพาะ code ที่ผิดรูป (`TH1`) — แก้ comment กับ test ให้ตรงพฤติกรรมจริงแล้ว

ที่เหลือ (route + zod schema, 14 เคส) เขียนไว้ใน `tests/payment-webhook.route.test.ts` รอ `npm install && npm test`

## ต้องตั้งค่าเพิ่มก่อนใช้

1. `npm install` → `cp .env.example .env` → เติมค่า → `npm run migrate`
2. **`src/webhook/signature.ts` + `src/webhook/schema.ts` คือสองไฟล์ที่ต้องปรับตาม gateway จริง** — ผมใช้สคีมแบบ Stripe (`x-payment-signature: t=<ts>,v1=<hex>` เซ็นบน `<ts>.<raw body>`) ซึ่งตรงกับ Stripe/Omise และเจ้าอื่นในกลุ่มนี้ แต่ถ้าใช้ 2C2P/GBPrimePay ชื่อ header กับชื่อ field จะต่างกัน บอกชื่อ gateway มาได้ ผมแก้ให้ตรง spec — ไฟล์อื่นไม่ต้องแตะ
3. ตาราง `orders` ที่ผมสร้างมี field เท่าที่ flow นี้ต้องใช้ ถ้ามีตารางเดิมอยู่แล้วให้ merge เอาเฉพาะ `payment_id / paid_at / confirmation_email_sent_at` + ตาราง `payment_events`

## สิ่งที่ยังไม่ได้ทำ (ตั้งใจ)

- **Sweeper ส่งอีเมลซ้ำ**: order ที่ paid แล้วแต่ `confirmation_email_sent_at IS NULL` คือคิว retry (มี partial index รออยู่แล้ว) แต่ตัว cron/worker ยังไม่ได้เขียน — ถ้า SMTP ล่มตอนนี้ ลูกค้าจะไม่ได้อีเมลจนกว่าจะมีคนรัน ตัวนี้เป็นงานชิ้นถัดไปที่ผมแนะนำให้ทำ
- **Rate limit** ที่ระดับแอป: ยังไม่ใส่ ตอนนี้กันด้วย body cap 64kb + HMAC ที่ราคาถูก ถ้าเปิดสู่ public จริงแนะนำจำกัดที่ WAF/ingress และ allowlist IP ของ gateway
- **Refund / payment.failed**: ยังไม่รองรับ (event type อื่นถูก ack ด้วย 200 แล้วข้าม) เพราะยังไม่มี requirement เรื่องสถานะ refunded
