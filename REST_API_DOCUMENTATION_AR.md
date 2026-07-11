# توثيق REST API — نظام إدارة المخزون (Back-end)

هذا الملف موجّه لمطوري الواجهة الأمامية، ويشرح كيفية استدعاء جميع نقاط النهاية (Endpoints) المتاحة في مشروع إدارة المخزون الخلفي، بما في ذلك المصادقة، العزل متعدد العملاء (Multi-tenant عبر customerId)، والاشتراكات وحدود الخطة.

> ملاحظة مهمة للواجهة الأمامية: أغلب نقاط النهاية محمية وتتطلب إرسال JWT في ترويسة `Authorization: Bearer <token>`. كما أن أغلبها يتطلب اشتراكاً نشطاً (قد تُرجع 402 عند عدم وجود اشتراك أو انتهائه).

---

## جدول المحتويات

- [1) نظرة عامة](#1-نظرة-عامة)
- [2) مصادقة وحماية الطلبات](#2-مصادقة-وحماية-الطلبات)
- [3) تنسيقات عامة](#3-تنسيقات-عامة)
- [4) Health Check](#4-health-check)
- [5) Auth (المصادقة)](#5-auth-المصادقة)
- [6) Items (المنتجات/المخزون)](#6-items-المنتجاتالمخزون)
- [7) Sales (المبيعات)](#7-sales-المبيعات)
- [8) Purchases (المشتريات البسيطة)](#8-purchases-المشتريات-البسيطة)
- [9) Purchase Invoices (فواتير الشراء)](#9-purchase-invoices-فواتير-الشراء)
- [10) Inventory Adjustments (تسويات المخزون)](#10-inventory-adjustments-تسويات-المخزون)
- [11) Suppliers (الموردون)](#11-suppliers-الموردون)
- [12) Expenses (المصروفات)](#12-expenses-المصروفات)
- [13) Excel Files (ملفات Excel المحفوظة)](#13-excel-files-ملفات-excel-المحفوظة)
- [14) Reports (التقارير)](#14-reports-التقارير)
- [15) Profit Summary (ملخص الربح السريع)](#15-profit-summary-ملخص-الربح-السريع)
- [16) Returns (المرتجعات)](#16-returns-المرتجعات)
- [17) Subscription (الاشتراكات)](#17-subscription-الاشتراكات)
- [18) Superadmin (لوحة السوبر أدمن)](#18-superadmin-لوحة-السوبر-أدمن)
- [19) Notifications (التنبيهات)](#19-notifications-التنبيهات)

---

## 1) نظرة عامة

- **Base URL**:
  - محلياً (Development): `http://localhost:<PORT>` (عادة `http://localhost:5000` أو حسب إعدادك)
  - على الاستضافة: استخدم رابط البيئة الإنتاجية الخاصة بك.
- **Prefix**: جميع المسارات تبدأ بـ `/api`.
- **عزل البيانات (Multi-tenant)**: يتم تحديد العميل من خلال `customerId` المخزن داخل حساب المستخدم (داخل الـ JWT) ثم يُحقن في `req.customerId`. لا تحتاج لإرساله من الواجهة الأمامية، لكن يجب أن تستخدم التوكن الصحيح لنفس الحساب.
- **حد حجم الطلب**: JSON body limit = `10kb`. تجنب إرسال payload كبيرة.
- **CORS**: محكوم بقائمة Origins مسموحة. للواجهة الأمامية، استخدم نطاقاً مسموحاً أو اضبط `CORS_ORIGIN`.

---

## 2) مصادقة وحماية الطلبات

### 2.1 الترويسات المطلوبة (Headers)

- للطلبات المحمية:
  - `Authorization: Bearer <JWT>`
- للطلبات التي تحتوي على Body بصيغة JSON:
  - `Content-Type: application/json`
  - `Accept: application/json` (اختياري لكنه مفيد)

### 2.2 أدوار المستخدم (Roles)

قد تتطلب بعض العمليات صلاحيات محددة:
- `superadmin`
- `admin`
- `editor`
- `viewer`

أمثلة:
- إنشاء مورد أو شراء أو فاتورة شراء قد يتطلب `admin` أو `editor`.
- حذف شراء قد يتطلب `admin`.
- جميع مسارات `/api/superadmin/*` تتطلب `superadmin` فقط.

---

## 3) تنسيقات عامة

### 3.1 نموذج الاستجابة القياسي (شائع)

معظم نقاط النهاية تُرجع JSON بهذا الشكل (قد تختلف بعض النقاط قليلاً):

```json
{
  "status": true,
  "message": "نص/رسالة",
  "data": {}
}
```

- `status` (Boolean): نجاح/فشل.
- `message` (String): رسالة تفسيرية (قد تكون غير موجودة في بعض الاستجابات).
- `data` (Any): البيانات (قد تكون `null` أو مصفوفة أو كائن).

### 3.2 نموذج أخطاء التحقق (Validation) — HTTP 400

عند فشل Joi validation:

```json
{
  "status": false,
  "message": "تفاصيل الخطأ/الأخطاء",
  "data": null
}
```

### 3.3 نموذج أخطاء المصادقة — HTTP 401

عند غياب التوكن أو فشل التحقق:

```json
{
  "status": false,
  "message": "Not authorized, no token",
  "data": null
}
```

أو:

```json
{
  "status": false,
  "message": "Not authorized, token failed",
  "data": null
}
```

### 3.4 نموذج أخطاء الصلاحيات — HTTP 403

عند منع الوصول بسبب الدور:

```json
{
  "status": false,
  "message": "Forbidden",
  "data": null
}
```

أو للسوبر أدمن:

```json
{
  "status": false,
  "message": "غير مسموح لك بالوصول لهذه المنطقة. صلاحيات سوبر أدمن مطلوبة."
}
```

### 3.5 نموذج أخطاء الاشتراك — HTTP 402/403

عند عدم وجود اشتراك نشط أو انتهاءه:

```json
{
  "status": false,
  "message": "لا يوجد اشتراك نشط لهذا الحساب. يرجى الاشتراك للمتابعة.",
  "type": "SUBSCRIPTION_REQUIRED"
}
```

أو عند انتهاء الاشتراك:

```json
{
  "status": false,
  "message": "انتهت صلاحية اشتراكك. يرجى تجديد الاشتراك للمتابعة.",
  "type": "SUBSCRIPTION_EXPIRED"
}
```

أو عند إيقاف/تقييد الحساب:

```json
{
  "status": false,
  "message": "تم إيقاف حسابك مؤقتاً. يرجى التواصل مع الدعم الفني.",
  "type": "ACCOUNT_RESTRICTED"
}
```

### 3.6 التصفح بالصفحات (Pagination)

بعض نقاط النهاية تدعم:
- `page` (Number): رقم الصفحة (ابتداءً من 1)
- `limit` (Number): عدد العناصر في الصفحة

وغالباً تُرجع:

```json
{
  "pagination": {
    "total": 120,
    "page": 1,
    "limit": 10,
    "totalPages": 12
  }
}
```

### 3.7 تنسيق التاريخ

- التواريخ في الاستجابات غالباً بصيغة ISO (`2026-06-20T...Z`) أو كـ `Date`.
- في الاستعلامات `from/to` تستخدم صيغة ISO: `YYYY-MM-DD` أو `YYYY-MM-DDTHH:mm:ssZ`.

---

## 4) Health Check

### GET `/api/health`

**الوصف:** فحص سريع لحالة الخادم وحالة اتصال قاعدة البيانات.

**Headers المطلوبة:** لا يوجد.

**المعلمات:** لا يوجد.

**استجابة 200 (نجاح):**

```json
{
  "status": "ok",
  "environment": "development",
  "db_connected": true,
  "uptime": 123.45,
  "timestamp": "2026-06-20T12:34:56.000Z"
}
```

- `status` (String): ثابت `ok`.
- `environment` (String): قيمة `NODE_ENV`.
- `db_connected` (Boolean): هل MongoDB متصل.
- `uptime` (Number): زمن تشغيل السيرفر بالثواني.
- `timestamp` (String): وقت توليد الاستجابة.

**مثال Fetch:**

```js
const res = await fetch(`${API_BASE_URL}/api/health`);
const data = await res.json();
```

---

## 5) Auth (المصادقة)

### 5.1 POST `/api/auth/register`

**الوصف:** إنشاء حساب مستخدم جديد + إنشاء اشتراك تجريبي (مجاني) لمدة 30 يوم + إرجاع JWT.

**Headers المطلوبة:**
- `Content-Type: application/json`

**Body (JSON):**

| الحقل | النوع | مطلوب | الوصف |
|------|------|------|------|
| username | String | نعم | اسم المستخدم (فريد) |
| password | String | نعم | كلمة المرور (6 أحرف+). |
| companyName | String | لا | اسم الشركة (قد يكون فارغاً) |

> ملاحظة: يوجد حقل `role` يُستخدم داخلياً في الكود عند التسجيل، لكنه **غير موجود** في Joi schema الحالي، لذلك سيتم حذفه تلقائياً من `stripUnknown`. أي لا تعتمد عليه من الواجهة الأمامية.

**نموذج طلب صالح:**

```json
{
  "username": "demo_user",
  "password": "StrongPass123",
  "companyName": "Demo Company"
}
```

**استجابة 201 (نجاح):**

```json
{
  "status": true,
  "message": "User registered successfully",
  "data": {
    "user": {
      "_id": "667000000000000000000001",
      "customerId": "CUST-000123",
      "username": "demo_user",
      "companyName": "Demo Company",
      "role": "admin",
      "isBanned": false,
      "createdAt": "2026-06-20T12:00:00.000Z",
      "updatedAt": "2026-06-20T12:00:00.000Z",
      "__v": 0
    },
    "customerId": "CUST-000123",
    "token": "<JWT>"
  }
}
```

**أخطاء محتملة:**
- 400: إذا كان `username` موجوداً مسبقاً أو فشل التحقق.
- 500: خطأ غير متوقع.

**مثال Axios:**

```js
import axios from "axios";

const res = await axios.post(`${API_BASE_URL}/api/auth/register`, {
  username: "demo_user",
  password: "StrongPass123",
  companyName: "Demo Company",
});

const token = res.data.data.token;
```

---

### 5.2 POST `/api/auth/login`

**الوصف:** تسجيل الدخول وإرجاع JWT.

**Headers المطلوبة:**
- `Content-Type: application/json`

**Body (JSON):**

| الحقل | النوع | مطلوب | الوصف |
|------|------|------|------|
| username | String | نعم | اسم المستخدم |
| password | String | نعم | كلمة المرور |

**نموذج طلب صالح:**

```json
{
  "username": "demo_user",
  "password": "StrongPass123"
}
```

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Login successful",
  "data": {
    "user": {
      "_id": "667000000000000000000001",
      "customerId": "CUST-000123",
      "username": "demo_user",
      "companyName": "Demo Company",
      "role": "admin",
      "isBanned": false,
      "createdAt": "2026-06-20T12:00:00.000Z",
      "updatedAt": "2026-06-20T12:00:00.000Z",
      "__v": 0
    },
    "customerId": "CUST-000123",
    "token": "<JWT>"
  }
}
```

**أخطاء محتملة:**
- 400: بيانات دخول خاطئة.
- 403: الحساب محظور.
- 500: خطأ خادم.

**مثال Fetch:**

```js
const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "demo_user", password: "StrongPass123" }),
});

