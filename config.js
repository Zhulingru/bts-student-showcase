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

  // ─── 老師登入（選用）──────────────────────────────────
  // 老師可透過「老師登入」輸入驗證碼，以老師身分按讚／留言（顯示 👩‍🏫 徽章）。
  // 真正的驗證碼（code）寫在 apps-script.gs 的 TEACHERS_PRIVATE 裡，這裡只放姓名／顯示名稱。
  // teachers[].name 必須和 TEACHERS_PRIVATE[].name 一字不差。
  teachers: [
    { name: "Chibi", label: "Chibi 老師" },
  ],

  // ─── 展覽模式（家長 / 老師來看的公開展場）─────────────────────
  // true 時：
  //   - 隱藏「新增作品」按鈕（家長不需要看到後台入口）
  //   - 顯示網頁上方的「引言區」
  // 之後要開放給學生上傳時，改成 false 即可回到原本狀態。
  publicViewMode: true,

  // ─── 隱藏特定產出（選用）──────────────────────────────────────
  // 試算表列仍保留，只是不在網站顯示（近期更新、個人牆、作品計數）。
  // student 必須和 students[].name 完全一致；title 為標題精確比對。
  hiddenEntries: [
    { student: "張語晴", title: "任務2" },
  ],

  // ─── 任務三 · 每週週誌連結（Google Docs）────────────────────────
  // key 必須和上方 students[].name 完全一致（一字不差）
  // 值是「知道連結的使用者可檢視」的 Google Docs 網址
  // 顯示位置：
  //   1) 學生卡片右下角小按鈕「📓 週誌」
  //   2) 網頁底部「任務三 · 週誌總覽」區（依班級分組列出）
  task3Urls: {
    // ===== A 班 =====
    "楊靖鈞": "https://docs.google.com/document/d/1Zr7YEegnvhleo7rymwcrlbcGzuI1SELRIGrqTyhz7VI/edit",
    "張彥霆": "https://docs.google.com/document/d/1XnTQSnG3V5rr7f7s1uBF384wXdnyFj9iNmo1gLd3I50/edit",
    "黃羿晴": "https://docs.google.com/document/d/1PA7dgOlAov69FnVfhY8BwqduvmfU5s-Oab2bvw8AxkA/edit",
    "張凱倫": "https://docs.google.com/document/d/1cdpwFt5VL2v9RxeTdDLz33BKj8eWuv6ghJa-cIFztvg/edit",
    "黃詠琳": "https://docs.google.com/document/d/1TJDWNyGl0QnGhtgjujUTpkOqaZ-zicqs28X190iiWU0/edit",
    "林于崴": "https://docs.google.com/document/d/11Pz1tj_fs_pTHvf0-sb6DdFIumyb8OgcYMZpbccUyfA/edit",
    "盧愛心": "https://docs.google.com/document/d/18sHiw12vBl-qwNWOAG4138j3n_R8TfTQQkx3O9FAJAU/edit",
    "林若谷": "https://docs.google.com/document/d/1Bn0aXsULB2i-cUQ0YONUiSrvvMbfNO9hUW-cU2948AM/edit",
    "楊承樺": "https://docs.google.com/document/d/1JbJ-Yq3M3JkFsB1-fa8EPRpC9krCmidh1dOM4WjI2SE/edit",
    "李宛頤": "https://docs.google.com/document/d/1_HVuJylNkhWzzP9usS-tro_eZxVnJj7qHrew3HtWgAg/edit",
    "馬家榆": "https://docs.google.com/document/d/14yGx7c34gK7r0Yro8n-0-wJYrhc3fMDfnkZOkkGCxww/edit",
    "謝凝思": "https://docs.google.com/document/d/1-wOy6cWm9W2EDAWjLAbmIDkzobWkZw0uYKdz1sIAWCA/edit",
    "施宥均": "https://docs.google.com/document/d/1-Ixc3sio0nw-DXYT6IldvL8FgEzAGdoS4j73eJ4man4/edit",

    // ===== B 班 =====
    "何樂":   "https://docs.google.com/document/d/1Q9gjPUKbfDe2nwEuf_zbzSjVtZzBU6JiEatAabb8lRQ/edit",
    "黃可馨": "https://docs.google.com/document/d/1dWepYKjG-7t7UXJ6s4Vzy1ssgSIvHZhsQm-hVeWxiJI/edit",
    "陳妤欣": "https://docs.google.com/document/u/0/d/1RlPnSzF0sXc0EipebAxZIIFiVRTrBZEHHHHc8jGfJOI/edit",
    "鍾勻浩": "https://docs.google.com/document/d/1PHnwF7_s5z2u3KflV52JQTDhiYIB4jrCxaeSqipGAyA/edit",
    "程亮瑜": "https://docs.google.com/document/d/1-bKsK7XemmxGgKQZ4J39Ed6Cwj1fN3AOmsP0RrbNRw8/edit",
    "涂子宥": "https://docs.google.com/document/d/1ZPJ0iXC8qcM8OwAjBhwPYWJSKzm4l0iRukiNbnnSiBE/edit",
    "張語晴": "https://docs.google.com/document/d/1z0TcQHe8nL1HuwxOm4PyQT303JmoWL-EfD15zYz8xuI/edit",
    "張一心": "https://docs.google.com/document/d/1wezqmB9QTLEQpFhHS3RxtFvUaNMEEB7-1Nb73iYPjQo/edit",
    "楊元鈞": "https://docs.google.com/document/d/1woc_Au_hMeXoS9KtFyaEu0JB_cwp7dW-bqNNPFIOC2Q/edit",
    "杜品儀": "https://docs.google.com/document/d/1R1h4QHFI6uhmsGt-7NAPG9GVhSPrszjQ1AVZcYXm154/edit",
    "蕭弗盈": "https://docs.google.com/document/d/1EDS2atVZtLT2RYlEiBngpioGt4PuYvzxbxVz41AGfVA/edit",
    "洪若馨": "https://docs.google.com/document/d/1KqUu-r3i7PakSoVKYtwW_YmgpTGWn1P0SICcjW8rq4Q/edit",
    "胡睿成": "https://docs.google.com/document/d/1JXzsNLRDKqscrSN_1uMfrIUa8VUiiSH-lO8uvEGJF1g/edit",
    "許宸熙": "https://docs.google.com/document/d/1p8rcWOgb2CqVh3fkz_SnURnSRsNXbwQDAW3YtnFActU/edit",
    "余宜融": "https://docs.google.com/document/u/0/d/1VTPH1cjLUIQHEjKbBoOHyOSTBGsIBLhcezl2CHzZCnQ/edit",
  },

  // 班級設定
  // label 是網站上顯示的文字，必須和 Google 表單「班級」欄位的選項完全一致
  // color 是班級主色，可以改成你喜歡的色碼
  classes: [
    { id: "A", label: "A 班",       color: "#0ea5e9" },  // 天藍
    { id: "B", label: "B 班",       color: "#f59e0b" },  // 琥珀
  ],

  // 學生名單（順序會決定網格排列順序）
  // name 必須和 Google 表單「學生姓名」下拉選單的選項完全一致（一字不差）
  // class 必須對應上方 classes 的 id（"A" 或 "B"）
  // topic 是學生的專題主題，會顯示在學生卡片與詳情彈窗（可留空字串隱藏）
  //
  // 注意：每位學生的「驗證碼（code）」與「email」不放在這裡,
  //      而是在 apps-script.gs 的 STUDENTS_PRIVATE 裡（那份不會進 GitHub）。
  //      好處：驗證碼是個資，留在 Apps Script 就跟分享雲端資料夾的函式同一個地方，
  //      你執行分享函式時可以直接寄信給學生，連同資料夾連結 + 驗證碼一起給。
  students: [
    // ===== A 班（13 位）=====
    { name: "黃羿晴", class: "A", topic: "NBA edit videos, and NBA 手冊" },
    { name: "張凱倫", class: "A", topic: "build a secret base" },
    { name: "黃詠琳", class: "A", topic: "棲息筆記" },
    { name: "林于崴", class: "A", topic: "只用程式做Youtube" },
    { name: "林若谷", class: "A", topic: "pokerogue Mono runs" },
    { name: "楊靖鈞", class: "A", topic: "《「因」果關係》" },
    { name: "盧愛心", class: "A", topic: "甜點備忘錄" },
    { name: "馬家榆", class: "A", topic: "做一本下午茶食譜" },
    { name: "施宥均", class: "A", topic: "下一次出國去露營！" },
    { name: "張彥霆", class: "A", topic: "F1介紹" },
    { name: "楊承樺", class: "A", topic: "從零開始建造迷你房子（智能家具）" },
    { name: "李宛頤", class: "A", topic: "自己編一首歌" },
    { name: "謝凝思", class: "A", topic: "make a roblox survival game" },

    // ===== B 班（15 位）=====
    { name: "陳妤欣", class: "B", topic: "吉你他美（吉他）" },
    { name: "鍾勻浩", class: "B", topic: "自由奔跑" },
    { name: "涂子宥", class: "B", topic: "星際大戰世界觀" },
    { name: "何樂",   class: "B", topic: "我的3D列印模型、甜點製作歷程" },
    { name: "黃可馨", class: "B", topic: "可爾黏思" },
    { name: "程亮瑜", class: "B", topic: "黏黏有瑜" },
    { name: "張語晴", class: "B", topic: "遊戲影片剪輯練習、世界盃數據說明" },
    { name: "張一心", class: "B", topic: "寶可夢中心地圖" },
    { name: "杜品儀", class: "B", topic: "做一本甜點食譜" },
    { name: "洪若馨", class: "B", topic: "這次的旅程..." },
    { name: "胡睿成", class: "B", topic: "謎功" },
    { name: "楊元鈞", class: "B", topic: "遊戲影片剪輯練習" },
    { name: "蕭弗盈", class: "B", topic: "今天也在塗塗改改" },
    { name: "許宸熙", class: "B", topic: "小型公仔製作師" },
    { name: "余宜融", class: "B", topic: "鼠類大百科和鼠疫介紹" },
  ],
};
