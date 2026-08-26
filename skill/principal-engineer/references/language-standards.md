# Language & Framework Standards

อ่านเมื่อเริ่ม project ใหม่ หรือไม่แน่ใจ convention/เครื่องมือของภาษานั้น
**ถ้า repo มี convention อยู่แล้ว ให้ตามของ repo — เอกสารนี้ใช้ตอนไม่มีอะไรให้ตาม**

## TypeScript / JavaScript

- ES modules + `async/await` — ไม่ใช้ `var`, callback hell, `require` ใน project ใหม่
- `strict: true` ใน tsconfig; ห้าม `any` (ใช้ `unknown` แล้ว narrow), ห้าม `@ts-ignore` โดยไม่มีคำอธิบาย
- validate ข้อมูลจากภายนอกด้วย `zod` แล้ว infer type จาก schema — ได้ type กับ runtime check จากแหล่งเดียว
- error: `throw new Error(msg, { cause })` แทนการ throw string
- โครง: `src/` + path alias (`@/`), test คู่กับไฟล์ (`x.test.ts`) หรือ `tests/` — เลือกอย่างใดอย่างหนึ่งให้ทั้ง repo
- เครื่องมือ: TypeScript + ESLint + Prettier (หรือ Biome), vitest/jest, pnpm

## Python

- type hint ทุก signature ของ public function; `from __future__ import annotations` ถ้าต้องรองรับเวอร์ชันเก่า
- Pydantic v2 สำหรับ data ที่เข้ามาจากภายนอก / config; `@dataclass` สำหรับ struct ภายใน
- `pathlib` แทน `os.path`, f-string แทน `%`/`.format()`
- exception ของตัวเอง สืบทอดจาก base ของ project เดียว (`class AppError(Exception)`)
- เครื่องมือ: `uv` หรือ `poetry`, `ruff` (lint+format), `mypy`/`pyright`, `pytest`
- โครง: `src/<package>/` layout, `pyproject.toml` เป็นแหล่งความจริงเดียว

## Frontend (React / Next.js)

- function component + hooks; แยก logic ออกเป็น custom hook เมื่อ component เริ่มมี state หลายก้อน
- server state (`TanStack Query`/RSC) แยกจาก client state — อย่ายัด API response ลง global store
- key ของ list ต้องเป็น id จริง ไม่ใช่ index
- accessibility ขั้นต่ำ: ปุ่มคือ `<button>`, label ผูกกับ input, contrast พอ, focus ใช้ keyboard ได้

## Backend / API

- RESTful: noun พหูพจน์ (`/orders/{id}`), HTTP verb ตรงความหมาย, status code ถูกต้อง (201 create, 204 no content, 400 input ผิด, 401 ไม่รู้ว่าใคร, 403 รู้ว่าใครแต่ไม่มีสิทธิ์, 404, 409 conflict, 422 validation)
- error response รูปแบบเดียวทั้ง API: `{ error: { code, message, details? } }`
- versioning ตั้งแต่วันแรก (`/api/v1`) — เพิ่มทีหลังเจ็บกว่า
- health check endpoint, structured logging (JSON) พร้อม request id ที่ไล่ตามข้าม service ได้
- idempotency key สำหรับ endpoint ที่ตัดเงิน/สร้าง order

## Database

- migration เป็นไฟล์ที่ commit ไว้เสมอ (Alembic/Prisma/Flyway) — ห้ามแก้ schema ด้วยมือบน production
- ตั้ง index ให้ FK และ column ที่ filter/sort บ่อย
- transaction ครอบ operation ที่ต้องสำเร็จหรือล้มพร้อมกัน
- soft delete เมื่อข้อมูลมีคุณค่าเชิงประวัติ; hard delete เมื่อกฎหมาย/PDPA บังคับให้ลบจริง
- อย่าเก็บเงินเป็น float — ใช้ integer หน่วยย่อย (สตางค์) หรือ `Decimal`/`NUMERIC`

## Odoo (บริบทงานของผู้ใช้)

- module structure: `__manifest__.py`, `models/`, `views/`, `security/ir.model.access.csv`, `data/`
- สืบทอดด้วย `_inherit` อย่าแก้ core module ตรง ๆ
- ทุก model ใหม่ต้องมี record ใน `ir.model.access.csv` ไม่งั้น user ทั่วไปเข้าไม่ได้
- ใช้ ORM API (`search`, `browse`, `create`) แทน raw SQL; ถ้าจำเป็นต้อง raw ให้ใช้ parameter binding (`self.env.cr.execute(sql, params)`)
- ระวัง N+1: `read_group` / prefetch แทนการ loop `browse` ทีละ record
