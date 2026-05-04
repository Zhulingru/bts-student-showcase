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

  function getClassInfo(classId) {
    return CLASS_BY_ID.get(classId) || { id: classId, label: classId || "未分班", color: "#8a93a6" };
  }

  // ---------- 身分管理（localStorage，弱實名）----------
  const IDENTITY_STORAGE_KEY = "bts-showcase-identity-v1";
  const GUEST_MODE_ENABLED = Boolean(CONFIG.guestModeEnabled);
  const GUEST_ROLES = Array.isArray(CONFIG.guestRoles) ? CONFIG.guestRoles : [];
  const GUEST_ROLE_BY_ID = new Map(GUEST_ROLES.map(r => [r.id, r]));
  let identity = loadIdentity();

  function loadIdentity() {
    try {
      const raw = localStorage.getItem(IDENTITY_STORAGE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.userId || !obj.userName) return null;
      if (!obj.role) obj.role = "student";
      return obj;
    } catch (_) {
      return null;
    }
  }

  function saveIdentity(name, role) {
    const existing = loadIdentity();
    const next = {
      userId: (existing && existing.userId) || generateUuid(),
      userName: name,
      role: role || "student",
    };
    localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(next));
    identity = next;
    return next;
  }

  function generateUuid() {
    if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return "u-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
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
  document.getElementById("refresh-interval-label").textContent = CONFIG.refreshIntervalSeconds;

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

  function extractDriveFileId(url) {
    if (!url || typeof url !== "string") return null;
    const patterns = [
      /\/file\/d\/([a-zA-Z0-9_-]+)/,
      /[?&]id=([a-zA-Z0-9_-]+)/,
      /\/d\/([a-zA-Z0-9_-]+)/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  }

  function driveThumb(fileId, width = 800) {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${width}`;
  }

  function driveOpenUrl(fileId) {
    return `https://drive.google.com/file/d/${fileId}/view`;
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

  function getMediaHtml(entry, width = 800) {
    const fileId = extractDriveFileId(entry.fileUrl);

    if (fileId) {
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

    if (entry.linkUrl) return `<div class="fallback">🔗</div>`;
    return `<div class="fallback">📝</div>`;
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

    return `
      <div class="student-card" data-student="${escapeHtml(student.name)}">
        <span class="class-ribbon" style="background:${cls.color}">${escapeHtml(student.class)}</span>
        <div class="thumb">${thumbHtml}</div>
        <div class="info">
          <span class="name">${escapeHtml(student.name)}</span>
          <span class="count ${count === 0 ? "zero" : ""}">${count}</span>
        </div>
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
    modalTitleEl.innerHTML = `${avatarHtml}<span class="modal-title-text">${escapeHtml(studentName)}${classTag} <span style="color:var(--text-soft);font-weight:400;font-size:14px">· 共 ${entries.length} 則產出</span></span>`;

    const bioHtml = renderStudentBioSection(studentName);
    let worksHtml = "";
    if (entries.length === 0) {
      worksHtml = `<div class="placeholder student-works-placeholder">這位同學還沒有上傳任何產出</div>`;
    } else {
      worksHtml = entries.map(entry => renderEntryDetail(entry)).join("");
    }

    modalBodyEl.innerHTML = bioHtml + worksHtml;
  }

  /** 學生詳情側欄縮圖：圖片用 cover；影片先試 Drive 縮圖；文件用版型化佔位（Drive 常回傳很小的圖示） */
  function renderEntryMediaBlock(entry) {
    const fileId = extractDriveFileId(entry.fileUrl);
    if (fileId) {
      if (isImageType(entry.type)) {
        return `<img src="${driveThumb(fileId, 800)}" alt="${escapeHtml(entry.title)}" />`;
      }
      if (isDocType(entry.type)) {
        return `<div class="entry-media-placeholder entry-media-placeholder--doc" role="img" aria-label="檔案：文件">
          <span class="entry-media-placeholder-icon" aria-hidden="true">📄</span>
          <span class="entry-media-placeholder-label">文件預覽</span>
          <span class="entry-media-placeholder-hint">請點下方「在 Drive 開啟」瀏覽完整內容</span>
        </div>`;
      }
      if (isVideoType(entry.type)) {
        return `<div class="entry-media-stack">
          <img class="entry-drive-thumb" src="${driveThumb(fileId, 800)}" alt="" loading="lazy"
            onerror="this.classList.add('is-hidden');var p=this.nextElementSibling;if(p){p.classList.remove('is-hidden');p.setAttribute('aria-hidden','false');}" />
          <div class="entry-media-placeholder entry-media-placeholder--video is-hidden" aria-hidden="true">
            <span class="entry-media-placeholder-icon" aria-hidden="true">🎬</span>
            <span class="entry-media-placeholder-label">影片</span>
            <span class="entry-media-placeholder-hint">請點「在 Drive 開啟」播放</span>
          </div>
        </div>`;
      }
      return `<img src="${driveThumb(fileId, 800)}" alt="${escapeHtml(entry.title)}" />`;
    }
    if (entry.linkUrl) {
      return `<div class="entry-media-placeholder entry-media-placeholder--link" role="img" aria-label="連結項目">
        <span class="entry-media-placeholder-icon" aria-hidden="true">🔗</span>
        <span class="entry-media-placeholder-label">連結</span>
        <span class="entry-media-placeholder-hint">點下方「外部連結」前往</span>
      </div>`;
    }
    return `<div class="entry-media-placeholder entry-media-placeholder--note" role="img" aria-label="文字項目">
      <span class="entry-media-placeholder-icon" aria-hidden="true">📝</span>
      <span class="entry-media-placeholder-label">文字／其他</span>
    </div>`;
  }

  function renderEntryDetail(entry) {
    const fileId = extractDriveFileId(entry.fileUrl);
    const mediaBlock = renderEntryMediaBlock(entry);

    const links = [];
    if (fileId) {
      links.push(`<a href="${driveOpenUrl(fileId)}" target="_blank" rel="noopener">在 Drive 開啟</a>`);
    }
    if (entry.linkUrl) {
      links.push(`<a href="${escapeHtml(entry.linkUrl)}" target="_blank" rel="noopener">外部連結 ↗</a>`);
    }

    const reactionsHtml = socialEnabled ? renderReactionsBar(entry) : "";
    const commentsHtml = socialEnabled ? renderCommentsSection(entry) : "";

    return `
      <div class="entry">
        <div class="entry-media">${mediaBlock}</div>
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
    const disabled = !identity;
    const title = disabled ? "title=\"請先從右上角『選擇身分』\"" : "";

    return `
      <div class="reactions-bar" data-entry-id="${escapeHtml(entryId)}">
        ${emojis.map(emoji => {
          const count = counts[emoji] || 0;
          const active = userHasReacted(entryId, emoji);
          return `
            <button type="button"
                    class="reaction-btn ${active ? "active" : ""}"
                    data-emoji="${escapeHtml(emoji)}"
                    ${disabled ? "disabled" : ""} ${title}>
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
    const disabled = !identity;

    return `
      <div class="comments-section" data-entry-id="${escapeHtml(entryId)}">
        <div class="comments-heading">
          <span class="label">留言</span>
          <span class="count">${list.length} 則</span>
        </div>
        <div class="comment-list">${renderCommentListItems(list)}</div>
        <form class="comment-form" data-entry-id="${escapeHtml(entryId)}">
          <textarea
            placeholder="${disabled ? "請先從右上角「選擇身分」" : "分享你的想法…（最多 200 字）"}"
            maxlength="200"
            rows="1"
            ${disabled ? "disabled" : ""}></textarea>
          <button type="submit" ${disabled ? "disabled" : ""}>送出</button>
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
          btn.disabled = !identity;
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
    if (!identity) { openIdentityPicker(); return; }
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
    if (!identity) { openIdentityPicker(); return; }
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

  // 所有學生姓名（normalized），給訪客表單做重名檢查
  const STUDENT_NAME_SET = new Set((CONFIG.students || []).map(s => normalizeName(s.name)));

  // ---------- 學生驗證碼（後端驗證）----------
  // 驗證碼本身不在前端，而是在 Apps Script 的 STUDENTS_PRIVATE 裡（私密、不進 GitHub）。
  // 前端只做兩件事：
  //   1. 從 doGet 回傳的 codesEnabled 旗標得知是否要跳驗證碼步驟
  //   2. 把學生輸入的碼 POST 給 Apps Script，由後端回報 valid: true / false
  // 若 Apps Script 未設定（socialEnabled = false），就沒有互動功能也不需要驗證。
  // 預設值跟著 socialEnabled 走；待 fetchSocial() 第一次回來後，會依後端實際狀態再更新。
  let codesEnabled = socialEnabled;

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
    const studentHtml = CLASSES.map(cls => {
      const students = (CONFIG.students || []).filter(s => s.class === cls.id);
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

    identityListEl.innerHTML = studentHtml + renderGuestFormHtml();
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
      // 3) 驗證碼步驟：送出
      const codeSubmit = e.target.closest("#identity-code-submit");
      if (codeSubmit) {
        submitStudentCode();
        return;
      }
      // 4) 訪客：切換角色
      const roleBtn = e.target.closest(".identity-role");
      if (roleBtn) {
        identityListEl.querySelectorAll(".identity-role").forEach(b => b.classList.remove("active"));
        roleBtn.classList.add("active");
        clearGuestError();
        return;
      }
      // 5) 訪客：送出暱稱
      const submit = e.target.closest("#identity-nick-submit");
      if (submit) {
        submitGuestForm();
        return;
      }
    });
    identityListEl.addEventListener("input", (e) => {
      if (e.target.id === "identity-nick-input") clearGuestError();
      if (e.target.id === "identity-code-input") clearCodeError();
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
    load();
    fetchSocial();
  });

  // 初始化身分 chip 與社交功能
  refreshIdentityChip();

  load();
  setInterval(load, Math.max(10, CONFIG.refreshIntervalSeconds) * 1000);

  if (socialEnabled) {
    fetchSocial();
    const socialInterval = Math.max(5, CONFIG.socialRefreshIntervalSeconds || 10);
    setInterval(fetchSocial, socialInterval * 1000);
  }
})();
