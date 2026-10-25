/**
 * CzechMate 同步腳本（requirements spec 6.6 and 6.7）
 *
 * 貼到你的 Google 試算表：「擴充功能 › Apps Script」，取代原本的內容後儲存。
 * 部署：「部署 › 新增部署作業 › 網頁應用程式」，執行身分「我」，存取權「任何人」。
 * 「任何人」只代表誰能呼叫這個網址；沒有下面這組金鑰的請求一律拒絕，試算表本身仍只有你看得到。
 */
const SECRET = '__CZECHMATE_SECRET__';
const PROTOCOL = 1;
const LEDGER_SHEETS = ['支出總表', '換匯紀錄', '月份×類別', '旅程彙總', '付款方式彙總'];
const RESOURCE_SHEET = '資源';
const RESOURCE_HEADERS = ['ID', '標題', '類型', '階段', '網址', '內容', '標籤', '圖片檔名', '釘選', '常用連結名稱'];
// Folder for images, from "My Drive"; set in the app (設定 › Google 試算表) and filled in when copying the script.
const IMAGE_FOLDER_PATH = '__CZECHMATE_IMAGE_FOLDER__';
const FORMATS = { date: 'yyyy/mm/dd', datetime: 'yyyy/mm/dd hh:mm', twd: '#,##0', amount: '#,##0.00', rate: '0.000000', int: '0' };
const MAX_PAYLOAD_CHARS = 10 * 1024 * 1024;
const MAX_IMAGE_BASE64 = 7 * 1024 * 1024;
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FAILS = 10;

function doGet() {
  return json_({ ok: true, app: 'CzechMate', message: 'CzechMate 同步端點已啟用。請在 App 的設定貼上這個網址。' });
}

