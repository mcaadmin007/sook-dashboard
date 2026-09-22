/* =========================================================================
   SOOK DASHBOARD — Google Ads → Firestore Actual Sync
   =========================================================================
   วางไฟล์นี้ทั้งดุ้นเป็น "Google Ads Script" ในบัญชี Google Ads ที่ต้องการดึงข้อมูล
   (Tools & Settings → Bulk Actions → Scripts → + New script)

   ทำหน้าที่: ดึงยอด Spend + Clicks ของบัญชี Google Ads รายเดือน แล้วเขียนเข้า
   Firestore ที่ boards/sook/actuals/{YYYY-MM|Google Ads|Maximize Clicks}
   ซึ่งเป็น path เดียวกับที่ index.html ของ Dashboard อ่านแบบ real-time อยู่แล้ว
   (ดู sub('actuals', ...) ใน fbWatch() ของ index.html)

   ทำไมไม่ต่อแบบเดียวกับปุ่ม "Connect Meta" ในหน้าเว็บ:
   Google Ads API เรียกตรงจากเบราว์เซอร์ไม่ได้ (ต้องมี Developer Token +
   OAuth ฝั่งเซิร์ฟเวอร์) ต่างจาก Facebook Graph API ที่เรียกจาก client ได้เลย
   วิธีนี้เลี่ยงปัญหานั้นโดยให้ Google Ads เขียนข้อมูลเข้า Firestore เอง
   ผ่าน Service Account แทน — ไม่ต้องมี backend/Cloud Function เพิ่ม

   ------------------------------------------------------------------------
   SETUP (ทำครั้งเดียว)
   ------------------------------------------------------------------------
   1) ไปที่ Firebase Console → โปรเจค sook-lead-generation
      → ⚙ Project settings → Service accounts → "Generate new private key"
      จะได้ไฟล์ .json ดาวน์โหลดมา (เก็บให้ดี ห้ามแชร์ต่อ)

   2) เปิดไฟล์ .json นั้น คัดลอก 2 ค่านี้มาแปะแทนที่ด้านล่าง:
        client_email   → SA_EMAIL
        private_key    → SA_PRIVATE_KEY   (คัดลอกทั้งค่า รวม \n ทุกตัว)

   3) เข้าบัญชี Google Ads ที่ต้องการดึงข้อมูล → Tools & Settings (รูปประแจ)
      → Bulk Actions → Scripts → กด "+" สร้างสคริปต์ใหม่
      → ลบโค้ดตัวอย่างทิ้ง แล้ววางไฟล์นี้ทั้งไฟล์แทน

   4) แก้ค่าตั้งค่าด้านล่าง (SA_EMAIL, SA_PRIVATE_KEY, START_DATE) ให้ครบ
      แล้วกด "Preview" หรือ "Run" ครั้งแรกเพื่อทดสอบ + ให้สคริปต์ขอสิทธิ์
      (Authorize) — อนุญาตให้เข้าถึง External requests ตอนที่มันถาม

   5) เช็คผลลัพธ์ที่แท็บ Logs ว่าขึ้น "Synced X months to Firestore" โดยไม่มี error
      แล้วเปิด Dashboard ดูว่าช่อง Actual ของแถว Google Ads / Maximize Clicks
      ในเดือนนั้นๆ ขึ้นตัวเลขแล้ว

   6) ตั้งเวลารันอัตโนมัติ: ปุ่ม "Frequency" ในหน้า Scripts → เลือกรันทุกวัน
      (แนะนำ "Daily") ระบบจะดึงข้อมูลอัปเดตให้เองโดยไม่ต้องกดอะไรอีก

   หมายเหตุ: ค่า Channel/Objective ต้องสะกดตรงกับใน index.html เป๊ะๆ
   ('Google Ads' และ 'Maximize Clicks') ไม่งั้น Dashboard จะไม่รู้จักแถวนั้น
   ========================================================================= */