const payload = await res.json();
if (!res.ok) throw new Error(payload.message);
localStorage.setItem("token", payload.data.token);
```

---

### 5.3 GET `/api/auth/me`

**الوصف:** جلب بيانات المستخدم الحالي بناءً على JWT.

**Headers المطلوبة:**
- `Authorization: Bearer <JWT>`

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "User details",
  "data": {
    "user": {
      "_id": "667000000000000000000001",
      "customerId": "CUST-000123",
      "username": "demo_user",
      "companyName": "Demo Company",
      "role": "admin",
      "isBanned": false,
      "createdAt": "2026-06-20T12:00:00.000Z",
      "updatedAt": "2026-06-20T12:00:00.000Z",
      "__v": 0
    },
    "customerId": "CUST-000123"
  }
}
```

**أخطاء محتملة:**
- 401: توكن مفقود/غير صالح.
- 403: حساب بلا customerId (حالة نادرة).
- 500: خطأ خادم.

**مثال Axios:**

```js
import axios from "axios";

const token = localStorage.getItem("token");
const res = await axios.get(`${API_BASE_URL}/api/auth/me`, {
  headers: { Authorization: `Bearer ${token}` },
});
```

---

### 5.4 POST `/api/auth/logout`

**الوصف:** تسجيل خروج (حاليًا لا يلغي التوكن على السيرفر؛ فقط استجابة نجاح). على الواجهة الأمامية احذف التوكن من التخزين.

**Headers المطلوبة:** لا يوجد.

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Logged out successfully"
}
```

**مثال Fetch:**

```js
await fetch(`${API_BASE_URL}/api/auth/logout`, { method: "POST" });
localStorage.removeItem("token");
```

---

## 6) Items (المنتجات/المخزون)

> جميع مسارات Items محمية وتتطلب:
> - `Authorization: Bearer <JWT>`
> - اشتراك نشط (قد تُرجع 402)

### 6.1 GET `/api/items`

**الوصف:** جلب قائمة المنتجات مع pagination، مع إمكانية فلترة المنتجات منخفضة المخزون.

**Headers المطلوبة:**
- `Authorization: Bearer <JWT>`

**Query Parameters:**

| المعلمة | النوع | مطلوب | الوصف |
|--------|------|------|------|
| page | Number | لا | الصفحة (افتراضي 1) |
| limit | Number | لا | عدد العناصر (افتراضي 10) |
| lowStock | String | لا | إذا كانت `true` يرجع المنتجات بكمية أقل من 5 |

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Items fetched",
  "data": [
    {
      "_id": "667000000000000000001111",
      "customerId": "CUST-000123",
      "modelNumber": "MD-100",
      "customer": "عميل نهائي",
      "name": "Keyboard",
      "quantity": 12,
      "price": 250,
      "costPrice": 180,
      "createdAt": "2026-06-20T12:00:00.000Z",
      "__v": 0
    }
  ],
  "totalInventoryValue": 3000,
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

**أخطاء محتملة:**
- 401/402/403/500 وفق النماذج القياسية.

**مثال Axios:**

```js
import axios from "axios";

const token = localStorage.getItem("token");
const res = await axios.get(`${API_BASE_URL}/api/items`, {
  params: { page: 1, limit: 20, lowStock: "false" },
  headers: { Authorization: `Bearer ${token}` },
});
```

---

### 6.2 GET `/api/items/search`

**الوصف:** البحث في المنتجات باستخدام نص بحث واحد، ويتم البحث في `modelNumber` و`name` و`customer`.

**Headers المطلوبة:**
- `Authorization: Bearer <JWT>`

**Query Parameters:**

| المعلمة | النوع | مطلوب | الوصف |
|--------|------|------|------|
| search | String | نعم | النص المطلوب البحث عنه |

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Search results",
  "data": [
    {
      "_id": "667000000000000000001111",
      "customerId": "CUST-000123",
      "modelNumber": "MD-100",
      "customer": "عميل نهائي",
      "name": "Keyboard",
      "quantity": 12,
      "price": 250,
      "costPrice": 180,
      "createdAt": "2026-06-20T12:00:00.000Z",
      "__v": 0
    }
  ]
}
```

**أخطاء محتملة:**
- 401/402/403/500.

**مثال Fetch:**

```js
const token = localStorage.getItem("token");
const url = new URL(`${API_BASE_URL}/api/items/search`);
url.searchParams.set("search", "MD-100");

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
});
const data = await res.json();
```

---

### 6.3 POST `/api/items`

**الوصف:** إنشاء منتج جديد. يخضع لحد الخطة `maxItems`.

**Headers المطلوبة:**
- `Authorization: Bearer <JWT>`
- `Content-Type: application/json`

**Body (JSON):**

| الحقل | النوع | مطلوب | الوصف |
|------|------|------|------|
| modelNumber | String | نعم | رقم/كود الموديل |
| name | String | نعم | اسم المنتج |
| quantity | Number | نعم | الكمية الافتتاحية (>= 0) |
| price | Number | نعم | سعر البيع |
| costPrice | Number | لا | متوسط/سعر التكلفة (افتراضي 0) |
| customer | String | نعم | اسم العميل/الجهة (كما في النظام الحالي) |

**نموذج طلب صالح:**

```json
{
  "modelNumber": "MD-100",
  "name": "Keyboard",
  "quantity": 10,
  "price": 250,
  "costPrice": 180,
  "customer": "عميل نهائي"
}
```

**استجابة 201 (نجاح):**

```json
{
  "status": true,
  "message": "Item added",
  "data": {
    "_id": "667000000000000000001111",
    "customerId": "CUST-000123",
    "modelNumber": "MD-100",
    "customer": "عميل نهائي",
    "name": "Keyboard",
    "quantity": 10,
    "price": 250,
    "costPrice": 180,
    "createdAt": "2026-06-20T12:00:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:**
- 400: فشل Joi أو الوصول لحد الخطة (`type: LIMIT_REACHED`).
- 401/402/403/500.

**مثال Axios:**

```js
import axios from "axios";