function doPost(e) {
  var raw = e && e.postData && e.postData.contents;
  if (typeof raw !== 'string' || raw.length > MAX_PAYLOAD_CHARS) {
    return json_({ ok: false, error: 'protocol', message: '請求內容過大或無效。' });
  }
  var req;
  try {
    req = JSON.parse(raw);
  } catch (err) {
    return json_({ ok: false, error: 'protocol', message: '無法讀取請求內容。' });
  }
  // iOS Shortcuts may send the protocol as text, so compare as numbers.
  if (!req || req.app !== 'CzechMate' || Number(req.protocol) !== PROTOCOL) {
    return json_({ ok: false, error: 'protocol', message: 'App 與腳本版本不符，請在 App 重新複製腳本並部署新版本。' });
  }
  // The right secret always gets through, so strangers guessing cannot lock the phone out.
  if (!safeEqual_(String(req.secret || ''), SECRET)) {
    if (isRateLimited_()) return json_({ ok: false, error: 'secret', message: '金鑰錯誤次數過多，請稍後再試。' });
    recordFailedSecret_();
    return json_({ ok: false, error: 'secret', message: '同步金鑰不正確。' });
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json_({ ok: false, error: 'busy', message: '另一個同步正在進行，請稍後再試。' });
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    switch (req.action) {
      case 'ping':
        return json_({ ok: true, spreadsheetUrl: ss.getUrl(), name: ss.getName(), resourcesGid: resourceSheet_(ss).getSheetId(), imageFolder: IMAGE_FOLDER_PATH, features: ['quickAdd', 'quickAddType'] });
      case 'sync':
        return json_(syncLedger_(ss, req.sheets || []));
      case 'getResources':
        return json_(getResources_(ss));
      case 'appendResource':
        return json_(appendResource_(ss, req.resource || {}));
      case 'quickAdd':
        return json_(quickAdd_(ss, req));
      case 'uploadImage':
        return json_(uploadImage_(String(req.name || ''), String(req.mime || 'image/jpeg'), String(req.base64 || '')));
      case 'getImages':
        return json_(getImages_(req.names || [], req.known || {}));
      default:
        return json_({ ok: false, error: 'protocol', message: '不認得的動作：' + req.action });
    }
  } catch (err) {
    return json_({ ok: false, error: 'exception', message: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isRateLimited_() {
  if (typeof CacheService === 'undefined') return false;
  var cache = CacheService.getScriptCache();
  return cache ? Number(cache.get('cm_fail_count') || '0') >= MAX_FAILS : false;
}

function recordFailedSecret_() {
  if (typeof CacheService !== 'undefined') {
    var cache = CacheService.getScriptCache();
    if (cache) {
      var n = Number(cache.get('cm_fail_count') || '0') + 1;
      cache.put('cm_fail_count', String(n), 600);
    }
  }
  if (typeof PropertiesService !== 'undefined') {
    var props = PropertiesService.getScriptProperties();
    if (props) props.setProperty('lastFailedSecretAt', new Date().toISOString());
  }
}

/** Prevents spreadsheet formula injection when a text field begins with =, +, -, or @. */
function safeText_(s) {
  var str = String(s);
  return /^[=+\-@\t\r]/.test(str) ? "'" + str : str;
}

/* ---------- 記帳：整張覆寫五個工作表，不碰其他工作表 ---------- */

function toCell_(v, type) {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'date' && typeof v === 'string') {
    var p = v.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  if (type === 'datetime' && typeof v === 'string') return new Date(v);
  if (typeof v === 'string') return safeText_(v);
  return v;
}

function syncLedger_(ss, sheets) {
  var count = 0;
  sheets.forEach(function (s) {
    if (LEDGER_SHEETS.indexOf(s.name) < 0) return;
    var sh = ss.getSheetByName(s.name) || ss.insertSheet(s.name);
    if (sh.getFilter()) sh.getFilter().remove();
    sh.clear();
    var headers = s.columns.map(function (c) { return c.header; });
    var values = [headers].concat(
      s.rows.map(function (r) {
        return r.map(function (v, i) { return toCell_(v, s.columns[i].type); });
      })
    );
    var range = sh.getRange(1, 1, values.length, headers.length);
    range.setValues(values);
    if (values.length > 1) {
      s.columns.forEach(function (c, i) {
        if (FORMATS[c.type]) sh.getRange(2, i + 1, values.length - 1, 1).setNumberFormat(FORMATS[c.type]);
      });
    }
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#E3E8D9');
    sh.setFrozenRows(1);
    range.createFilter();
    count++;
  });
  return { ok: true, syncedAt: new Date().toISOString(), sheets: count };
}

/* ---------- 資源 ---------- */

function resourceSheet_(ss) {
  var sh = ss.getSheetByName(RESOURCE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(RESOURCE_SHEET, 0);
    sh.getRange(1, 1, 1, RESOURCE_HEADERS.length).setValues([RESOURCE_HEADERS]).setFontWeight('bold').setBackground('#E3E8D9');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Header name → column index (0-based); adds missing columns, including ID as the first column. */
function resourceColumns_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  if (headers.indexOf('ID') < 0) {
    sh.insertColumnBefore(1);
    sh.getRange(1, 1).setValue('ID').setFontWeight('bold');
    headers.unshift('ID');
  }
  RESOURCE_HEADERS.forEach(function (h) {
    if (headers.indexOf(h) < 0) {
      headers.push(h);
      sh.getRange(1, headers.length).setValue(h).setFontWeight('bold');
    }
  });
  var map = {};
  headers.forEach(function (h, i) { if (h) map[h] = i; });
  return map;
}

function cellText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v);
}

function getResources_(ss) {
  var sh = resourceSheet_(ss);
  var cols = resourceColumns_(sh);
  var lastRow = sh.getLastRow();
  var width = sh.getLastColumn();
  var rows = [];
  if (lastRow >= 2) {
    var data = sh.getRange(2, 1, lastRow - 1, width).getValues();
    data.forEach(function (r, i) {
      var empty = r.every(function (v) { return v === '' || v === null; });
      if (empty) return;
      var id = cellText_(r[cols.ID]).trim();
      if (!id) {
        id = Utilities.getUuid();
        sh.getRange(i + 2, cols.ID + 1).setValue(id);
      }
      var values = {};
      Object.keys(cols).forEach(function (h) { values[h] = cellText_(r[cols[h]]); });
      values.ID = id;
      rows.push({ row: i + 2, values: values });
    });
  }
  return { ok: true, rows: rows, spreadsheetUrl: ss.getUrl(), resourcesGid: sh.getSheetId() };
}

function appendResource_(ss, res) {
  var sh = resourceSheet_(ss);
  var cols = resourceColumns_(sh);
  var id = String(res.ID || Utilities.getUuid());
  // Idempotent: a retried request must not add the row twice.
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    var ids = sh.getRange(2, cols.ID + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === id) return { ok: true, id: id, row: i + 2, existed: true };
    }
  }
  var width = sh.getLastColumn();
  var row = [];
  for (var c = 0; c < width; c++) row.push('');
  Object.keys(cols).forEach(function (h) {
    if (h === 'ID') row[cols[h]] = id;
    else if (res[h] !== undefined) row[cols[h]] = safeText_(res[h]);
  });
  sh.appendRow(row);
  return { ok: true, id: id, row: sh.getLastRow() };
}

/* ---------- iOS 分享捷徑：從分享選單快速新增 ---------- */

var STAGE_LABELS = ['出發前', '抵達後', '旅遊', '不分'];
var TYPE_LABELS = ['筆記', 'Dcard', '網站', '截圖', '文件'];

/** Finds the first http(s) URL in shared text. */
function firstUrl_(text) {
  var m = String(text || '').match(/https?:\/\/[^\s<>"'）)]+/i);
  return m ? m[0].replace(/[.,;:!?。，、！？]+$/, '') : '';
}

/** Drops tracking parameters; Dcard links keep only the post path. */
function cleanUrl_(url) {
  if (!url) return '';
  if (/^https?:\/\/(www\.)?dcard\.tw\//i.test(url)) return url.split(/[?#]/)[0];
  var parts = url.split('#')[0].split('?');
  if (parts.length < 2) return parts[0];
  var kept = parts[1].split('&').filter(function (kv) { return kv && !/^(utm_[a-z]+|fbclid|gclid|igshid|ref|ref_src|si)=/i.test(kv); });
  return kept.length ? parts[0] + '?' + kept.join('&') : parts[0];
}

/** Same rule as the app: lowercase, no trailing slash. */
function urlKey_(url) {
  return String(url || '').trim().toLowerCase().replace(/\/+$/, '');
}

function typeForUrl_(url) {
  if (!url) return '筆記';
  if (/^https?:\/\/(www\.)?dcard\.tw\//i.test(url)) return 'Dcard';
  return '網站';
}

/** The page <title>, or '' when it cannot be fetched. */
function fetchTitle_(url) {
  if (typeof UrlFetchApp === 'undefined') return '';
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() >= 400) return '';
    var m = String(res.getContentText()).slice(0, 200000).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? decodeEntities_(m[1]).replace(/\s+/g, ' ').trim() : '';
  } catch (err) {
    return '';
  }
}

function decodeEntities_(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); });
}