/* ---------------- ตั้งค่า ---------------- */
const PROJECT_ID     = 'sook-lead-generation';
const SA_EMAIL        = 'PASTE_client_email_FROM_JSON_HERE';
const SA_PRIVATE_KEY  = `-----BEGIN PRIVATE KEY-----\nPASTE_private_key_FROM_JSON_HERE\n-----END PRIVATE KEY-----\n`;

const START_DATE      = '2026-01-01';      // เริ่มดึงย้อนหลังจากวันนี้ตั้งแต่วันที่นี้
const CHANNEL         = 'Google Ads';       // ต้องตรงกับชื่อ Channel ใน index.html
const OBJECTIVE       = 'Maximize Clicks';  // ต้องตรงกับชื่อแถวใน index.html

/* ใส่คำที่อยู่ในชื่อแคมเปญ ถ้าอยากนับเฉพาะบางแคมเปญ (เว้นว่าง = นับทั้งบัญชี) */
const CAMPAIGN_NAME_CONTAINS = '';

/* ---------------- main ---------------- */
function main(){
  const token = getAccessToken();
  const rows  = pullMonthlyStats();
  rows.forEach(r => pushToFirestore(token, r));
  Logger.log('Synced ' + rows.length + ' months to Firestore');
}

/* ดึงยอด Spend + Clicks รายเดือนจากบัญชี Google Ads */
function pullMonthlyStats(){
  const tz    = AdsApp.currentAccount().getTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  const nameFilter = CAMPAIGN_NAME_CONTAINS
    ? ` AND campaign.name LIKE '%${CAMPAIGN_NAME_CONTAINS}%'`
    : '';

  const query = `
    SELECT segments.month, metrics.cost_micros, metrics.clicks
    FROM campaign
    WHERE segments.date BETWEEN '${START_DATE}' AND '${today}'${nameFilter}
  `;

  const report = AdsApp.report(query);
  const rows   = report.rows();
  const byMonth = {};

  while(rows.hasNext()){
    const row   = rows.next();
    const month = String(row['segments.month']).slice(0, 7); // 'YYYY-MM-DD' -> 'YYYY-MM'
    if(!byMonth[month]) byMonth[month] = { spend: 0, clicks: 0 };
    byMonth[month].spend  += Number(row['metrics.cost_micros']) / 1e6;
    byMonth[month].clicks += Number(row['metrics.clicks']);
  }

  return Object.keys(byMonth).map(m => ({
    month:  m,
    spend:  Math.round(byMonth[m].spend),
    clicks: Math.round(byMonth[m].clicks),
  }));
}

/* เขียนผลลัพธ์ 1 เดือนเข้า Firestore boards/sook/actuals/{docId} */
function pushToFirestore(token, r){
  const docId = `${r.month}|${CHANNEL}|${OBJECTIVE}`;
  const url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
    '/databases/(default)/documents/boards/sook/actuals/' + encodeURIComponent(docId) +
    '?updateMask.fieldPaths=spend&updateMask.fieldPaths=result';

  const body = {
    fields: {
      spend:  { integerValue: String(r.spend) },
      result: { integerValue: String(r.clicks) },
    },
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });

  if(res.getResponseCode() >= 300){
    Logger.log('Firestore error ' + r.month + ': ' + res.getContentText());
  }
}

/* ขอ OAuth access token จาก Service Account (JWT Bearer flow) เพื่อเรียก Firestore REST API */
function getAccessToken(){
  const header = { alg: 'RS256', typ: 'JWT' };
  const now    = Math.floor(Date.now() / 1000);
  const claim  = {
    iss:   SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  };

  const b64 = o => Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/, '');
  const toSign  = b64(header) + '.' + b64(claim);
  const sigByte = Utilities.computeRsaSha256Signature(toSign, SA_PRIVATE_KEY);
  const sig     = Utilities.base64EncodeWebSafe(sigByte).replace(/=+$/, '');
  const jwt     = toSign + '.' + sig;

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    },
    muteHttpExceptions: true,
  });

  const data = JSON.parse(res.getContentText());
  if(!data.access_token) throw new Error('ขอ token ไม่สำเร็จ: ' + res.getContentText());
  return data.access_token;
}
