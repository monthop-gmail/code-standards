## ⚠️ ก่อนอื่น — เรื่องด่วนที่ต้องทำวันนี้

ไฟล์เดิมมี credential จริงเขียนอยู่ในโค้ด:
- password DB `app_admin` ของ `db.internal.acme.co`
- mail API key `sk_live_...`

**ต้อง rotate ทั้งสองตัว ไม่ใช่แค่ลบออกจากไฟล์** เพราะมันอยู่ใน git history ไปแล้ว ใครที่ clone repo นี้ได้ = มี password production ทั้งคู่ ผมย้ายไปอ่านจาก env var ให้แล้ว (`.env.example`) แต่การเปลี่ยนรหัสจริงต้องทำที่ฝั่ง DB/mail provider

และของเดิม **SQL injection ได้ทุก query** — `"... WHERE id = " + req.params.id` ทำให้ `GET /orders/1 OR 1=1` อ่าน order ของทุกคนได้ ส่วน `POST` ก็ส่ง `coupon` เป็น payload อะไรก็ได้เข้าไปต่อ string ตรง ๆ ถ้า endpoint นี้เปิดอยู่บน production ควรถือว่าข้อมูลรั่วไปแล้วจนกว่าจะพิสูจน์ได้ว่าไม่

---

## สิ่งที่ทำ

ปัญหาจริงของไฟล์นี้ไม่ใช่ "ยาว" แต่คือ **ฟังก์ชันเดียวทำ 5 อย่าง** (validate + query + คิดเงิน + เขียน DB + ส่งอีเมล) เลยไม่มีจุดไหนที่ test ได้เลย และกฎคิดเงินซึ่งเป็นส่วนที่ผิดแล้วเสียเงินจริง ก็ฝังอยู่กลางโค้ดที่ต้องมี MySQL ถึงจะรันได้

```
outputs/
├── src/
│   ├── errors.js                     # error base ตัวเดียวของทั้งแอป + mapping ไป HTTP status
│   ├── logger.js                     # structured log (JSON บรรทัดเดียว) ไม่มี PII
│   ├── app.js                        # ประกอบ dependency ทั้งหมดที่จุดเดียว
│   ├── config/env.js                 # อ่าน env, ขาดตัวไหนล้มตั้งแต่ boot
│   ├── db/pool.js
│   ├── http/middleware.js            # asyncHandler, requireAuth, error handler
│   ├── notifications/order-mailer.js # fetch ของ Node 18+ พร้อม timeout
│   └── orders/
│       ├── pricing.js                # กฎคิดเงินล้วน ๆ — pure function ไม่รู้จัก DB/express
│       ├── order.validation.js       # ตรวจ input ที่ขอบระบบ
│       ├── order.repository.js       # SQL ทั้งหมดของ feature นี้ (parameterized ทุกอัน)
│       ├── order.service.js          # orchestration + transaction
│       └── order.routes.js           # HTTP ล้วน ไม่มี logic ไม่มี SQL
├── tests/                            # 39 tests, ผ่านหมด (node --test, ไม่ต้อง install อะไร)
├── .env.example
└── PLAN.md                           # แผน + เหตุผลของการตัดสินใจแต่ละข้อ
```

### เส้นแบ่งที่เลือก และทำไม

**`pricing.js` แยกออกมาเป็น pure function** — นี่คือ 80% ของคุณค่าที่ได้จาก refactor นี้ กฎส่วนลด/ค่าส่งเป็นส่วนที่ถูกขอแก้บ่อยที่สุดและผิดแล้วเสียเงินจริง พอมันไม่ต้องพึ่ง DB ก็เขียน test ครอบ edge case ได้หมดในเสี้ยววินาที (ขอบของ `qty > 10`, คูปองใหญ่กว่ายอด, ค่าส่งที่ยอด 1500.00 พอดี)

**SQL ทั้งหมดอยู่ไฟล์เดียว ไม่แตกเป็น product/coupon/order repo** — ทุก query ในนั้นเปลี่ยนด้วยเหตุผลเดียวกัน และถ้าแตกจะได้ไฟล์ละ 15 บรรทัดที่ต้องเปิด 4 ไฟล์เพื่ออ่าน flow เดียว ซึ่งแย่กว่าเดิม

**ไม่เพิ่ม dependency ใหม่เลย** — ไม่ลง zod (validation เขียนเอง ~80 บรรทัด), ถอด `node-fetch` ออกเพราะ Node 18+ มี `fetch` แล้ว, test ใช้ `node:test` ที่ติดมากับ runtime คุณจึงรัน `npm test` ได้ทันทีโดยไม่ต้องแตะ package-lock

**คงเป็น JavaScript + CommonJS** — ของเดิมเป็นแบบนี้ ผมใส่ type ครบด้วย JSDoc แทน (เปิด `checkJs` ได้เลยถ้าอยากได้ type check) การแปลงเป็น TypeScript ควรเป็น PR แยก ไม่ควรพ่วงมากับงานนี้จนอ่าน diff ไม่ออก

**ไม่ใส่ interface/factory/DI container** — service รับ dependency ผ่าน argument ธรรมดา มีผู้ใช้จริง 2 ราย (production ต่อ MySQL, test ใช้ fake) แค่นั้นพอ

### บั๊กที่เจอระหว่างทาง (ไม่ได้อยู่ในคำขอ แต่แก้ให้แล้ว)

