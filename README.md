# ค่าลูกขนไก่ - ชมรมแบดมินตัน

แอปสำหรับบันทึกการเล่นแบดมินตัน คำนวณค่าลูกขนไก่ต่อคน สรุปสถิติรายวัน/สัปดาห์/เดือน และติดตามยอดค้างชำระของแต่ละคน ไม่ต้องล็อกอิน ใช้ได้จากมือถือทุกเครื่อง

- **Frontend**: React + TypeScript + Vite
- **Database**: Google Sheets (เข้าถึงผ่าน Google Apps Script Web App — ไม่มี backend server แยกให้ดูแล)

## โครงสร้างโปรเจกต์

```
apps-script/   โค้ด Google Apps Script (นำไปวางใน Apps Script editor)
scripts/       สคริปต์ช่วยงาน (ทดสอบ backend)
public/        ไอคอนแอป + manifest
src/           โค้ด React
```

### ไอคอนแอป

ไฟล์ต้นฉบับคือ `public/logo-source.jpg` (768×768) ถ้าต้องการเปลี่ยนโลโก้ ให้แทนที่ไฟล์นี้แล้วสร้างไอคอนใหม่ด้วย `sips` (มีมากับ macOS):

```bash
SRC=public/logo-source.jpg
sips -s format png -Z 512 "$SRC" --out public/icon-512.png
sips -s format png -Z 192 "$SRC" --out public/icon-192.png
sips -s format png -Z 180 "$SRC" --out public/apple-touch-icon.png
sips -c 600 600 "$SRC" --out /tmp/crop.png
sips -s format png -Z 32 /tmp/crop.png --out public/favicon-32.png
sips -s format png -Z 16 /tmp/crop.png --out public/favicon-16.png
sips -s format png -Z 410 "$SRC" --out /tmp/inner.png
sips --padToHeightWidth 512 512 --padColor FFFFFF /tmp/inner.png --out public/icon-maskable-512.png
```

## ขั้นตอนที่ 1: สร้าง Google Sheet + Apps Script

1. สร้าง Google Sheet ใหม่ (เช่นตั้งชื่อ "AeroThai Badminton Club DB")
2. เปิด **Extensions → Apps Script** จากเมนูของ Sheet
3. ในหน้า Apps Script editor ให้สร้างไฟล์ `.gs` ตามชื่อในโฟลเดอร์ `apps-script/` ของโปรเจกต์นี้ (Code.gs, Utils.gs, Players.gs, Games.gs, Balances.gs, Stats.gs, Settings.gs) แล้วคัดลอกเนื้อหาแต่ละไฟล์ไปวาง
4. ในหน้า Apps Script editor เลือกฟังก์ชัน `setupSheets` จาก dropdown ด้านบน แล้วกด **Run** (ครั้งแรกจะขอสิทธิ์เข้าถึง Sheet ให้กด Authorize) — ฟังก์ชันนี้จะสร้างชีตทั้ง 4 แผ่น (`Players`, `Games`, `Settlements`, `Settings`) พร้อมหัวตารางและตั้งราคาลูกขนไก่เริ่มต้นที่ 10 บาท/ลูกให้อัตโนมัติ
5. ไปที่ **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. กด Deploy แล้วคัดลอก **Web app URL** ที่ได้ (ลงท้ายด้วย `/exec`) เก็บไว้ใช้ในขั้นตอนถัดไป

> หมายเหตุ: ทุกครั้งที่แก้ไขโค้ด `.gs` ต้องกด **Deploy → Manage deployments → แก้ไข (ไอคอนดินสอ) → New version → Deploy** เพื่อให้ URL เดิมใช้โค้ดล่าสุด

## ขั้นตอนที่ 2: ตั้งค่าฝั่ง React

```bash
npm install
cp .env.example .env.local
```

แก้ไข `.env.local` ให้ `VITE_APPS_SCRIPT_URL` เป็น URL ที่ได้จากขั้นตอนที่ 1:

```
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/XXXXX/exec
```

## ขั้นตอนที่ 3: Deploy ขึ้น Vercel

