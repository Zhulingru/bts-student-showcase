// ================================================================
// app.js：所有網頁邏輯都在這裡，你不需要修改這個檔案
// 若有問題，回頭檢查 config.js 裡的設定是否正確
// ================================================================

(function () {
  "use strict";

  // ---------- 初始化畫面文字 ----------
  document.getElementById("site-title").textContent = CONFIG.siteTitle;
  document.getElementById("site-subtitle").textContent = CONFIG.siteSubtitle;
  document.getElementById("upload-btn").href = CONFIG.formUrl;
  document.getElementById("refresh-interval-label").textContent = CONFIG.refreshIntervalSeconds;

  const statusEl = document.getElementById("status-text");
  const lastUpdatedEl = document.getElementById("last-updated");
  const feedEl = document.getElementById("feed");
  const gridEl = document.getElementById("students-grid");
  const modalEl = document.getElementById("modal");
  const modalTitleEl = document.getElementById("modal-title");
  const modalBodyEl = document.getElementById("modal-body");

  let allEntries = [];
  let entriesByStudent = new Map();

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
        // 影片在卡片上顯示縮圖，在詳情頁用 iframe
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

  // ---------- 從 Google 試算表抓資料 ----------
  async function fetchSheetData() {
    if (!CONFIG.sheetId || CONFIG.sheetId.includes("請貼上")) {
      throw new Error("尚未設定 Sheet ID，請編輯 config.js");
    }

    const sheetParam = CONFIG.sheetName ? `&sheet=${encodeURIComponent(CONFIG.sheetName)}` : "";
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?tqx=out:json${sheetParam}`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`無法取得試算表資料（HTTP ${res.status}）`);
    const text = await res.text();

    // gviz 回傳的是 JSONP 格式，要手動切出 JSON
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

  // 將試算表一列轉換為我們要用的資料
  // 預設的欄位名稱（Google 表單自動產生）：
  //   時間戳記 / 學生姓名 / 產出類型 / 標題 / 說明 / 檔案上傳 / 外部連結
  // 若使用者改了欄位名稱，可以調整下面的 keys
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
      // gviz 時間回傳常見形式：Date(2026,3,21,14,30,0)
      const m = rawTime.match(/Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)/);
      if (m) {
        timestamp = new Date(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
      } else {
        timestamp = new Date(rawTime);
      }
    } else {
      timestamp = new Date();
    }

    return {
      timestamp,
      student: String(student).trim(),
      type: type ? String(type).trim() : "",
      title: title ? String(title).trim() : "（未命名）",
      desc: desc ? String(desc).trim() : "",
      fileUrl: fileUrl ? String(fileUrl).trim() : "",
      linkUrl: linkUrl ? String(linkUrl).trim() : "",
    };
  }

  // ---------- 渲染 ----------
  function render() {
    renderFeed();
    renderStudentsGrid();
  }

  function renderFeed() {
    const latest = [...allEntries]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 12);

    if (latest.length === 0) {
      feedEl.innerHTML = `<div class="placeholder">還沒有任何產出，歡迎成為第一個！</div>`;
      return;
    }

    feedEl.innerHTML = latest.map(entry => `
      <article class="feed-card" data-student="${escapeHtml(entry.student)}">
        <div class="media">
          ${getMediaHtml(entry, 600)}
          <span class="type-badge">${escapeHtml(typeBadge(entry.type))}</span>
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
    `).join("");

    feedEl.querySelectorAll(".feed-card").forEach(card => {
      card.addEventListener("click", () => openStudentModal(card.dataset.student));
    });
  }

  function renderStudentsGrid() {
    gridEl.innerHTML = CONFIG.students.map(name => {
      const entries = entriesByStudent.get(name) || [];
      const count = entries.length;
      const latest = entries[0]; // 已排序
      const thumbHtml = latest
        ? getMediaHtml(latest, 400)
        : `<span class="empty">尚未上傳</span>`;

      return `
        <div class="student-card" data-student="${escapeHtml(name)}">
          <div class="thumb">${thumbHtml}</div>
          <div class="info">
            <span class="name">${escapeHtml(name)}</span>
            <span class="count ${count === 0 ? "zero" : ""}">${count}</span>
          </div>
        </div>
      `;
    }).join("");

    gridEl.querySelectorAll(".student-card").forEach(card => {
      card.addEventListener("click", () => openStudentModal(card.dataset.student));
    });
  }

  // ---------- 學生詳情彈窗 ----------
  function openStudentModal(studentName) {
    const entries = entriesByStudent.get(studentName) || [];
    modalTitleEl.textContent = `${studentName}（共 ${entries.length} 則產出）`;

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
        // 影片與文件用 Drive iframe 預覽，效果穩定
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

      // 按學生分組並依時間排序（新→舊）
      entriesByStudent = new Map();
      for (const name of CONFIG.students) entriesByStudent.set(name, []);
      for (const e of entries) {
        if (!entriesByStudent.has(e.student)) {
          // 若表單回傳的姓名不在名單中，也一併顯示（避免資料遺失）
          entriesByStudent.set(e.student, []);
        }
        entriesByStudent.get(e.student).push(e);
      }
      for (const arr of entriesByStudent.values()) {
        arr.sort((a, b) => b.timestamp - a.timestamp);
      }

      render();
      setStatus("ok", `已更新 · 共 ${entries.length} 則產出`);
      lastUpdatedEl.textContent = `最後更新：${new Date().toLocaleTimeString("zh-TW")}`;
    } catch (err) {
      console.error(err);
      setStatus("err", `載入失敗：${err.message}`);
    }
  }

  // 手動刷新按鈕
  document.getElementById("refresh-btn").addEventListener("click", load);

  // 啟動
  load();
  setInterval(load, Math.max(10, CONFIG.refreshIntervalSeconds) * 1000);
})();
