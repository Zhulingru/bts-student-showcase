/**
 * ================================================================
 * BTS Student Showcase · Apps Script（整合版，與實際部署同步）
 * ================================================================
 *
 * 本檔案整合四段功能：
 *   1. 表單送出後，自動把檔案搬到對應學生的 Drive 資料夾並重新命名
 *   2. 一次性把每個學生資料夾分享給對應 email（編輯權限）+ 寄驗證碼通知
 *   3. 學生身分驗證碼 API；Showcase 個人簡介讀寫（Bios）
 *   4. Student Showcase：反應、留言、（與上述共用 doGet/doPost）
 *
 * 前兩段是 Drive／表單檔案管理；後端 Web App（doGet／doPost）承載身分驗證、個人簡介、反應與留言，互相可分開維護。
 *
 * 部署 Showcase 後端：
 *   1. 「部署」→「新增部署作業」→ 類型「網頁應用程式」
 *   2. 執行身分：「我」　存取權：「任何人」
 *   3. 拿到的網址貼到 config.js 的 appsScriptUrl
 *
 * ⚠️ 學生 email、驗證碼（STUDENTS_PRIVATE）為個資，請勿提交至 GitHub。
 *    本檔案在 repo 中只放假資料示範，真正的 email 維持只在 Apps Script
 *    編輯器內。
 * ================================================================
 */


// ============== 設定區 ==============

// 28 位學生共用的總資料夾 ID（從 Drive 網址 /folders/xxxxx 取出）
const ROOT_FOLDER_ID = "1ifLLbfeurjSeVN6wK5NnJvRtwplbazwE";

// 表單欄位名稱（必須和你表單題目一字不差，若不同請修改）
const FIELD_STUDENT = "學生姓名";
const FIELD_TITLE   = "標題";
const FIELD_FILE    = "檔案上傳";


// ============== 主流程：每次表單送出會自動執行 ==============

function onFormSubmitAutoSort(e) {
  try {
    const nv = e.namedValues || {};
    const studentName = getFirst(nv[FIELD_STUDENT]);
    if (!studentName) { Logger.log("沒有學生姓名，略過"); return; }

    const title    = getFirst(nv[FIELD_TITLE]) || "未命名";
    const fileCell = getFirst(nv[FIELD_FILE])  || "";
    const fileIds  = extractFileIds(fileCell);

    if (fileIds.length === 0) {
      Logger.log(`${studentName}：無檔案（可能只填連結），略過`);
      return;
    }

    const studentFolder = findStudentFolder(normalizeName(studentName));
    if (!studentFolder) {
      Logger.log(`找不到 ${studentName} 的資料夾，檔案留在原處`);
      return;
    }

    const dateStr = formatDateForFile(new Date());
    fileIds.forEach((id, idx) => {
      const file = DriveApp.getFileById(id);
      const ext = getExt(file.getName());
      const suffix = fileIds.length > 1 ? `_${idx + 1}` : "";
      const newName = `${dateStr}_${sanitize(title)}${suffix}${ext}`;
      file.setName(newName);
      file.moveTo(studentFolder);
    });

    Logger.log(`✓ 已把 ${fileIds.length} 個檔案搬到 ${studentName} 資料夾`);
  } catch (err) {
    Logger.log("錯誤：" + err + "\n" + err.stack);
  }
}


// ============== 一次性設定觸發器 ==============

