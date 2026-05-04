// ================================================================
// 老師設定區：整個網站你只需要改這個檔案
// 其他 .html / .css / .js 檔案都不用動
// ================================================================

const CONFIG = {
  // 網站上方標題
  siteTitle: "專題製作學習歷程牆",
  siteSubtitle: "114T3 · A / B 兩班共 28 位同學的創作即時動態",

  // Google 試算表的 ID
  // 從你試算表網址複製：
  // https://docs.google.com/spreadsheets/d/【這一段就是 SHEET_ID】/edit
  sheetId: "14QzmfxqKCsqfMwR9QYgcTI7JWDQHcZA5KqWzr_qlHrg",

  // 試算表分頁的識別碼清單（陣列，可放多個 gid）
  // - 一般情境：只有一個分頁（學生表單回應），放一個就好
  // - 多表單情境：第二張表單（例如老師示範表單）也可以寫入同一份試算表的新分頁，
  //   建好後把新分頁網址裡的 gid 也加進來，網站會同時讀取兩者並合併
  sheetGids: [
    "230117923",   // Form A：學生表單 → 分頁「表單回應 1」
    "1910543082",  // Form B：老師示範表單 → 分頁「表單回應 2」
  ],

  // 若沒設 sheetGids，會退回使用這個分頁名稱
  sheetName: "表單回應 1",

  // Google 表單填寫的網址（學生點「新增產出」按鈕會跳到這裡）
  formUrl: "https://forms.gle/91MQyqctWm2SaLjP9",

  // ─── 大頭貼（選用）──────────────────────────────────
  // 學生可以透過同一張表單上傳大頭貼：
  //   - 表單「類型」下拉選項新增一個 → 與下面字串完全一致
  //   - 學生要更新大頭貼就再填一次表單，最新的那張勝出
  // 想關閉整個功能：把字串改成空字串 "" 即可，一切回到沒有大頭貼的狀態
  avatarType: "大頭貼",

  // 自動刷新間隔（秒），建議 30 秒
  refreshIntervalSeconds: 30,

  // ─── 反應與留言（選用）──────────────────────────────────
  // 留空的話，emoji 反應與留言功能會自動隱藏，其他功能照常運作。
  // 啟用方式請見 apps-script.gs 檔案裡的說明，以及 README「第四部分」。
  appsScriptUrl: "https://script.google.com/macros/s/AKfycbz35Jp3XjMnvgfFj3SFE-XTzoNNXEzDYwYKdpT5Uu-OEo4FxOC4wmlBtLxwHxsXufPf/exec",

  // 可用的 emoji 反應（順序就是顯示順序，想加減自由改）
  reactionEmojis: ["👍", "❤️", "🔥", "😂", "👀"],

  // 反應與留言的刷新間隔（秒），比作品刷新快一點，讓互動更有臨場感
  socialRefreshIntervalSeconds: 10,

  // ─── 個人簡介（選用）──────────────────────────────────
  // 需在下方啟用 appsScriptUrl（與 emoji／留言／驗證碼為同一組後端）。
  // false = 完全不顯示簡介區；之後要打開改成 true，並將 apps-script.gs 部署為新版本。
  studentBioEnabled: true,
  studentBioMaxLength: 280,

  // ─── 訪客模式（選用）──────────────────────────────────
  // 開啟後，「選擇身分」視窗會多一個「自填暱稱」區塊，給老師 / 家長 / 其他來賓用。
  // 訪客的暱稱不能跟學生清單重名，留言旁邊會自動加上角色徽章。
  // 想關閉（例如只開放給學生）把這個設成 false 即可。
  guestModeEnabled: true,

  // 可選的訪客角色（順序就是顯示順序）
  guestRoles: [
    { id: "guest",   label: "訪客", emoji: "👤" },
    { id: "teacher", label: "老師", emoji: "👩‍🏫" },
    { id: "parent",  label: "家長", emoji: "👨‍👩‍👦" },
  ],

  // 班級設定
  // label 是網站上顯示的文字，必須和 Google 表單「班級」欄位的選項完全一致
  // color 是班級主色，可以改成你喜歡的色碼
  classes: [
    { id: "A", label: "A 班",       color: "#0ea5e9" },  // 天藍
    { id: "B", label: "B 班",       color: "#f59e0b" },  // 琥珀
    { id: "X", label: "X 班（示範）", color: "#8b5cf6" },  // 紫色：老師示範用，非學生帳號
  ],

  // 學生名單（順序會決定網格排列順序）
  // name 必須和 Google 表單「學生姓名」下拉選單的選項完全一致（一字不差）
  // class 必須對應上方 classes 的 id（"A" 或 "B"）
  //
  // 注意：每位學生的「驗證碼（code）」與「email」不放在這裡，
  //      而是在 apps-script.gs 的 STUDENTS_PRIVATE 裡（那份不會進 GitHub）。
  //      好處：驗證碼是個資，留在 Apps Script 就跟分享雲端資料夾的函式同一個地方，
  //      你執行分享函式時可以直接寄信給學生，連同資料夾連結 + 驗證碼一起給。
  students: [
    // ===== A 班（13 位）=====
    { name: "黃羿晴", class: "A" },
    { name: "張凱倫", class: "A" },
    { name: "黃詠琳", class: "A" },
    { name: "林于崴", class: "A" },
    { name: "林若谷", class: "A" },
    { name: "楊靖鈞", class: "A" },
    { name: "盧愛心", class: "A" },
    { name: "馬家榆", class: "A" },
    { name: "施宥均", class: "A" },
    { name: "張彥霆", class: "A" },
    { name: "楊承樺", class: "A" },
    { name: "李宛頤", class: "A" },
    { name: "謝凝思", class: "A" },

    // ===== B 班（15 位）=====
    { name: "陳妤欣", class: "B" },
    { name: "鍾勻浩", class: "B" },
    { name: "涂子宥", class: "B" },
    { name: "何樂",   class: "B" },
    { name: "黃可馨", class: "B" },
    { name: "程亮瑜", class: "B" },
    { name: "張語晴", class: "B" },
    { name: "張一心", class: "B" },
    { name: "杜品儀", class: "B" },
    { name: "洪若馨", class: "B" },
    { name: "胡睿成", class: "B" },
    { name: "楊元鈞", class: "B" },
    { name: "蕭弗盈", class: "B" },
    { name: "許宸熙", class: "B" },
    { name: "余宜融", class: "B" },

    // ===== X 班 · 老師示範用（1 位）=====
    { name: "Chibi", class: "X" },
  ],
};
