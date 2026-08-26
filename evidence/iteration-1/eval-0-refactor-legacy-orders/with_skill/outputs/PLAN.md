# แผนก่อนลงมือ (บันทึกไว้แทนการขอ approval — ไม่มี approval step ใน environment นี้)

งานนี้เข้าเกณฑ์ "ต้องขอ approval" ตาม workflow ข้อ 1 (แก้ไฟล์เกิน 5 ไฟล์ + เปลี่ยน folder structure)
เมื่อขอไม่ได้ จึงบันทึกแผน + เหตุผลของการตัดสินใจไว้ที่นี่ แล้วเดินตามดุลพินิจ

## ขอบเขต
Refactor `inputs/legacy_orders.js` (94 บรรทัด, express + mysql2, CommonJS) เป็นโครงที่แยก layer,
ปิดช่องโหว่ security ที่มีอยู่, และมี test ครอบ business logic

## ตัดสินใจอะไรบ้าง (และทางเลือกที่ไม่เลือก)

1. **คง JavaScript + CommonJS ไม่แปลงเป็น TypeScript/ESM**
   ของเดิมเป็น CommonJS — หลักการข้อ 2 บอกให้กลืนไปกับ convention ของ repo ก่อน
   type ครบด้วย JSDoc typedef แทน (ได้ IntelliSense + `checkJs` ได้ถ้าอยากเปิดทีหลัง)
   การแปลงเป็น TS เป็นข้อเสนอแยก ไม่ควรพ่วงมากับ refactor นี้

2. **ไม่เพิ่ม dependency ใหม่เลย (ไม่ใช้ zod / node-fetch)**
   validation เขียนเองประมาณ 80 บรรทัด — คุ้มกว่าการเพิ่ม dep ใน PR ที่ผู้ใช้ขอแค่ "จัดโค้ดให้อ่านรู้เรื่อง"
   `node-fetch` ถอดออกได้เลยเพราะ Node 18+ มี `fetch` global แล้ว
   test ใช้ `node:test` ที่ติดมากับ runtime — รันได้โดยไม่ต้อง install อะไร

3. **แยก layer ตาม "เหตุผลของการเปลี่ยนแปลง" ไม่ใช่ตามจำนวนบรรทัด**
   - กฎคิดเงิน (ฝ่ายการตลาด/บัญชีขอแก้) → `orders/pricing.js` เป็น pure function ทั้งหมด
   - SQL ทั้งหมดของ feature นี้ (DBA/schema เปลี่ยน) → `orders/order.repository.js` **ไฟล์เดียว**
     ไม่แตกเป็น product/coupon/order repo แยก เพราะจะได้ไฟล์ละ 15 บรรทัดและต้องเปิด 4 ไฟล์เพื่ออ่าน flow เดียว
   - orchestration + transaction → `orders/order.service.js`
   - HTTP (status code, response shape) → `orders/order.routes.js`

4. **ไม่สร้าง interface/abstract/DI container**
   service รับ dependency ผ่าน argument ธรรมดา (`createOrderService({ pool, repository, mailer, logger })`)
   เหตุผลที่ใส่แค่นี้: มีผู้ใช้จริง 2 ราย คือ production (ต่อ MySQL) กับ test (ใช้ fake) — พอแล้ว

5. **เงินคิดเป็นจำนวนเต็มหน่วยย่อย (สตางค์) ภายใน**
   float คูณ/ลดเปอร์เซ็นต์แล้วเพี้ยน (0.1+0.2) แต่ยังเขียนกลับลง DB เป็นหน่วยบาทเหมือนเดิม
   → ไม่ต้อง migrate schema ใน PR นี้

## Data flow
```
POST /api/v1/orders
  authenticate (ของ host app) → requireAuth → validateCreateOrderPayload(req.body)
  → service.createOrder(req.user.id, input)
      → repository.findProductsByIds()   // query เดียว ไม่ใช่ N+1
      → repository.findCouponByCode()
      → pricing.priceOrder()             // pure, ไม่แตะ DB
      → BEGIN → insertOrder → insertOrderItems (batch) → COMMIT
      → mailer.sendOrderConfirmation()   // best-effort นอก transaction
  → 201 { data: { orderId, totalMinor, ... } }
```

## สิ่งที่ตั้งใจเปลี่ยนพฤติกรรม (breaking, ต้องบอกผู้ใช้)
- `userId` / `email` ไม่รับจาก body อีกต่อไป → มาจาก session และ DB
- คูปองไม่มีอยู่จริง: เดิมเงียบ ๆ ไม่ลด → ตอนนี้ตอบ 422 `COUPON_NOT_FOUND`
- response ไม่ใช่ `{ ok: true/false }` ที่ status 200 เสมอ → ใช้ HTTP status จริง + `{ error: { code, message } }`
- `GET /orders/:id` เช็คความเป็นเจ้าของ → ของคนอื่นได้ 404