const token = localStorage.getItem("token");
const res = await axios.post(
  `${API_BASE_URL}/api/items`,
  {
    modelNumber: "MD-100",
    name: "Keyboard",
    quantity: 10,
    price: 250,
    costPrice: 180,
    customer: "عميل نهائي",
  },
  { headers: { Authorization: `Bearer ${token}` } }
);
```

---

### 6.4 PUT `/api/items/:id`

**الوصف:** تحديث منتج موجود (جزئي). يجب أن ينتمي المنتج لنفس `customerId`.

**Headers المطلوبة:**
- `Authorization: Bearer <JWT>`
- `Content-Type: application/json`

**Path Parameters:**

| المعلمة | النوع | مطلوب | الوصف |
|--------|------|------|------|
| id | String (ObjectId) | نعم | معرّف المنتج |

**Body (JSON) — يجب إرسال حقل واحد على الأقل:**

| الحقل | النوع | مطلوب | الوصف |
|------|------|------|------|
| modelNumber | String | لا | رقم الموديل |
| name | String | لا | اسم المنتج |
| quantity | Number | لا | الكمية |
| price | Number | لا | سعر البيع |
| costPrice | Number | لا | سعر/متوسط التكلفة |
| customer | String | لا | اسم العميل/الجهة |

**نموذج طلب صالح:**

```json
{
  "price": 275,
  "quantity": 8
}
```

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Item updated",
  "data": {
    "_id": "667000000000000000001111",
    "customerId": "CUST-000123",
    "modelNumber": "MD-100",
    "customer": "عميل نهائي",
    "name": "Keyboard",
    "quantity": 8,
    "price": 275,
    "costPrice": 180,
    "createdAt": "2026-06-20T12:00:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:**
- 400: فشل Joi (مثلاً إرسال Body فارغ) أو قيم غير صالحة.
- 404: المنتج غير موجود أو ليس ضمن العميل.
- 401/402/403/500.

**مثال Fetch:**

```js
const token = localStorage.getItem("token");
const res = await fetch(`${API_BASE_URL}/api/items/${itemId}`, {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ price: 275, quantity: 8 }),
});
const data = await res.json();
```

---

### 6.5 DELETE `/api/items/:id`

**الوصف:** حذف منتج. يجب أن ينتمي المنتج لنفس `customerId`.

**Headers المطلوبة:**
- `Authorization: Bearer <JWT>`

**Path Parameters:**

| المعلمة | النوع | مطلوب | الوصف |
|--------|------|------|------|
| id | String (ObjectId) | نعم | معرّف المنتج |

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Item deleted",
  "data": null
}
```

**أخطاء محتملة:**
- 400: `id` غير صالح.
- 404: المنتج غير موجود.
- 401/402/403/500.

**مثال Axios:**

```js
await axios.delete(`${API_BASE_URL}/api/items/${itemId}`, {
  headers: { Authorization: `Bearer ${token}` },
});
```

---

### 6.6 GET `/api/items/export`

**الوصف:** تصدير المخزون إلى ملف Excel (XLSX). الاستجابة ليست JSON عند النجاح بل ملف ثنائي.

**Headers المطلوبة:**
- `Authorization: Bearer <JWT>`

**استجابة 200 (نجاح):**
- `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Body: Binary (XLSX)

**استجابة 404 (لا توجد بيانات للتصدير):**

```json
{
  "status": false,
  "message": "لا توجد بيانات لتصديرها"
}
```

**مثال Axios (تحميل ملف):**

```js
import axios from "axios";

const token = localStorage.getItem("token");
const res = await axios.get(`${API_BASE_URL}/api/items/export`, {
  headers: { Authorization: `Bearer ${token}` },
  responseType: "blob",
});

const url = window.URL.createObjectURL(res.data);
const a = document.createElement("a");
a.href = url;
a.download = "inventory.xlsx";
a.click();
```

---

### 6.7 GET `/api/items/download/:id`

**الوصف:** تنزيل ملف Excel محفوظ مسبقاً في MongoDB بواسطة `InvoiceFile`.

**Headers المطلوبة:**
- `Authorization: Bearer <JWT>`

**Path Parameters:**

| المعلمة | النوع | مطلوب | الوصف |
|--------|------|------|------|
| id | String (ObjectId) | نعم | معرّف الملف |

**استجابة 200 (نجاح):**
- `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Body: Binary

**استجابة 404:**

```json
{
  "status": false,
  "message": "File not found or unauthorized",
  "data": null
}
```

---

### 6.8 PUT `/api/items/expenses/:id` (Legacy)

**الوصف:** تحديث مصروف (Expense) من خلال مسار داخل Items (موجود كمسار إضافي). يُفضّل استخدام `/api/expenses/:id` في القسم الخاص بالمصروفات.

**Headers المطلوبة:**
- `Authorization: Bearer <JWT>`
- `Content-Type: application/json`

**Path Parameters:** `id` (ObjectId) لمصروف.

**Body (JSON):**

