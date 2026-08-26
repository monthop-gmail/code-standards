# Engineering Principles — ใช้ตัดสินใจตอนแยก module / refactor

## สารบัญ
- [SOLID แบบใช้งานจริง](#solid-แบบใช้งานจริง)
- [DRY กับกับดักของมัน](#dry-กับกับดักของมัน)
- [KISS / YAGNI](#kiss--yagni)
- [Separation of Concerns](#separation-of-concerns)
- [เมื่อไหร่ควรแตกไฟล์](#เมื่อไหร่ควรแตกไฟล์)
- [Error handling patterns](#error-handling-patterns)
- [Performance](#performance)

## SOLID แบบใช้งานจริง

**S — Single Responsibility**: "เหตุผลเดียวที่จะต้องแก้" ไม่ใช่ "ทำงานเดียว"
ถามว่า *ใคร* จะมาขอให้แก้ class นี้ ถ้าคำตอบมีหลายฝ่าย (ฝ่ายบัญชีขอแก้สูตรคิดเงิน + ฝ่าย IT ขอเปลี่ยนรูปแบบ report) แปลว่าควรแยก

**O — Open/Closed**: เพิ่มพฤติกรรมใหม่ได้โดยไม่แก้ของเดิม
ใช้เมื่อมี variant ที่**เพิ่มขึ้นเรื่อย ๆ จริง** (payment provider, export format) ถ้ามีแค่สองแบบและจะไม่เพิ่ม `if/else` ธรรมดาชนะ

**L — Liskov**: subclass ต้องใช้แทน parent ได้โดยไม่พังคาดหวังเดิม
สัญญาณผิด: subclass override แล้ว throw `NotSupportedException` → แปลว่า hierarchy ผิด ควรเป็น composition

**I — Interface Segregation**: อย่าบังคับให้ implementer เขียน method ที่ไม่ใช้
สัญญาณผิด: implement interface แล้วมี method ที่ปล่อยว่าง

**D — Dependency Inversion**: business logic ไม่ควร import driver ของ database/HTTP client ตรง ๆ
ประโยชน์จริงคือ test ได้โดยไม่ต้องมี infra จริง — ถ้า test ได้อยู่แล้ว ไม่ต้องใส่ abstraction เพิ่ม

## DRY กับกับดักของมัน

DRY = ความรู้ชิ้นเดียวมีที่อยู่ที่เดียว **ไม่ใช่** "โค้ดหน้าตาเหมือนกันต้องรวมกัน"

โค้ดสองก้อนที่บังเอิญเหมือนกันแต่เปลี่ยนแปลงด้วยเหตุผลคนละอย่าง (coincidental duplication) ถ้ารวมกันจะกลายเป็นฟังก์ชันที่มี flag เต็มไปหมดในอีก 3 เดือน
เกณฑ์: รวมเมื่อ**แก้ที่หนึ่งแล้วต้องแก้อีกที่เสมอ** ถ้าไม่ใช่ ปล่อยให้ซ้ำดีกว่า — duplication ถูกกว่า abstraction ที่ผิด

## KISS / YAGNI

- แก้ปัญหาที่มีอยู่ตอนนี้ ไม่ใช่ปัญหาที่จินตนาการว่าจะมี
- ไม่เพิ่ม config option ที่ยังไม่มีใครขอ
- ไม่ทำ generic framework ให้กับ use case เดียว
- ทางออกที่ตรงไปตรงมาและอ่านง่าย ชนะทางออกที่ฉลาดแต่ต้องนั่งถอดรหัส

ถ้าต้องเขียน comment อธิบายว่าโค้ดทำงานยังไง (ไม่ใช่ทำไม) นั่นคือสัญญาณว่าโค้ดซับซ้อนเกินจำเป็น

## Separation of Concerns

เส้นแบ่งที่คุ้มค่าที่สุดคือ **business logic ↔ framework/IO**

```
❌ controller ที่ validate + query DB + คิดส่วนลด + format response ในฟังก์ชันเดียว
✅ controller (parse/validate/แปลง response)
   → service (คิดส่วนลด — pure, test ได้โดยไม่ต้องมี DB)
   → repository (query)
```

เหตุผล: business rule เปลี่ยนบ่อยที่สุดและผิดแล้วเสียหายที่สุด ต้อง test ได้เร็วและไม่ต้องพึ่ง infra

## เมื่อไหร่ควรแตกไฟล์

แตกเมื่อ — ไม่ใช่เพราะยาว แต่เพราะ:
- มีหลายเหตุผลที่จะต้องแก้ไฟล์นี้
- อ่านหาอะไรไม่เจอ ต้อง scroll หา
- test ต้อง mock เยอะผิดปกติเพื่อจะเทสส่วนเดียว
- คนละส่วนของไฟล์ถูกแก้โดยคนละคน → merge conflict บ่อย

**อย่าแตก** เป็นไฟล์ละ 20 บรรทัดจนต้องเปิด 8 ไฟล์เพื่ออ่าน flow เดียว — นั่นย้ายความซับซ้อนไปอยู่ระหว่างไฟล์เฉย ๆ

## Error handling patterns

```ts
// ❌ กลืน error
try { await save(x) } catch (e) {}

// ❌ log แล้วทำต่อเหมือนไม่มีอะไรเกิดขึ้น
try { await save(x) } catch (e) { console.log(e) }
return { ok: true }

// ✅ เพิ่ม context แล้วส่งต่อ
try {
  await save(x)
} catch (cause) {
  throw new PersistenceError(`failed to save order ${x.id}`, { cause })
}
```

หลักที่ใช้:
- จับเฉพาะ error ที่**รู้ว่าจะจัดการยังไง** ที่เหลือปล่อยขึ้นไป
- แนบ context (id, operation) ทุกครั้ง — stack trace อย่างเดียวไม่พอตอน debug production
- แยก **expected failure** (validation ผิด, ไม่พบข้อมูล) ออกจาก **unexpected** (DB ล่ม) — อย่างแรกคือ flow ปกติที่ต้องตอบผู้ใช้ให้ดี อย่างหลังต้องดังและ alert
- ที่ขอบระบบ (HTTP handler, message consumer, main) ต้องมี catch-all ที่ log แล้วตอบ error ที่ไม่รั่ว internal detail

**Graceful degradation**: ถ้า dependency รองล่ม (cache, analytics, recommendation) ระบบหลักควรทำงานต่อได้ — ใส่ timeout ทุก network call และมี fallback

## Performance

จัดการตั้งแต่แรกเพราะแก้ทีหลังแพง:
- **N+1 query** — loop ที่ query ทีละแถว ให้เปลี่ยนเป็น query เดียว/batch/eager load
- **ไม่มี index** บน column ที่ใช้ filter/join บ่อย
- **โหลดทั้งตารางเข้า memory** แล้วค่อย filter ในโค้ด — ให้ filter ที่ DB
- **ไม่มี pagination** บน endpoint ที่คืน list
- **memory leak** — listener/interval/subscription ที่ไม่ถูก cleanup, connection ที่ไม่ปิด
- **await ในลูป** ที่ไม่มี dependency ระหว่างรอบ → ใช้ `Promise.all` / `asyncio.gather` (แต่ใส่ concurrency limit อย่าเปิด 10,000 พร้อมกัน)

ที่**ไม่ต้อง**ทำก่อนมีข้อมูล: micro-optimization, cache ที่ยังไม่รู้ว่า hot path อยู่ตรงไหน, เขียนใหม่ด้วยภาษาที่เร็วกว่า — วัดก่อนค่อยแก้
