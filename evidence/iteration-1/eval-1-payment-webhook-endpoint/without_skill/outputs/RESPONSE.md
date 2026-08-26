เสร็จแล้วครับ ทำเป็น service แยก layer ชัดเจน (route → service → repository) ให้เทสง่ายและสลับ DB จริงได้โดยไม่ต้องแก้ business logic

## Endpoint

```
POST /webhooks/payments
X-Payment-Signature: t=<unix-seconds>,v1=<hex hmac-sha256>
```

รับ event แล้ว: ตรวจลายเซ็น → validate payload → เช็คยอดเงินกับ order → อัพเดทสถานะเป็น `paid` → ส่งอีเมลยืนยัน

## จุดที่ผมตัดสินใจให้ (สำคัญกว่าโค้ดเอง)

**1. Verify signature บน raw bytes**
คำนวณ HMAC-SHA256 จาก byte ที่ gateway ส่งมาเป๊ะ ๆ เลยต้อง mount route ด้วย `express.raw()` ไม่ใช่ `express.json()` — ถ้าเผลอใส่ `app.use(express.json())` ครอบทั้งแอปเมื่อไหร่ ลายเซ็นจะพังทันที เขียนหมายเหตุไว้ในโค้ดแล้ว
เทียบค่าด้วย `timingSafeEqual` และมี timestamp tolerance 300 วิ กัน replay ของเก่า

**2. Idempotency สองชั้น**
Gateway ยิงซ้ำเป็นเรื่องปกติ (retry, at-least-once) ถ้าไม่กันจะได้ order paid ซ้ำ + อีเมลซ้ำ ผมกันไว้ที่:
- claim event id ก่อนประมวลผล (ซ้ำ = ตอบ 200 แล้วจบ)
- `markAsPaid` เป็น conditional update ที่คืน `alreadyPaid` มาด้วย ถ้า order จ่ายไปแล้วจะไม่ส่งอีเมลซ้ำ แม้จะมาคนละ event id

ถ้าประมวลผลล้มเหลวกลางทาง จะ release claim คืนให้ gateway retry ได้

**3. อีเมลล้มเหลว ≠ webhook ล้มเหลว**
พอ order เป็น paid แล้ว ถ้าตอบ 5xx เพราะส่งเมลไม่ผ่าน gateway จะยิงซ้ำทั้งที่เงินเข้าแล้ว — ผมจึง log error ไว้แล้วตอบ 200 พร้อม `emailSent: false` ของจริงตรงนี้ควรโยนเข้า job queue ไว้ retry

**4. ไม่เชื่อ payload เรื่องยอดเงิน**
เทียบ `amount` + `currency` กับยอดใน order ก่อนเสมอ ไม่ตรง = 409 และไม่แตะสถานะ order เลย รวมถึงกัน order ที่ cancelled/refunded ไม่ให้ถูก mark paid

**5. Status code สื่อความหมายกับ gateway**
- 401/400/409 = อย่า retry (ผิดตั้งแต่ต้นทาง)
- 404 order ไม่เจอ / 500 = retry ได้ (อาจ race กับ order creation)

## โครงสร้าง

```
src/app.ts, server.ts          wiring + graceful shutdown
src/config/env.ts              zod validate env, พังตั้งแต่ boot ถ้า config ขาด
src/middleware/                request-id, verify signature, error handler
src/routes/paymentWebhook.ts
src/services/                  signature, paymentWebhookService, emailService
src/repositories/              OrderRepository, ProcessedEventStore (in-memory)
tests/                         unit + integration (supertest)
```

Repository เป็น in-memory ไว้ก่อน ตอนต่อ DB จริงแก้แค่ `src/server.ts` จุดเดียว — แต่ต้องคง contract ไว้: `markAsPaid` ต้องเป็น UPDATE เดียวที่มีเงื่อนไข `WHERE status='pending'` และ `claim` เป็น `INSERT ... ON CONFLICT DO NOTHING` ไม่งั้น idempotency จะพังตอนมี request พร้อมกัน

## Tests

เขียนคลุมเคสที่พังจริงในโปรดักชัน: signature ปลอม/หมดอายุ/body ถูกแก้หลังเซ็น, ยิงซ้ำ, ยอดไม่ตรง, order ไม่มี, order ถูกยกเลิก, SMTP ล่ม (order ต้องยังเป็น paid), HTML escape ในอีเมล

รัน: `npm install && npm test`

## ที่ยังไม่ได้ทำ (ตั้งใจ)

- ยังไม่ต่อ DB จริงกับ SMTP จริง — ต้องรู้ก่อนว่าใช้อะไร (Postgres/Prisma? SES/SendGrid?)
- ยังไม่ใส่ rate limit ที่ตัว endpoint — ปกติควรอยู่ที่ ingress/WAF มากกว่า
- ชื่อ header กับรูปแบบลายเซ็นผมทำตามแบบ Stripe ไว้ก่อน ถ้า gateway ที่ใช้จริงเป็นเจ้าอื่น (Omise, 2C2P, GB Prime) บอกได้เลยครับ แก้แค่ `src/services/signature.ts` ไฟล์เดียว