```json
{
  "description": "نقل",
  "amount": 150
}
```

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Expense updated",
  "data": {
    "_id": "66700000000000000000E111",
    "customerId": "CUST-000123",
    "description": "نقل",
    "amount": 150,
    "date": "2026-06-20T00:00:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:**
- 400: فشل Joi.
- 404: المصروف غير موجود.
- 401/402/403/500.

---

### 6.9 DELETE `/api/items/expenses/:id` (Legacy)

**الوصف:** حذف مصروف (Expense) من خلال مسار داخل Items. يُفضّل استخدام `/api/expenses/:id`.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Expense deleted",
  "data": null
}
```

---

## 7) Sales (المبيعات)

> جميع مسارات Sales محمية وتتطلب JWT + اشتراك نشط.

### 7.1 GET `/api/sales/export`

**الوصف:** تصدير تقرير المبيعات إلى Excel مع إمكانية فلترة تاريخية.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**Query Parameters:**

| المعلمة | النوع | مطلوب | الوصف |
|--------|------|------|------|
| from | String (Date) | لا | بداية الفترة |
| to | String (Date) | لا | نهاية الفترة |

**استجابة 200 (نجاح):** ملف XLSX.

**مثال Axios:**

```js
const res = await axios.get(`${API_BASE_URL}/api/sales/export`, {
  params: { from: "2026-06-01", to: "2026-06-30" },
  headers: { Authorization: `Bearer ${token}` },
  responseType: "blob",
});
```

---

### 7.2 POST `/api/sales`

**الوصف:** إنشاء فاتورة بيع (تخفيض المخزون + إنشاء حركة مخزون OUT).

**Headers المطلوبة:**
- `Authorization: Bearer <JWT>`
- `Content-Type: application/json`

**Body (JSON):**

| الحقل | النوع | مطلوب | الوصف |
|------|------|------|------|
| modelNumber | String | نعم | رقم موديل المنتج (يجب أن يوجد ضمن Items لنفس العميل) |
| name | String | نعم | اسم المنتج |
| quantity | Number | نعم | الكمية المباعة |
| price | Number | نعم | سعر البيع للوحدة |
| sellerName | String | لا | اسم العميل/البائع (يُستخدم في واجهة التقارير) |
| total | Number | لا | الإجمالي؛ إن لم يُرسل سيتم حسابه `quantity*price` |

**نموذج طلب صالح:**

```json
{
  "modelNumber": "MD-100",
  "name": "Keyboard",
  "quantity": 2,
  "price": 275,
  "sellerName": "أحمد",
  "total": 550
}
```

**استجابة 201 (نجاح):**

```json
{
  "status": true,
  "message": "تم إضافة فاتورة البيع",
  "data": {
    "_id": "66700000000000000000S001",
    "customerId": "CUST-000123",
    "modelNumber": "MD-100",
    "name": "Keyboard",
    "quantity": 2,
    "price": 275,
    "costPrice": 180,
    "total": 550,
    "sellerName": "أحمد",
    "createdAt": "2026-06-20T12:10:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:**
- 400: الكمية غير متوفرة أو فشل Joi.
- 404: المنتج غير موجود.
- 401/402/403/500.

**مثال Fetch:**

```js
const res = await fetch(`${API_BASE_URL}/api/sales`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    modelNumber: "MD-100",
    name: "Keyboard",
    quantity: 2,
    price: 275,
    sellerName: "أحمد",
  }),
});
const data = await res.json();
```

---

### 7.3 GET `/api/sales`

**الوصف:** جلب فواتير البيع مع فلاتر تاريخية + pagination + إجمالي المبيعات.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**Query Parameters (اختياري، تُطبق أولوية حسب الكود):**

| المعلمة | النوع | الوصف |
|--------|------|------|
| day | String (Date) | يوم محدد مثل `2026-06-20` |
| month | String | شهر بصيغة `YYYY-MM` مثل `2026-06` |
| year | String/Number | سنة مثل `2026` |
| from | String (Date) | بداية فترة |
| to | String (Date) | نهاية فترة |
| page | Number | الصفحة |
| limit | Number | الحد |

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "فواتير البيع",
  "data": [
    {
      "_id": "66700000000000000000S001",
      "customerId": "CUST-000123",
      "modelNumber": "MD-100",
      "name": "Keyboard",
      "quantity": 2,
      "price": 275,
      "costPrice": 180,
      "total": 550,
      "createdAt": "2026-06-20T12:10:00.000Z",
      "sellerName": "أحمد",
      "__v": 0,
      "customer": "أحمد"
    }
  ],
  "totalSalesValue": 550,
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

**مثال Axios:**

```js
const res = await axios.get(`${API_BASE_URL}/api/sales`, {
  params: { from: "2026-06-01", to: "2026-06-30", page: 1, limit: 20 },
  headers: { Authorization: `Bearer ${token}` },
});
```

---

### 7.4 PUT `/api/sales/:id`

**الوصف:** تحديث كمية وسعر فاتورة بيع. يقوم النظام بإرجاع/خصم الكمية من المخزون وفق الفرق، ويُنشئ حركة مخزون ADJUSTMENT.

**Headers المطلوبة:**
- `Authorization: Bearer <JWT>`
- `Content-Type: application/json`

**Path Parameters:** `id` (ObjectId) للفاتورة.

**Body (JSON):**

```json
{
  "quantity": 3,
  "price": 280
}
```

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "تم تحديث الفاتورة",
  "data": {
    "_id": "66700000000000000000S001",
    "customerId": "CUST-000123",
    "modelNumber": "MD-100",
    "name": "Keyboard",
    "quantity": 3,
    "price": 280,
    "costPrice": 180,
    "total": 840,
    "sellerName": "أحمد",
    "createdAt": "2026-06-20T12:10:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:**
- 400: الكمية غير كافية أو فشل Joi.
- 404: الفاتورة/المنتج غير موجود.
- 401/402/403/500.

---

### 7.5 DELETE `/api/sales/:id`

**الوصف:** حذف فاتورة بيع (يرجع الكمية للمخزون ويُنشئ حركة RETURN).

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "تم حذف الفاتورة"
}
```

**أخطاء محتملة:**
- 404: الفاتورة غير موجودة.
- 401/402/403/500.

---

### 7.6 POST `/api/sales/bulk-delete`

**الوصف:** حذف مجموعة فواتير بيع دفعة واحدة (يرجع المخزون لكل فاتورة إذا أمكن).

**Headers المطلوبة:**
- `Authorization: Bearer <JWT>`
- `Content-Type: application/json`

**Body (JSON):**

```json
{
  "ids": ["66700000000000000000S001", "66700000000000000000S002"]
}
```

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "تم حذف الفواتير المحددة بنجاح!"
}
```

**أخطاء محتملة:**
- 400: فشل Joi (مثلاً ids فارغة).
- 401/402/403/500.

---

## 8) Purchases (المشتريات البسيطة)

> جميع مسارات Purchases محمية وتتطلب JWT + اشتراك نشط.

### 8.1 GET `/api/purchases`

**الوصف:** جلب عمليات شراء بسيطة (ليست فواتير شراء). تُرجع أيضاً مجموع قيمة المشتريات.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**Query Parameters:** `page`, `limit`.

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Purchases",
  "data": [
    {
      "_id": "66700000000000000000P001",
      "customerId": "CUST-000123",
      "description": "شراء Keyboard (MD-100) من Supplier A",
      "amount": 500,
      "date": "2026-06-20T00:00:00.000Z",
      "type": "purchase",
      "reason": "",
      "itemId": {
        "_id": "667000000000000000001111",
        "modelNumber": "MD-100",
        "name": "Keyboard",
        "quantity": 15,
        "price": 250,
        "costPrice": 190,
        "customerId": "CUST-000123",
        "createdAt": "2026-06-20T12:00:00.000Z",
        "__v": 0
      },
      "modelNumber": "MD-100",
      "name": "Keyboard",
      "quantity": 5,
      "price": 100,
      "supplier": "Supplier A",
      "createdAt": "2026-06-20T12:20:00.000Z",
      "updatedAt": "2026-06-20T12:20:00.000Z",
      "__v": 0
    }
  ],
  "totalPurchasesValue": 500,
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

---

### 8.2 POST `/api/purchases`

**الوصف:** إضافة عملية شراء بسيطة مرتبطة بمنتج موجود (يزيد المخزون ويعيد حساب متوسط التكلفة المرجّح). تتطلب صلاحية `admin` أو `editor`. كما يتم احتساب حد الخطة باستخدام مورد `sales` (بيع/شراء).

**Headers المطلوبة:**
- `Authorization: Bearer <JWT>`
- `Content-Type: application/json`

**Body (JSON):**

```json
{
  "modelNumber": "MD-100",
  "name": "Keyboard",
  "quantity": 5,
  "price": 100,
  "supplier": "Supplier A",
  "date": "2026-06-20"
}
```

**استجابة 201 (نجاح):**

```json
{
  "status": true,
  "message": "Purchase created",
  "data": {
    "_id": "66700000000000000000P001",
    "customerId": "CUST-000123",
    "description": "شراء Keyboard (MD-100) من Supplier A",
    "amount": 500,
    "date": "2026-06-20T00:00:00.000Z",
    "type": "purchase",
    "reason": "",
    "itemId": "667000000000000000001111",
    "modelNumber": "MD-100",
    "name": "Keyboard",
    "quantity": 5,
    "price": 100,
    "supplier": "Supplier A",
    "createdAt": "2026-06-20T12:20:00.000Z",
    "updatedAt": "2026-06-20T12:20:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:**
- 403: الدور غير مسموح.
- 404: المنتج غير موجود (يجب إنشاء المنتج أولاً عبر `/api/items`).
- 400: فشل Joi أو حد الخطة.
- 401/402/500.

---

### 8.3 PUT `/api/purchases/:id`

**الوصف:** تحديث عملية شراء بسيطة (لا يعيد احتساب المخزون في هذا المسار — يحدّث سجل الشراء فقط).

**Headers المطلوبة:** `Authorization: Bearer <JWT>`, `Content-Type: application/json`

**Body:** نفس حقول إنشاء الشراء.

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Purchase updated",
  "data": {
    "_id": "66700000000000000000P001",
    "customerId": "CUST-000123",
    "description": "شراء Keyboard (MD-100) من Supplier A",
    "amount": 600,
    "date": "2026-06-21T00:00:00.000Z",
    "type": "purchase",
    "reason": "",
    "itemId": "667000000000000000001111",
    "modelNumber": "MD-100",
    "name": "Keyboard",
    "quantity": 6,
    "price": 100,
    "supplier": "Supplier A",
    "createdAt": "2026-06-20T12:20:00.000Z",
    "updatedAt": "2026-06-20T12:30:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:** 403/404/400/401/402/500.

---

### 8.4 DELETE `/api/purchases/:id`

**الوصف:** حذف عملية شراء بسيطة (يتطلب `admin`).

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Purchase deleted",
  "data": null
}
```

**أخطاء محتملة:**
- 400: id غير صالح.
- 403: ليس admin.
- 404: غير موجود.
- 401/402/500.

---

### 8.5 POST `/api/purchases/adjust`

**الوصف:** إضافة تعديل يدوي على إجمالي المشتريات/الأرباح (ينشئ سجل Purchase من نوع `adjustment`). يتطلب `admin` أو `editor`.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`, `Content-Type: application/json`

**Body:**

```json
{
  "amount": 1000,
  "reason": "تعديل يدوي"
}
```

**استجابة 201 (نجاح):**

```json
{
  "status": true,
  "message": "تم إضافة التعديل",
  "data": {
    "_id": "66700000000000000000A001",
    "customerId": "CUST-000123",
    "description": "تعديل يدوي",
    "amount": 1000,
    "type": "adjustment",
    "reason": "تعديل يدوي",
    "date": "2026-06-20T12:40:00.000Z",
    "createdAt": "2026-06-20T12:40:00.000Z",
    "updatedAt": "2026-06-20T12:40:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:** 400/403/401/402/500.

---

## 9) Purchase Invoices (فواتير الشراء)

> جميع مسارات فواتير الشراء محمية وتتطلب JWT + اشتراك نشط.

### 9.1 GET `/api/purchase-invoices`

**الوصف:** جلب فواتير الشراء مع pagination، ويقوم بعمل `populate` للمورد.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**Query Parameters:** `page` (افتراضي 1) و`limit` (افتراضي 20، أقصى 100).

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Purchase invoices",
  "data": [
    {
      "_id": "66700000000000000000PI01",
      "customerId": "CUST-000123",
      "invoiceNumber": "PI-20260620-121500-ABCD",
      "supplierId": {
        "_id": "66700000000000000000SUP1",
        "customerId": "CUST-000123",
        "name": "Supplier A",
        "phone": "",
        "email": "",
        "address": "",
        "balance": 450,
        "createdAt": "2026-06-20T11:00:00.000Z",
        "updatedAt": "2026-06-20T12:15:00.000Z",
        "__v": 0
      },
      "date": "2026-06-20T00:00:00.000Z",
      "status": "posted",
      "items": [
        {
          "itemId": "667000000000000000001111",
          "qty": 5,
          "unitCost": 100,
          "lineTotal": 500
        }
      ],
      "subTotal": 500,
      "tax": 0,
      "discount": 50,
      "grandTotal": 450,
      "paidAmount": 0,
      "createdAt": "2026-06-20T12:15:00.000Z",
      "updatedAt": "2026-06-20T12:15:00.000Z",
      "__v": 0
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

### 9.2 GET `/api/purchase-invoices/:id`

**الوصف:** جلب تفاصيل فاتورة شراء واحدة مع `populate` للمورد وبنود الفاتورة (`items.itemId`).

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Purchase invoice",
  "data": {
    "_id": "66700000000000000000PI01",
    "customerId": "CUST-000123",
    "invoiceNumber": "PI-20260620-121500-ABCD",
    "supplierId": {
      "_id": "66700000000000000000SUP1",
      "name": "Supplier A",
      "balance": 450,
      "customerId": "CUST-000123",
      "createdAt": "2026-06-20T11:00:00.000Z",
      "updatedAt": "2026-06-20T12:15:00.000Z",
      "__v": 0
    },
    "date": "2026-06-20T00:00:00.000Z",
    "status": "posted",
    "items": [
      {
        "itemId": {
          "_id": "667000000000000000001111",
          "modelNumber": "MD-100",
          "name": "Keyboard",
          "quantity": 15,
          "price": 250,
          "costPrice": 190,
          "customerId": "CUST-000123",
          "createdAt": "2026-06-20T12:00:00.000Z",
          "__v": 0
        },
        "qty": 5,
        "unitCost": 100,
        "lineTotal": 500
      }
    ],
    "subTotal": 500,
    "tax": 0,
    "discount": 50,
    "grandTotal": 450,
    "paidAmount": 0,
    "createdAt": "2026-06-20T12:15:00.000Z",
    "updatedAt": "2026-06-20T12:15:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:**
- 400: id غير صالح.
- 404: غير موجود.
- 401/402/403/500.

---

### 9.3 POST `/api/purchase-invoices`

**الوصف:** إنشاء فاتورة شراء (يزيد المخزون لكل بند + يحسب متوسط التكلفة المرجح + ينشئ حركات مخزون PURCHASE + يحدّث رصيد المورد Balance بالدين المتبقي).

**الصلاحيات:** `admin` أو `editor`.

**Headers المطلوبة:**
- `Authorization: Bearer <JWT>`
- `Content-Type: application/json`

**Body (JSON):**

| الحقل | النوع | مطلوب | الوصف |
|------|------|------|------|
| invoiceNumber | String | لا | رقم فاتورة (إن لم يُرسل سيتم توليده تلقائياً) |
| supplierId | String (ObjectId) | نعم | معرّف المورد |
| date | String/Date | لا | تاريخ الفاتورة |
| tax | Number | لا | ضريبة (افتراضي 0) |
| discount | Number | لا | خصم (افتراضي 0) |
| paidAmount | Number | لا | المدفوع (افتراضي 0، لا يمكن أن يتجاوز الإجمالي) |
| items | Array | نعم | بنود الفاتورة (على الأقل بند واحد) |

**items[]:**

| الحقل | النوع | مطلوب | الوصف |
|------|------|------|------|
| itemId | String (ObjectId) | نعم | معرّف المنتج |
| qty | Number | نعم | الكمية (> 0) |
| unitCost | Number | نعم | تكلفة الوحدة |

**نموذج طلب صالح:**

```json
{
  "supplierId": "66700000000000000000SUP1",
  "date": "2026-06-20",
  "tax": 0,
  "discount": 50,
  "paidAmount": 0,
  "items": [
    { "itemId": "667000000000000000001111", "qty": 5, "unitCost": 100 }
  ]
}
```

**استجابة 201 (نجاح):**

```json
{
  "status": true,
  "message": "Purchase invoice created",
  "data": {
    "_id": "66700000000000000000PI01",
    "customerId": "CUST-000123",
    "invoiceNumber": "PI-20260620-121500-ABCD",
    "supplierId": "66700000000000000000SUP1",
    "date": "2026-06-20T00:00:00.000Z",
    "status": "posted",
    "items": [
      { "itemId": "667000000000000000001111", "qty": 5, "unitCost": 100, "lineTotal": 500 }
    ],
    "subTotal": 500,
    "tax": 0,
    "discount": 50,
    "grandTotal": 450,
    "paidAmount": 0,
    "createdAt": "2026-06-20T12:15:00.000Z",
    "updatedAt": "2026-06-20T12:15:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:**
- 400: `supplierId`/`itemId` غير صالح، أو `paidAmount > grandTotal`، أو totals سلبية، أو فشل Joi.
- 403: الدور غير مسموح.
- 404: المورد/المنتج غير موجود.
- 401/402/500.

**مثال Axios:**

```js
await axios.post(
  `${API_BASE_URL}/api/purchase-invoices`,
  {
    supplierId,
    date: "2026-06-20",
    tax: 0,
    discount: 50,
    paidAmount: 0,
    items: [{ itemId, qty: 5, unitCost: 100 }],
  },
  { headers: { Authorization: `Bearer ${token}` } }
);
```

---

### 9.4 POST `/api/purchase-invoices/:id/cancel`

**الوصف:** إلغاء فاتورة شراء منشورة (يعكس المخزون ويُنشئ حركة PURCHASE_CANCEL ويقلل رصيد المورد). يمنع الإلغاء إذا وُجدت حركات مخزون لاحقة على نفس المنتجات بعد تاريخ الفاتورة.

**الصلاحيات:** `admin` أو `editor`.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Purchase invoice cancelled",
  "data": {
    "_id": "66700000000000000000PI01",
    "status": "cancelled",
    "cancelledAt": "2026-06-20T13:00:00.000Z",
    "cancelledBy": "667000000000000000000001"
  }
}
```

**أخطاء محتملة:**
- 400: id غير صالح أو الفاتورة ملغاة بالفعل.
- 404: الفاتورة/المنتج غير موجود.
- 409: لا يمكن الإلغاء بسبب وجود حركات مخزون لاحقة أو سيؤدي لمخزون سالب.
- 401/402/403/500.

---

## 10) Inventory Adjustments (تسويات المخزون)

> محمية وتتطلب JWT + اشتراك نشط.

### 10.1 GET `/api/inventory-adjustments`

**الوصف:** عرض سجل تسويات المخزون مع pagination وإمكانية فلترة بـ `itemId`.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**Query Parameters:**

| المعلمة | النوع | الوصف |
|--------|------|------|
| page | Number | افتراضي 1 |
| limit | Number | افتراضي 20 (أقصى 100) |
| itemId | String (ObjectId) | فلترة لسجل منتج محدد |

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Inventory adjustments",
  "data": [
    {
      "_id": "66700000000000000000ADJ1",
      "customerId": "CUST-000123",
      "itemId": {
        "_id": "667000000000000000001111",
        "modelNumber": "MD-100",
        "name": "Keyboard",
        "quantity": 12,
        "price": 250,
        "costPrice": 180,
        "customerId": "CUST-000123",
        "createdAt": "2026-06-20T12:00:00.000Z",
        "__v": 0
      },
      "qtyDelta": -2,
      "unitCost": 180,
      "reason": "كسر",
      "date": "2026-06-20T00:00:00.000Z",
      "createdBy": "667000000000000000000001",
      "createdAt": "2026-06-20T12:50:00.000Z",
      "updatedAt": "2026-06-20T12:50:00.000Z",
      "__v": 0
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

### 10.2 POST `/api/inventory-adjustments`

**الوصف:** تنفيذ تسوية مخزون (زيادة أو نقصان). يقوم بإنشاء سجل تسوية + حركة مخزون ADJUSTMENT. إذا كانت التسوية موجبة و`unitCost` موجودة، يعيد حساب متوسط التكلفة المرجح.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`, `Content-Type: application/json`

**Body (JSON):**

| الحقل | النوع | مطلوب | الوصف |
|------|------|------|------|
| itemId | String (ObjectId) | نعم | معرّف المنتج |
| qtyDelta | Number | نعم | فرق الكمية (+ زيادة / - نقصان) ولا يمكن أن يكون 0 |
| unitCost | Number | لا | تكلفة الوحدة (تؤثر فقط عند الزيادة) |
| reason | String | لا | سبب التسوية |
| date | Date/String | لا | تاريخ الحركة |

**نموذج طلب صالح:**

```json
{
  "itemId": "667000000000000000001111",
  "qtyDelta": -2,
  "unitCost": 180,
  "reason": "كسر",
  "date": "2026-06-20"
}
```

**استجابة 201 (نجاح):**

```json
{
  "status": true,
  "message": "Inventory adjusted",
  "data": {
    "_id": "66700000000000000000ADJ1",
    "customerId": "CUST-000123",
    "itemId": "667000000000000000001111",
    "qtyDelta": -2,
    "unitCost": 180,
    "reason": "كسر",
    "date": "2026-06-20T00:00:00.000Z",
    "createdBy": "667000000000000000000001",
    "createdAt": "2026-06-20T12:50:00.000Z",
    "updatedAt": "2026-06-20T12:50:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:**
- 400: itemId غير صالح أو فشل Joi.
- 404: المنتج غير موجود.
- 409: سيؤدي إلى مخزون سالب.
- 401/402/403/500.

---

## 11) Suppliers (الموردون)

> محمية وتتطلب JWT + اشتراك نشط.

### 11.1 GET `/api/suppliers`

**الوصف:** جلب الموردين مع pagination.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**Query:** `page`, `limit`.

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Suppliers",
  "data": [
    {
      "_id": "66700000000000000000SUP1",
      "customerId": "CUST-000123",
      "name": "Supplier A",
      "phone": "",
      "email": "",
      "address": "",
      "balance": 450,
      "createdAt": "2026-06-20T11:00:00.000Z",
      "updatedAt": "2026-06-20T12:15:00.000Z",
      "__v": 0
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

### 11.2 POST `/api/suppliers`

**الوصف:** إنشاء مورد جديد. يتطلب `admin` أو `editor`.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`, `Content-Type: application/json`

**Body (JSON):**

```json
{
  "name": "Supplier A",
  "phone": "01000000000",
  "email": "supplier@example.com",
  "address": "Cairo"
}
```

**استجابة 201 (نجاح):**

```json
{
  "status": true,
  "message": "Supplier created",
  "data": {
    "_id": "66700000000000000000SUP1",
    "customerId": "CUST-000123",
    "name": "Supplier A",
    "phone": "01000000000",
    "email": "supplier@example.com",
    "address": "Cairo",
    "balance": 0,
    "createdAt": "2026-06-20T11:00:00.000Z",
    "updatedAt": "2026-06-20T11:00:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:**
- 403: دور غير مسموح.
- 409: المورد موجود مسبقاً.
- 400: فشل Joi.
- 401/402/500.

---

## 12) Expenses (المصروفات)

> محمية وتتطلب JWT + اشتراك نشط.

### 12.1 GET `/api/expenses`

**الوصف:** جلب المصروفات مع pagination + إجمالي قيمة المصروفات.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**Query:**

| المعلمة | النوع | الوصف |
|--------|------|------|
| page | Number | افتراضي 1 |
| limit | Number | افتراضي 10 |

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Expenses fetched",
  "data": [
    {
      "_id": "66700000000000000000E111",
      "customerId": "CUST-000123",
      "description": "نقل",
      "amount": 150,
      "date": "2026-06-20T00:00:00.000Z",
      "__v": 0
    }
  ],
  "totalExpensesValue": 150,
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

---

### 12.2 POST `/api/expenses`

**الوصف:** إنشاء مصروف جديد. يخضع لحد الخطة `maxExpenses`. التحقق هنا يتم يدوياً (ليس Joi).

**Headers المطلوبة:** `Authorization: Bearer <JWT>`, `Content-Type: application/json`

**Body (JSON):**

```json
{
  "description": "نقل",
  "amount": 150
}
```

**استجابة 201 (نجاح):**

```json
{
  "status": true,
  "message": "Expense added",
  "data": {
    "_id": "66700000000000000000E111",
    "customerId": "CUST-000123",
    "description": "نقل",
    "amount": 150,
    "date": "2026-06-20T12:55:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:**
- 400: إذا كان `description` أو `amount` مفقوداً أو حد الخطة.
- 401/402/403/500.

---

### 12.3 PUT `/api/expenses/:id`

**الوصف:** تحديث مصروف.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`, `Content-Type: application/json`

**Body:**

```json
{
  "description": "نقل (محدّث)",
  "amount": 200
}
```

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Expense updated",
  "data": {
    "_id": "66700000000000000000E111",
    "customerId": "CUST-000123",
    "description": "نقل (محدّث)",
    "amount": 200,
    "date": "2026-06-20T12:55:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:**
- 404: غير موجود.
- 401/402/403/500.

---

### 12.4 DELETE `/api/expenses/:id`

**الوصف:** حذف مصروف.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Expense deleted"
}
```

**أخطاء محتملة:** 404/401/402/403/500.

---

## 13) Excel Files (ملفات Excel المحفوظة)

> محمية وتتطلب JWT + اشتراك نشط.

### 13.1 GET `/api/excel-files`

**الوصف:** جلب جميع ملفات Excel المحفوظة للعميل الحالي بصيغة JSON (بدون حقل `buffer` لتخفيف الحجم).

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "Files fetched",
  "data": [
    {
      "_id": "66700000000000000000F001",
      "customerId": "CUST-000123",
      "createdAt": "2026-06-20T12:00:00.000Z",
      "__v": 0
    }
  ]
}
```

---

### 13.2 GET `/api/excel-files/:id/download`

**الوصف:** تنزيل ملف Excel محدد.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**استجابة 200 (نجاح):** ملف XLSX (Binary).

**استجابة 404 (غير موجود):**

```json
{
  "status": false,
  "message": "File not found"
}
```

**مثال Axios:**

```js
const res = await axios.get(`${API_BASE_URL}/api/excel-files/${fileId}/download`, {
  headers: { Authorization: `Bearer ${token}` },
  responseType: "blob",
});
```

---

### 13.3 DELETE `/api/excel-files/:id`

**الوصف:** حذف ملف Excel محفوظ.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "File deleted successfully"
}
```

**استجابة 404:**

```json
{
  "status": false,
  "message": "File not found"
}
```

---

## 14) Reports (التقارير)

> محمية وتتطلب JWT + اشتراك نشط.
> معظم مسارات التقارير تقبل Query Parameters التالية (وفق Joi):
> `from`, `to`, `page`, `limit`, `search`, `lowStock`, `itemId`, `direction`, `reason`.

### 14.1 GET `/api/reports/summary`

**الوصف:** ملخص شامل للوحة التحكم: إجمالي المنتجات، آخر المبيعات، مخزون منخفض، مؤشرات مالية (مبيعات/COGS/مشتريات/مصروفات/صافي ربح).

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "data": {
    "customerId": "CUST-000123",
    "companyName": "Demo Company",
    "inventory": {
      "totalItems": 10,
      "lowStockItems": [
        {
          "_id": "667000000000000000001111",
          "modelNumber": "MD-100",
          "name": "Keyboard",
          "quantity": 3,
          "price": 250,
          "costPrice": 180,
          "customerId": "CUST-000123",
          "createdAt": "2026-06-20T12:00:00.000Z",
          "__v": 0
        }
      ]
    },
    "financials": {
      "totalSales": 550,
      "salesCount": 1,
      "totalCOGS": 360,
      "totalPurchases": 450,
      "purchasesCount": 1,
      "totalExpenses": 150,
      "netProfit": 40
    },
    "recentSales": [
      {
        "_id": "66700000000000000000S001",
        "modelNumber": "MD-100",
        "name": "Keyboard",
        "quantity": 2,
        "price": 275,
        "total": 550,
        "sellerName": "أحمد",
        "costPrice": 180,
        "customerId": "CUST-000123",
        "createdAt": "2026-06-20T12:10:00.000Z",
        "__v": 0
      }
    ]
  }
}
```

---

### 14.2 GET `/api/reports/sales`

**الوصف:** تقرير المبيعات مع pagination وإحصائيات إجمالية.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**Query Parameters الشائعة:**
- `from`, `to` لتحديد فترة.
- `page`, `limit`.

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "data": {
    "customerId": "CUST-000123",
    "pagination": { "page": 1, "limit": 50, "total": 1, "pages": 1 },
    "summary": {
      "totalRevenue": 550,
      "totalQuantitySold": 2,
      "averagePrice": 275
    },
    "invoices": [
      {
        "_id": "66700000000000000000S001",
        "customerId": "CUST-000123",
        "modelNumber": "MD-100",
        "name": "Keyboard",
        "quantity": 2,
        "price": 275,
        "costPrice": 180,
        "total": 550,
        "sellerName": "أحمد",
        "createdAt": "2026-06-20T12:10:00.000Z",
        "__v": 0
      }
    ]
  }
}
```

---

### 14.3 GET `/api/reports/inventory`

**الوصف:** تقرير المخزون الحالي + ملخص إجمالي.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**Query Parameters:**

| المعلمة | النوع | الوصف |
|--------|------|------|
| search | String | بحث في `modelNumber` و`name` |
| lowStock | String | `true` لإظهار منخفض المخزون |

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "data": {
    "customerId": "CUST-000123",
    "summary": {
      "totalItems": 10,
      "totalValue": 3000,
      "totalQuantity": 120,
      "outOfStock": 1,
      "lowStock": 2
    },
    "items": [
      {
        "_id": "667000000000000000001111",
        "customerId": "CUST-000123",
        "modelNumber": "MD-100",
        "name": "Keyboard",
        "customer": "عميل نهائي",
        "quantity": 12,
        "price": 250,
        "costPrice": 180,
        "createdAt": "2026-06-20T12:00:00.000Z",
        "__v": 0
      }
    ]
  }
}
```

---

### 14.4 GET `/api/reports/profit`

**الوصف:** تقرير الأرباح (مبيعات/مشتريات/COGS/مصروفات/هامش ربح) مع فترة اختيارية.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**Query Parameters:** `from`, `to`.

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "data": {
    "customerId": "CUST-000123",
    "period": { "from": "2026-06-01", "to": "2026-06-30" },
    "totalSales": 550,
    "totalPurchases": 450,
    "totalCOGS": 360,
    "totalExpenses": 150,
    "grossProfit": 190,
    "netProfit": 40,
    "profitMarginPercent": 7.27
  }
}
```

---

### 14.5 GET `/api/reports/stock-movements`

**الوصف:** تقرير حركة المخزون مع فلاتر (منتج/اتجاه/سبب/فترة) + pagination.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**Query Parameters:**

| المعلمة | النوع | الوصف |
|--------|------|------|
| itemId | String (ObjectId) | فلترة لمنتج محدد |
| direction | String | `IN` أو `OUT` |
| reason | String | `PURCHASE`, `SALE`, `ADJUSTMENT`, `RETURN`, `PURCHASE_CANCEL`, `OPENING_BALANCE` |
| from | Date | بداية |
| to | Date | نهاية |
| page | Number | صفحة |
| limit | Number | حد (أقصى 200) |

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "data": {
    "customerId": "CUST-000123",
    "pagination": { "page": 1, "limit": 50, "total": 1, "pages": 1 },
    "movements": [
      {
        "_id": "66700000000000000000M001",
        "customerId": "CUST-000123",
        "itemId": {
          "_id": "667000000000000000001111",
          "modelNumber": "MD-100",
          "name": "Keyboard",
          "quantity": 12,
          "price": 250,
          "costPrice": 180,
          "customerId": "CUST-000123",
          "createdAt": "2026-06-20T12:00:00.000Z",
          "__v": 0
        },
        "qty": 2,
        "direction": "OUT",
        "reason": "SALE",
        "referenceType": "SALE_INVOICE",
        "referenceId": "66700000000000000000S001",
        "unitCost": 180,
        "date": "2026-06-20T12:10:00.000Z",
        "createdAt": "2026-06-20T12:10:00.000Z",
        "updatedAt": "2026-06-20T12:10:00.000Z",
        "__v": 0
      }
    ]
  }
}
```

---

## 15) Profit Summary (ملخص الربح السريع)

### GET `/api/profit`

**الوصف:** ملخص مالي سريع (إجمالي مشتريات/مبيعات/COGS/مصروفات/صافي ربح) بدون فلاتر زمنية.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "data": {
    "totalPurchases": 450,
    "totalSales": 550,
    "totalCOGS": 360,
    "netProfit": 40,
    "totalExpenses": 150
  }
}
```

**أخطاء محتملة:** 401/402/403/500.

---

## 16) Subscription (الاشتراكات)

### 16.1 GET `/api/subscription/plans` (عام)

**الوصف:** جلب الخطط العامة المتاحة للاشتراك (بدون تسجيل دخول).

**Headers المطلوبة:** لا يوجد.

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "data": [
    {
      "_id": "66700000000000000000PLN1",
      "id": "pro",
      "name": "Pro",
      "price": 299,
      "currency": "EGP",
      "durationDays": 30,
      "limits": { "maxItems": 1000, "maxSales": 2000, "maxExpenses": 1000 },
      "features": ["..."],
      "isPublic": true,
      "createdAt": "2026-06-20T10:00:00.000Z",
      "updatedAt": "2026-06-20T10:00:00.000Z",
      "__v": 0
    }
  ]
}
```

---

### 16.2 GET `/api/subscription/status`

**الوصف:** جلب حالة الاشتراك الحالية + الاستهلاك (usage) مقارنة بالحدود. إذا لم يوجد اشتراك للمستخدم، يتم إنشاء اشتراك مجاني تلقائياً.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "data": {
    "plan": "free",
    "status": "active",
    "startDate": "2026-06-20T12:00:00.000Z",
    "endDate": "2026-07-20T12:00:00.000Z",
    "limits": { "maxItems": 200, "maxSales": 200, "maxExpenses": 200 },
    "usage": { "items": 10, "sales": 5, "expenses": 2 },
    "daysLeft": 30
  }
}
```

**أخطاء محتملة:** 401/403/500.

---

### 16.3 POST `/api/subscription/pay`

**الوصف:** إرسال طلب دفع لاشتراك جديد/ترقية. ينشئ Transaction بحالة `pending`، ويمنع وجود طلب Pending سابق.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`, `Content-Type: application/json`

**Body (JSON):**

```json
{
  "planRequested": "pro",
  "referenceNumber": "VF-123456",
  "amount": 300
}
```

**استجابة 201 (نجاح):**

```json
{
  "status": true,
  "message": "تم استلام طلب الدفع بنجاح، سيتم تفعيل الاشتراك بعد المراجعة (عادة خلال أقل من ساعة).",
  "data": {
    "_id": "66700000000000000000T001",
    "customerId": "CUST-000123",
    "amount": 300,
    "paymentMethod": "vodafone_cash",
    "status": "pending",
    "referenceNumber": "VF-123456",
    "planRequested": "pro",
    "createdAt": "2026-06-20T13:10:00.000Z",
    "updatedAt": "2026-06-20T13:10:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:**
- 400: فشل Joi، خطة غير صالحة، مبلغ غير كاف، أو يوجد طلب pending بالفعل.
- 401/403/500.

---

### 16.4 POST `/api/subscription/activate/:transactionId` (Superadmin)

**الوصف:** تفعيل الاشتراك يدوياً لمعاملة Pending (لأغراض الإدارة/الاختبار).

**Headers المطلوبة:** `Authorization: Bearer <JWT>` (سوبر أدمن).

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "تم تفعيل الاشتراك بنجاح"
}
```

**أخطاء محتملة:** 400/403/404/500.

---

## 17) Superadmin (لوحة السوبر أدمن)

> جميع مسارات هذا القسم محمية وتتطلب:
> - `Authorization: Bearer <JWT>`
> - الدور `superadmin`

### 17.1 GET `/api/superadmin/stats`

**الوصف:** إحصائيات عامة للنظام (عدد المستخدمين، الاشتراكات النشطة، الإيرادات، عدد العناصر، المدفوعات المعلقة).

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "data": {
    "users": 10,
    "activeSubscriptions": 7,
    "revenue": 1500,
    "items": 250,
    "pendingPayments": 2,
    "latestPendingPayments": [
      {
        "_id": "66700000000000000000T001",
        "customerId": "CUST-000123",
        "amount": 300,
        "planRequested": "pro",
        "createdAt": "2026-06-20T13:10:00.000Z",
        "user": { "username": "demo_user", "email": null }
      }
    ]
  }
}
```

---

### 17.2 GET `/api/superadmin/users/export` (XLSX)

**الوصف:** تصدير المستخدمين إلى Excel.

**استجابة 200:** ملف XLSX.

---

### 17.3 GET `/api/superadmin/transactions/export` (XLSX)

**الوصف:** تصدير المعاملات إلى Excel.

**استجابة 200:** ملف XLSX.

---

### 17.4 GET `/api/superadmin/users`

**الوصف:** جلب جميع المستخدمين (غير السوبر أدمن) مع بيانات الاشتراك لكل مستخدم.

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "data": [
    {
      "_id": "667000000000000000000001",
      "customerId": "CUST-000123",
      "username": "demo_user",
      "companyName": "Demo Company",
      "role": "admin",
      "isBanned": false,
      "createdAt": "2026-06-20T12:00:00.000Z",
      "updatedAt": "2026-06-20T12:00:00.000Z",
      "__v": 0,
      "subscription": {
        "_id": "66700000000000000000SUB1",
        "customerId": "CUST-000123",
        "planType": "free",
        "status": "active",
        "startDate": "2026-06-20T12:00:00.000Z",
        "endDate": "2026-07-20T12:00:00.000Z",
        "limits": { "maxItems": 200, "maxSales": 200, "maxExpenses": 200 },
        "createdAt": "2026-06-20T12:00:00.000Z",
        "updatedAt": "2026-06-20T12:00:00.000Z",
        "__v": 0
      }
    }
  ]
}
```

---

### 17.5 PUT `/api/superadmin/users/:userId`

**الوصف:** تحديث حالة المستخدم (حظر/رفع حظر) أو تغيير الدور. يدعم `reason` للتدقيق.

**Headers:** `Content-Type: application/json`

**Body مثال:**

```json
{
  "isBanned": true,
  "reason": "مخالفة شروط الاستخدام"
}
```

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "تم تحديث بيانات المستخدم بنجاح",
  "data": {
    "_id": "667000000000000000000001",
    "customerId": "CUST-000123",
    "username": "demo_user",
    "companyName": "Demo Company",
    "role": "admin",
    "isBanned": true,
    "createdAt": "2026-06-20T12:00:00.000Z",
    "updatedAt": "2026-06-20T13:20:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:** 404/403/500.

---

### 17.6 DELETE `/api/superadmin/users/:userId`

**الوصف:** حذف المستخدم وجميع بياناته نهائياً. يتطلب سبب في body.

**Headers:** `Content-Type: application/json`

**Body:**

```json
{
  "reason": "طلب العميل حذف الحساب"
}
```

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "تم حذف المستخدم وكافة بياناته نهائياً بنجاح"
}
```

**أخطاء محتملة:** 400/403/404/500.

---

### 17.7 PUT `/api/superadmin/users/:userId/subscription`

**الوصف:** تعديل اشتراك مستخدم يدوياً (نوع الخطة/الحالة/تاريخ الانتهاء). يتطلب `reason`.

**Body:**

```json
{
  "planType": "pro",
  "status": "active",
  "endDate": "2026-08-01",
  "reason": "ترقية يدوية"
}
```

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "تم تحديث بيانات الاشتراك بنجاح",
  "data": {
    "_id": "66700000000000000000SUB1",
    "customerId": "CUST-000123",
    "planType": "pro",
    "status": "active",
    "endDate": "2026-08-01T00:00:00.000Z",
    "limits": { "maxItems": 1000, "maxSales": 2000, "maxExpenses": 1000 },
    "createdAt": "2026-06-20T12:00:00.000Z",
    "updatedAt": "2026-06-20T13:30:00.000Z",
    "__v": 0
  }
}
```

**أخطاء محتملة:** 400/404/500.

---

### 17.8 GET `/api/superadmin/plans`

**الوصف:** جلب جميع الخطط.

**استجابة 200:**

```json
{
  "status": true,
  "data": [
    {
      "_id": "66700000000000000000PLN1",
      "id": "free",
      "name": "Free",
      "price": 0,
      "currency": "EGP",
      "durationDays": 30,
      "limits": { "maxItems": 200, "maxSales": 200, "maxExpenses": 200 },
      "features": [],
      "isPublic": true,
      "createdAt": "2026-06-20T10:00:00.000Z",
      "updatedAt": "2026-06-20T10:00:00.000Z",
      "__v": 0
    }
  ]
}
```

---

### 17.9 POST `/api/superadmin/plans`

**الوصف:** إنشاء خطة جديدة.

**Body مثال:**

```json
{
  "id": "pro",
  "name": "Pro",
  "price": 299,
  "currency": "EGP",
  "durationDays": 30,
  "limits": { "maxItems": 1000, "maxSales": 2000, "maxExpenses": 1000 },
  "features": ["Export Excel", "Reports"],
  "isPublic": true
}
```

**استجابة 201:**

```json
{
  "status": true,
  "data": {
    "_id": "66700000000000000000PLN1",
    "id": "pro",
    "name": "Pro",
    "price": 299,
    "currency": "EGP",
    "durationDays": 30,
    "limits": { "maxItems": 1000, "maxSales": 2000, "maxExpenses": 1000 },
    "features": ["Export Excel", "Reports"],
    "isPublic": true,
    "createdAt": "2026-06-20T10:00:00.000Z",
    "updatedAt": "2026-06-20T10:00:00.000Z",
    "__v": 0
  }
}
```

---

### 17.10 PUT `/api/superadmin/plans/:id`

**الوصف:** تحديث خطة موجودة بواسطة Mongo `_id`.

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "data": {
    "_id": "66700000000000000000PLN1",
    "id": "pro",
    "name": "Pro (Updated)",
    "price": 399,
    "limits": { "maxItems": 1500, "maxSales": 2500, "maxExpenses": 1500 },
    "features": ["..."],
    "isPublic": true,
    "createdAt": "2026-06-20T10:00:00.000Z",
    "updatedAt": "2026-06-20T14:00:00.000Z",
    "__v": 0
  },
  "message": "تم تحديث الخطة بنجاح"
}
```

---

### 17.11 DELETE `/api/superadmin/plans/:id`

**الوصف:** حذف خطة بواسطة Mongo `_id`.

**استجابة 200:**

```json
{
  "status": true,
  "message": "تم حذف الخطة بنجاح"
}
```

---

### 17.12 GET `/api/superadmin/transactions`

**الوصف:** جلب جميع معاملات الدفع مع بيانات المستخدم المرتبطة (Lookup).

**استجابة 200:**

```json
{
  "status": true,
  "data": [
    {
      "_id": "66700000000000000000T001",
      "customerId": "CUST-000123",
      "amount": 300,
      "paymentMethod": "vodafone_cash",
      "status": "pending",
      "referenceNumber": "VF-123456",
      "planRequested": "pro",
      "notes": null,
      "processedBy": null,
      "processedAt": null,
      "createdAt": "2026-06-20T13:10:00.000Z",
      "user": {
        "username": "demo_user",
        "email": null,
        "companyName": "Demo Company"
      }
    }
  ]
}
```

---

### 17.13 POST `/api/superadmin/transactions/:transactionId/approve`

**الوصف:** قبول معاملة pending وتفعيل الاشتراك للمستخدم.

**Body (اختياري):**

```json
{
  "notes": "تم القبول من قبل الإدارة"
}
```

**استجابة 200:**

```json
{
  "status": true,
  "message": "تم قبول الدفعة وتفعيل الاشتراك بنجاح"
}
```

---

### 17.14 POST `/api/superadmin/transactions/:transactionId/reject`

**الوصف:** رفض معاملة pending مع سبب.

**Body:**

```json
{
  "reason": "رقم العملية غير صحيح"
}
```

**استجابة 200:**

```json
{
  "status": true,
  "message": "تم رفض الدفعة بنجاح"
}
```

---

### 17.15 GET `/api/superadmin/audit-logs`

**الوصف:** جلب آخر 100 سجل تدقيق.

**استجابة 200:**

```json
{
  "status": true,
  "data": [
    {
      "_id": "66700000000000000000L001",
      "customerId": "CUST-000123",
      "action": "APPROVE_PAYMENT",
      "details": { "transactionId": "66700000000000000000T001", "amount": 300, "plan": "pro" },
      "ipAddress": "::1",
      "at": "2026-06-20T14:10:00.000Z",
      "createdAt": "2026-06-20T14:10:00.000Z",
      "updatedAt": "2026-06-20T14:10:00.000Z",
      "__v": 0
    }
  ]
}
```

---

### 17.16 POST `/api/superadmin/audit-logs/bulk-delete`

**الوصف:** حذف مجموعة سجلات تدقيق.

**Body:**

```json
{
  "logIds": ["66700000000000000000L001", "66700000000000000000L002"]
}
```

**استجابة 200:**

```json
{
  "status": true,
  "message": "تم حذف سجلات التدقيق بنجاح"
}
```

---

## 18) Notifications (التنبيهات)

> محمية وتتطلب JWT (وتستخدم `customerId` كمستلم).

### 18.1 GET `/api/notifications`

**الوصف:** جلب آخر 50 تنبيه + عدد غير المقروء.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "data": {
    "notifications": [
      {
        "_id": "66700000000000000000N001",
        "recipientId": "CUST-000123",
        "senderName": "النظام",
        "message": "تم استلام طلب اشتراكك بنجاح وجاري المراجعة الآن.",
        "type": "subscription_request",
        "data": { "transactionId": "66700000000000000000T001" },
        "isRead": false,
        "createdAt": "2026-06-20T13:10:00.000Z",
        "updatedAt": "2026-06-20T13:10:00.000Z",
        "__v": 0
      }
    ],
    "unreadCount": 1
  }
}
```

---

### 18.2 PUT `/api/notifications/:id/read`

**الوصف:** تعليم تنبيه كمقروء.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**استجابة 200 (نجاح):**

```json
{
  "status": true,
  "message": "تم التحديد كمقروء"
}
```

**أخطاء محتملة:**
- 404: التنبيه غير موجود.
- 401/403/500.

---

### 18.3 PUT `/api/notifications/read-all`

**الوصف:** تعليم جميع التنبيهات كمقروءة.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**استجابة 200:**

```json
{
  "status": true,
  "message": "تم تحديد الكل كمقروء"
}
```

---

### 18.4 DELETE `/api/notifications/:id`

**الوصف:** حذف تنبيه.

**Headers المطلوبة:** `Authorization: Bearer <JWT>`

**استجابة 200:**

```json
{
  "status": true,
  "message": "تم حذف التنبيه"
}
```

**أخطاء محتملة:** 404/401/403/500.