### 3.1 ตรวจสอบ backend ก่อน

```bash
npm run check:backend "https://script.google.com/macros/s/XXXXX/exec"
```

ต้องขึ้น ✅ ครบทุกรายการก่อนไปขั้นตอนถัดไป ถ้าไม่ผ่านให้ดูหัวข้อ "แก้ปัญหาที่พบบ่อย" ด้านล่าง

### 3.2 push โค้ดขึ้น GitHub

```bash
git add -A && git commit -m "Badminton shuttle cost tracker" && git branch -M main
```

จากนั้นสร้าง repo บน GitHub แล้ว `git remote add origin <url>` และ `git push -u origin main`

> `.env.local` ถูก gitignore ไว้แล้ว จะไม่ถูก push ขึ้นไป

### 3.3 สร้างโปรเจกต์บน Vercel

1. ไปที่ [vercel.com/new](https://vercel.com/new) → Import repo ที่เพิ่ง push
2. Vercel จะตรวจเจอ Vite เองอัตโนมัติ (Build: `npm run build`, Output: `dist`) — ไม่ต้องแก้
3. กางหัวข้อ **Environment Variables** แล้วเพิ่ม:

   | Key | Value |
   |---|---|
   | `VITE_APPS_SCRIPT_URL` | URL `/exec` จากขั้นตอนที่ 1 |

   เลือกให้ครบทั้ง Production, Preview และ Development
4. กด **Deploy**

> ⚠️ **สำคัญ**: Vite ฝังค่า env ตอน build ไม่ใช่ตอนรัน ถ้าแก้ `VITE_APPS_SCRIPT_URL` ทีหลัง ต้องกด **Redeploy** ด้วย ไม่งั้นค่าเดิมจะยังติดอยู่ในไฟล์ที่ build ไว้

### 3.4 ทดสอบหลัง deploy

เปิดเว็บที่ได้จากมือถือ แล้วลองบันทึกเกม 1 เกม จากนั้นเปิด Google Sheet ดูว่ามีแถวเพิ่มในชีต `Games` และ `Players` จริง

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| ได้ HTML กลับมาแทน JSON / เว็บโหลดข้อมูลไม่ขึ้น | deployment ตั้ง access ไม่เป็น **Anyone** — Google ส่งหน้า login มาแทน ไปที่ Deploy → Manage deployments → แก้เป็น Anyone |
| แก้โค้ด `.gs` แล้วเว็บยังทำงานแบบเดิม | ต้องกด Deploy → Manage deployments → ไอคอนดินสอ → Version: **New version** → Deploy (URL เดิมจะชี้ไปโค้ดใหม่) |
| `ไม่พบชีต: Games` | ยังไม่ได้รัน `setupSheets` หรือชื่อแท็บถูกแก้ ต้องเป็น `Players`, `Games`, `Settlements`, `Settings` เป๊ะ ๆ |
| บันทึกเกมไม่ได้ แต่ดูข้อมูลได้ | มักเป็นปัญหา CORS ตอน POST — ตรวจว่า deploy เวอร์ชันล่าสุดแล้ว (โค้ดฝั่ง frontend ส่งเป็น `text/plain` เพื่อเลี่ยง preflight อยู่แล้ว) |
| องค์กรไม่ให้เลือก "Anyone" | ดูหัวข้อ "ข้อจำกัดของ Google Workspace" ด้านล่าง |

### ข้อจำกัดของ Google Workspace

ถ้าบัญชีเป็นของบริษัทและผู้ดูแลระบบปิดการแชร์แบบสาธารณะไว้ ตัวเลือก **Anyone** อาจไม่ขึ้นให้เลือก (เห็นแค่ "Anyone within [องค์กร]") ซึ่งจะทำให้แอปเรียก API ไม่ได้เพราะ Google จะ redirect ไปหน้า login แล้วติด CORS

ทางออก: deploy Apps Script จาก **บัญชี Gmail ส่วนตัว** (สร้าง Google Sheet ใหม่ในบัญชีนั้น แล้วรัน `setupSheets`) หรือขอให้ผู้ดูแลระบบอนุญาตเป็นกรณีไป

## รันโปรเจกต์

```bash
npm run dev             # เปิดเซิร์ฟเวอร์สำหรับพัฒนา
npm run build           # สร้างไฟล์สำหรับ production (ตรวจ TypeScript ด้วย)
npm run preview         # ดูตัวอย่างไฟล์ที่ build แล้ว
npm run lint            # ตรวจสอบโค้ดด้วย oxlint
npm run check:backend   # ทดสอบว่า Apps Script Web App ทำงานถูกต้อง
```

## ฟีเจอร์หลัก

- **บันทึกเกม (ปฏิทิน)** — แสดงเป็นปฏิทินรายเดือน วันนี้ไฮไลต์สีเข้มเห็นชัด และวันที่มีเกมจะแสดงจำนวนเกม
  - แตะวันที่บนปฏิทิน = ดู **ประวัติการเล่น** ของวันนั้นอย่างเดียว (พร้อมแก้ไข/ลบเกมได้)
  - กดปุ่ม **บันทึกเกม** = เปิดฟอร์มกรอกข้อมูล (ตั้งค่าเริ่มต้นเป็นวันนี้ และเปลี่ยนวันที่ในฟอร์มได้ เพื่อบันทึกย้อนหลัง)
  - ใส่ผู้เล่นได้ **1–4 คน** (กด “ลบ” เพื่อเอาช่องที่ไม่ใช้ออก หรือ “＋ เพิ่มผู้เล่น” เพื่อเพิ่ม) ค่าลูกขนไก่จะหารตามจำนวนคนที่กรอกจริง เช่น เล่นคนเดียวหรือรับผิดชอบค่าลูกเอง = จ่ายเต็มจำนวน พร้อมแสดงยอดที่ต้องจ่ายให้เห็นก่อนกดบันทึก
  - การ์ด **สรุปเดือนนี้ (ชื่อเดือน)** จะเปลี่ยนตามเดือนที่กำลังดูอยู่บนปฏิทิน
- **สถิติ** — เลือกช่วงเวลา (วันนี้ / สัปดาห์นี้ / เดือนนี้ / ทั้งหมด) แล้วแสดงตัวเลขสรุป: จำนวนลูกขนไก่ที่ใช้ ค่าใช้จ่าย จำนวนผู้เล่นที่ร่วม และจำนวนเกม
- **ค้นหา & จ่ายเงิน** — แสดงอันดับผู้ที่ยังค้างชำระ (เรียงจากยอดมากไปน้อย) พร้อมช่องค้นหา แตะชื่อเพื่อดูรายละเอียด: ช่วงวันที่ค้างชำระ จำนวนเกม จำนวนลูกขนไก่ รายการเกมแต่ละวัน ข้อมูลบัญชีรับชำระเงิน และปุ่มยืนยันว่าชำระแล้ว (รีเซ็ตยอดเป็น 0)
- **ตั้งค่า** — ต้องใส่รหัสผ่านก่อนเข้า (ค่าเริ่มต้น: `aerothaibadmintonclub2026`) ภายในมี 2 ส่วน: ราคาลูกขนไก่ต่อลูก (มีผลกับเกมใหม่เท่านั้น) และรายละเอียดบัญชีรับชำระเงิน (พิมพ์อิสระ แสดงให้ผู้เล่นเห็นตอนกดชำระเงิน)

### การเปลี่ยนรหัสผ่านหน้าตั้งค่า

รหัสผ่านเก็บอยู่ในชีต `Settings` แถว key = `settings_password` แก้ค่าในช่อง value ได้โดยตรงจาก Google Sheet

แอปนี้เปิดให้ทุกคนที่มีลิงก์ใช้งานได้โดยไม่ต้องล็อกอิน (ยกเว้นหน้าตั้งค่าที่มีรหัสผ่าน) จึงควรแชร์ลิงก์เฉพาะภายในกลุ่มที่ไว้ใจกัน
