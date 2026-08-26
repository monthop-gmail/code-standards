<!--
วางไฟล์นี้ (หรือต่อท้าย CLAUDE.md ที่มีอยู่แล้ว) ที่ root ของ repo
เพื่อให้ /code-review บังคับใช้มาตรฐานเหล่านี้ได้ — เพราะ /code-review อ้างอิง CLAUDE.md
และจะข้ามเรื่อง code quality ทั่วไปที่ไม่ได้เขียนไว้ในนี้

ตัดข้อที่ไม่เกี่ยวกับ stack ของ repo นี้ออกก่อนใช้ (เช่น repo ที่ไม่แตะ database ให้ตัดหมวด
ความถูกต้องของข้อมูลทิ้ง) — CLAUDE.md ถูกโหลดทุก session ยาวไปคือจ่าย token เปล่า

ที่มาและหลักการคัดข้อ: https://monthop-gmail.github.io/code-standards/
-->

## Code standards

กฎข้างล่างนี้บังคับใช้ใน code review — ละเมิดข้อไหนถือเป็น blocking issue

### Security
- Query ต้องเป็น parameterized เสมอ (`?` / `$1` / `%s`) ห้ามต่อ string เข้า SQL แม้ค่าจะมาจากระบบเราเอง
- ห้าม hardcode secret ทุกชนิด (password, API key, token, connection string) — ใช้ env var
  ถ้าพบ secret ใน diff ให้ระบุด้วยว่าต้อง rotate ไม่ใช่แค่ลบออก เพราะค่าเดิมอยู่ใน git history แล้ว
- Endpoint ต้องเช็คสิทธิ์ระดับ resource ไม่ใช่แค่ว่า authenticated แล้ว
  (`GET /orders/:id` ต้องยืนยันว่า order นั้นเป็นของผู้ใช้ที่ล็อกอินอยู่)
- ห้ามเชื่อค่าจาก client เรื่องตัวตน สิทธิ์ และราคา — ต้องดึงจาก session หรือ DB ฝั่ง server
- ห้าม log password, token, OTP, PII เต็ม ๆ, Authorization header
- Webhook ต้อง verify signature ก่อนประมวลผล payload

### Error handling
- ห้าม `catch` เปล่า หรือ `except: pass` — ทุก catch ต้องจัดการให้จบ, log พร้อม context แล้วโยนต่อ, หรือแปลงเป็น error ที่มีความหมายกว่าเดิม
- HTTP status code ต้องสื่อความจริง ห้ามตอบ 200 เมื่อ operation ล้มเหลว
- External call ทุกอันต้องมี timeout

### ความถูกต้องของข้อมูล
- เงินห้ามเก็บหรือคำนวณเป็น float — ใช้ integer หน่วยย่อย (สตางค์) หรือ `Decimal` / `NUMERIC` ตลอดเส้นทาง
- งานที่ห้ามทำซ้ำ (ตัดเงิน, สร้างออเดอร์, ส่งอีเมลยืนยัน) ต้องกันซ้ำด้วย unique constraint หรือ transaction
  ห้ามใช้ check-then-write ในหน่วยความจำ เพราะพังทันทีเมื่อมีมากกว่าหนึ่ง instance
- Operation ที่ต้องสำเร็จหรือล้มพร้อมกัน ต้องอยู่ใน transaction เดียวกัน

### Performance
- ห้ามมี N+1 query — ลูปที่ยิง query ทีละแถวต้องเปลี่ยนเป็น query เดียว, batch หรือ eager load
- ห้าม `await` ในลูปที่แต่ละรอบไม่ได้ขึ้นต่อกัน
- Endpoint ที่คืน list ต้องมี pagination
- Connection, file handle, listener, interval ต้องถูกปิด/cleanup

### โครงสร้าง
- Abstraction (interface, abstract class, factory, DI container) ต้องมีผู้ใช้จริงตั้งแต่ 2 รายขึ้นไป
  test ที่ใช้ object literal ไม่นับเป็นผู้ใช้รายที่สอง — ถ้ามีรายเดียวให้ inline กลับไป
- ห้าม wire in-memory stand-in (Map, Set, array) เข้า production entrypoint แม้จะมีคอมเมนต์บอกให้สลับทีหลัง
- ห้ามมี TODO, stub, หรือฟังก์ชันที่ return ค่าคงที่แทนการทำงานจริง ในเส้นทางที่ถูกเรียกใช้จริง
- ต้องมี type ครบทุก public signature ห้ามใช้ `any` (ถ้าไม่รู้ type ให้ใช้ `unknown` แล้ว narrow)

### Refactor
- Refactor แปลว่าเปลี่ยนโครงสร้างโดยพฤติกรรมเหมือนเดิม
  **ถ้า PR เปลี่ยนพฤติกรรมด้วย ต้องเขียนบอกใน PR description ครบทุกข้อว่าเปลี่ยนอะไรและทำไม**
  การเปลี่ยนตัวดำเนินการเปรียบเทียบ (`>` เป็น `>=`), ค่าคงที่, หรือเงื่อนไข ที่ไม่ได้เขียนบอก ถือเป็น blocking issue
  แม้จะดูเหมือนตั้งใจก็ตาม