/** Removes site names such as " - Dcard" or " | Medium" from a page title. */
function trimTitle_(title) {
  var t = String(title || '')
    .replace(/\s*[|｜]\s*by\s+[^|｜]+[|｜]\s*Medium\s*$/i, '')
    .replace(/\s*[-|｜–]\s*(Dcard|Medium|HackMD|YouTube|Facebook|Instagram|Threads)\s*$/i, '')
    .trim();
  return t.length > 80 ? t.slice(0, 80) + '…' : t;
}

/** A title written into the link itself, e.g. Medium's /@user/文章標題-9b630fc0c3ab; '' when there is none. */
function titleFromSlug_(url) {
  var path = String(url || '').replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0].replace(/\/+$/, '');
  var last = path.split('/').pop() || '';
  try {
    last = decodeURIComponent(last);
  } catch (err) {
    return '';
  }
  last = last.replace(/-[0-9a-f]{8,16}$/i, '').replace(/\.(html?|php)$/i, '');
  // Only worth it when the slug reads like words: CJK text, or several words joined by dashes.
  if (!/[^\x00-\x7f]/.test(last) && last.split(/[-_]/).length < 3) return '';
  return last.replace(/[-_]+/g, ' ').trim();
}

/** Shortcuts may pass the link itself as the page name; that is not a title. */
function usableTitle_(t) {
  t = String(t || '').trim();
  return /^https?:\/\//i.test(t) ? '' : t;
}

/**
 * Adds one row from the iOS share sheet. `input` is whatever was shared (a URL, or text with a URL);
 * `title`, `type`, `stage`, `tags` and `note` are optional. A URL already in the sheet is not added twice.
 * Every answer carries `message`, which the shortcut shows as a notification.
 */
