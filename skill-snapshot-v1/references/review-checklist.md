# Self-Review Checklist

ใช้ตอนขั้นที่ 5 ของ workflow (ก่อนบอกว่าเสร็จ) หรือเมื่อถูกขอให้ review โค้ด
อ่านโค้ดที่เพิ่งเขียนใหม่อีกรอบ **ในมุมคนที่ต้องมา maintain ต่ออีก 6 เดือน** เจออะไรแก้เลย

## Correctness
- [ ] โค้ดรันได้จริง — import ครบ, ชื่อฟังก์ชัน/ตัวแปรตรงกันทุกที่, ไม่มี syntax error
- [ ] ไม่มี `TODO`, `FIXME`, placeholder, mock data ที่แอบอ้างว่าเป็นของจริง
- [ ] ไม่มี `console.log` / `print` / debugger ค้าง
- [ ] ไม่มี dead code, import ที่ไม่ได้ใช้, ฟังก์ชันที่ไม่มีใครเรียก
- [ ] async: `await` ครบทุกที่ที่ต้องรอ, ไม่มี floating promise

## Edge cases
- [ ] empty (`[]`, `""`, `{}`), `null`/`undefined`/`None`
- [ ] ค่าติดลบ, ศูนย์, ค่าเกินขอบเขต, off-by-one
- [ ] input ขนาดใหญ่ / list ยาว → มี pagination หรือ streaming ไหม
- [ ] unicode / อักษรไทย / emoji ในข้อความและชื่อไฟล์
- [ ] timezone: เก็บเป็น UTC แล้วแปลงตอนแสดงผลไหม
- [ ] เรียกซ้ำ/กดซ้ำ → idempotent ไหม, race condition ไหม

## Error handling
- [ ] ไม่มี catch เปล่า / `except: pass`
- [ ] error มี context (id, operation) พอให้ debug ได้จาก log อย่างเดียว
- [ ] external call ทุกอันมี timeout
- [ ] ที่ขอบระบบมี catch-all ที่ไม่รั่ว internal detail ออกไปหา client

## Security
- [ ] ไม่มี secret hardcode (grep หา `password`, `api_key`, `token`, `secret`)
- [ ] input จากภายนอกถูก validate ด้วย schema
- [ ] query เป็น parameterized ทั้งหมด
- [ ] endpoint เช็ค authorization ระดับ resource ไม่ใช่แค่ authentication
- [ ] log ไม่มี password/token/PII

## Performance
- [ ] ไม่มี N+1 query
- [ ] ไม่มี `await` ในลูปที่รันขนานได้
- [ ] ไม่โหลดข้อมูลทั้งตารางมา filter ในโค้ด
- [ ] resource ถูกปิด/cleanup (connection, file handle, listener, interval)

## Maintainability
- [ ] type ครบ ไม่มี `any`
- [ ] ชื่อบอกเจตนา — อ่านชื่อแล้วเดาได้ว่าทำอะไรโดยไม่ต้องเปิด implementation
- [ ] ไม่มี magic number/string ลอย ๆ → ตั้งเป็น constant ที่มีชื่อ
- [ ] ตามสไตล์ของ repo (naming, layer, error pattern, วิธี import)
- [ ] public API มี docstring/JSDoc ที่อธิบาย "ทำไม" และเงื่อนไขการใช้
- [ ] abstraction ทุกตัวมีผู้ใช้จริง ≥ 2 ราย — ถ้ามีรายเดียว inline กลับไป

## Tests
- [ ] business logic สำคัญมี test
- [ ] test ครอบ edge case ไม่ใช่แค่ happy path
- [ ] test ไม่พึ่ง network/เวลาจริง/ลำดับการรัน
- [ ] **รัน test จริงแล้ว** — ถ้าแดง บอกผู้ใช้พร้อม output ไม่ใช่รายงานว่าผ่าน

## ส่งมอบ
- [ ] บอกสิ่งที่ต้องตั้งค่าเพิ่ม (env var, migration, dependency ที่ต้อง install)
- [ ] บอกสิ่งที่สมมติไว้และสิ่งที่ยังไม่ได้ทำ (ถ้ามี)
