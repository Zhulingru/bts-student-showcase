// ================================================================
// app.js：所有網頁邏輯都在這裡，你不需要修改這個檔案
// 若有問題，回頭檢查 config.js 裡的設定是否正確
// ================================================================

(function () {
  "use strict";

  // ---------- 常數與工具：班級 ----------
  const CLASSES = Array.isArray(CONFIG.classes) && CONFIG.classes.length
    ? CONFIG.classes
    : [];
  const CLASS_BY_ID = new Map(CLASSES.map(c => [c.id, c]));

  // 姓名正規化：去除前後空白、把連續空白壓成單一空白
  // 避免 config 和表單選項之間多一個空格就比不到
  function normalizeName(s) {
    if (s == null) return "";
    return String(s).trim().replace(/\s+/g, " ");
  }

  const STUDENT_TO_CLASS = new Map(
    (CONFIG.students || []).map(s => [normalizeName(s.name), s.class])
  );
  const STUDENT_NAME_SET = new Set((CONFIG.students || []).map(s => normalizeName(s.name)));

  // 學生 → 專題主題（來自 config.students[].topic）
  const STUDENT_TOPICS = new Map(
    (CONFIG.students || []).map(s => [normalizeName(s.name), (s.topic || "").trim()])
  );
  function topicFor(studentName) {
    return STUDENT_TOPICS.get(normalizeName(studentName)) || "";
  }

  function getClassInfo(classId) {
    return CLASS_BY_ID.get(classId) || { id: classId, label: classId || "未分班", color: "#8a93a6" };
  }

  // ---------- 身分管理（localStorage，弱實名）----------
  const IDENTITY_STORAGE_KEY = "bts-showcase-identity-v1";
  const TEACHER_STORAGE_KEY = "bts-showcase-teacher-v1";
  const GUEST_MODE_ENABLED = Boolean(CONFIG.guestModeEnabled);
  const GUEST_ROLES = Array.isArray(CONFIG.guestRoles) ? CONFIG.guestRoles : [];
  const GUEST_ROLE_BY_ID = new Map(GUEST_ROLES.map(r => [r.id, r]));
  const CONFIG_TEACHERS = Array.isArray(CONFIG.teachers) ? CONFIG.teachers : [];
  let identity = loadIdentity();
  let teacherSession = loadTeacherSession();

  function loadIdentity() {
    try {
      const raw = localStorage.getItem(IDENTITY_STORAGE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.userId || !obj.userName) return null;
      if (!obj.role) obj.role = "student";
      // 舊版 localStorage 沒有 explicit：已選學生或自填暱稱視為已登入，僅自動「訪客」不算
      if (obj.explicit === undefined) {
        if (obj.role === "student" && STUDENT_NAME_SET.has(normalizeName(obj.userName))) {
          obj.explicit = true;
        } else if (obj.role !== "student" && normalizeName(obj.userName) !== normalizeName("訪客")) {
          obj.explicit = true;
        } else {
          obj.explicit = false;
        }
      }
      return obj;
    } catch (_) {
      return null;
    }
  }

  function saveIdentity(name, role, options) {
    const opts = options || {};
    const existing = loadIdentity();
    const next = {
      userId: (existing && existing.userId) || generateUuid(),
      userName: name,
      role: role || "student",
      explicit: Object.prototype.hasOwnProperty.call(opts, "explicit") ? !!opts.explicit : true,
    };
    localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(next));
    identity = next;
    return next;
  }

  function hasExplicitIdentity() {
    return Boolean(identity && identity.explicit === true);
  }

  const SOCIAL_HINT_MESSAGE = "從網站右上角登入後可以按讚留言";
  let socialHintTimer = null;

  function showSocialHintToast() {
    let el = document.getElementById("social-hint-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "social-hint-toast";
      el.className = "social-hint-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.textContent = SOCIAL_HINT_MESSAGE;
    el.classList.add("is-visible");
    clearTimeout(socialHintTimer);
    socialHintTimer = setTimeout(() => el.classList.remove("is-visible"), 3200);
  }

  function requireExplicitIdentityForSocial() {
    if (hasExplicitIdentity()) return true;
    showSocialHintToast();
    return false;
  }

  // 首次進站或 localStorage 裡是已移除的示範學生（如 Chibi）時，預設為「訪客」
  function ensureDefaultIdentity() {
    if (!GUEST_MODE_ENABLED || GUEST_ROLES.length === 0) return;
    const invalidStudent =
      identity &&
      identity.role === "student" &&
      !STUDENT_NAME_SET.has(normalizeName(identity.userName));
    if (!identity || invalidStudent) {
      const defaultRole = GUEST_ROLES[0].id || "guest";
      const defaultName = GUEST_ROLES[0].label || "訪客";
      saveIdentity(defaultName, defaultRole, { explicit: false });
    }
  }

  ensureDefaultIdentity();

  function generateUuid() {
    if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return "u-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
  }

  // 老師憑證單獨存一份；要看面板時把它附上 POST。
  // 失效（後端改了 code）的話下一次 POST 會被退回，我們自動清掉 session 並請老師重登。
  function loadTeacherSession() {
    try {
      const raw = localStorage.getItem(TEACHER_STORAGE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.name || !obj.code) return null;
      return obj;
    } catch (_) {
      return null;
    }
  }

  function saveTeacherSession(name, code, label) {
    const obj = { name: name, code: code, label: label || name };
    localStorage.setItem(TEACHER_STORAGE_KEY, JSON.stringify(obj));
    teacherSession = obj;
    return obj;
  }

  function clearTeacherSession() {
    localStorage.removeItem(TEACHER_STORAGE_KEY);
    teacherSession = null;
  }

  function isAdmin() {
    return Boolean(teacherSession && teacherSession.name && teacherSession.code);
  }

  function roleInfo(role) {
    return GUEST_ROLE_BY_ID.get(role) || null;
  }

  function roleBadgeHtml(role) {
    const info = roleInfo(role);
    if (!info) return "";
    return `<span class="role-badge role-${escapeHtml(role)}">${info.emoji} ${escapeHtml(info.label)}</span>`;
  }

  function displayNameWithRole(name, role) {
    const info = roleInfo(role);
    if (!info) return name;
    return `${info.emoji} ${name}`;
  }

  // ---------- Entry ID（跨頁載入穩定）----------
  function entryIdFor(entry) {
    if (!entry) return "";
    const t = entry.timestamp instanceof Date ? entry.timestamp.getTime() : 0;
    return `${entry.student}@${t}`;
  }

  function cssEscape(s) {
    if (window.CSS && typeof CSS.escape === "function") return CSS.escape(String(s));
    return String(s).replace(/([^\w-])/g, "\\$1");
  }

  // ---------- 社交狀態（反應 + 留言）----------
  const socialEnabled = Boolean(CONFIG.appsScriptUrl && !CONFIG.appsScriptUrl.includes("貼上"));
  let socialState = { reactions: [], comments: [] };
  let biosByStudent = new Map(); // normalized name → { text, timestamp }
  const STUDENT_BIO_ENABLED = Boolean(CONFIG.studentBioEnabled);
  const STUDENT_BIO_MAX =
    typeof CONFIG.studentBioMaxLength === "number" && CONFIG.studentBioMaxLength >= 60 && CONFIG.studentBioMaxLength <= 512
      ? CONFIG.studentBioMaxLength
      : 280;

  let openedStudentName = null;

  function reactionCountsFor(entryId) {
    const counts = {};
    for (const e of CONFIG.reactionEmojis || []) counts[e] = 0;
    for (const r of socialState.reactions) {
      if (r.entryId !== entryId) continue;
      counts[r.emoji] = (counts[r.emoji] || 0) + 1;
    }
    return counts;
  }

  function userHasReacted(entryId, emoji) {
    if (!identity) return false;
    return socialState.reactions.some(r =>
      r.entryId === entryId && r.emoji === emoji && r.userId === identity.userId
    );
  }

  function commentsFor(entryId) {
    return socialState.comments
      .filter(c => c.entryId === entryId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  function studentBioFor(studentName) {
    const rec = biosByStudent.get(normalizeName(studentName));
    return rec && rec.text ? String(rec.text) : "";
  }

  function canEditStudentBio(studentName) {
    if (!STUDENT_BIO_ENABLED || !socialEnabled || !identity) return false;
    if (identity.role !== "student") return false;
    return normalizeName(identity.userName) === normalizeName(studentName);
  }

  // ---------- 大頭貼 ----------
  const AVATAR_TYPE_RAW = (CONFIG.avatarType || "").trim();
  const AVATAR_ENABLED = AVATAR_TYPE_RAW.length > 0;
  let avatarsByStudent = new Map();

  function isAvatarEntry(entry) {
    if (!AVATAR_ENABLED || !entry || !entry.type) return false;
    return String(entry.type).trim() === AVATAR_TYPE_RAW;
  }

  function avatarFor(studentName) {
    return avatarsByStudent.get(normalizeName(studentName)) || null;
  }

  function renderAvatarImg(avatar, width = 400, extraAttrs = "") {
    const fid = extractDriveFileId(avatar.fileUrl);
    if (fid) {
      return `<img src="${driveThumb(fid, width)}" alt="${escapeHtml(avatar.student)} 的大頭貼" loading="lazy" ${extraAttrs} onerror="this.onerror=null;this.style.display='none';this.parentElement.innerHTML+='<div class=&quot;fallback&quot;>👤</div>'" />`;
    }
    return `<div class="fallback">👤</div>`;
  }

  // ---------- 初始化畫面文字 ----------
  document.getElementById("site-title").textContent = CONFIG.siteTitle;
  document.getElementById("site-subtitle").textContent = CONFIG.siteSubtitle;
  document.getElementById("upload-btn").href = CONFIG.formUrl;

  // ---------- 展覽模式（家長 / 老師公開展覽時使用）----------
  // 統一在這裡處理：隱藏管理用按鈕、顯示引言區
  // 任務三週誌以「學生卡片上的 📓 週誌 pill」呈現，不再有獨立的總覽區
  const PUBLIC_VIEW_MODE = CONFIG.publicViewMode === true;
  const TASK3_URLS = (CONFIG.task3Urls && typeof CONFIG.task3Urls === "object") ? CONFIG.task3Urls : {};

  const curatorIntroEl = document.getElementById("curator-intro");
  const uploadBtnEl = document.getElementById("upload-btn");

  if (PUBLIC_VIEW_MODE) {
    if (curatorIntroEl) curatorIntroEl.hidden = false;
    if (uploadBtnEl) uploadBtnEl.hidden = true;
  } else {
    if (uploadBtnEl) uploadBtnEl.hidden = false;
  }

  function task3UrlFor(studentName) {
    if (!studentName) return "";
    return TASK3_URLS[studentName] || TASK3_URLS[String(studentName).trim()] || "";
  }

  const statusEl = document.getElementById("status-text");
  const lastUpdatedEl = document.getElementById("last-updated");
  const feedEl = document.getElementById("feed");
  const feedSubEl = document.getElementById("feed-sub");
  const studentsContainerEl = document.getElementById("students-container");
  const filterEl = document.getElementById("class-filter");
  const modalEl = document.getElementById("modal");
  const modalTitleEl = document.getElementById("modal-title");
  const modalBodyEl = document.getElementById("modal-body");
  const identityBtn = document.getElementById("identity-btn");
  const identityNameEl = document.getElementById("identity-name");
  const identityModalEl = document.getElementById("identity-modal");
  const identityListEl = document.getElementById("identity-list");

  let allEntries = [];
  let entriesByStudent = new Map();
  let activeFilter = "ALL"; // "ALL" | 班級 id（例如 "A" / "B"）

  // ---------- 篩選列 ----------
  function renderFilterBar() {
    const chips = [
      { id: "ALL", label: "全部", color: null },
      ...CLASSES.map(c => ({ id: c.id, label: c.label, color: c.color })),
    ];

    filterEl.innerHTML = chips.map(chip => {
      const count = chip.id === "ALL"
        ? allEntries.length
        : allEntries.filter(e => STUDENT_TO_CLASS.get(e.student) === chip.id).length;
      const isActive = activeFilter === chip.id;
      const dot = chip.color
        ? `<span class="chip-dot" style="background:${chip.color}"></span>`
        : "";
      return `
        <button class="filter-chip ${isActive ? "active" : ""}"
                data-filter="${escapeHtml(chip.id)}"
                role="tab"
                aria-selected="${isActive}">
          ${dot}
          <span>${escapeHtml(chip.label)}</span>
          <span class="chip-count">${count}</span>
        </button>
      `;
    }).join("");

    filterEl.querySelectorAll(".filter-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        activeFilter = btn.dataset.filter;
        renderFilterBar();
        render();
      });
    });
  }

  // ---------- 工具函式 ----------
  function setStatus(kind, text) {
    const dotClass = kind === "ok" ? "ok" : kind === "warn" ? "warn" : "err";
    statusEl.innerHTML = `<span class="status-dot ${dotClass}"></span>${text}`;
  }

  /** 產出／留言時間：年月日 + 時分（24 小時制，例：2026年5月2日 14:30） */
  function formatEntryTimestamp(d) {
    if (!(d instanceof Date) || isNaN(d)) return "";
    return new Intl.DateTimeFormat("zh-TW", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(d);
  }

  /** 從單一段 URL 或字串抽出第一個疑似 Drive id（與 Apps Script extractFileIds 分段邏輯搭配） */
  function extractDriveFileIdFromSegment(segment) {
    if (!segment || typeof segment !== "string") return null;
    const s = segment.trim();
    if (!s) return null;
    const patterns = [
      /\/file\/d\/([a-zA-Z0-9_-]+)/,
      /[?&]id=([a-zA-Z0-9_-]+)/,
      /\/d\/([a-zA-Z0-9_-]+)/,
    ];
    for (const p of patterns) {
      const m = s.match(p);
      if (m) return m[1];
    }
    const loose = s.match(/[-\w]{25,}/);
    return loose ? loose[0] : null;
  }

  /** 一個儲存格內若有多個連結／id（換行或逗號分隔），依序列出、去重 */
  function extractDriveFileIds(url) {
    if (!url || typeof url !== "string") return [];
    const parts = String(url)
      .split(/[\n,]+/)
      .map(x => x.trim())
      .filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const p of parts) {
      const id = extractDriveFileIdFromSegment(p);
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  }

  function extractDriveFileId(url) {
    const ids = extractDriveFileIds(url);
    return ids.length ? ids[0] : null;
  }

  /** 多檔並存時：找出含有該 id 的那段 URL（供試 Google 文件類嵌入預覽） */
  function fileUrlSegmentFor(fullCell, fileId) {
    if (!fullCell || !fileId) return "";
    const parts = String(fullCell)
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(Boolean);
    const hit = parts.find(p => p.includes(fileId));
    return hit || String(fullCell);
  }

  function driveThumb(fileId, width = 800) {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${width}`;
  }

  function driveOpenUrl(fileId) {
    return `https://drive.google.com/file/d/${fileId}/view`;
  }

  /** 嵌入預覽網址：PDF／Drive 檔可走 file/preview；Google 原生連結請用對應 product 網址，否則嵌入會失敗。 */
  function driveEmbeddedPreviewUrl(fileId, urlHint) {
    const id = encodeURIComponent(fileId);
    const u = String(urlHint || "");
    if (/docs\.google\.com\/document\//i.test(u)) {
      return `https://docs.google.com/document/d/${id}/preview`;
    }
    if (/docs\.google\.com\/spreadsheets\//i.test(u)) {
      return `https://docs.google.com/spreadsheets/d/${id}/preview`;
    }
    if (/docs\.google\.com\/presentation\//i.test(u)) {
      return `https://docs.google.com/presentation/d/${id}/preview`;
    }
    return `https://drive.google.com/file/d/${id}/preview`;
  }

  function getInitials(name) {
    if (!name) return "？";
    return name.trim().slice(0, 1);
  }

  function isImageType(type) {
    return type && /圖片|image|photo/i.test(type);
  }

  function isVideoType(type) {
    return type && /影片|video|movie/i.test(type);
  }

  function isDocType(type) {
    return type && /文件|doc|pdf/i.test(type);
  }

  function typeBadge(type) {
    if (isImageType(type)) return "🖼 圖片";
    if (isVideoType(type)) return "🎬 影片";
    if (isDocType(type)) return "📄 文件";
    if (type && /連結|link/i.test(type)) return "🔗 連結";
    return type || "產出";
  }

  /** Feed／學生格等：單一 Drive 檔的縮圖（非嵌入） */
  function renderSingleDriveThumbForFeed(entry, fileId, width) {
    if (isImageType(entry.type)) {
      return `<img src="${driveThumb(fileId, width)}" alt="${escapeHtml(entry.title)}" loading="lazy" onerror="this.onerror=null;this.style.display='none';this.parentElement.innerHTML+='<div class=&quot;fallback&quot;>🖼</div>'" />`;
    }
    if (isVideoType(entry.type)) {
      return `<img src="${driveThumb(fileId, width)}" alt="${escapeHtml(entry.title)}" loading="lazy" onerror="this.onerror=null;this.style.display='none';this.parentElement.innerHTML+='<div class=&quot;fallback&quot;>🎬</div>'" />`;
    }
    if (isDocType(entry.type)) {
      return `<div class="fallback">📄</div>`;
    }
    return `<img src="${driveThumb(fileId, width)}" alt="${escapeHtml(entry.title)}" loading="lazy" onerror="this.onerror=null;this.style.display='none';this.parentElement.innerHTML+='<div class=&quot;fallback&quot;>📎</div>'" />`;
  }

  function getMediaHtml(entry, width = 800) {
    const fileIds = extractDriveFileIds(entry.fileUrl);
    if (fileIds.length === 0) {
      if (entry.linkUrl) return `<div class="fallback">🔗</div>`;
      return `<div class="fallback">📝</div>`;
    }
    if (fileIds.length === 1) {
      return renderSingleDriveThumbForFeed(entry, fileIds[0], width);
    }
    const maxShow = 4;
    const show = fileIds.slice(0, maxShow);
    const extra = fileIds.length - show.length;
    const cellW = Math.max(120, Math.floor(width / 2));
    const layoutClass = fileIds.length === 2 ? "multi-media-thumb--2" : "multi-media-thumb--grid4";
    const cells = show
      .map(id => `<div class="multi-media-cell">${renderSingleDriveThumbForFeed(entry, id, cellW)}</div>`)
      .join("");
    const badge = extra > 0 ? `<span class="multi-media-more">+${extra}</span>` : "";
    return `<div class="multi-media-thumb ${layoutClass}" aria-label="${fileIds.length} 個檔案">${cells}${badge}</div>`;
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // 由姓名反推班級（以 config 的 students 為準）；若表單欄位也帶了班級，優先用表單的
  function resolveClassId(studentName, classFromForm) {
    const fromForm = classFromForm ? normalizeClassId(classFromForm) : null;
    if (fromForm) return fromForm;
    return STUDENT_TO_CLASS.get(studentName) || null;
  }

  // 把 "A 班" "A班" "A" 等形式正規化成 config 裡的 id
  function normalizeClassId(raw) {
    if (!raw) return null;
    const s = String(raw).trim().toUpperCase().replace(/\s+/g, "");
    for (const c of CLASSES) {
      const id = c.id.toUpperCase();
      if (s === id) return c.id;
      if (s.startsWith(id) && s.length <= id.length + 2) return c.id; // 允許 "A班" 形式
      const labelNoSpace = (c.label || "").toUpperCase().replace(/\s+/g, "");
      if (s === labelNoSpace) return c.id;
    }
    return null;
  }

  // ---------- 從 Google 試算表抓資料 ----------
  async function fetchOneSheet(sheetParam) {
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?tqx=out:json${sheetParam}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < 0) throw new Error("試算表回應格式異常");
    const json = JSON.parse(text.substring(start, end + 1));

    if (!json.table || !json.table.rows) return [];

    const cols = (json.table.cols || []).map(c => (c.label || c.id || "").trim());
    const rows = json.table.rows.map(r => {
      const cells = r.c || [];
      const obj = {};
      cols.forEach((label, i) => {
        const cell = cells[i];
        obj[label] = cell ? cell.v : null;
      });
      return obj;
    });

    return rows.map(parseRow).filter(Boolean);
  }

  async function fetchSheetData() {
    if (!CONFIG.sheetId || CONFIG.sheetId.includes("請貼上")) {
      throw new Error("尚未設定 Sheet ID，請編輯 config.js");
    }

    // 組出要抓的分頁參數列表
    const sheetParams = [];
    if (Array.isArray(CONFIG.sheetGids) && CONFIG.sheetGids.length) {
      for (const g of CONFIG.sheetGids) {
        if (g) sheetParams.push(`&gid=${encodeURIComponent(g)}`);
      }
    } else if (CONFIG.sheetGid) {
      sheetParams.push(`&gid=${encodeURIComponent(CONFIG.sheetGid)}`);
    } else if (CONFIG.sheetName) {
      sheetParams.push(`&sheet=${encodeURIComponent(CONFIG.sheetName)}`);
    } else {
      sheetParams.push("");
    }

    // 並行抓所有分頁，個別失敗不影響其他分頁
    const results = await Promise.allSettled(sheetParams.map(p => fetchOneSheet(p)));

    const allEntriesFromAllSheets = [];
    const errors = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        allEntriesFromAllSheets.push(...r.value);
      } else {
        errors.push(`分頁 ${i + 1}：${r.reason.message || r.reason}`);
      }
    });

    if (allEntriesFromAllSheets.length === 0 && errors.length > 0) {
      throw new Error(errors.join("；"));
    }

    // 即使有部分分頁失敗，仍把錯誤紀錄到 console
    if (errors.length > 0) {
      console.warn("部分分頁載入失敗：", errors.join("；"));
    }

    return allEntriesFromAllSheets;
  }

  function parseRow(row) {
    const keys = Object.keys(row);
    const pick = (candidates) => {
      for (const c of candidates) {
        for (const k of keys) {
          if (k && k.includes(c)) return row[k];
        }
      }
      return null;
    };

    const rawTime = pick(["時間", "Timestamp", "timestamp"]);
    const student = pick(["學生", "姓名", "name", "Name"]);
    const klass = pick(["班級", "班別", "class", "Class"]);
    const type = pick(["類型", "type", "Type"]);
    const title = pick(["標題", "title", "Title"]);
    const desc = pick(["說明", "描述", "desc"]);
    const fileUrl = pick(["檔案", "上傳", "file", "File", "Upload"]);
    const linkUrl = pick(["連結", "link", "url", "URL"]);

    if (!student) return null;

    let timestamp;
    if (rawTime instanceof Date) {
      timestamp = rawTime;
    } else if (typeof rawTime === "string") {
      const m = rawTime.match(/Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)/);
      if (m) {
        timestamp = new Date(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
      } else {
        timestamp = new Date(rawTime);
      }
    } else {
      timestamp = new Date();
    }

    const studentName = normalizeName(student);
    const classId = resolveClassId(studentName, klass);

    return {
      timestamp,
      student: studentName,
      classId,
      type: type ? String(type).trim() : "",
      title: title ? String(title).trim() : "（未命名）",
      desc: desc ? String(desc).trim() : "",
      fileUrl: fileUrl ? String(fileUrl).trim() : "",
      linkUrl: linkUrl ? String(linkUrl).trim() : "",
    };
  }

  // ---------- 篩選邏輯 ----------
  function passesFilter(entry) {
    if (activeFilter === "ALL") return true;
    return entry.classId === activeFilter;
  }

  function studentPassesFilter(student) {
    if (activeFilter === "ALL") return true;
    return student.class === activeFilter;
  }

  // ---------- 渲染 ----------
  function render() {
    renderFilterBar();
    renderFeed();
    renderStudentsContainer();
  }

  function renderFeed() {
    const filtered = allEntries.filter(passesFilter);
    const latest = [...filtered]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 12);

    const filterLabel = activeFilter === "ALL" ? "全班" : getClassInfo(activeFilter).label;
    const nShown = Math.min(latest.length, 12);
    const scrollHint =
      latest.length >= 6 ? " · 可向左右滑動瀏覽全部" : "";
    feedSubEl.textContent = `${filterLabel}最近的 ${nShown} 則產出${scrollHint}`;

    if (latest.length === 0) {
      const msg = activeFilter === "ALL"
        ? "還沒有任何產出，歡迎成為第一個！"
        : `${filterLabel}還沒有任何產出`;
      feedEl.innerHTML = `<div class="placeholder">${msg}</div>`;
      return;
    }

    feedEl.innerHTML = latest.map(entry => {
      const cls = getClassInfo(entry.classId);
      const classBadge = entry.classId
        ? `<span class="class-badge" style="background:${cls.color}">${escapeHtml(entry.classId)}</span>`
        : "";
      const socialLine = socialEnabled ? renderFeedSocialLine(entryIdFor(entry)) : "";
      return `
      <article class="feed-card" data-student="${escapeHtml(entry.student)}">
        <div class="media">
          ${getMediaHtml(entry, 280)}
          <span class="type-badge">${escapeHtml(typeBadge(entry.type))}</span>
          ${classBadge}
        </div>
        <div class="body">
          <div class="author">
            <span class="avatar">${escapeHtml(getInitials(entry.student))}</span>
            <span>${escapeHtml(entry.student)}</span>
          </div>
          <div class="title">${escapeHtml(entry.title)}</div>
          <div class="timestamp">${formatEntryTimestamp(entry.timestamp)}</div>
          ${socialLine}
        </div>
      </article>
    `;
    }).join("");

    feedEl.querySelectorAll(".feed-card").forEach(card => {
      card.addEventListener("click", () => openStudentModal(card.dataset.student));
    });
  }

  function renderStudentsContainer() {
    // 決定要顯示哪些班級區塊
    const classesToShow = activeFilter === "ALL"
      ? CLASSES
      : CLASSES.filter(c => c.id === activeFilter);

    studentsContainerEl.innerHTML = classesToShow.map(cls => {
      const students = (CONFIG.students || []).filter(s => s.class === cls.id);
      const cards = students.map(s => renderStudentCard(s, cls)).join("");
      // 全部模式下顯示班級分群標題；單一班級模式下不重複顯示
      const headerHtml = activeFilter === "ALL"
        ? `
          <div class="class-group-header">
            <span class="group-dot" style="background:${cls.color}"></span>
            <h3>${escapeHtml(cls.label)}</h3>
            <span class="group-count">${students.length} 人</span>
          </div>`
        : "";
      return `
        <div class="class-group" data-class="${escapeHtml(cls.id)}">
          ${headerHtml}
          <div class="students-grid">${cards}</div>
        </div>
      `;
    }).join("");

    studentsContainerEl.querySelectorAll(".student-card").forEach(card => {
      card.addEventListener("click", () => openStudentModal(card.dataset.student));
    });
  }

  function renderStudentCard(student, cls) {
    const entries = entriesByStudent.get(normalizeName(student.name)) || [];
    const count = entries.length;
    const latest = entries[0];
    const avatar = avatarFor(student.name);

    let thumbHtml;
    if (avatar) {
      thumbHtml = renderAvatarImg(avatar, 400);
    } else if (latest) {
      thumbHtml = getMediaHtml(latest, 400);
    } else {
      thumbHtml = `<span class="empty">尚未上傳</span>`;
    }

    // 展覽模式下每張卡片右下角加一顆「週誌」按鈕，直接開啟該同學的任務三 Google Docs
    const task3Url = task3UrlFor(student.name);
    const task3Btn = PUBLIC_VIEW_MODE && task3Url
      ? `<a class="task3-pill" href="${escapeHtml(task3Url)}" target="_blank" rel="noopener"
             title="開啟 ${escapeHtml(student.name)} 的任務三 · 週誌"
             onclick="event.stopPropagation()">
           <span class="task3-pill-icon" aria-hidden="true">📓</span>
           <span class="task3-pill-label">週誌</span>
         </a>`
      : "";

    const topic = (student.topic || "").trim();
    const topicHtml = topic
      ? `<p class="topic" title="${escapeHtml(topic)}">${escapeHtml(topic)}</p>`
      : `<p class="topic is-empty" aria-hidden="true"></p>`;

    return `
      <div class="student-card" data-student="${escapeHtml(student.name)}">
        <span class="class-ribbon" style="background:${cls.color}">${escapeHtml(student.class)}</span>
        <div class="thumb">${thumbHtml}</div>
        <div class="info">
          <span class="name">${escapeHtml(student.name)}</span>
          <span class="count ${count === 0 ? "zero" : ""}">${count}</span>
        </div>
        ${topicHtml}
        ${task3Btn}
      </div>
    `;
  }

  function renderStudentBioSection(studentName) {
    if (!socialEnabled || !STUDENT_BIO_ENABLED) return "";
    const text = studentBioFor(studentName);
    const editable = canEditStudentBio(studentName);

    if (editable) {
      return `
      <section class="student-bio-section" aria-label="個人簡介">
        <div class="student-bio-heading">個人簡介</div>
        <p class="student-bio-hint">
          你目前已選身分為<strong>${escapeHtml(identity.userName)}</strong>，只在此區可以編輯自己的簡介；點其他同學的頭像時僅供瀏覽。
        </p>
        <textarea
          id="student-bio-input"
          class="student-bio-input"
          maxlength="${STUDENT_BIO_MAX}"
          rows="5"
          placeholder="簡短介紹你自己…">${escapeHtml(text)}</textarea>
        <div class="student-bio-actions">
          <button type="button" class="btn btn-primary student-bio-save" id="student-bio-save">儲存</button>
          <span id="student-bio-status" class="student-bio-status" hidden></span>
        </div>
      </section>`;
    }

    return `
      <section class="student-bio-section" aria-label="個人簡介">
        <div class="student-bio-heading">個人簡介</div>
        ${text
          ? `<div class="student-bio-readonly"><p class="student-bio-body">${escapeHtml(text)}</p></div>`
          : `<div class="student-bio-readonly"><p class="student-bio-empty">對方尚未填寫個人簡介</p></div>`
        }
      </section>`;
  }

  // ---------- 學生詳情彈窗 ----------
  function openStudentModal(studentName) {
    openedStudentName = studentName;
    renderStudentModalBody(studentName);
    modalEl.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function renderStudentModalBody(studentName) {
    const key = normalizeName(studentName);
    const entries = entriesByStudent.get(key) || [];
    const classId = STUDENT_TO_CLASS.get(key);
    const cls = classId ? getClassInfo(classId) : null;
    const classTag = cls
      ? ` <span class="tag" style="background:${cls.color};color:white">${escapeHtml(cls.label)}</span>`
      : "";
    const avatar = avatarFor(studentName);
    const avatarHtml = avatar
      ? `<span class="modal-avatar">${renderAvatarImg(avatar, 160)}</span>`
      : "";
    const topic = topicFor(studentName);
    const topicLineHtml = topic
      ? `<span class="modal-title-topic">${escapeHtml(topic)}</span>`
      : "";
    modalTitleEl.innerHTML = `${avatarHtml}<span class="modal-title-text"><span class="modal-title-line">${escapeHtml(studentName)}${classTag} <span class="modal-title-meta">· 共 ${entries.length} 則產出</span></span>${topicLineHtml}</span>`;

    const bioHtml = renderStudentBioSection(studentName);
    let worksHtml = "";
    if (entries.length === 0) {
      worksHtml = `<div class="placeholder student-works-placeholder">這位同學還沒有上傳任何產出</div>`;
    } else {
      worksHtml = entries.map(entry => renderEntryDetail(entry)).join("");
    }

    modalBodyEl.innerHTML = bioHtml + worksHtml;
  }

  /** 詳情區：單一檔案的預覽（含 PDF embed）；iframeTitleSuffix 會接在標題後供無障礙 */
  function renderEntrySingleBlockInner(entry, fileId, iframeTitleSuffix) {
    const hint = fileUrlSegmentFor(entry.fileUrl, fileId);
    const suffix = iframeTitleSuffix || "";

    if (isImageType(entry.type)) {
      return `<img src="${driveThumb(fileId, 800)}" alt="${escapeHtml(entry.title)}" />`;
    }
    if (isDocType(entry.type)) {
      const src = driveEmbeddedPreviewUrl(fileId, hint);
      return `<div class="entry-media-stack entry-doc-embed-stack">
          <iframe
            class="entry-drive-preview"
            src="${src}"
            title="${escapeHtml(entry.title)}${escapeHtml(suffix)}"
            loading="lazy"></iframe>
        </div>`;
    }
    if (isVideoType(entry.type)) {
      return `<div class="entry-media-stack">
          <img class="entry-drive-thumb" src="${driveThumb(fileId, 800)}" alt="" loading="lazy"
            onerror="this.classList.add('is-hidden');var p=this.nextElementSibling;if(p){p.classList.remove('is-hidden');p.setAttribute('aria-hidden','false');}" />
          <div class="entry-media-placeholder entry-media-placeholder--video is-hidden" aria-hidden="true">
            <span class="entry-media-placeholder-icon" aria-hidden="true">🎬</span>
            <span class="entry-media-placeholder-label">影片</span>
            <span class="entry-media-placeholder-hint">點縮圖或下方「Drive 附件」在雲端播放</span>
          </div>
        </div>`;
    }
    return `<img src="${driveThumb(fileId, 800)}" alt="${escapeHtml(entry.title)}" />`;
  }

  /** 學生詳情側欄：圖 cover；PDF／文件試 Drive/Google 嵌入預覽（首頁級可視區）；影片先試縮圖；多檔直向排列 */
  function renderEntryMediaBlock(entry) {
    const fileIds = extractDriveFileIds(entry.fileUrl);
    if (fileIds.length === 1) {
      return renderEntrySingleBlockInner(entry, fileIds[0], "");
    }
    if (fileIds.length > 1) {
      return (
        `<div class="entry-media-gallery">` +
        fileIds
          .map(
            (id, idx) => `
          <div class="entry-media-item">
            ${renderEntrySingleBlockInner(entry, id, ` 附件 ${idx + 1}`)}
            <span class="entry-media-index">${idx + 1}</span>
          </div>`
          )
          .join("") +
        `</div>`
      );
    }
    if (entry.linkUrl) {
      return `<div class="entry-media-placeholder entry-media-placeholder--link" role="img" aria-label="連結項目">
        <span class="entry-media-placeholder-icon" aria-hidden="true">🔗</span>
        <span class="entry-media-placeholder-label">連結</span>
        <span class="entry-media-placeholder-hint">點縮圖或下方「外部連結」</span>
      </div>`;
    }
    return `<div class="entry-media-placeholder entry-media-placeholder--note" role="img" aria-label="文字項目">
      <span class="entry-media-placeholder-icon" aria-hidden="true">📝</span>
      <span class="entry-media-placeholder-label">文字／其他</span>
    </div>`;
  }

  function renderEntryDetail(entry) {
    const fileIds = extractDriveFileIds(entry.fileUrl);
    const multiFile = fileIds.length > 1;
    const mediaBlock = renderEntryMediaBlock(entry);

    let mediaHref = "";
    let mediaHitLabel = "";
    if (fileIds.length === 1) {
      mediaHref = driveOpenUrl(fileIds[0]);
      mediaHitLabel = "在 Drive 開啟";
    } else if (!fileIds.length && entry.linkUrl) {
      mediaHref = String(entry.linkUrl).trim();
      mediaHitLabel = "開啟外部連結";
    }

    const hitHtml =
      !multiFile && mediaHref
        ? `<a class="entry-media-hit" href="${escapeHtml(mediaHref)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(mediaHitLabel)}（新分頁）" title="${escapeHtml(mediaHitLabel)}"></a>`
        : "";

    const links = [];
    fileIds.forEach((id, i) => {
      const label = fileIds.length === 1 ? "在 Drive 開啟" : `Drive 附件 ${i + 1}`;
      links.push(
        `<a href="${escapeHtml(driveOpenUrl(id))}" target="_blank" rel="noopener noreferrer">${label}</a>`
      );
    });
    if (entry.linkUrl) {
      links.push(`<a href="${escapeHtml(entry.linkUrl)}" target="_blank" rel="noopener noreferrer">外部連結 ↗</a>`);
    }

    const reactionsHtml = socialEnabled ? renderReactionsBar(entry) : "";
    const commentsHtml = socialEnabled ? renderCommentsSection(entry) : "";

    let mediaShellClass = "entry-media";
    if (multiFile) mediaShellClass += " entry-media--multi";
    else if (hitHtml) mediaShellClass += " entry-media--clickable";

    return `
      <div class="entry">
        <div class="${mediaShellClass}">
          ${mediaBlock}
          ${hitHtml}
        </div>
        <div class="entry-info">
          <div class="entry-title">${escapeHtml(entry.title)}</div>
          ${entry.desc ? `<div class="entry-desc">${escapeHtml(entry.desc)}</div>` : ""}
          <div class="entry-meta">
            <span class="tag">${escapeHtml(typeBadge(entry.type))}</span>
            <span>${formatEntryTimestamp(entry.timestamp)}</span>
            ${links.join("")}
          </div>
          ${reactionsHtml}
          ${commentsHtml}
        </div>
      </div>
    `;
  }

  // ---------- 反應 / 留言：渲染 ----------
  function renderFeedSocialLine(entryId) {
    const counts = reactionCountsFor(entryId);
    const commentCount = commentsFor(entryId).length;
    const top = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    if (top.length === 0 && commentCount === 0) {
      return `<div class="social"></div>`;
    }
    const parts = top.map(([emoji, n]) => `<span>${emoji} ${n}</span>`);
    if (commentCount > 0) parts.push(`<span>💬 ${commentCount}</span>`);
    return `<div class="social">${parts.join("")}</div>`;
  }

  function renderReactionsBar(entry) {
    const entryId = entryIdFor(entry);
    const counts = reactionCountsFor(entryId);
    const emojis = CONFIG.reactionEmojis || [];

    return `
      <div class="reactions-bar" data-entry-id="${escapeHtml(entryId)}">
        ${emojis.map(emoji => {
          const count = counts[emoji] || 0;
          const active = userHasReacted(entryId, emoji);
          return `
            <button type="button"
                    class="reaction-btn ${active ? "active" : ""}"
                    data-emoji="${escapeHtml(emoji)}">
              <span class="reaction-emoji">${emoji}</span>
              <span class="reaction-count">${count}</span>
            </button>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderCommentsSection(entry) {
    const entryId = entryIdFor(entry);
    const list = commentsFor(entryId);
    const placeholder = hasExplicitIdentity()
      ? "分享你的想法…（最多 200 字）"
      : "登入後即可留言（請從右上角選擇身分）";

    return `
      <div class="comments-section" data-entry-id="${escapeHtml(entryId)}">
        <div class="comments-heading">
          <span class="label">留言</span>
          <span class="count">${list.length} 則</span>
        </div>
        <div class="comment-list">${renderCommentListItems(list)}</div>
        <form class="comment-form" data-entry-id="${escapeHtml(entryId)}">
          <textarea
            placeholder="${placeholder}"
            maxlength="200"
            rows="1"></textarea>
          <button type="submit">送出</button>
        </form>
      </div>
    `;
  }

  function renderCommentListItems(list) {
    if (list.length === 0) {
      return `<div class="comment-empty">還沒有留言 · 第一個來留言吧</div>`;
    }
    return list.map(c => {
      const badge = roleBadgeHtml(c.role);
      return `
      <div class="comment">
        <div class="comment-meta">
          <span class="author">${escapeHtml(c.userName || "匿名")}${badge}</span>
          <span class="time">${formatEntryTimestamp(new Date(c.timestamp))}</span>
        </div>
        <div class="comment-text">${escapeHtml(c.text || "")}</div>
      </div>
    `;
    }).join("");
  }

  // 只更新 modal 裡的社交區塊（不動整個 body，避免丟失輸入中的文字與焦點）
  function updateModalSocialOnly() {
    if (!openedStudentName) return;
    const entries = entriesByStudent.get(normalizeName(openedStudentName)) || [];
    for (const entry of entries) {
      const id = entryIdFor(entry);
      const bar = modalBodyEl.querySelector(`.reactions-bar[data-entry-id="${cssEscape(id)}"]`);
      if (bar) {
        const counts = reactionCountsFor(id);
        (CONFIG.reactionEmojis || []).forEach(emoji => {
          const btn = bar.querySelector(`.reaction-btn[data-emoji="${cssEscape(emoji)}"]`);
          if (!btn) return;
          const countEl = btn.querySelector(".reaction-count");
          if (countEl) countEl.textContent = counts[emoji] || 0;
          btn.classList.toggle("active", userHasReacted(id, emoji));
        });
      }
      const section = modalBodyEl.querySelector(`.comments-section[data-entry-id="${cssEscape(id)}"]`);
      if (section) {
        const list = commentsFor(id);
        const countEl = section.querySelector(".comments-heading .count");
        if (countEl) countEl.textContent = `${list.length} 則`;
        const listEl = section.querySelector(".comment-list");
        if (listEl) listEl.innerHTML = renderCommentListItems(list);
      }
    }
  }

  // ---------- 反應 / 留言：後端互動 ----------
  // 送出中的 POST 計數。大於 0 時，輪詢的 fetchSocial 會暫停一輪，
  // 避免把還沒寫進試算表的樂觀更新給洗掉。
  let pendingPosts = 0;

  async function postToAppsScript(body) {
    pendingPosts++;
    try {
      // Content-Type 用 text/plain 可避免 CORS preflight（Apps Script 端 e.postData.contents 仍拿得到 JSON 字串）
      const res = await fetch(CONFIG.appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "失敗");
      return json;
    } finally {
      pendingPosts--;
    }
  }

  async function fetchSocial() {
    if (!socialEnabled) return;
    if (pendingPosts > 0) {
      // 有寫入動作正在進行，避免把樂觀更新洗掉，這一輪先跳過
      return;
    }
    try {
      const res = await fetch(CONFIG.appsScriptUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "載入失敗");
      socialState.reactions = Array.isArray(json.reactions) ? json.reactions : [];
      socialState.comments = Array.isArray(json.comments) ? json.comments : [];
      codesEnabled = !!json.codesEnabled;
      serverTeachers = Array.isArray(json.teachers) ? json.teachers : [];
      if (typeof json.submissionDashboardPublic === "boolean") {
        submissionDashboardPublic = json.submissionDashboardPublic;
      }
      refreshTeacherUiState();

      if (STUDENT_BIO_ENABLED) {
        const nextBios = new Map();
        for (const b of Array.isArray(json.bios) ? json.bios : []) {
          const k = normalizeName(b.studentName);
          if (!k) continue;
          nextBios.set(k, {
            text: String(b.text != null ? b.text : "").trim(),
            timestamp: b.timestamp || "",
          });
        }
        biosByStudent = nextBios;
      } else {
        biosByStudent = new Map();
      }
      // Feed 卡片的小計數也要刷新
      renderFeed();
      // 若有彈窗開著，局部更新反應／留言／非編輯中時的個人簡介
      updateModalSocialOnly();

      if (STUDENT_BIO_ENABLED) {
        const ta = document.getElementById("student-bio-input");
        const editingBio = ta && document.activeElement === ta;
        if (openedStudentName && !modalEl.hidden && !editingBio) {
          const sec = modalBodyEl.querySelector(".student-bio-section");
          if (sec && !canEditStudentBio(openedStudentName)) {
            sec.outerHTML = renderStudentBioSection(openedStudentName);
          }
        }
      }
    } catch (err) {
      console.warn("[social] 載入失敗：", err.message || err);
    }
  }

  async function handleReactionClick(btn) {
    if (!requireExplicitIdentityForSocial()) return;
    const bar = btn.closest(".reactions-bar");
    if (!bar) return;
    const entryId = bar.dataset.entryId;
    const emoji = btn.dataset.emoji;
    if (!entryId || !emoji) return;

    // 樂觀更新（不 disable 按鈕，學生可以連續快點）
    const wasActive = btn.classList.contains("active");
    const countEl = btn.querySelector(".reaction-count");
    const prevCount = parseInt(countEl.textContent, 10) || 0;
    btn.classList.toggle("active", !wasActive);
    countEl.textContent = String(wasActive ? Math.max(0, prevCount - 1) : prevCount + 1);

    // 同步本地 state
    const optimisticReaction = {
      timestamp: new Date().toISOString(),
      entryId, emoji,
      userId: identity.userId,
      userName: identity.userName,
      role: identity.role,
    };
    if (wasActive) {
      socialState.reactions = socialState.reactions.filter(r =>
        !(r.entryId === entryId && r.emoji === emoji && r.userId === identity.userId)
      );
    } else {
      socialState.reactions.push(optimisticReaction);
    }

    try {
      await postToAppsScript({
        action: "toggleReaction",
        entryId, emoji,
        userId: identity.userId,
        userName: identity.userName,
        role: identity.role,
      });
      // 成功後稍後再拉一次，把別人的新動作也帶回來
      setTimeout(fetchSocial, 600);
    } catch (err) {
      console.warn("[reaction] 送出失敗，UI 已回復：", err.message || err);
      // 回復 UI
      btn.classList.toggle("active", wasActive);
      countEl.textContent = String(prevCount);
      // 回復本地 state
      if (wasActive) {
        socialState.reactions.push(optimisticReaction);
      } else {
        socialState.reactions = socialState.reactions.filter(r =>
          !(r.entryId === entryId && r.emoji === emoji && r.userId === identity.userId)
        );
      }
    }
  }

  async function handleCommentSubmit(form) {
    if (!requireExplicitIdentityForSocial()) return;
    const textarea = form.querySelector("textarea");
    const button = form.querySelector("button");
    const entryId = form.dataset.entryId;
    const text = (textarea.value || "").trim();
    if (!text || !entryId) return;

    const origText = textarea.value;
    button.disabled = true;
    textarea.disabled = true;

    try {
      await postToAppsScript({
        action: "addComment",
        entryId,
        userId: identity.userId,
        userName: identity.userName,
        role: identity.role,
        text,
      });

      // 樂觀加入本地 state
      socialState.comments.push({
        timestamp: new Date().toISOString(),
        entryId,
        userId: identity.userId,
        userName: identity.userName,
        role: identity.role,
        text,
      });

      textarea.value = "";
      updateModalSocialOnly();
      setTimeout(fetchSocial, 600);
    } catch (err) {
      console.warn("[comment] 送出失敗：", err.message || err);
      textarea.value = origText;
    } finally {
      button.disabled = false;
      textarea.disabled = false;
      textarea.focus();
    }
  }

  async function handleStudentBioSave() {
    if (!STUDENT_BIO_ENABLED) return;
    if (!identity || openedStudentName == null) return;
    if (!canEditStudentBio(openedStudentName)) return;

    const ta = document.getElementById("student-bio-input");
    const btn = document.getElementById("student-bio-save");
    const status = document.getElementById("student-bio-status");
    if (!ta || !btn) return;

    let text = String(ta.value || "").trim();
    if (text.length > STUDENT_BIO_MAX) text = text.slice(0, STUDENT_BIO_MAX);

    btn.disabled = true;
    ta.disabled = true;
    if (status) { status.hidden = true; status.textContent = ""; }

    try {
      await postToAppsScript({
        action: "setBio",
        studentName: openedStudentName,
        userId: identity.userId,
        text,
      });

      biosByStudent.set(normalizeName(openedStudentName), {
        text,
        timestamp: new Date().toISOString(),
      });
      renderStudentModalBody(openedStudentName);

      const stNew = document.getElementById("student-bio-status");
      const btnNew = document.getElementById("student-bio-save");
      if (stNew && btnNew && canEditStudentBio(openedStudentName)) {
        btnNew.disabled = false;
        const taNew = document.getElementById("student-bio-input");
        if (taNew) taNew.disabled = false;
        stNew.hidden = false;
        stNew.textContent = "已儲存";
        setTimeout(() => { if (stNew) stNew.hidden = true; }, 2600);
      }
      setTimeout(fetchSocial, 500);
    } catch (err) {
      console.warn("[bio]", err.message || err);
      ta.disabled = false;
      btn.disabled = false;
      if (status) {
        status.hidden = false;
        status.textContent = "儲存失敗：" + (err.message || "請稍後再試");
      }
    }
  }

  // Event delegation：綁一次就好（modalBodyEl 本身不會被替換）
  if (socialEnabled) {
    modalBodyEl.addEventListener("click", (e) => {
      if (STUDENT_BIO_ENABLED) {
        const saveBio = e.target.closest("#student-bio-save");
        if (saveBio) {
          if (!identity) { openIdentityPicker(); return; }
          handleStudentBioSave();
          return;
        }
      }
      const btn = e.target.closest(".reaction-btn");
      if (btn && !btn.disabled) handleReactionClick(btn);
    });
    modalBodyEl.addEventListener("submit", (e) => {
      const form = e.target.closest(".comment-form");
      if (form) { e.preventDefault(); handleCommentSubmit(form); }
    });
  }

  // ---------- 身分選擇器 ----------
  function refreshIdentityChip() {
    if (!socialEnabled) {
      identityBtn.hidden = true;
      return;
    }
    identityBtn.hidden = false;
    if (identity && identity.userName) {
      identityNameEl.textContent = displayNameWithRole(identity.userName, identity.role);
      identityBtn.classList.remove("is-unset");
    } else {
      identityNameEl.textContent = "選擇身分";
      identityBtn.classList.add("is-unset");
    }
  }

  // ---------- 學生驗證碼（後端驗證）----------
  // 驗證碼本身不在前端，而是在 Apps Script 的 STUDENTS_PRIVATE 裡（私密、不進 GitHub）。
  // 前端只做兩件事：
  //   1. 從 doGet 回傳的 codesEnabled 旗標得知是否要跳驗證碼步驟
  //   2. 把學生輸入的碼 POST 給 Apps Script，由後端回報 valid: true / false
  // 若 Apps Script 未設定（socialEnabled = false），就沒有互動功能也不需要驗證。
  // 預設值跟著 socialEnabled 走；待 fetchSocial() 第一次回來後，會依後端實際狀態再更新。
  let codesEnabled = socialEnabled;

  // 後端 doGet 回傳的老師清單；用來決定要不要在身分選擇器顯示「老師登入」入口。
  // 預設用 config.js 的 teachers，等後端第一次回應後會被覆蓋成實際 TEACHERS_PRIVATE 名單。
  let serverTeachers = CONFIG_TEACHERS.map(t => ({ name: t.name, label: t.label || t.name }));

  // 繳交狀況是否對所有人開放（後端 SUBMISSION_DASHBOARD_PUBLIC；doGet 會覆寫）
  let submissionDashboardPublic = CONFIG.submissionDashboardPublic === true;

  async function verifyStudentCodeRemote(studentName, input) {
    if (!socialEnabled) return { ok: true, valid: true };
    try {
      const res = await fetch(CONFIG.appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "verifyCode", name: studentName, code: input }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "驗證失敗");
      return { ok: true, valid: !!json.valid, reason: json.reason };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  async function verifyTeacherCodeRemote(teacherName, input) {
    if (!socialEnabled) return { ok: false, error: "appsScriptUrl 未設定" };
    try {
      const res = await fetch(CONFIG.appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "verifyTeacher", name: teacherName, code: input }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "驗證失敗");
      return { ok: true, valid: !!json.valid, reason: json.reason, label: json.label };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  function renderGuestFormHtml() {
    if (!GUEST_MODE_ENABLED || GUEST_ROLES.length === 0) return "";
    const activeRole = identity && identity.role && identity.role !== "student"
      ? identity.role
      : (GUEST_ROLES[0] && GUEST_ROLES[0].id) || "guest";
    const activeNick = identity && identity.role !== "student"
      ? identity.userName || ""
      : "";
    const roleBtns = GUEST_ROLES.map(r => `
      <button type="button"
              class="identity-role ${r.id === activeRole ? "active" : ""}"
              data-role="${escapeHtml(r.id)}">
        ${r.emoji} ${escapeHtml(r.label)}
      </button>
    `).join("");

    return `
      <div class="identity-group identity-group-guest">
        <div class="identity-group-label">
          <span class="dot" style="background:var(--ink)"></span>
          訪客 / 老師 / 家長（自填暱稱）
        </div>
        <div class="identity-guest-form">
          <div class="identity-role-row">${roleBtns}</div>
          <div class="identity-nick-row">
            <input type="text"
                   id="identity-nick-input"
                   class="identity-nick-input"
                   maxlength="20"
                   value="${escapeHtml(activeNick)}"
                   placeholder="輸入暱稱（1–20 字，不可跟學生同名）" />
            <button type="button" id="identity-nick-submit" class="identity-nick-submit">送出</button>
          </div>
          <div id="identity-guest-err" class="identity-guest-err" hidden></div>
        </div>
      </div>
    `;
  }

  function renderIdentityPickerList() {
    const teacherNameSet = new Set(serverTeachers.map(t => normalizeName(t.name)));

    const studentHtml = CLASSES.map(cls => {
      // 老師清單裡的名字不在學生選單裡出現（避免老師被點到走錯流程）
      const students = (CONFIG.students || [])
        .filter(s => s.class === cls.id)
        .filter(s => !teacherNameSet.has(normalizeName(s.name)));
      if (students.length === 0) return "";
      const options = students.map(s => {
        const isActive = identity && identity.role === "student" && identity.userName === s.name;
        const locked = codesEnabled ? `<span class="identity-lock" aria-hidden="true">🔒</span>` : "";
        return `<button type="button" class="identity-option ${isActive ? "active" : ""}" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}${locked}</button>`;
      }).join("");
      return `
        <div class="identity-group">
          <div class="identity-group-label">
            <span class="dot" style="background:${cls.color}"></span>
            ${escapeHtml(cls.label)}
          </div>
          <div class="identity-options">${options}</div>
        </div>
      `;
    }).join("");

    identityListEl.innerHTML = renderTeacherLoginHtml() + studentHtml + renderGuestFormHtml();
  }

  function renderTeacherLoginHtml() {
    if (!socialEnabled || serverTeachers.length === 0) return "";
    const teacherBtns = serverTeachers.map(t => {
      const isActive = isAdmin() && teacherSession && normalizeName(teacherSession.name) === normalizeName(t.name);
      return `
        <button type="button"
                class="identity-teacher-option ${isActive ? "active" : ""}"
                data-teacher-name="${escapeHtml(t.name)}">
          👩‍🏫 ${escapeHtml(t.label || t.name)}
          <span class="identity-lock" aria-hidden="true">🔒</span>
        </button>
      `;
    }).join("");
    const logoutHtml = isAdmin()
      ? `<button type="button" class="identity-teacher-logout" id="identity-teacher-logout">登出老師面板</button>`
      : "";
    return `
      <div class="identity-group identity-group-teacher">
        <div class="identity-group-label">
          <span class="dot" style="background:#10b981"></span>
          老師登入
        </div>
        <div class="identity-teacher-options">${teacherBtns}</div>
        ${logoutHtml}
      </div>
    `;
  }

  function renderIdentityTeacherCodeStep(teacherName, label) {
    identityListEl.innerHTML = `
      <div class="identity-code-step identity-code-step--teacher">
        <button type="button" class="identity-code-back" id="identity-code-back">← 換一個</button>
        <div class="identity-code-heading">
          <div class="identity-code-title">嗨，<strong>${escapeHtml(label || teacherName)}</strong></div>
          <div class="identity-code-sub">請輸入老師面板專用的 <strong>驗證碼</strong></div>
        </div>
        <div class="identity-code-row">
          <input type="text"
                 id="identity-teacher-code-input"
                 class="identity-code-input"
                 autocomplete="off"
                 autocapitalize="off"
                 spellcheck="false"
                 inputmode="numeric"
                 pattern="[0-9]*"
                 maxlength="4"
                 placeholder="4 位數字"
                 data-name="${escapeHtml(teacherName)}" />
          <button type="button" id="identity-teacher-code-submit" class="identity-code-submit">確認</button>
        </div>
        <div id="identity-teacher-code-err" class="identity-code-err" hidden></div>
        <div class="identity-code-hint">通過驗證後右上會多一個 📊 按鈕，點下去可以看全班繳交狀況。</div>
      </div>
    `;
    const input = document.getElementById("identity-teacher-code-input");
    if (input) setTimeout(() => input.focus(), 30);
  }

  function showTeacherCodeError(msg) {
    const el = document.getElementById("identity-teacher-code-err");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    const input = document.getElementById("identity-teacher-code-input");
    if (input) {
      input.classList.add("has-error");
      input.focus();
      input.select();
    }
  }
  function clearTeacherCodeError() {
    const el = document.getElementById("identity-teacher-code-err");
    if (el) { el.hidden = true; el.textContent = ""; }
    const input = document.getElementById("identity-teacher-code-input");
    if (input) input.classList.remove("has-error");
  }

  async function submitTeacherCode() {
    const input = document.getElementById("identity-teacher-code-input");
    const submitBtn = document.getElementById("identity-teacher-code-submit");
    if (!input) return;
    const teacherName = input.dataset.name;
    const value = input.value || "";
    if (!value.trim()) {
      showTeacherCodeError("請輸入驗證碼");
      return;
    }

    clearTeacherCodeError();
    input.disabled = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "驗證中…";
    }

    const result = await verifyTeacherCodeRemote(teacherName, value);

    input.disabled = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "確認";
    }

    if (!result.ok) {
      showTeacherCodeError(`驗證服務連不上：${result.error}。請稍後再試。`);
      return;
    }
    if (!result.valid) {
      showTeacherCodeError("驗證碼不正確，再試一次");
      return;
    }

    saveTeacherSession(teacherName, value, result.label);
    refreshTeacherUiState();
    closeIdentityPicker();
    openTeacherDashboard();
  }

  function renderIdentityCodeStep(studentName) {
    identityListEl.innerHTML = `
      <div class="identity-code-step">
        <button type="button" class="identity-code-back" id="identity-code-back">← 換一位</button>
        <div class="identity-code-heading">
          <div class="identity-code-title">嗨，<strong>${escapeHtml(studentName)}</strong> 同學</div>
          <div class="identity-code-sub">請輸入老師私訊給你的 <strong>驗證碼</strong>，確認這就是你本人</div>
        </div>
        <div class="identity-code-row">
          <input type="text"
                 id="identity-code-input"
                 class="identity-code-input"
                 autocomplete="off"
                 autocapitalize="off"
                 spellcheck="false"
                 inputmode="numeric"
                 pattern="[0-9]*"
                 maxlength="4"
                 placeholder="4 位數字"
                 data-name="${escapeHtml(studentName)}" />
          <button type="button" id="identity-code-submit" class="identity-code-submit">確認</button>
        </div>
        <div id="identity-code-err" class="identity-code-err" hidden></div>
        <div class="identity-code-hint">忘記或還沒收到？請聯絡老師，驗證碼會和你的雲端資料夾連結一起分享給你。</div>
      </div>
    `;
    const input = document.getElementById("identity-code-input");
    if (input) setTimeout(() => input.focus(), 30);
  }

  function openIdentityPicker() {
    renderIdentityPickerList();
    identityModalEl.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function showCodeError(msg) {
    const el = document.getElementById("identity-code-err");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    const input = document.getElementById("identity-code-input");
    if (input) {
      input.classList.add("has-error");
      input.focus();
      input.select();
    }
  }

  function clearCodeError() {
    const el = document.getElementById("identity-code-err");
    if (el) { el.hidden = true; el.textContent = ""; }
    const input = document.getElementById("identity-code-input");
    if (input) input.classList.remove("has-error");
  }

  async function submitStudentCode() {
    const input = document.getElementById("identity-code-input");
    const submitBtn = document.getElementById("identity-code-submit");
    if (!input) return;
    const studentName = input.dataset.name;
    const value = input.value || "";
    if (!value.trim()) {
      showCodeError("請輸入驗證碼");
      return;
    }

    clearCodeError();
    input.disabled = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "驗證中…";
    }

    const result = await verifyStudentCodeRemote(studentName, value);

    input.disabled = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "確認";
    }

    if (!result.ok) {
      showCodeError(`驗證服務連不上：${result.error}。請稍後再試。`);
      return;
    }
    if (!result.valid) {
      showCodeError("驗證碼不正確，再試一次（或確認是不是其他同學的碼）");
      return;
    }

    saveIdentity(studentName, "student");
    refreshIdentityChip();
    closeIdentityPicker();
    if (openedStudentName) renderStudentModalBody(openedStudentName);
  }

  function showGuestError(msg) {
    const el = document.getElementById("identity-guest-err");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }
  function clearGuestError() {
    const el = document.getElementById("identity-guest-err");
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
  }

  function submitGuestForm() {
    const input = document.getElementById("identity-nick-input");
    if (!input) return;
    const raw = (input.value || "").trim();
    if (!raw) {
      showGuestError("請輸入暱稱");
      input.focus();
      return;
    }
    if (raw.length > 20) {
      showGuestError("暱稱最多 20 字");
      input.focus();
      return;
    }
    if (STUDENT_NAME_SET.has(normalizeName(raw))) {
      showGuestError("這個名字跟學生重複了，請換一個（例如加個「老師」「媽媽」）");
      input.focus();
      return;
    }
    const activeRoleBtn = identityListEl.querySelector(".identity-role.active");
    const role = activeRoleBtn ? activeRoleBtn.dataset.role : "guest";
    saveIdentity(raw, role);
    refreshIdentityChip();
    closeIdentityPicker();
    if (openedStudentName) {
      renderStudentModalBody(openedStudentName);
    }
  }

  function closeIdentityPicker() {
    identityModalEl.hidden = true;
    if (modalEl.hidden) document.body.style.overflow = "";
  }

  if (socialEnabled) {
    identityBtn.addEventListener("click", openIdentityPicker);
    identityModalEl.querySelectorAll("[data-close-identity]").forEach(el => {
      el.addEventListener("click", closeIdentityPicker);
    });
    identityListEl.addEventListener("click", (e) => {
      // 1) 學生選單：進入驗證碼步驟（若後端未啟用驗證則直接通過）
      const opt = e.target.closest(".identity-option");
      if (opt) {
        const name = opt.dataset.name;
        if (!codesEnabled) {
          saveIdentity(name, "student");
          refreshIdentityChip();
          closeIdentityPicker();
          if (openedStudentName) renderStudentModalBody(openedStudentName);
        } else {
          renderIdentityCodeStep(name);
        }
        return;
      }
      // 2) 驗證碼步驟：返回名單
      const backBtn = e.target.closest("#identity-code-back");
      if (backBtn) {
        renderIdentityPickerList();
        return;
      }
      // 3) 驗證碼步驟：送出（學生 / 老師）
      const codeSubmit = e.target.closest("#identity-code-submit");
      if (codeSubmit) {
        submitStudentCode();
        return;
      }
      const teacherCodeSubmit = e.target.closest("#identity-teacher-code-submit");
      if (teacherCodeSubmit) {
        submitTeacherCode();
        return;
      }
      // 4) 老師登入按鈕
      const teacherOpt = e.target.closest(".identity-teacher-option");
      if (teacherOpt) {
        const teacherName = teacherOpt.dataset.teacherName;
        const meta = serverTeachers.find(t => t.name === teacherName);
        renderIdentityTeacherCodeStep(teacherName, meta && meta.label);
        return;
      }
      // 5) 老師登出
      const logoutBtn = e.target.closest("#identity-teacher-logout");
      if (logoutBtn) {
        clearTeacherSession();
        refreshTeacherUiState();
        renderIdentityPickerList();
        return;
      }
      // 6) 訪客：切換角色
      const roleBtn = e.target.closest(".identity-role");
      if (roleBtn) {
        identityListEl.querySelectorAll(".identity-role").forEach(b => b.classList.remove("active"));
        roleBtn.classList.add("active");
        clearGuestError();
        return;
      }
      // 7) 訪客：送出暱稱
      const submit = e.target.closest("#identity-nick-submit");
      if (submit) {
        submitGuestForm();
        return;
      }
    });
    identityListEl.addEventListener("input", (e) => {
      if (e.target.id === "identity-nick-input") clearGuestError();
      if (e.target.id === "identity-code-input") clearCodeError();
      if (e.target.id === "identity-teacher-code-input") clearTeacherCodeError();
    });
    identityListEl.addEventListener("keydown", (e) => {
      if (e.target.id === "identity-nick-input" && e.key === "Enter") {
        e.preventDefault();
        submitGuestForm();
      }
      if (e.target.id === "identity-code-input" && e.key === "Enter") {
        e.preventDefault();
        submitStudentCode();
      }
      if (e.target.id === "identity-teacher-code-input" && e.key === "Enter") {
        e.preventDefault();
        submitTeacherCode();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !identityModalEl.hidden) closeIdentityPicker();
    });
  }

  function closeModal() {
    modalEl.hidden = true;
    document.body.style.overflow = "";
    openedStudentName = null;
  }

  document.querySelectorAll("[data-close-modal]").forEach(el => {
    el.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalEl.hidden) closeModal();
  });

  // ---------- 歷屆作品參考（Inspiration） ----------
  // 資料來源：inspiration/manifest.json，由 tools/build-inspiration.py 產生
  // 行為：依學長姐分組、可橫向滑動的小輪播；點圖開 lightbox，可左右翻同一位的其他海報
  const INSPIRATION_MANIFEST_URL = "inspiration/manifest.json";
  const INSPIRATION_BASE = "inspiration/";

  const inspirationSectionEl = document.getElementById("inspiration-section");
  const inspirationContainerEl = document.getElementById("inspiration-container");
  const inspirationSubEl = document.getElementById("inspiration-sub");
  const lightboxEl = document.getElementById("inspiration-lightbox");
  const lightboxImgEl = document.getElementById("inspiration-lightbox-img");
  const lightboxCaptionEl = document.getElementById("inspiration-lightbox-caption");
  const lightboxPrevBtn = lightboxEl ? lightboxEl.querySelector("[data-lightbox-prev]") : null;
  const lightboxNextBtn = lightboxEl ? lightboxEl.querySelector("[data-lightbox-next]") : null;

  let inspirationStudents = [];
  let lightboxState = null; // { studentIndex, fileIndex }

  async function loadInspiration() {
    if (!inspirationContainerEl) return;
    try {
      const res = await fetch(INSPIRATION_MANIFEST_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const students = Array.isArray(data && data.students) ? data.students : [];
      inspirationStudents = students.filter(s => s && Array.isArray(s.files) && s.files.length > 0);
      renderInspiration();
    } catch (err) {
      // 沒有 manifest（例如老師還沒跑 build script）就直接隱藏整區
      console.info("[inspiration] 沒有讀到 manifest，跳過渲染：", err.message || err);
      inspirationSectionEl.hidden = true;
    }
  }

  function renderInspiration() {
    if (!inspirationContainerEl) return;
    if (!inspirationStudents.length) {
      inspirationSectionEl.hidden = true;
      return;
    }

    const totalPosters = inspirationStudents.reduce((n, s) => n + s.files.length, 0);
    if (inspirationSubEl) {
      inspirationSubEl.textContent =
        `${inspirationStudents.length} 位學長姐 · ${totalPosters} 張海報 · 點圖看大圖`;
    }

    const cardHtml = (s, sIdx) => {
      const cover = s.files[0];
      const countLabel = s.files.length > 1 ? `${s.files.length} 張` : "1 張";
      return `
        <button class="inspiration-card"
                type="button"
                data-student-idx="${sIdx}"
                aria-label="開啟 ${escapeHtml(s.name)} 的 ${s.files.length} 張海報">
          <div class="inspiration-card-media">
            <img src="${escapeHtml(INSPIRATION_BASE + cover)}"
                 alt="${escapeHtml(s.name)} 的海報"
                 loading="lazy"
                 decoding="async" />
            ${s.files.length > 1
              ? `<span class="inspiration-card-count">${countLabel}</span>`
              : ""}
          </div>
          <div class="inspiration-card-foot">
            <span class="inspiration-card-name">${escapeHtml(s.name)}</span>
            <span class="inspiration-card-meta">${countLabel}</span>
          </div>
        </button>
      `;
    };

    // 依姓名順序平均分到 3 列，每列獨立橫向捲軸（27 → 9 / 9 / 9；不整除時前面的列會多一張）
    const ROWS = 3;
    const total = inspirationStudents.length;
    const baseCount = Math.ceil(total / ROWS);
    const rows = [];
    for (let r = 0; r < ROWS; r++) {
      const start = r * baseCount;
      const slice = inspirationStudents
        .slice(start, start + baseCount)
        .map((s, i) => ({ s, originalIdx: start + i }));
      if (slice.length) rows.push(slice);
    }

    inspirationContainerEl.innerHTML = rows.map(row => `
      <div class="inspiration-row">
        ${row.map(({ s, originalIdx }) => cardHtml(s, originalIdx)).join("")}
      </div>
    `).join("");

    inspirationSectionEl.hidden = false;
  }

  function openLightbox(studentIndex, fileIndex) {
    if (!lightboxEl) return;
    const s = inspirationStudents[studentIndex];
    if (!s || !s.files[fileIndex]) return;
    lightboxState = { studentIndex, fileIndex };
    updateLightbox();
    lightboxEl.hidden = false;
    lightboxEl.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function updateLightbox() {
    if (!lightboxState) return;
    const { studentIndex, fileIndex } = lightboxState;
    const s = inspirationStudents[studentIndex];
    if (!s) return;
    const file = s.files[fileIndex];
    lightboxImgEl.src = INSPIRATION_BASE + file;
    lightboxImgEl.alt = `${s.name} 的海報 ${fileIndex + 1}`;
    lightboxCaptionEl.textContent = s.files.length > 1
      ? `${s.name} · ${fileIndex + 1} / ${s.files.length}`
      : s.name;
    const onlyOne = s.files.length <= 1;
    if (lightboxPrevBtn) lightboxPrevBtn.hidden = onlyOne;
    if (lightboxNextBtn) lightboxNextBtn.hidden = onlyOne;
  }

  function closeLightbox() {
    if (!lightboxEl || lightboxEl.hidden) return;
    lightboxEl.hidden = true;
    lightboxEl.setAttribute("aria-hidden", "true");
    lightboxImgEl.src = "";
    lightboxState = null;
    if (modalEl.hidden && identityModalEl.hidden) {
      document.body.style.overflow = "";
    }
  }

  function lightboxStep(delta) {
    if (!lightboxState) return;
    const s = inspirationStudents[lightboxState.studentIndex];
    if (!s) return;
    const len = s.files.length;
    if (len <= 1) return;
    lightboxState.fileIndex = (lightboxState.fileIndex + delta + len) % len;
    updateLightbox();
  }

  if (inspirationContainerEl) {
    inspirationContainerEl.addEventListener("click", (e) => {
      const card = e.target.closest(".inspiration-card");
      if (!card) return;
      const sIdx = Number(card.dataset.studentIdx);
      if (Number.isFinite(sIdx)) openLightbox(sIdx, 0);
    });
  }

  if (lightboxEl) {
    lightboxEl.querySelectorAll("[data-close-lightbox]").forEach(el => {
      el.addEventListener("click", closeLightbox);
    });
    if (lightboxPrevBtn) lightboxPrevBtn.addEventListener("click", () => lightboxStep(-1));
    if (lightboxNextBtn) lightboxNextBtn.addEventListener("click", () => lightboxStep(1));
    document.addEventListener("keydown", (e) => {
      if (lightboxEl.hidden) return;
      if (e.key === "Escape") { closeLightbox(); return; }
      if (e.key === "ArrowLeft")  { lightboxStep(-1); return; }
      if (e.key === "ArrowRight") { lightboxStep(1); return; }
    });
  }

  // ---------- 老師面板：繳交狀況 ----------
  // 流程：
  //   - 老師通過 verifyTeacher 後，{name, code} 存到 localStorage 的 TEACHER_STORAGE_KEY
  //   - 若後端 SUBMISSION_DASHBOARD_PUBLIC：任何人可開 📊，POST 不必帶驗證碼
  //   - 否則僅 isAdmin() 可開，且每次 POST getSubmissionStatus 後端再驗一次
  //   - 開著 modal 時每 N 秒自動刷新，方便老師看即時繳交動態
  const teacherDashBtn = document.getElementById("teacher-dash-btn");
  const teacherModalEl = document.getElementById("teacher-modal");
  const teacherModalBodyEl = document.getElementById("teacher-modal-body");
  const teacherRefreshBtn = document.getElementById("teacher-refresh-btn");
  const TEACHER_REFRESH_INTERVAL_MS = 15000;
  let teacherStatusCache = null;
  let teacherFetchInflight = false;
  let teacherRefreshTimer = null;

  function refreshTeacherUiState() {
    if (!teacherDashBtn) return;
    // 展覽模式下強制隱藏管理按鈕，即使後端說可以顯示也不外露
    if (PUBLIC_VIEW_MODE) {
      teacherDashBtn.hidden = true;
      return;
    }
    const showBtn =
      socialEnabled &&
      (submissionDashboardPublic || (isAdmin() && serverTeachers.length > 0));
    teacherDashBtn.hidden = !showBtn;
    // 若伺服器名單突然不見了（老師被移除）、或本地 session 與伺服器不對應，自動清掉
    if (isAdmin()) {
      const stillThere = serverTeachers.some(
        t => normalizeName(t.name) === normalizeName(teacherSession.name)
      );
      if (!stillThere && serverTeachers.length > 0) {
        clearTeacherSession();
        if (!submissionDashboardPublic) {
          teacherDashBtn.hidden = true;
          if (teacherModalEl && !teacherModalEl.hidden) closeTeacherDashboard();
        }
      }
    }
  }

  function openTeacherDashboard() {
    if (!teacherModalEl) return;
    if (!submissionDashboardPublic && !isAdmin()) {
      openIdentityPicker();
      return;
    }
    teacherModalEl.hidden = false;
    document.body.style.overflow = "hidden";
    if (teacherStatusCache) {
      renderTeacherDashboard(teacherStatusCache);
    } else {
      teacherModalBodyEl.innerHTML = `<div class="teacher-loading">載入中…</div>`;
    }
    fetchTeacherStatus();
    startTeacherAutoRefresh();
  }

  function closeTeacherDashboard() {
    if (!teacherModalEl || teacherModalEl.hidden) return;
    teacherModalEl.hidden = true;
    stopTeacherAutoRefresh();
    if (modalEl.hidden && identityModalEl.hidden && (!lightboxEl || lightboxEl.hidden)) {
      document.body.style.overflow = "";
    }
  }

  function startTeacherAutoRefresh() {
    stopTeacherAutoRefresh();
    teacherRefreshTimer = setInterval(() => {
      if (document.hidden) return;
      fetchTeacherStatus({ silent: true });
    }, TEACHER_REFRESH_INTERVAL_MS);
  }

  function stopTeacherAutoRefresh() {
    if (teacherRefreshTimer) {
      clearInterval(teacherRefreshTimer);
      teacherRefreshTimer = null;
    }
  }

  async function fetchTeacherStatus(opts) {
    if (!socialEnabled) return;
    if (!submissionDashboardPublic && !isAdmin()) return;
    if (teacherFetchInflight) return;
    teacherFetchInflight = true;
    const silent = opts && opts.silent;
    if (teacherRefreshBtn) {
      teacherRefreshBtn.classList.add("is-loading");
      teacherRefreshBtn.disabled = true;
    }
    try {
      const res = await fetch(CONFIG.appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "getSubmissionStatus",
          name: isAdmin() ? teacherSession.name : "",
          code: isAdmin() ? teacherSession.code : "",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.ok) {
        if (json.error === "unauthorized") {
          if (!submissionDashboardPublic) {
            clearTeacherSession();
            refreshTeacherUiState();
          }
          renderTeacherDashboardError("登入失效，請重新登入老師面板。");
          return;
        }
        throw new Error(json.error || "載入失敗");
      }
      teacherStatusCache = json;
      renderTeacherDashboard(json);
    } catch (err) {
      console.warn("[teacher] fetch failed", err);
      if (!silent || !teacherStatusCache) {
        renderTeacherDashboardError(`載入失敗：${err.message || err}`);
      }
    } finally {
      teacherFetchInflight = false;
      if (teacherRefreshBtn) {
        teacherRefreshBtn.classList.remove("is-loading");
        teacherRefreshBtn.disabled = false;
      }
    }
  }

  function renderTeacherDashboardError(msg) {
    if (!teacherModalBodyEl) return;
    teacherModalBodyEl.innerHTML = `
      <div class="teacher-error">
        <p>${escapeHtml(msg)}</p>
        <button type="button" class="btn btn-ghost" id="teacher-error-retry">重試</button>
      </div>
    `;
    const btn = document.getElementById("teacher-error-retry");
    if (btn) btn.addEventListener("click", () => fetchTeacherStatus());
  }

  function fmtTeacherTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const pad = n => String(n).padStart(2, "0");
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function renderTeacherDashboard(data) {
    if (!teacherModalBodyEl) return;
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const students = Array.isArray(data.students) ? data.students : [];
    const totals = data.totals || {};
    const unmatched = Array.isArray(data.unmatched) ? data.unmatched : [];
    const generated = fmtTeacherTime(data.generatedAt);

    if (tasks.length === 0) {
      teacherModalBodyEl.innerHTML = `
        <div class="teacher-empty">
          <p>目前 REQUIRED_TASKS 是空的。</p>
          <p class="teacher-empty-hint">到 apps-script.gs 把要追蹤的任務（例如 <code>任務零</code>）加進 <code>REQUIRED_TASKS</code> 陣列，然後重新部署即可。</p>
        </div>
      `;
      return;
    }

    // ---- 統計列 ----
    const summaryHtml = `
      <div class="teacher-summary">
        ${tasks.map(t => {
          const tot = totals[t.id] || { done: 0, missing: students.length };
          const pct = students.length ? Math.round((tot.done / students.length) * 100) : 0;
          return `
            <div class="teacher-summary-card">
              <div class="teacher-summary-label">${escapeHtml(t.label)}</div>
              <div class="teacher-summary-value">${tot.done}<span class="teacher-summary-divider">/</span>${students.length}</div>
              <div class="teacher-summary-bar"><div class="teacher-summary-bar-fill" style="width:${pct}%"></div></div>
              <div class="teacher-summary-meta">${pct}% 已交 · 還差 ${tot.missing} 人</div>
            </div>
          `;
        }).join("")}
      </div>
    `;

    // ---- 矩陣 ----
    // 班級顏色：用同一份 CONFIG.classes 設定
    const classOfNorm = STUDENT_TO_CLASS;  // map: normalizedName -> classId
    const rowsHtml = students.map(s => {
      const cls = classOfNorm.get(normalizeName(s.name)) || "";
      const clsInfo = cls ? getClassInfo(cls) : null;
      const clsCell = clsInfo
        ? `<span class="teacher-cell-class" style="--cls-color:${clsInfo.color}">${escapeHtml(clsInfo.id)}</span>`
        : `<span class="teacher-cell-class teacher-cell-class--none">—</span>`;
      const tdTasks = tasks.map(t => {
        const st = s.status && s.status[t.id];
        // pdfCount 模式：後端會多回一個 requirement 字串（例如「至少 2 個 PDF」）
        // 用它區分 tooltip 與 cell 顯示
        const isPdfMode = st && typeof st.requirement === "string";
        const titlesAttr = (st && st.titles ? st.titles : []).join(" · ");
        const detailLabel = isPdfMode ? "檔名" : "標題";

        if (!st || !st.done) {
          // 未交。pdfCount 模式如果已經傳了部分 PDF（只是還沒滿要求數），顯示進度
          if (isPdfMode && st && st.count > 0) {
            const tip = `${st.requirement} · 目前 ${st.count} 個` +
              (titlesAttr ? `\n${detailLabel}：${titlesAttr}` : "");
            return `<td class="teacher-cell teacher-cell--missing" data-task="${escapeHtml(t.id)}" title="${escapeHtml(tip)}">
              <span class="teacher-check teacher-check--no" aria-label="未交">✗</span>
              <span class="teacher-cell-time">${st.count} 個 PDF</span>
            </td>`;
          }
          const missTip = isPdfMode && st ? st.requirement : "";
          return `<td class="teacher-cell teacher-cell--missing" data-task="${escapeHtml(t.id)}"${missTip ? ` title="${escapeHtml(missTip)}"` : ""}><span class="teacher-check teacher-check--no" aria-label="未交">✗</span></td>`;
        }
        const lastLabel = st.lastTime ? fmtTeacherTime(st.lastTime) : "";
        const countBadge = st.count > 1 ? `<span class="teacher-cell-count" title="共 ${st.count} 個">×${st.count}</span>` : "";
        const tooltip = lastLabel
          ? `最後一次：${lastLabel}${titlesAttr ? `\n${detailLabel}：${titlesAttr}` : ""}`
          : titlesAttr;
        return `<td class="teacher-cell teacher-cell--done" data-task="${escapeHtml(t.id)}" title="${escapeHtml(tooltip)}">
          <span class="teacher-check teacher-check--yes" aria-label="已交">✓</span>
          ${lastLabel ? `<span class="teacher-cell-time">${escapeHtml(lastLabel)}</span>` : ""}
          ${countBadge}
        </td>`;
      }).join("");
      return `
        <tr>
          <td class="teacher-cell-name">${clsCell} <span class="teacher-cell-namelabel">${escapeHtml(s.name)}</span></td>
          ${tdTasks}
        </tr>
      `;
    }).join("");

    const matrixHtml = `
      <div class="teacher-matrix-wrap">
        <table class="teacher-matrix">
          <thead>
            <tr>
              <th class="teacher-cell-name">學生</th>
              ${tasks.map(t => `<th>${escapeHtml(t.label)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;

    // ---- 還沒交的清單 ----
    const missingHtml = tasks.map(t => {
      const list = students.filter(s => !(s.status && s.status[t.id] && s.status[t.id].done));
      if (list.length === 0) {
        return `<div class="teacher-missing-block teacher-missing-block--clear">
          <strong>${escapeHtml(t.label)}</strong> · 🎉 全班都交了
        </div>`;
      }
      const names = list.map(s => escapeHtml(s.name)).join("、");
      return `<div class="teacher-missing-block">
        <div class="teacher-missing-head"><strong>${escapeHtml(t.label)}</strong>還沒交（${list.length}）：</div>
        <div class="teacher-missing-names">${names}</div>
      </div>`;
    }).join("");

    // ---- 未對應到名單的姓名（協助修正） ----
    const unmatchedHtml = unmatched.length > 0 ? `
      <div class="teacher-unmatched">
        <div class="teacher-unmatched-head">⚠️ 試算表裡有這些姓名，但不在學生名單裡，沒有列進矩陣：</div>
        <div class="teacher-unmatched-names">${unmatched.map(escapeHtml).join("、")}</div>
        <div class="teacher-unmatched-hint">請確認 config.js / 表單下拉選單 / STUDENTS_PRIVATE 中的姓名是否一字不差。</div>
      </div>
    ` : "";

    teacherModalBodyEl.innerHTML = `
      <div class="teacher-meta">
        <span>共 ${students.length} 位學生 · ${tasks.length} 項必交</span>
        ${generated ? `<span class="teacher-generated">資料更新時間：${escapeHtml(generated)}</span>` : ""}
      </div>
      ${summaryHtml}
      ${matrixHtml}
      <div class="teacher-section-title">還沒交的</div>
      ${missingHtml}
      ${unmatchedHtml}
    `;
  }

  if (teacherDashBtn) {
    teacherDashBtn.addEventListener("click", openTeacherDashboard);
  }
  if (teacherModalEl) {
    teacherModalEl.querySelectorAll("[data-close-teacher]").forEach(el => {
      el.addEventListener("click", closeTeacherDashboard);
    });
  }
  if (teacherRefreshBtn) {
    teacherRefreshBtn.addEventListener("click", () => fetchTeacherStatus());
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && teacherModalEl && !teacherModalEl.hidden) closeTeacherDashboard();
  });

  // ---------- 主流程 ----------
  async function load() {
    setStatus("warn", "更新中…");
    try {
      const raw = await fetchSheetData();

      // 大頭貼類型的條目抽出來獨立維護；不進 feed、不進作品計數
      avatarsByStudent = new Map();
      const entries = [];
      for (const e of raw) {
        if (isAvatarEntry(e)) {
          const key = normalizeName(e.student);
          const existing = avatarsByStudent.get(key);
          if (!existing || (e.timestamp instanceof Date && existing.timestamp < e.timestamp)) {
            avatarsByStudent.set(key, e);
          }
        } else {
          entries.push(e);
        }
      }
      allEntries = entries;

      entriesByStudent = new Map();
      for (const s of CONFIG.students || []) entriesByStudent.set(normalizeName(s.name), []);

      const configNameSet = new Set((CONFIG.students || []).map(s => normalizeName(s.name)));
      const unmatched = new Set();
      for (const e of entries) {
        const key = normalizeName(e.student);
        if (!configNameSet.has(key)) unmatched.add(e.student);
        if (!entriesByStudent.has(key)) {
          entriesByStudent.set(key, []);
        }
        entriesByStudent.get(key).push(e);
      }
      for (const arr of entriesByStudent.values()) {
        arr.sort((a, b) => b.timestamp - a.timestamp);
      }

      if (unmatched.size > 0) {
        console.warn(
          "[student-showcase] 以下姓名出現在試算表但不在 config.js 的 students 裡，不會出現在對應班級的格子中：\n" +
          [...unmatched].map(n => `  - "${n}"`).join("\n") +
          "\n請把 config.js 裡的姓名改成與表單／試算表完全一致（含空白）。"
        );
      }

      render();
      setStatus("ok", `已更新 · 共 ${entries.length} 則產出`);
      lastUpdatedEl.textContent = `最後更新：${new Date().toLocaleTimeString("zh-TW")}`;
    } catch (err) {
      console.error(err);
      setStatus("err", `載入失敗：${err.message}`);
      // 即使載入失敗，也先把篩選列和學生格子的空狀態渲染出來，讓老師知道版面長什麼樣
      render();
    }
  }

  document.getElementById("refresh-btn").addEventListener("click", () => {
    // 手動刷新：忽略 idle / 隱藏狀態，強制執行一輪
    dataPoller.runNow();
    socialPoller.runNow();
  });

  // ---------- 智慧排程：頁籤隱藏 / 使用者閒置時自動暫停 ----------
  // 目的：避免「掛網但沒人看」的情境下持續打 Google Sheets / Apps Script，
  //      減少 CPU、網路與後端 quota 消耗。整體行為：
  //   - document.hidden（切到別的分頁／視窗最小化）→ 完全暫停輪詢
  //   - 使用者超過 IDLE_AFTER_MS 沒任何動作 → 暫停輪詢
  //   - 任一條件解除（回到頁面 / 重新有動作）→ 立刻抓一次，再恢復常態節奏
  //   - 自己按 emoji 或留言：採樂觀更新（既有邏輯），不依賴輪詢即可看到變化
  const IDLE_AFTER_MS = 10 * 60 * 1000; // 10 分鐘沒動算閒置

  function makeSmartPoller(fn, intervalSeconds, label) {
    const intervalMs = Math.max(5, intervalSeconds) * 1000;
    let timerId = null;
    let lastRunAt = 0;
    let lastActivityAt = Date.now();
    let inflight = false;

    function isActiveTab() { return !document.hidden; }
    function isIdle() { return Date.now() - lastActivityAt > IDLE_AFTER_MS; }
    function shouldRun() { return isActiveTab() && !isIdle(); }

    async function tick(forceImmediate = false) {
      if (!forceImmediate && !shouldRun()) return;
      if (inflight) return;
      inflight = true;
      lastRunAt = Date.now();
      try {
        await fn();
      } catch (err) {
        console.warn(`[poller:${label}] tick failed`, err);
      } finally {
        inflight = false;
      }
    }

    function runIfStale() {
      if (Date.now() - lastRunAt >= intervalMs) tick();
    }

    function start() {
      if (timerId) return;
      tick();
      timerId = setInterval(tick, intervalMs);
    }

    function noteActivity() {
      const wasIdle = isIdle();
      lastActivityAt = Date.now();
      if (wasIdle && isActiveTab()) runIfStale();
    }

    function noteVisibilityChange() {
      if (isActiveTab()) runIfStale();
    }

    return {
      start,
      runNow: () => tick(true),
      noteActivity,
      noteVisibilityChange,
    };
  }

  const dataPoller = makeSmartPoller(load, CONFIG.refreshIntervalSeconds, "data");
  const socialPoller = socialEnabled
    ? makeSmartPoller(fetchSocial, CONFIG.socialRefreshIntervalSeconds || 10, "social")
    : null;

  // 全域 activity 監聽：throttle 成每 5 秒最多通知一次 poller
  let lastActivityNotify = 0;
  function onUserActivity() {
    const now = Date.now();
    if (now - lastActivityNotify < 5000) return;
    lastActivityNotify = now;
    dataPoller.noteActivity();
    if (socialPoller) socialPoller.noteActivity();
  }
  ["mousemove", "keydown", "scroll", "touchstart", "click"].forEach(evt => {
    window.addEventListener(evt, onUserActivity, { passive: true });
  });

  document.addEventListener("visibilitychange", () => {
    dataPoller.noteVisibilityChange();
    if (socialPoller) socialPoller.noteVisibilityChange();
  });

  // 初始化身分 chip 與社交功能
  refreshIdentityChip();
  refreshTeacherUiState();

  dataPoller.start();
  if (socialPoller) socialPoller.start();

  // 學長姐海報是靜態素材，載入一次即可（後續更新請重跑 tools/build-inspiration.py 並重新部署）
  loadInspiration();
})();
