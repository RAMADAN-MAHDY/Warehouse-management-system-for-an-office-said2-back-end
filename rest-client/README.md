# 🧪 REST Client Tests - Customer ID Isolation System
## دليل الاختبار الشامل

### المتطلبات
1. **VS Code** مع إضافة **REST Client** (humao.rest-client)
2. السيرفر يعمل على `http://localhost:5000`

---

## ترتيب الاختبارات

```
├── 01-auth.http       ← ابدأ هنا: تسجيل مستخدمَين ونسخ الـ tokens
├── 02-items.http      ← اختبار عزل المخزون
├── 03-sales.http      ← اختبار عزل فواتير البيع
├── 04-purchases.http  ← اختبار عزل المشتريات
└── 05-reports.http    ← اختبار التقارير المنفصلة
```

---

## خطوات الاختبار

### الخطوة 1: تشغيل السيرفر
```bash
npm run dev
```

### الخطوة 2: تنفيذ ملف 01-auth.http
1. افتح `01-auth.http`
2. أرسل **TEST 1** (تسجيل tenant1) → انسخ `customerId` و`token`
3. أرسل **TEST 2** (تسجيل tenant2) → انسخ `customerId` و`token`
4. تحقق أن الـ `customerId` في كل رد **مختلف** وبصيغة `CUST-XXXXXXXX`

### الخطوة 3: تحديث الـ Tokens
- في كل ملف `.http` استبدل `PUT_TENANT1_TOKEN_HERE` بتوكن tenant1
- استبدل `PUT_TENANT2_TOKEN_HERE` بتوكن tenant2

### الخطوة 4: تنفيذ باقي الملفات بالترتيب
- `02-items.http` → أضف منتجات ثم تحقق من العزل
- `03-sales.http` → أنشئ فواتير ثم تحقق من العزل
- `04-purchases.http` → اختبر الشراء وحظر التعديل المتقاطع
- `05-reports.http` → تحقق من أن التقارير تختلف بين العميلَين

---

## ✅ نتائج الاختبار المتوقعة

| الاختبار | الرد المتوقع |
|----------|-------------|
| تسجيل مستخدم | `{ status: true, customerId: "CUST-XXXXXXXX" }` |
| جلب بيانات tenant1 | بياناته فقط |
| جلب بيانات tenant2 | بياناته فقط (مختلفة) |
| حذف بيانات عميل آخر | `404 Item not found` |
| وصول بدون توكن | `401 Not authorized` |
| توكن بدون customerId | `403 Access denied` |

---

## 🔒 سيناريوهات الأمان المهمة (من ملف 02-items.http)

**TEST 8:** يحاول tenant2 حذف منتج tenant1 بالـ ID المباشر  
→ يُرجع `404` لأن الاستعلام يُضيف `{ customerId: tenant2_id }` تلقائياً  
→ الملف غير موجود من منظور tenant2 ✅

**TEST 3 في 03-sales.http:** tenant2 يحاول بيع LAPTOP-001 الخاص بـ tenant1  
→ يُرجع `404 المنتج غير موجود` لأن البحث يتم داخل مخزون tenant2 فقط ✅
