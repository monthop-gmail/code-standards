# Security Checklist — OWASP Top 10 แบบใช้งานจริง

อ่านเมื่อเขียน endpoint, auth, จัดการ input จากภายนอก, แตะ DB, หรือรับไฟล์

## กฎเหล็ก 3 ข้อ

1. **ห้าม hardcode secret** — API key, password, connection string, JWT secret, private key
   ใช้ env var + `.env.example` ที่มีแต่ชื่อตัวแปร (ไม่มีค่า) และ `.env` ต้องอยู่ใน `.gitignore`
   ถ้าเจอ secret ที่ commit ไปแล้วในโค้ดเดิม → **บอกผู้ใช้ทันที** และเตือนว่าต้อง rotate ไม่ใช่แค่ลบออก (ยังอยู่ใน git history)
2. **Input จากภายนอกคือ hostile จนกว่าจะพิสูจน์ได้** — HTTP body/query/header/cookie, file upload, webhook, message queue, ผลจาก third-party API
   validate ที่ขอบระบบด้วย schema (zod / Pydantic / class-validator) แล้วส่ง typed object เข้าไปข้างใน ไม่ใช่โยน raw dict/any เข้าไป
3. **อย่าเชื่อ input จาก client เรื่องสิทธิ์และราคา** — role, userId, price, quantity discount ต้องดึงจาก session/DB ฝั่ง server เสมอ

## ตามหมวด OWASP

**A01 Broken Access Control** — จุดที่พลาดบ่อยที่สุด
- ทุก endpoint ต้องเช็คสองชั้น: *authenticated ไหม* และ *มีสิทธิ์กับ resource ตัวนี้ไหม*
- IDOR: `GET /orders/123` ต้องเช็คว่า order 123 เป็นของ user ที่ล็อกอินอยู่ — ไม่ใช่แค่เช็คว่าล็อกอินแล้ว
- default deny: route ใหม่ต้องปิดไว้ก่อน ไม่ใช่เปิดแล้วค่อยไล่ปิด

**A02 Cryptographic Failures**
- password → `bcrypt` / `argon2` เท่านั้น (ห้าม MD5/SHA1/SHA256 เปล่า)
- ข้อมูลอ่อนไหว (บัตรประชาชน, เลขบัญชี, ข้อมูลสุขภาพ) เข้ารหัสตอนเก็บ และห้ามหลุดลง log
- TLS ทุก external call, ห้ามปิด cert verification

**A03 Injection**
- SQL: parameterized query / ORM เท่านั้น — ห้ามต่อ string แม้จะ "escape แล้ว"
- Command injection: อย่าส่ง user input เข้า shell; ถ้าจำเป็นใช้ array-form (`execFile`, `subprocess.run([...])` ไม่มี `shell=True`)
- XSS: escape ตอน render, อย่าใช้ `dangerouslySetInnerHTML` / `v-html` กับข้อมูลจากผู้ใช้; ถ้าต้องรับ HTML ใช้ sanitizer (DOMPurify)
- Path traversal: normalize path แล้วเช็คว่ายังอยู่ใต้ base dir ก่อนอ่าน/เขียนไฟล์

**A04 Insecure Design** — rate limit บน login/OTP/reset password, ป้องกัน enumeration (ข้อความ error เหมือนกันไม่ว่า user จะมีหรือไม่มี)

**A05 Security Misconfiguration** — ปิด debug/stack trace ใน production, ตั้ง security headers (CSP, HSTS, X-Content-Type-Options), CORS ระบุ origin จริง ห้าม `*` คู่กับ credentials, ห้ามเปิด admin panel/DB port ออก public

**A06 Vulnerable Components** — ใช้ version ที่ยัง maintain, ไม่ใช้ library ที่ deprecated แล้ว, มี lockfile commit ไว้

**A07 Auth Failures** — session/token มีวันหมดอายุ, logout ต้อง invalidate จริง, refresh token หมุนเวียนได้และเพิกถอนได้, ไม่ใส่ token ใน URL

**A08 Data Integrity** — verify signature ของ webhook (Stripe, LINE, GitHub) ก่อนประมวลผล **เสมอ** — payload ที่ไม่ verify คือใครส่งมาก็ได้

**A09 Logging Failures**
- log: ใครทำ, อะไร, เมื่อไหร่, ผลเป็นยังไง สำหรับ auth event และการเปลี่ยนข้อมูลสำคัญ
- **ห้าม log**: password, token, credit card, OTP, PII เต็ม ๆ, Authorization header
- error ที่ตอบกลับ client ต้องเป็นข้อความกลาง ๆ ส่วนรายละเอียดเก็บใน log ฝั่ง server

**A10 SSRF** — ถ้ารับ URL จากผู้ใช้แล้วไปยิงต่อ ต้อง allowlist domain และบล็อก private IP range (169.254.169.254, 127.0.0.1, 10.x, 192.168.x)

## File upload

จำกัด size, ตรวจ MIME จาก content จริงไม่ใช่นามสกุล, สร้างชื่อไฟล์ใหม่ (อย่าใช้ชื่อจากผู้ใช้), เก็บนอก webroot หรือบน object storage, ไม่ให้ execute
