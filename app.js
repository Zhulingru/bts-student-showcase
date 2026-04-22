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
  let identity = loadIdentity();

  function loadIdentity() {
    try {
      const raw = localStorage.getItem(IDENTITY_STORAGE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.userId || !obj.userName) return null;
      return obj;
    } catch (_) {
      return null;
    }
  }

  function saveIdentity(name) {
    const existing = loadIdentity();
    const next = {
      userId: (existing && existing.userId) || generateUuid(),
      userName: name,
    };
    localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(next));
    identity = next;
    return next;
  }

  function generateUuid() {
    if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return "u-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
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

  function formatTime(d) {
    if (!(d instanceof Date) || isNaN(d)) return "";
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return "剛剛";
    if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`;
    if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} 天前`;
    return d.toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
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
    feedSubEl.textContent = `${filterLabel}最近的 ${Math.min(latest.length, 12)} 則產出`;

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
          ${getMediaHtml(entry, 600)}
          <span class="type-badge">${escapeHtml(typeBadge(entry.type))}</span>
          ${classBadge}
        </div>
        <div class="body">
          <div class="author">
            <span class="avatar">${escapeHtml(getInitials(entry.student))}</span>
            <span>${escapeHtml(entry.student)}</span>
          </div>
          <div class="title">${escapeHtml(entry.title)}</div>
          <div class="timestamp">${formatTime(entry.timestamp)}</div>
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
    const thumbHtml = latest
      ? getMediaHtml(latest, 400)
      : `<span class="empty">尚未上傳</span>`;

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
    modalTitleEl.innerHTML = `${escapeHtml(studentName)}${classTag} <span style="color:var(--text-soft);font-weight:400;font-size:14px">· 共 ${entries.length} 則產出</span>`;

    if (entries.length === 0) {
      modalBodyEl.innerHTML = `<div class="placeholder">這位同學還沒有上傳任何產出</div>`;
    } else {
      modalBodyEl.innerHTML = entries.map(entry => renderEntryDetail(entry)).join("");
    }
  }

  function renderEntryDetail(entry) {
    const fileId = extractDriveFileId(entry.fileUrl);
    let mediaBlock = "";

    if (fileId) {
      if (isImageType(entry.type)) {
        mediaBlock = `<img src="${driveThumb(fileId, 800)}" alt="${escapeHtml(entry.title)}" />`;
      } else if (isVideoType(entry.type) || isDocType(entry.type)) {
        mediaBlock = `<div class="fallback">${isVideoType(entry.type) ? "🎬" : "📄"}</div>`;
      } else {
        mediaBlock = `<img src="${driveThumb(fileId, 800)}" alt="${escapeHtml(entry.title)}" />`;
      }
    } else if (entry.linkUrl) {
      mediaBlock = `<div class="fallback">🔗</div>`;
    } else {
      mediaBlock = `<div class="fallback">📝</div>`;
    }

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
            <span>${formatTime(entry.timestamp)}</span>
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
    return list.map(c => `
      <div class="comment">
        <div class="comment-meta">
          <span class="author">${escapeHtml(c.userName || "匿名")}</span>
          <span class="time">${formatTime(new Date(c.timestamp))}</span>
        </div>
        <div class="comment-text">${escapeHtml(c.text || "")}</div>
      </div>
    `).join("");
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
      // Feed 卡片的小計數也要刷新
      renderFeed();
      // 若有彈窗開著，局部更新反應與留言
      updateModalSocialOnly();
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
        text,
      });

      // 樂觀加入本地 state
      socialState.comments.push({
        timestamp: new Date().toISOString(),
        entryId,
        userId: identity.userId,
        userName: identity.userName,
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

  // Event delegation：綁一次就好（modalBodyEl 本身不會被替換）
  if (socialEnabled) {
    modalBodyEl.addEventListener("click", (e) => {
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
      identityNameEl.textContent = identity.userName;
      identityBtn.classList.remove("is-unset");
    } else {
      identityNameEl.textContent = "選擇身分";
      identityBtn.classList.add("is-unset");
    }
  }

  function openIdentityPicker() {
    const html = CLASSES.map(cls => {
      const students = (CONFIG.students || []).filter(s => s.class === cls.id);
      if (students.length === 0) return "";
      const options = students.map(s => {
        const isActive = identity && identity.userName === s.name;
        return `<button type="button" class="identity-option ${isActive ? "active" : ""}" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button>`;
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
    identityListEl.innerHTML = html;
    identityModalEl.hidden = false;
    document.body.style.overflow = "hidden";
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
      const opt = e.target.closest(".identity-option");
      if (!opt) return;
      saveIdentity(opt.dataset.name);
      refreshIdentityChip();
      closeIdentityPicker();
      // 身分改變後，重新渲染 modal（按鈕 disable 狀態變化）與 feed（無影響）
      if (openedStudentName) {
        renderStudentModalBody(openedStudentName);
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
      const entries = await fetchSheetData();
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
