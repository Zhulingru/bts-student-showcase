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

  // 自動刷新間隔（秒），建議 30 秒
  refreshIntervalSeconds: 30,

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