function setupTrigger() {
  const all = ScriptApp.getProjectTriggers();
  for (const t of all) {
    if (t.getHandlerFunction() === "onFormSubmitAutoSort") {
      ScriptApp.deleteTrigger(t);
    }
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger("onFormSubmitAutoSort")
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();
  Logger.log("✓ 觸發器已建立，之後每次表單送出會自動分類");
}


// ============== 補跑：把過去已經送出過的整理一次 ==============

function backfillAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  let moved = 0, skipped = 0, notFound = 0;

  for (const sheet of sheets) {
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) continue;
    const headers = data[0].map(h => String(h).trim());
    const idxStudent = headers.findIndex(h => h.includes(FIELD_STUDENT));
    const idxTitle   = headers.findIndex(h => h.includes(FIELD_TITLE));
    const idxFile    = headers.findIndex(h => h.includes(FIELD_FILE));
    const idxTime    = headers.findIndex(h => h.includes("時間") || h.toLowerCase().includes("timestamp"));
    if (idxStudent < 0 || idxFile < 0) continue;

    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      const studentName = normalizeName(row[idxStudent]);
      if (!studentName) continue;
      const fileIds = extractFileIds(row[idxFile]);
      if (fileIds.length === 0) continue;

      const studentFolder = findStudentFolder(studentName);
      if (!studentFolder) { notFound++; continue; }

      const ts = row[idxTime] instanceof Date ? row[idxTime] : new Date();
      const dateStr = formatDateForFile(ts);
      const title = normalizeName(row[idxTitle]) || "未命名";

      fileIds.forEach((id, idx) => {
        try {
          const file = DriveApp.getFileById(id);
          const parents = file.getParents();
          let alreadyIn = false;
          while (parents.hasNext()) {
            if (parents.next().getId() === studentFolder.getId()) { alreadyIn = true; break; }
          }
          if (alreadyIn) { skipped++; return; }
          const ext = getExt(file.getName());
          const suffix = fileIds.length > 1 ? `_${idx + 1}` : "";
          file.setName(`${dateStr}_${sanitize(title)}${suffix}${ext}`);
          file.moveTo(studentFolder);
          moved++;
        } catch (err) {
          Logger.log(`檔案 ${id} 搬移失敗：${err}`);
        }
      });
    }
  }
  Logger.log(`✓ 完成：搬移 ${moved}，已在正確位置 ${skipped}，找不到資料夾 ${notFound}`);
}


// ============== 工具函式（不用改） ==============

function getFirst(arr) {
  if (!arr) return "";
  if (Array.isArray(arr)) return String(arr[0] || "").trim();
  return String(arr).trim();
}

function normalizeName(s) {
  return String(s || "").trim().replace(/\s+/g, " ");
}

function extractFileIds(text) {
  if (!text) return [];
  const parts = String(text).split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  const ids = [];
  for (const p of parts) {
    const m = p.match(/[-\w]{25,}/);
    if (m) ids.push(m[0]);
  }
  return ids;
}

function findStudentFolder(name) {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  return searchFolder(root, name);
}

function searchFolder(parent, targetName) {
  const direct = parent.getFolders();
  while (direct.hasNext()) {
    const f = direct.next();
    if (normalizeName(f.getName()) === targetName) return f;
  }
  const recurse = parent.getFolders();
  while (recurse.hasNext()) {
    const found = searchFolder(recurse.next(), targetName);
    if (found) return found;
  }
  return null;
}

