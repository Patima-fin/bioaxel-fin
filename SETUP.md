# Water POG Financial Dashboard — คู่มือ Setup

## ภาพรวม

```
Google Sheets (ข้อมูล) ←→ Apps Script (API) ←→ Financial Dashboard (เว็บ)
                                                         ↑
                                                   Netlify (Hosting)
```

---

## ขั้นตอนที่ 1 — ตั้งค่า Google Sheets + Apps Script

### 1.1 สร้าง Google Sheet ใหม่
1. ไปที่ [sheets.google.com](https://sheets.google.com) → สร้างชีตว่างใหม่
2. ตั้งชื่อว่า **"Water POG Financial DB"**

### 1.2 เพิ่ม Apps Script
1. เมนู **Extensions → Apps Script**
2. ลบโค้ดเดิมทั้งหมดออก
3. เปิดไฟล์ `apps_script/Code.gs` ในโฟลเดอร์นี้ → คัดลอกทั้งหมด → วางใน Apps Script
4. กด **Ctrl+S** เพื่อบันทึก (ตั้งชื่อโปรเจกต์ว่า "Water POG Backend")
5. กลับไปที่ Google Sheet → รีเฟรชหน้า → จะเห็นเมนู **"Water POG"** ปรากฏขึ้น
6. คลิก **Water POG → ① สร้าง/รีเซ็ตชีตทั้งหมด** → รอสักครู่

### 1.3 Deploy เป็น Web App
1. ใน Apps Script → กด **Deploy → New deployment**
2. กดไอคอน ⚙️ "Select type" → เลือก **Web app**
3. ตั้งค่าดังนี้:

   | ช่อง | ค่า |
   |------|-----|
   | Description | v1 |
   | Execute as | **Me** |
   | Who has access | **Anyone** |

4. กด **Deploy**
5. หากมี popup ขออนุญาต → กด Advanced → Go to ... (unsafe) → Allow
6. **คัดลอก Web App URL** (หน้าตาประมาณ `https://script.google.com/macros/s/AKfy.../exec`)

---

## ขั้นตอนที่ 2 — เชื่อม Dashboard กับ Apps Script

เปิดไฟล์ `app/config.js` แล้ววาง URL:

```javascript
window.WTP_CONFIG = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfy.../exec',  // ← วางตรงนี้
  AUTO_REFRESH_MS: 300000,
};
```

บันทึกไฟล์ → เปิดเว็บใหม่ → sidebar จะแสดงจุดสีเขียว **"Sync เมื่อกี้"**

---

## ขั้นตอนที่ 3 — Deploy ขึ้น Netlify

### วิธีที่ 1: Drag & Drop (ง่ายที่สุด)
1. ไปที่ [app.netlify.com](https://app.netlify.com) → Sign up ฟรีด้วย Google/GitHub
2. ในหน้า Sites → ลากโฟลเดอร์ `WebAPP - FIN` ทั้งโฟลเดอร์วางลงในหน้าเว็บ Netlify
3. รอ 30 วินาที → ได้ URL เช่น `https://waterpog-fin.netlify.app`

> **หมายเหตุ:** ทุกครั้งที่แก้ไขไฟล์และอยากอัป → ลาก Drag & Drop ใหม่อีกครั้ง

### วิธีที่ 2: เชื่อมกับ GitHub (Auto-deploy)
1. สร้าง Repository บน GitHub
2. Push ไฟล์ทั้งหมดขึ้น GitHub
3. ใน Netlify → New site from Git → เลือก Repo → Deploy
4. ทุกครั้งที่ push code ใหม่ Netlify จะ deploy อัตโนมัติ

---

## โครงสร้างไฟล์

```
WebAPP - FIN/
├── Financial Dashboard.html   ← เปิดหน้านี้ในเบราว์เซอร์
├── netlify.toml               ← Netlify configuration
├── SETUP.md                   ← ไฟล์นี้
├── app/
│   ├── config.js              ← ★ ใส่ Apps Script URL ตรงนี้
│   ├── data.js                ← Mock data + localStorage
│   ├── data_sync.js           ← Google Sheets sync layer
│   ├── styles.css
│   ├── app.jsx
│   ├── components.jsx
│   ├── charts.jsx
│   └── page_*.jsx             ← หน้าต่างๆ
├── apps_script/
│   └── Code.gs                ← คัดลอกไปวางใน Google Apps Script
└── tweaks-panel.jsx
```

---

## สถานะ Sync ที่ Sidebar

| สี | ความหมาย |
|----|----------|
| 🔵 เทา | Offline — ยังไม่ได้ตั้งค่า URL |
| 🟡 เหลือง | กำลัง sync... |
| 🟢 เขียว | เชื่อมต่อสำเร็จ |
| 🔴 แดง | เชื่อมต่อไม่ได้ (ตรวจสอบ URL) |

---

## คำถามที่พบบ่อย

**Q: เปิดด้วย file:// ได้มั้ย?**
A: ไม่ได้ครับ เพราะโหลด .jsx หลายไฟล์ ต้องรันผ่าน HTTP Server หรือ Netlify

**Q: Apps Script ช้ามาก?**
A: ครั้งแรกช้าเพราะ "cold start" ~2-5 วินาที ครั้งต่อไปจะเร็วขึ้น

**Q: ข้อมูลหาย?**
A: ข้อมูลอยู่ใน Google Sheet ตรวจสอบได้โดยตรง ถ้าเว็บหายให้กด refresh

**Q: 3 คนแก้พร้อมกันได้มั้ย?**
A: ได้ครับ แต่ถ้าแก้ entity เดียวกันพร้อมกัน คนที่ Save ทีหลังจะ overwrite ดังนั้นควรแก้คนละส่วนกัน
