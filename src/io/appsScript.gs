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
const IMAGE_FOLDER = 'CzechMate 圖片';
const FORMATS = { date: 'yyyy/mm/dd', datetime: 'yyyy/mm/dd hh:mm', twd: '#,##0', amount: '#,##0.00', rate: '0.000000', int: '0' };

function doGet() {
  return json_({ ok: true, app: 'CzechMate', message: 'CzechMate 同步端點已啟用。請在 App 的設定貼上這個網址。' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'protocol', message: '無法讀取請求內容。' });
  }
  if (!req || req.app !== 'CzechMate' || req.protocol !== PROTOCOL) {
    return json_({ ok: false, error: 'protocol', message: 'App 與腳本版本不符，請在 App 重新複製腳本並部署新版本。' });
  }
  if (!safeEqual_(String(req.secret || ''), SECRET)) {
    return json_({ ok: false, error: 'secret', message: '同步金鑰不正確。' });
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json_({ ok: false, error: 'busy', message: '另一個同步正在進行，請稍後再試。' });
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    switch (req.action) {
      case 'ping':
        return json_({ ok: true, spreadsheetUrl: ss.getUrl(), name: ss.getName(), resourcesGid: resourceSheet_(ss).getSheetId() });
      case 'sync':
        return json_(syncLedger_(ss, req.sheets || []));
      case 'getResources':
        return json_(getResources_(ss));
      case 'appendResource':
        return json_(appendResource_(ss, req.resource || {}));
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

/* ---------- 記帳：整張覆寫五個工作表，不碰其他工作表 ---------- */

function toCell_(v, type) {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'date' && typeof v === 'string') {
    var p = v.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  if (type === 'datetime' && typeof v === 'string') return new Date(v);
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
    else if (res[h] !== undefined) row[cols[h]] = String(res[h]);
  });
  sh.appendRow(row);
  return { ok: true, id: id, row: sh.getLastRow() };
}

/* ---------- 雲端硬碟圖片 ---------- */

function imageFolder_() {
  var it = DriveApp.getFoldersByName(IMAGE_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(IMAGE_FOLDER);
}

function fileByName_(folder, name) {
  var it = folder.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}

function uploadImage_(name, mime, base64) {
  if (!name || !base64) return { ok: false, error: 'exception', message: '缺少圖片內容。' };
  var folder = imageFolder_();
  var file = fileByName_(folder, name);
  if (!file) file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(base64), mime, name));
  return { ok: true, name: name, id: file.getId(), modified: file.getLastUpdated().toISOString() };
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
