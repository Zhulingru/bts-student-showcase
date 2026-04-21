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

    modalEl.hidden = false;
    document.body.style.overflow = "hidden";
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
        </div>
      </div>
    `;
  }

  function closeModal() {
    modalEl.hidden = true;
    document.body.style.overflow = "";
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

  document.getElementById("refresh-btn").addEventListener("click", load);

  load();
  setInterval(load, Math.max(10, CONFIG.refreshIntervalSeconds) * 1000);
})();