function quickAdd_(ss, req) {
  var input = String(req.input || '').trim();
  var url = cleanUrl_(String(req.url || '').trim() || firstUrl_(input));
  if (!url && !input) return { ok: false, error: 'exception', message: '沒有收到網址或文字。' };

  var sh = resourceSheet_(ss);
  var cols = resourceColumns_(sh);
  var lastRow = sh.getLastRow();
  if (url && lastRow >= 2) {
    var key = urlKey_(url);
    var data = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
    for (var i = 0; i < data.length; i++) {
      if (urlKey_(cellText_(data[i][cols['網址']])) === key) {
        var existing = cellText_(data[i][cols['標題']]);
        return { ok: true, duplicate: true, row: i + 2, title: existing, message: '已經存過了：' + existing };
      }
    }
  }

  // Title: given (Safari's page name) > shared text without the URL > the page's <title>
  // > words in the link > the site's address. Some sites (Medium) refuse Google's servers.
  // Remove the link as shared (with its tracking parameters) before the cleaned one.
  var shared = firstUrl_(input);
  var rest = (shared ? input.replace(shared, '') : input).replace(url, '').trim();
  var title = trimTitle_(usableTitle_(req.title) || rest.split(/\n/)[0] || (url ? fetchTitle_(url) || titleFromSlug_(url) : ''));
  if (!title) title = url ? url.replace(/^https?:\/\/(www\.)?/i, '').split(/[/?#]/)[0] : rest.slice(0, 30);

  var type = TYPE_LABELS.indexOf(String(req.type || '')) >= 0 ? String(req.type) : typeForUrl_(url);
  var stage = STAGE_LABELS.indexOf(String(req.stage || '')) >= 0 ? String(req.stage) : '不分';
  var tags = ['待整理'].concat(String(req.tags || '').split(/[;；,，]/).map(function (t) { return t.trim(); }).filter(String));
  var note = String(req.note || '').trim();
  var extra = rest.indexOf('\n') >= 0 ? rest.slice(rest.indexOf('\n') + 1).trim() : '';
  var content = [note, extra].filter(String).join('\n') || '（從分享捷徑新增，待補重點）';

  var out = appendResource_(ss, {
    '標題': title, '類型': type, '階段': stage, '網址': url, '內容': content,
    '標籤': tags.filter(function (t, i) { return tags.indexOf(t) === i; }).join(';')
  });
  return { ok: true, id: out.id, row: out.row, title: title, message: '已存入資源庫：' + title };
}

/* ---------- 雲端硬碟圖片 ---------- */

/** Walks IMAGE_FOLDER_PATH (e.g. "計畫/CzechMate/CzechMate 圖片") from My Drive, creating missing folders. */
function imageFolder_() {
  var folder = DriveApp.getRootFolder();
  IMAGE_FOLDER_PATH.split('/').map(function (p) { return p.trim(); }).filter(String).forEach(function (part) {
    var it = folder.getFoldersByName(part);
    folder = it.hasNext() ? it.next() : folder.createFolder(part);
  });
  return folder;
}

function fileByName_(folder, name) {
  var it = folder.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}

function uploadImage_(name, mime, base64) {
  var cleanName = String(name || '').replace(/[\\/]/g, '_').trim();
  if (!cleanName || !base64) return { ok: false, error: 'exception', message: '缺少圖片內容。' };
  if (base64.length > MAX_IMAGE_BASE64) return { ok: false, error: 'exception', message: '圖片檔案過大。' };
  if (ALLOWED_MIMES.indexOf(mime) < 0) return { ok: false, error: 'exception', message: '不支援的圖片格式。' };
  var folder = imageFolder_();
  var file = fileByName_(folder, cleanName);
  if (!file) file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(base64), mime, cleanName));
  return { ok: true, name: cleanName, id: file.getId(), modified: file.getLastUpdated().toISOString() };
}

function getImages_(names, known) {
  var folder = imageFolder_();
  var images = names.slice(0, 5).map(function (name) {
    var file = fileByName_(folder, name);
    if (!file) {
      // Names in the sheet are matched case-insensitively, like CSV imports.
      var all = folder.getFiles();
      while (all.hasNext()) {
        var f = all.next();
        if (f.getName().toLowerCase() === String(name).toLowerCase()) { file = f; break; }
      }
    }
    if (!file) return { name: name, missing: true };
    var id = file.getId();
    var modified = file.getLastUpdated().toISOString();
    var k = known[name];
    if (k && k.id === id && k.modified === modified) return { name: name, id: id, modified: modified, unchanged: true };
    var blob = file.getBlob();
    return { name: name, id: id, modified: modified, mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
  });
  return { ok: true, images: images };
}