| ของเดิม | ผลที่เกิด |
| --- | --- |
| `if (total > 1500) { total = total }` | บรรทัดที่ไม่ทำอะไรเลย — เจตนาคือ "ส่งฟรี" ตอนนี้เขียนเป็น `calculateShipping()` ที่อ่านออก |
| ไม่มี transaction | insert `order_items` พังกลางคัน = เหลือ order เปล่าค้างใน DB ตอนนี้ครอบ transaction + rollback |
| `catch (e) {}` ตอนส่งอีเมล | mail service ล่มแล้วไม่มีใครรู้ ตอนนี้ order ยัง commit ปกติ (degrade ได้) แต่ log พร้อม `orderId` ให้ตามส่งซ้ำได้ |
| ไม่มี timeout ตอนเรียก mail | mail service ค้าง = request ลูกค้าค้างตาม ตอนนี้ตั้ง 5 วินาที (ปรับผ่าน env) |
| N+1 query | ตะกร้า 20 ชิ้น = 21 query ตอนนี้ query เดียวด้วย `IN (?)` ส่วน `GET` ใช้ JOIN แทน loop |
| `p.price` ตอนสินค้าถูกลบ | `TypeError` → ตอบ `{ ok: false }` status 200 ตอนนี้ตอบ 422 พร้อมบอกว่า product id ไหนหาย |
| `GET /orders/:id` ไม่มี try/catch | query พัง = unhandled rejection, request ค้างจน timeout |
| คิดเงินบน float | ส่วนลดทบกันแล้วเศษเพี้ยน ตอนนี้คิดบนจำนวนเต็มสตางค์ แล้วแปลงกลับเป็นบาทตอนเขียน DB (**ไม่ต้อง migrate schema**) |
| `console.log('order created', orderId, req.body)` | log อีเมลลูกค้าลง stdout ทุก order ตอนนี้ log เฉพาะ id กับยอด |

## สิ่งที่เปลี่ยนพฤติกรรม — ต้องแก้ฝั่ง client ด้วย

1. **`userId` และ `email` ไม่รับจาก body อีกแล้ว** ของเดิมใครก็ยิงสั่งของในนามคนอื่นได้ และสั่งให้ส่งอีเมลไปที่อยู่ไหนก็ได้ ตอนนี้ `userId` มาจาก session และอีเมลดึงจาก `users` ตาม id นั้น
2. **`GET /orders/:id` ของคนอื่นได้ 404** (ไม่ใช่ 403 — 403 จะเป็นการยืนยันว่า order id นั้นมีอยู่จริง)
3. **response ไม่ใช่ `{ ok: true/false }` status 200 เสมอ** เปลี่ยนเป็น `201` + `{ data: {...} }` และ error เป็น `{ error: { code, message } }` พร้อม status ที่ถูกต้อง (401/404/422/500)
4. **คูปองที่ไม่มีอยู่จริงตอบ 422** ของเดิมเงียบ ๆ ไม่ลดให้ ลูกค้าเห็นยอดไม่ตรงที่คาดโดยไม่มีคำอธิบาย
5. **สินค้าซ้ำในตะกร้าถูกปฏิเสธ** ให้รวม qty มาก่อน (ของเดิมได้สองบรรทัด ซึ่งแต่ละบรรทัดอาจไม่ถึงเกณฑ์ส่วนลดจำนวนมากทั้งที่รวมแล้วถึง)
6. **route ย้ายไปใต้ `/api/v1`** — เพิ่ม versioning ทีหลังเจ็บกว่า

## ต้องทำต่อ

- **rotate DB password + mail API key** (ข้อบนสุด)
- ตั้ง env ตาม `.env.example` — ขาดตัวไหนแอปจะล้มตั้งแต่ boot ไม่ใช่ตอน request แรก
- `createApp()` **บังคับ**ให้ส่ง `authenticate` middleware ของระบบ auth ที่มีอยู่เข้ามา (ตัวที่เซ็ต `req.user = { id }`) ผมไม่ได้เขียน auth ให้เพราะไม่รู้ว่าระบบเดิมใช้อะไร และไม่อยากใส่ของปลอมที่ดูเหมือนทำงาน — ถ้ายังไม่มี บอกได้ว่าใช้อะไรอยู่ (JWT/session/API gateway) เดี๋ยวต่อให้
- ผมสมมติว่ามีตาราง `users` ที่มี column `email` — ถ้าชื่อไม่ตรง แก้ที่ `findUserEmail()` จุดเดียว

**สิ่งที่ผมยังไม่ได้ทำ เพราะต้องเปลี่ยน schema (ควรเป็น PR แยก):**
- ตาราง `coupons` ไม่มี column วันหมดอายุ/จำนวนครั้งที่ใช้ได้ → ตอนนี้คูปองเก่าใช้ได้ตลอดกาลและใช้ซ้ำได้ไม่จำกัด นี่คือช่องโหว่เชิงธุรกิจที่ควรอุด
- ยังไม่มี idempotency key → ลูกค้ากดปุ่มสั่งซื้อรัว ๆ จะได้ order ซ้ำ
- ยังไม่ได้เช็ค stock ตอนสั่ง

## รัน test

```
npm test        # หรือ  node --test "tests/**/*.test.js"
# 39 tests, pass 39, fail 0
```

รันแล้วผ่านจริงครับ ไม่ต้อง `npm install` เพราะ test ไม่แตะ express/mysql2 เลย (ใช้ fake repository)
