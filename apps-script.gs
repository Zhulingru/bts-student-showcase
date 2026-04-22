/**
 * ================================================================
 * BTS Student Showcase · Reactions & Comments Backend
 * ================================================================
 *
 * 把整個檔案的內容，複製到你「綁定同一份試算表」的 Apps Script 編輯器裡，
 * 然後：
 *   1. 點上方的「部署」→「新增部署作業」
 *   2. 類型選「網頁應用程式」
 *   3. 執行身分：「我」（老師自己）
 *   4. 存取權：「任何人」
 *   5. 部署完會拿到一個 https://script.google.com/macros/s/.../exec 的網址
 *   6. 把這個網址貼到 config.js 的 appsScriptUrl
 *
 * 第一次會問你是否授權存取試算表，按同意即可。
 *
 * 這個後端會自動在你的試算表裡建立兩個新分頁：
 *   - Reactions   （emoji 反應，每列一個反應事件）
 *   - Comments    （留言）
 *
 * ================================================================
 */

const REACTIONS_SHEET = "Reactions";
const COMMENTS_SHEET = "Comments";

const REACTIONS_HEADERS = ["timestamp", "entryId", "emoji", "userId", "userName"];
const COMMENTS_HEADERS = ["timestamp", "entryId", "userId", "userName", "text"];

const MAX_COMMENT_LENGTH = 200;
const MIN_POST_INTERVAL_MS = 800; // 同一 userId 兩次寫入之間的最小間隔
const lastPostByUser = {}; // 記憶體中的簡易節流（每次冷啟會清空，可接受）

// ---------- GET：供前端讀取反應與留言清單 ----------
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const reactions = readSheet(ss, REACTIONS_SHEET, REACTIONS_HEADERS);
    const comments = readSheet(ss, COMMENTS_SHEET, COMMENTS_HEADERS);
    return jsonOut({ ok: true, reactions: reactions, comments: comments });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------- POST：toggleReaction / addComment ----------
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    const action = body.action;

    if (!action) return jsonOut({ ok: false, error: "missing action" });

    // 簡易節流
    const uid = String(body.userId || "").slice(0, 64);
    if (uid) {
      const now = Date.now();
      if (lastPostByUser[uid] && now - lastPostByUser[uid] < MIN_POST_INTERVAL_MS) {
        return jsonOut({ ok: false, error: "too fast" });
      }
      lastPostByUser[uid] = now;
    }

    if (action === "toggleReaction") return handleToggleReaction(body);
    if (action === "addComment") return handleAddComment(body);

    return jsonOut({ ok: false, error: "unknown action" });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------- toggleReaction ----------
function handleToggleReaction(body) {
  const entryId = String(body.entryId || "").slice(0, 256);
  const emoji = String(body.emoji || "").slice(0, 16);
  const userId = String(body.userId || "").slice(0, 64);
  const userName = String(body.userName || "").slice(0, 64);

  if (!entryId || !emoji || !userId) {
    return jsonOut({ ok: false, error: "missing fields" });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, REACTIONS_SHEET, REACTIONS_HEADERS);

  // 加鎖避免併發
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const data = sheet.getDataRange().getValues();
    // 第 0 列是表頭
    const idxEntry = REACTIONS_HEADERS.indexOf("entryId");
    const idxEmoji = REACTIONS_HEADERS.indexOf("emoji");
    const idxUser = REACTIONS_HEADERS.indexOf("userId");

    for (let i = data.length - 1; i >= 1; i--) {
      if (
        String(data[i][idxEntry]) === entryId &&
        String(data[i][idxEmoji]) === emoji &&
        String(data[i][idxUser]) === userId
      ) {
        sheet.deleteRow(i + 1);
        return jsonOut({ ok: true, active: false });
      }
    }

    sheet.appendRow([new Date(), entryId, emoji, userId, userName]);
    return jsonOut({ ok: true, active: true });
  } finally {
    lock.releaseLock();
  }
}

// ---------- addComment ----------
function handleAddComment(body) {
  const entryId = String(body.entryId || "").slice(0, 256);
  const userId = String(body.userId || "").slice(0, 64);
  const userName = String(body.userName || "").slice(0, 64);
  let text = String(body.text || "").trim();

  if (!entryId || !userId || !text) {
    return jsonOut({ ok: false, error: "missing fields" });
  }

  if (text.length > MAX_COMMENT_LENGTH) {
    text = text.slice(0, MAX_COMMENT_LENGTH);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, COMMENTS_SHEET, COMMENTS_HEADERS);

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    sheet.appendRow([new Date(), entryId, userId, userName, text]);
    return jsonOut({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// ---------- 公用工具 ----------
function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readSheet(ss, name, headers) {
  const sheet = ss.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length);
  const values = range.getValues();
  return values.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      const v = row[i];
      if (v instanceof Date) {
        obj[h] = v.toISOString();
      } else {
        obj[h] = v;
      }
    });
    return obj;
  });
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
