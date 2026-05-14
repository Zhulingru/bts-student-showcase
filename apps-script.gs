/**
 * ================================================================
 * BTS Student Showcase · Apps Script（整合版，與實際部署同步）
 * ================================================================
 *
 * 本檔案整合四段功能：
 *   1. 表單送出後，可選檢核「填表者 email ╳ STUDENTS_PRIVATE」再把檔案搬到對應學生資料夾
 *   2. 一次性把每個學生資料夾分享給對應 email（編輯權限）+ 寄驗證碼通知
 *   3. 學生身分驗證碼 API；Showcase 個人簡介讀寫(Bios)
 *   4. Student Showcase：反應、留言、（與上述共用 doGet/doPost）
 *
 * 前兩段是 Drive／表單檔案管理；後端 Web App（doGet／doPost）承載身分驗證、個人簡介、反應與留言，互相可分開維護。
 *
 * 部署 Showcase 後端：
 *   1. 「部署」→「新增部署作業」→ 類型「網頁應用程式」
 *   2. 執行身分：「我」　存取權：「任何人」
 *   3. 拿到的網址貼到 config.js 的 appsScriptUrl
 *
 * ⚠️ 學生 email、驗證碼（STUDENTS_PRIVATE）為個資。本 repo 可依班級決定是否填入真實名單以方便複製進 Apps Script；若對外公開，請評估是否要改為僅編輯器內維護或另用私有備份。
 * ================================================================
 */


// ============== 設定區 ==============

// 28 位學生共用的總資料夾 ID（從 Drive 網址 /folders/xxxxx 取出）
const ROOT_FOLDER_ID = "1ifLLbfeurjSeVN6wK5NnJvRtwplbazwE";

// 表單欄位名稱（必須和你表單題目一字不差，若不同請修改）
const FIELD_STUDENT = "學生姓名";
const FIELD_TITLE   = "標題";
const FIELD_FILE    = "檔案上傳";

// 表單若已設定「必須登入／蒐集電子郵件（已驗證）」，可開啟此選項：
// 只有「填表者的 Google 帳號 email」與 STUDENTS_PRIVATE 裡該位學生的 email 相同時，才會搬檔到個人資料夾。
// 不符時檔案留在表單預設上傳位置，並寫入執行記錄。
//
// 目前設定：false（不檢查 email，「學生姓名」選誰就搬到誰的資料夾）。
// 想恢復防冒名比對請改回 true，並確認 STUDENTS_PRIVATE 內每位學生的 email 都正確。
const FORM_EMAIL_MATCH_ENABLED = false;

// 表單送出後，若試算表已有「同學生 + 同標題」的舊列，自動刪除舊列、保留剛送出的新列。
//   - 用途：學生重新上傳相同主題的最新版本時，歷程牆只會顯示最新一筆，不會重複
//   - 不會動 Drive 上的檔案（保留所有版本，需要時可手動清）
//   - 比對規則：學生姓名（前後空白忽略）+ 標題（前後空白忽略）完全相同
//   - 想關閉自動覆蓋改回 false 即可，事後仍可用 removeDuplicateRows() 手動清理
const AUTO_OVERWRITE_ON_RESUBMIT = true;


// ============== 主流程：每次表單送出會自動執行 ==============