function formatDateForFile(d) {
  if (!(d instanceof Date) || isNaN(d)) d = new Date();
  const z = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`;
}

function getExt(filename) {
  const m = String(filename).match(/(\.[^.]+)$/);
  return m ? m[1] : "";
}

function sanitize(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}


// ============== 學生私密資料（email + 驗證碼，僅存於 Apps Script，不進 GitHub）==============
// ⚠️ 這張表是個資，請勿把真實 email 或驗證碼提交到 GitHub。
//    本檔案在 repo 中只放假資料示範格式，真正的資料維持只在 Apps Script 編輯器內。
//
// 每一筆欄位：
//   name  ：和網站 config.js 裡的 students[].name 必須完全一致
//   email ：學生的 Google 帳號 email，用來分享資料夾與寄驗證碼通知
//   code  ：該學生的驗證碼；學生在網站「選擇身分」時要輸入這串才會認證成功
//           預設 4 碼數字，可用 generateMissingCodes() 自動產一組貼回來
//           比對時不分大小寫、前後空白自動去掉
//
const STUDENTS_PRIVATE = [
  // 範例格式（實際資料放在 Apps Script 編輯器內）：
  // { name: "王小明", email: "s000000_example@school.edu.tw", code: "3714" },
];

// 寄給學生的信件主旨與內容模板
// {{name}} {{code}} {{folderUrl}} {{folderName}} 會在寄信時被替換
const SHARE_EMAIL_SUBJECT = "【專題歷程牆】你的個人資料夾與驗證碼";
const SHARE_EMAIL_BODY = `嗨 {{name}}：

老師把你在《專題製作》這學期的個人雲端資料夾分享給你了，以後你的產出檔案都會被自動分類到這裡：

📁 {{folderName}}
{{folderUrl}}

另外，我們也架了一個班級學習歷程牆，你可以在上面幫同學按 emoji 和留言。第一次進網站時請點右上角「選擇身分」挑你自己的名字，然後輸入下面這組**只屬於你**的驗證碼：

🔑 你的驗證碼：{{code}}

（這組碼請不要公開；其他人拿不到就沒辦法冒你的名字留言。）

如有問題歡迎私訊老師。祝創作順利！
`;


// ============== 分享資料夾腳本（含寄驗證碼通知）==============
// 權限：編輯者（可看、可改、可刪）
// 通知：
//   - Google Drive 預設會寄一封「某某分享了資料夾給你」通知信
//   - 本腳本會「另外」寄一封自己寫的信，裡面有資料夾連結 + 驗證碼
//   → 學生會收到兩封信，或把第二封當作主要的使用指南

// 模擬執行：只會在 Log 印出「會做什麼」，不真的動作、不寄信
function dryRunShareStudentFolders() {
  _shareStudentFolders({ dryRun: true });
}

// 正式執行：真的分享資料夾 + 寄驗證碼通知信
function actuallyShareStudentFolders() {
  _shareStudentFolders({ dryRun: false });
}

function _shareStudentFolders(opts) {
  const dryRun = !!opts.dryRun;
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  let ok = 0, skipped = 0, notFound = 0, failed = 0, noCode = 0;

  Logger.log(dryRun ? "=== DRY RUN（只模擬，不分享、不寄信）===" : "=== 正式執行分享 + 寄驗證碼通知 ===");

  for (const s of STUDENTS_PRIVATE) {
    if (!s.code) {
      Logger.log(`! ${s.name} 沒有驗證碼（code 空白），請先在 STUDENTS_PRIVATE 填上或跑 generateMissingCodes()`);
      noCode++;
      continue;
    }

    const folder = searchFolder(root, normalizeName(s.name));
    if (!folder) {
      Logger.log(`✗ 找不到 ${s.name} 的資料夾`);
      notFound++;
      continue;
    }

    const email = s.email.toLowerCase();
    const editors = folder.getEditors().map(u => String(u.getEmail()).toLowerCase());
    const alreadyEditor = editors.includes(email);

    const folderUrl = folder.getUrl();
    const folderName = folder.getName();
    const subject = SHARE_EMAIL_SUBJECT;
    const body = SHARE_EMAIL_BODY
      .replace(/{{name}}/g, s.name)
      .replace(/{{code}}/g, s.code)
      .replace(/{{folderUrl}}/g, folderUrl)
      .replace(/{{folderName}}/g, folderName);

    if (dryRun) {
      Logger.log(
        `[DRY RUN] ${s.name} <${s.email}>\n` +
        `  - ${alreadyEditor ? "（已是編輯者，不會重加）" : "將加入編輯者"}\n` +
        `  - 將寄信（主旨：「${subject}」，含驗證碼 ${s.code}）`
      );
      ok++;
      continue;
    }

    try {
      if (!alreadyEditor) {
        folder.addEditor(s.email);
      } else {
        Logger.log(`- ${s.name} 已有編輯權限，不重複加`);
        skipped++;
      }
      MailApp.sendEmail({
        to: s.email,
        subject: subject,
        body: body,
      });
      Logger.log(`✓ ${s.name} 完成（分享 + 寄驗證碼信）`);
      ok++;
      Utilities.sleep(300);  // 避免觸發 API 節流
    } catch (err) {
      Logger.log(`✗ ${s.name} 失敗：${err.message}`);
      failed++;
    }
  }

  Logger.log(`\n====================`);
  Logger.log(
    `${dryRun ? "[模擬]" : "[實際]"} 完成：處理 ${ok}，跳過 ${skipped}，找不到資料夾 ${notFound}，沒有驗證碼 ${noCode}，失敗 ${failed}`
  );
}


// ============== 驗證碼工具 ==============

// 一次性產驗證碼：跑這個會幫 STUDENTS_PRIVATE 裡所有 code 為空的同學產一組新的 4 碼數字，
// 然後把整個陣列印在 Log 裡，你複製貼回上面覆蓋 STUDENTS_PRIVATE 即可。
// 不會自動寫回程式碼（Apps Script 不允許腳本改自己），所以請記得貼回去再存檔。
function generateMissingCodes() {
  const used = new Set(
    STUDENTS_PRIVATE.filter(s => s.code).map(s => String(s.code))
  );
  const out = STUDENTS_PRIVATE.map(s => {
    if (s.code) return { name: s.name, email: s.email, code: String(s.code) };
    let c;
    do { c = randomCode(4); } while (used.has(c));
    used.add(c);
    return { name: s.name, email: s.email, code: c };
  });
  const lines = out.map(s =>
    `  { name: "${s.name}", email: "${s.email}", code: "${s.code}" },`
  );
  Logger.log("=== 複製以下整塊，貼回覆蓋 STUDENTS_PRIVATE ===\n" +
    "const STUDENTS_PRIVATE = [\n" + lines.join("\n") + "\n];");
}

function randomCode(len) {
  // 4 位數字（0000–9999）；允許前導 0，學生輸入時也不會自動消失
  let s = "";
  for (let i = 0; i < len; i++) {
    s += String(Math.floor(Math.random() * 10));
  }
  return s;
}

// 驗證碼比對：不分大小寫，前後空白自動去掉
function normalizeCode(s) {
  return String(s == null ? "" : s).trim().toLowerCase();
}

function findStudentPrivate(name) {
  const target = normalizeName(name);
  for (const s of STUDENTS_PRIVATE) {
    if (normalizeName(s.name) === target) return s;
  }
  return null;
}

function handleVerifyCode(body) {
  const name = String(body.name || "").slice(0, 64);
  const code = String(body.code || "").slice(0, 64);

  if (!name) return jsonOut({ ok: false, error: "missing name" });

  const record = findStudentPrivate(name);
  if (!record) {
    // 名單上沒這個人 → 回報不存在（不要洩漏有沒有 code，一律 valid:false）
    return jsonOut({ ok: true, valid: false, reason: "unknown" });
  }
  if (!record.code) {
    // 老師還沒設 code → 放行（相容性：此時相當於沒啟用驗證）
    return jsonOut({ ok: true, valid: true, reason: "no-code-set" });
  }
  if (normalizeCode(code) === normalizeCode(record.code)) {
    return jsonOut({ ok: true, valid: true });
  }
  // 錯了：停一下，稍微拖慢暴力破解
  Utilities.sleep(800);
  return jsonOut({ ok: true, valid: false, reason: "mismatch" });
}


// ================================================================
// 以下為 Student Showcase 反應與留言後端（BTS Showcase · Reactions & Comments）
// 不影響上方的自動分檔、資料夾分享功能
// 部署方式：右上「部署」→「新增部署作業」→ 類型「網頁應用程式」
//          執行身分選「我」、存取權選「任何人」
// ================================================================

const REACTIONS_SHEET = "Reactions";
const COMMENTS_SHEET = "Comments";
const BIOS_SHEET = "Bios";

const REACTIONS_HEADERS = ["timestamp", "entryId", "emoji", "userId", "userName"];
// 留言表新增 role 欄位以支援訪客模式（student/guest/teacher/parent）
// 舊有試算表若沒有 role 欄，程式會在首次 doPost / doGet 時自動補上表頭
const COMMENTS_HEADERS = ["timestamp", "entryId", "userId", "userName", "text", "role"];
const BIOS_HEADERS = ["timestamp", "studentName", "userId", "text"];

const MAX_COMMENT_LENGTH = 200;
// 個人簡介字數上限（與前端 config.studentBioMaxLength 建議保持一致）
const MAX_BIO_LENGTH = 280;
const ALLOWED_ROLES = ["student", "guest", "teacher", "parent"];

function normalizeRole(r) {
  const s = String(r || "student");
  return ALLOWED_ROLES.indexOf(s) >= 0 ? s : "student";
}

function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // 讀取前先補齊 Comments 的 role 表頭（舊試算表升級用）
    const cSheet = ss.getSheetByName(COMMENTS_SHEET);
    if (cSheet) ensureCommentsRoleHeader(cSheet);
    const reactions = readShowcaseSheet(ss, REACTIONS_SHEET, REACTIONS_HEADERS);
    const comments = readShowcaseSheet(ss, COMMENTS_SHEET, COMMENTS_HEADERS);
    const bios = readLatestBios(ss);
    // codesEnabled：若 STUDENTS_PRIVATE 裡至少有一位設了 code，就回 true。
    // 前端會用這個旗標決定要不要跳出驗證碼輸入畫面。
    const codesEnabled = STUDENTS_PRIVATE.some(s => s && s.code);
    return jsonOut({
      ok: true,
      reactions: reactions,
      comments: comments,
      bios: bios,
      codesEnabled: codesEnabled,
    });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    const action = body.action;

    if (!action) return jsonOut({ ok: false, error: "missing action" });

    if (action === "toggleReaction") return handleToggleReaction(body);
    if (action === "addComment") return handleAddComment(body);
    if (action === "verifyCode") return handleVerifyCode(body);
    if (action === "setBio") return handleSetBio(body);

    return jsonOut({ ok: false, error: "unknown action" });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

function handleToggleReaction(body) {
  const entryId = String(body.entryId || "").slice(0, 256);
  const emoji = String(body.emoji || "").slice(0, 16);
  const userId = String(body.userId || "").slice(0, 64);
  const userName = String(body.userName || "").slice(0, 64);

  if (!entryId || !emoji || !userId) {
    return jsonOut({ ok: false, error: "missing fields" });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateShowcaseSheet(ss, REACTIONS_SHEET, REACTIONS_HEADERS);

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const data = sheet.getDataRange().getValues();
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

function handleAddComment(body) {
  const entryId = String(body.entryId || "").slice(0, 256);
  const userId = String(body.userId || "").slice(0, 64);
  const userName = String(body.userName || "").slice(0, 64);
  const role = normalizeRole(body.role);
  let text = String(body.text || "").trim();

  if (!entryId || !userId || !text) {
    return jsonOut({ ok: false, error: "missing fields" });
  }

  if (text.length > MAX_COMMENT_LENGTH) {
    text = text.slice(0, MAX_COMMENT_LENGTH);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateShowcaseSheet(ss, COMMENTS_SHEET, COMMENTS_HEADERS);
  ensureCommentsRoleHeader(sheet);

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    sheet.appendRow([new Date(), entryId, userId, userName, text, role]);
    return jsonOut({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// 每位學生「個人簡介」會 append 成一列；公開讀取時取該姓名的最新時間那一列。
// STUDENTS_PRIVATE 若已填資料，則只接受名單內姓名（防空刷）；若陣列為空則不檢查（範例專案用）。
function handleSetBio(body) {
  const rawName = String(body.studentName || "").trim();
  const userId = String(body.userId || "").slice(0, 64);
  let text = String(body.text ?? "").trim();

  if (!rawName || !userId) {
    return jsonOut({ ok: false, error: "missing fields" });
  }

  const studentName = normalizeName(rawName);
  if (!studentName) {
    return jsonOut({ ok: false, error: "missing fields" });
  }

  if (STUDENTS_PRIVATE.length > 0 && !findStudentPrivate(studentName)) {
    return jsonOut({ ok: false, error: "unknown student" });
  }

  if (text.length > MAX_BIO_LENGTH) {
    text = text.slice(0, MAX_BIO_LENGTH);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateShowcaseSheet(ss, BIOS_SHEET, BIOS_HEADERS);

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    sheet.appendRow([new Date(), studentName, userId, text]);
    return jsonOut({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function readLatestBios(ss) {
  const sheet = ss.getSheetByName(BIOS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getDataRange().getValues();
  const idxTs = BIOS_HEADERS.indexOf("timestamp");
  const idxName = BIOS_HEADERS.indexOf("studentName");
  const idxText = BIOS_HEADERS.indexOf("text");
  return _buildLatestBiosList(data, idxTs, idxName, idxText);
}

function _buildLatestBiosList(data, idxTs, idxName, idxText) {
  const best = {}; // normalized name -> { ts, text, displayName }
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    let ts = row[idxTs];
    if (!(ts instanceof Date)) ts = new Date(ts);
    if (isNaN(ts.getTime())) continue;
    const rawName = row[idxName];
    const nm = normalizeName(rawName);
    if (!nm) continue;
    const txt = String(row[idxText] != null ? row[idxText] : "").trim();
    const display = rawName != null && String(rawName).trim() ? String(rawName).trim() : nm;
    // 同一時間戳多列時，後面那列（較新 append）勝出
    if (!best[nm] || ts >= best[nm].ts) {
      best[nm] = { ts: ts, text: txt, displayName: display };
    }
  }
  const out = [];
  for (const k in best) {
    const b = best[k];
    out.push({
      studentName: b.displayName,
      text: b.text,
      timestamp: b.ts.toISOString(),
    });
  }
  return out;
}

// 若 Comments 舊表頭只有 5 欄（沒有 role），幫它補一欄
function ensureCommentsRoleHeader(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;
  const row = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (row.indexOf("role") === -1) {
    sheet.getRange(1, lastCol + 1).setValue("role");
  }
}

function getOrCreateShowcaseSheet(ss, name, headers) {
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

function readShowcaseSheet(ss, name, headers) {
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