function onFormSubmitAutoSort(e) {
  let studentName = "";
  let title = "";
  try {
    const nv = e.namedValues || {};
    studentName = getFirst(nv[FIELD_STUDENT]);
    if (!studentName) { Logger.log("沒有學生姓名，略過"); return; }

    title = getFirst(nv[FIELD_TITLE]) || "未命名";
    const fileCell = getFirst(nv[FIELD_FILE])  || "";
    const fileIds  = extractFileIds(fileCell);

    if (fileIds.length === 0) {
      Logger.log(`${studentName}：無檔案（可能只填連結），略過搬檔（仍會檢查同主題覆蓋）`);
      return;
    }

    const respondentEmail = getRespondentEmailFromNamedValues(nv);
    const emailCheck = checkFormSubmitEmailPolicy(studentName, respondentEmail);
    if (!emailCheck.ok) {
      Logger.log(formEmailRejectLog(studentName, respondentEmail, emailCheck.reason));
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
  } finally {
    // 不論上面搬檔結果如何，只要學生姓名 + 標題有效，就嘗試清掉同學生＋同主題的舊列。
    // 這樣學生重新上傳相同主題的最新版本時，歷程牆只會顯示最新一筆。
    if (AUTO_OVERWRITE_ON_RESUBMIT && studentName && title) {
      try {
        _overwriteOlderRowsOnResubmit(e, studentName, title);
      } catch (err) {
        Logger.log("自動覆蓋舊紀錄失敗：" + err);
      }
    }
  }
}

/**
 * 找出「同學生 + 同標題」的舊列，刪除舊列，保留剛剛送出的新列。
 * 由 onFormSubmit 觸發；e.range 指向剛 append 的新列。
 * Drive 上的檔案不會被動到。
 */
function _overwriteOlderRowsOnResubmit(e, studentName, title) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const newRowNum = e.range.getRow();
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const idxStudent = headers.findIndex(h => h.includes(FIELD_STUDENT));
  const idxTitle   = headers.findIndex(h => h.includes(FIELD_TITLE));
  if (idxStudent < 0 || idxTitle < 0) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const targetStudent = normalizeName(studentName);
  const targetTitle = normalizeName(title);

  const toDelete = [];
  for (let i = 0; i < data.length; i++) {
    const rowNum = i + 2;       // 試算表實際列號（+1 表頭 +1 才是 1-indexed）
    if (rowNum === newRowNum) continue;  // 跳過剛新增的這一列
    const rs = normalizeName(data[i][idxStudent]);
    const rt = normalizeName(data[i][idxTitle]);
    if (rs === targetStudent && rt === targetTitle) {
      toDelete.push(rowNum);
    }
  }

  if (toDelete.length === 0) return;

  // 由底往上刪，避免位移影響後續 row index
  toDelete.sort((a, b) => b - a);
  toDelete.forEach(r => sheet.deleteRow(r));
  Logger.log(
    `↻ 自動覆蓋：${studentName} · 「${title}」` +
    `刪除 ${toDelete.length} 列舊紀錄（保留新列 #${newRowNum}），Drive 檔案不動`
  );
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
    const idxEmail   = findRespondentEmailColumnIndex(headers);
    const idxTime    = headers.findIndex(h => h.includes("時間") || h.toLowerCase().includes("timestamp"));
    if (idxStudent < 0 || idxFile < 0) continue;

    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      const studentName = normalizeName(row[idxStudent]);
      if (!studentName) continue;
      const fileIds = extractFileIds(row[idxFile]);
      if (fileIds.length === 0) continue;

      const rowEmail = idxEmail >= 0 ? String(row[idxEmail] || "").trim() : "";
      const emailCheck = checkFormSubmitEmailPolicy(studentName, rowEmail);
      if (!emailCheck.ok) {
        Logger.log(`[補跑略過 第 ${r + 1} 列] ${formEmailRejectLog(studentName, rowEmail, emailCheck.reason)}`);
        continue;
      }

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


// ============== 工具函式（表單 email 規則、檔案搬移等） ==============

function getFirst(arr) {
  if (!arr) return "";
  if (Array.isArray(arr)) return String(arr[0] || "").trim();
  return String(arr).trim();
}

function normalizeName(s) {
  return String(s || "").trim().replace(/\s+/g, " ");
}

/** 與驗證碼比對相同：email 不分大小寫、去空白 */
function normalizeEmail(s) {
  return String(s == null ? "" : s).trim().toLowerCase();
}

/**
 * 從試算表「表單回應」的欄位標題找出「填表者 email」欄。
 * Google 表單中文版常見：電子郵件地址／英文：Email address。
 */
function findRespondentEmailColumnIndex(headers) {
  const hints = [
    "電子郵件地址",
    "電子郵件",
    "Email address",
    "Email Address",
    "Respondent Email",
    "Your email address",
  ];
  for (const hint of hints) {
    const i = headers.findIndex(h => String(h).trim() === hint);
    if (i >= 0) return i;
  }
  return headers.findIndex(h => {
    const t = String(h);
    return (/email/i.test(t) || /電子|郵件|信箱/.test(t)) && !/學校|備註|說明/.test(t);
  });
}

/**
 * Spreadsheet onFormSubmit 的 namedValues：鍵為欄名，與試算表第一列相同。
 */
function getRespondentEmailFromNamedValues(nv) {
  if (!nv) return "";
  const preferredKeys = [
    "電子郵件地址",
    "電子郵件",
    "Email address",
    "Email Address",
    "Respondent Email",
    "Your email address",
  ];
  for (const k of preferredKeys) {
    const v = getFirst(nv[k]);
    if (v) return v;
  }
  for (const k of Object.keys(nv)) {
    if (/學校|備註|說明|標題/.test(k)) continue;
    if (!/email|電子|郵件|信箱/i.test(k)) continue;
    const v = getFirst(nv[k]);
    if (v && /@/.test(v)) return v;
  }
  return "";
}

/**
 * @returns {{ ok: boolean, reason: string }}
 *   reason: match | disabled | no-private-list | no-respondent-email | unknown-student | no-email-on-file | email-mismatch
 */
function checkFormSubmitEmailPolicy(studentName, respondentEmail) {
  if (!FORM_EMAIL_MATCH_ENABLED) {
    return { ok: true, reason: "disabled" };
  }
  // 範本／尚未貼上名單時不擋搬檔；一旦有名單即強制比對 email。
  if (!STUDENTS_PRIVATE || STUDENTS_PRIVATE.length === 0) {
    return { ok: true, reason: "no-private-list" };
  }
  const email = normalizeEmail(respondentEmail);
  if (!email) {
    return { ok: false, reason: "no-respondent-email" };
  }
  const record = findStudentPrivate(studentName);
  if (!record) {
    return { ok: false, reason: "unknown-student" };
  }
  const expected = normalizeEmail(record.email);
  if (!expected) {
    return { ok: false, reason: "no-email-on-file" };
  }
  if (email === expected) {
    return { ok: true, reason: "match" };
  }
  return { ok: false, reason: "email-mismatch" };
}

function formEmailRejectLog(studentName, respondentEmail, reason) {
  const em = respondentEmail ? maskEmail(normalizeEmail(respondentEmail)) : "（無）";
  const name = normalizeName(studentName) || "?";
  const lines = {
    "no-respondent-email":
      `未取得填表者電子郵件（請確認表單已設為「蒐集電子郵件」）。學生姓名：${name}`,
    "unknown-student":
      `學生「${name}」不在 STUDENTS_PRIVATE 名單，為安全起見不搬檔。填表帳號：${em}`,
    "no-email-on-file":
      `名單中「${name}」未填 email，無法比對 Google 帳號，不搬檔。填表帳號：${em}`,
    "email-mismatch":
      `填表帳號（${em}）與所選學生「${name}」在 STUDENTS_PRIVATE 的 email 不符，不搬檔（可能誤選他人姓名）`,
  };
  return lines[reason] || `email 檢查未通過（${reason}）。學生：${name}，填表：${em}`;
}

/** 執行記錄用：只顯示信箱前後段，減少完整個資進 log */
function maskEmail(e) {
  const s = String(e || "");
  const at = s.indexOf("@");
  if (at <= 1) return s ? s[0] + "***" : "";
  if (at < 0) return s.slice(0, 2) + "***";
  return s.slice(0, 2) + "***" + s.slice(at);
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


// ============== 學生資料（email + 驗證碼；本機／repo 可與 Apps Script 同步）==============
// ⚠️ 若 repo 為公開，此區塊內容等同對外可看，請視校內規範自行決定是否保留／改打碼／改私有備份。
//
// 每一筆欄位：
//   name  ：和網站 config.js 裡的 students[].name 必須完全一致
//   email ：學生的 Google 帳號 email，用來分享資料夾與寄驗證碼通知；
//           若 FORM_EMAIL_MATCH_ENABLED 為 true 且本名單非空，須以此 email 登入表單且「學生姓名」
//           選該員，自動搬檔才會進行（見 onFormSubmitAutoSort）。
//   code  ：該學生的驗證碼；學生在網站「選擇身分」時要輸入這串才會認證成功
//           預設 4 碼數字，可用 generateMissingCodes() 自動產一組貼回來
//           比對時不分大小寫、前後空白自動去掉
//
const STUDENTS_PRIVATE = [
  // ⚠️ 真實名單（姓名 / 學校 email / 驗證碼）為個資，請只在 Apps Script 編輯器
  //    或你的私有備份維護，不要提交到公開 repo。
  //
  // 本 repo 內這個陣列**故意保持空白**，讓 GitHub 上只看得到結構、看不到真實資料；
  // 你部署時把實際名單貼進 Apps Script 編輯器即可。
  //
  // 範例格式：
  // { name: "王小明", email: "xiaoming@school.edu.tw", code: "1234" },
  // { name: "陳美麗", email: "meili@school.edu.tw",    code: "5678" },
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
    const emailTrim = String(s.email == null ? "" : s.email).trim();
    if (!emailTrim) {
      Logger.log(`! ${s.name} 未填 email，略過分享／寄信（示範帳號可加老師信箱或手動分享）`);
      skipped++;
      continue;
    }

    const folder = searchFolder(root, normalizeName(s.name));
    if (!folder) {
      Logger.log(`✗ 找不到 ${s.name} 的資料夾`);
      notFound++;
      continue;
    }

    const email = emailTrim.toLowerCase();
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
        `[DRY RUN] ${s.name} <${emailTrim}>\n` +
        `  - ${alreadyEditor ? "（已是編輯者，不會重加）" : "將加入編輯者"}\n` +
        `  - 將寄信（主旨：「${subject}」，含驗證碼 ${s.code}）`
      );
      ok++;
      continue;
    }

    try {
      if (!alreadyEditor) {
        folder.addEditor(emailTrim);
      } else {
        Logger.log(`- ${s.name} 已有編輯權限，不重複加`);
        skipped++;
      }
      MailApp.sendEmail({
        to: emailTrim,
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


// ================================================================
// 維運工具：診斷未分類檔案與重複上傳（事後修補用）
// ================================================================
//
// 適用情境（兩個典型問題）：
//   (1) 學生有送出表單、檔案傳到 Drive，但沒被搬到該學生的個人資料夾
//   (2) 學生不小心送兩次（或同一份檔案上傳兩次），歷程牆上同一筆出現重複
//       （現在 AUTO_OVERWRITE_ON_RESUBMIT=true 後新送的會自動覆蓋舊的，
//        本工具僅用於處理舊資料）
//
// 標準流程：
//   step 1. 跑 `diagnoseShowcaseSheet()`：只看不動，把兩類問題列出來
//   step 2. 跑 `resortMisplacedFiles()`：把未分類的檔案搬到該學生資料夾
//                                      （就是 backfillAll() 的別名）
//   step 3. 跑 `removeDuplicateRows(true)`：模擬刪除重複列，看會刪到哪些
//   step 4. 確認 OK 再跑 `removeDuplicateRows(false)`：真的刪掉舊的那列
//          → 保留最新一列（時間最近的那筆），舊的列被刪除
//          → Drive 上的檔案保持不動（依老師指示）
//
// 後端 sheet（Reactions / Comments / Bios）會自動跳過，不會被誤掃。
// ================================================================

function diagnoseShowcaseSheet() {
  const report = _scanShowcaseSheet();

  Logger.log("=== 1. 檔案沒進該學生資料夾 ===");
  if (report.misplaced.length === 0) {
    Logger.log("（沒有發現未分類的檔案）");
  } else {
    report.misplaced.forEach(m => {
      Logger.log(
        `[分頁「${m.sheetName}」第 ${m.row} 列] ${m.studentName} · 「${m.title}」` +
        `\n    檔案 ${m.fileId} ── ${m.reason}`
      );
    });
    Logger.log(`\n→ 修復方式：執行 resortMisplacedFiles()，會嘗試搬到正確位置。`);
  }

  Logger.log("");
  Logger.log("=== 2. 疑似重複上傳（同一位學生 + 完全相同的標題） ===");
  if (report.duplicateGroups.length === 0) {
    Logger.log("（沒有發現重複紀錄）");
  } else {
    report.duplicateGroups.forEach(g => {
      const rowsDesc = g.rows
        .slice()
        .sort((a, b) => a.timestamp - b.timestamp)
        .map(r => `    - 第 ${r.row} 列 · ${_fmtTs(r.timestamp)}`)
        .join("\n");
      Logger.log(
        `${g.studentName} · 「${g.title}」（分頁「${g.sheetName}」共 ${g.rows.length} 列）：\n${rowsDesc}`
      );
    });
    Logger.log(
      `\n→ 修復方式：先跑 removeDuplicateRows(true) 看會刪哪些（模擬）；` +
      `\n  確認 OK 再跑 removeDuplicateRows(false) 實際刪除（保留最新一列、刪除舊列；檔案不動）。`
    );
  }
}

/** resortMisplacedFiles() 是 backfillAll() 的別名，命名更貼近本情境，方便老師找到。 */
function resortMisplacedFiles() {
  backfillAll();
}

function removeDuplicateRows(dryRun) {
  // 安全預設：除非明確傳 false，否則一律 dry run
  if (dryRun !== false) dryRun = true;

  const report = _scanShowcaseSheet();
  if (report.duplicateGroups.length === 0) {
    Logger.log("沒有找到重複紀錄，無事可做。");
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bySheet = {}; // sheetName -> [rowNumber, ...]
  let totalToDelete = 0;

  Logger.log(dryRun ? "=== DRY RUN：只模擬，不真的刪 ===" : "=== 正式執行刪除 ===");
  for (const g of report.duplicateGroups) {
    // 由新到舊排；第一個保留，其餘刪除
    const sorted = g.rows.slice().sort((a, b) => b.timestamp - a.timestamp);
    const keep = sorted[0];
    const toRemove = sorted.slice(1);
    if (toRemove.length === 0) continue;

    Logger.log(
      `${g.studentName} · 「${g.title}」：保留第 ${keep.row} 列（${_fmtTs(keep.timestamp)}），` +
      `${dryRun ? "將刪" : "已刪"} ${toRemove.map(r => `第 ${r.row} 列(${_fmtTs(r.timestamp)})`).join("、")}`
    );

    if (!bySheet[g.sheetName]) bySheet[g.sheetName] = [];
    toRemove.forEach(r => {
      bySheet[g.sheetName].push(r.row);
      totalToDelete++;
    });
  }

  if (dryRun) {
    Logger.log(`\n[DRY RUN] 共會刪 ${totalToDelete} 列。確認後請執行 removeDuplicateRows(false)。`);
    return;
  }

  // 同分頁內由底往上刪，避免 row index 位移
  Object.keys(bySheet).forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(`! 找不到分頁「${sheetName}」，跳過`);
      return;
    }
    const rows = bySheet[sheetName].slice().sort((a, b) => b - a);
    rows.forEach(r => sheet.deleteRow(r));
    Logger.log(`✓ 分頁「${sheetName}」刪除 ${rows.length} 列完成`);
  });
  Logger.log(`\n完成：共刪 ${totalToDelete} 列。Drive 上的檔案保持不動，需要時請手動清理。`);
}

function _fmtTs(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return "（無時間）";
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
}

/**
 * 統一掃描：回傳 { misplaced, duplicateGroups }
 *  - misplaced：檔案沒在該學生資料夾內的紀錄
 *  - duplicateGroups：同一學生 + 完全相同標題 ≥2 列
 *
 * 只掃「表單回應」類分頁；自動跳過 Reactions / Comments / Bios。
 */
function _scanShowcaseSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const backendSheets = new Set([REACTIONS_SHEET, COMMENTS_SHEET, BIOS_SHEET]);
  const misplaced = [];
  const duplicateGroups = [];

  // 快取「學生資料夾」與「檔案的父資料夾集合」減少 Drive 呼叫
  const folderCache = {};   // studentName -> Folder | null
  function getStudentFolder(name) {
    if (folderCache.hasOwnProperty(name)) return folderCache[name];
    const f = findStudentFolder(name);
    folderCache[name] = f;
    return f;
  }

  for (const sheet of ss.getSheets()) {
    const sheetName = sheet.getName();
    if (backendSheets.has(sheetName)) continue;

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) continue;
    const headers = data[0].map(h => String(h).trim());
    const idxStudent = headers.findIndex(h => h.includes(FIELD_STUDENT));
    const idxTitle   = headers.findIndex(h => h.includes(FIELD_TITLE));
    const idxFile    = headers.findIndex(h => h.includes(FIELD_FILE));
    const idxTime    = headers.findIndex(h => h.includes("時間") || h.toLowerCase().includes("timestamp"));
    if (idxStudent < 0) continue;

    const byKey = {}; // "name||title" -> [{row, timestamp}, ...]

    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      const studentName = normalizeName(row[idxStudent]);
      if (!studentName) continue;
      const title = (idxTitle >= 0 ? normalizeName(row[idxTitle]) : "") || "（未命名）";
      const ts = (idxTime >= 0 && row[idxTime] instanceof Date)
        ? row[idxTime]
        : new Date(0);

      const key = `${studentName}||${title}`;
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push({ row: r + 1, timestamp: ts });

      if (idxFile >= 0) {
        const fileIds = extractFileIds(row[idxFile]);
        if (fileIds.length === 0) continue;

        const studentFolder = getStudentFolder(studentName);
        if (!studentFolder) {
          fileIds.forEach(fid => misplaced.push({
            sheetName, row: r + 1, studentName, title, fileId: fid,
            reason: `找不到該學生的資料夾（請確認 config.js / 試算表姓名拼寫一致，並執行 setupTrigger() 後資料夾的存在）`,
          }));
          continue;
        }

        const targetId = studentFolder.getId();
        for (const fid of fileIds) {
          try {
            const file = DriveApp.getFileById(fid);
            const parents = file.getParents();
            let inFolder = false;
            while (parents.hasNext()) {
              if (parents.next().getId() === targetId) { inFolder = true; break; }
            }
            if (!inFolder) {
              misplaced.push({
                sheetName, row: r + 1, studentName, title, fileId: fid,
                reason: `檔案目前不在「${studentFolder.getName()}」資料夾`,
              });
            }
          } catch (err) {
            misplaced.push({
              sheetName, row: r + 1, studentName, title, fileId: fid,
              reason: `無法存取檔案（可能已被刪除或權限變更）：${err.message || err}`,
            });
          }
        }
      }
    }

    Object.keys(byKey).forEach(k => {
      if (byKey[k].length < 2) return;
      const [name, title] = k.split("||");
      duplicateGroups.push({
        sheetName, studentName: name, title,
        rows: byKey[k],
      });
    });
  }

  return { misplaced, duplicateGroups };
}
