
/*
 * ==========================================
 * p5.js 國文測驗網站
 * 題庫來源：Google 試算表 CSV
 * 功能：隨機抽題、答題判斷、解析、計分、
 *       響應式畫面、繁體中文字型、重新載入
 * ==========================================
 */

// 1. Google 試算表發布後的 CSV 網址
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTdBP9cnCXP3piYld6Hr3o0SZMd9MzzbbOwfQCXmNR2rE9w7IXRHXdI0PuU0bbR75DMPCx8iorHMM7g/pub?gid=1315257067&single=true&output=csv";

// 2. 測驗設定
const QUESTIONS_PER_QUIZ = 5;
const POINTS_PER_QUESTION = 20;

// 3. 題庫與測驗狀態
let questionBank = [];
let quizQuestions = [];

let currentIndex = 0;
let score = 0;
let selectedAnswer = -1;
let answered = false;

let loading = true;
let errorMessage = "";
let statusMessage = "";

let optionRects = [];
let nextRect = null;
let reloadRect = null;
let restartRect = null;

// 4. 設定中文字型
function setupFont() {
  // 載入 Google Fonts 繁體中文字型
  if (!document.getElementById("noto-tc-font")) {
    const link = document.createElement("link");
    link.id = "noto-tc-font";
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap";

    document.head.appendChild(link);
  }

  textFont("Noto Sans TC");
}

// 5. 建立畫布
function setup() {
  createCanvas(windowWidth, windowHeight);
  setupFont();
  textAlign(CENTER, CENTER);
  loadQuestions();
}

// 6. CSV 解析器
// 支援逗號、雙引號，以及欄位內的換行
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");

  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if (
      (ch === "\n" || ch === "\r") &&
      !quoted
    ) {
      if (ch === "\r" && text[i + 1] === "\n") {
        i++;
      }

      row.push(cell.trim());

      if (row.some(v => v !== "")) {
        rows.push(row);
      }

      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());

  if (row.some(v => v !== "")) {
    rows.push(row);
  }

  if (rows.length < 2) {
    throw new Error("CSV 沒有題目資料，請檢查試算表。");
  }

  const headers = rows[0].map(h =>
    h.replace(/^\uFEFF/, "").trim()
  );

  return rows.slice(1).map(values => {
    const item = {};

    headers.forEach((header, i) => {
      item[header] = values[i] ?? "";
    });

    return item;
  });
}

// 7. 統一欄位名稱，容許部分常見別名
function normalizeHeader(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s_\-（）()：:]/g, "");
}

function getField(row, aliases) {
  const keys = Object.keys(row);

  for (const alias of aliases) {
    const wanted = normalizeHeader(alias);

    const found = keys.find(
      key => normalizeHeader(key) === wanted
    );

    if (found !== undefined && row[found] !== "") {
      return String(row[found]).trim();
    }
  }

  return "";
}

// 8. 將 CSV 資料轉換成測驗題目
function convertQuestions(rows) {
  return rows.map(row => {
    const question = getField(row, [
      "題目", "問題", "題幹", "question"
    ]);

    const options = [
      getField(row, ["選項A", "選項1", "A", "optionA"]),
      getField(row, ["選項B", "選項2", "B", "optionB"]),
      getField(row, ["選項C", "選項3", "C", "optionC"]),
      getField(row, ["選項D", "選項4", "D", "optionD"])
    ];

    let answerText = getField(row, [
      "正確答案", "答案", "解答", "answer", "correctAnswer"
    ]).toUpperCase();

    // 支援 A、B、C、D 或 1、2、3、4
    const answerMap = {
      "1": "A", "2": "B", "3": "C", "4": "D",
      "Ａ": "A", "Ｂ": "B", "Ｃ": "C", "Ｄ": "D"
    };

    answerText = answerMap[answerText] || answerText;

    const answerIndex = ["A", "B", "C", "D"]
      .indexOf(answerText);

    const explanation = getField(row, [
      "解析", "解釋", "說明", "explanation"
    ]);

    return {
      question,
      options,
      answerIndex,
      explanation: explanation || "本題暫無解析。"
    };
  }).filter(q =>
    q.question &&
    q.options.every(option => option !== "") &&
    q.answerIndex >= 0
  );
}

// 9. 從 Google 試算表載入題庫
async function loadQuestions() {
  loading = true;
  errorMessage = "";
  statusMessage = "";
  redraw();

  try {
    // 加入時間參數，避免瀏覽器使用舊快取
    const separator = CSV_URL.includes("?") ? "&" : "?";
    const url = CSV_URL + separator + "_t=" + Date.now();

    const response = await fetch(url, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        "無法讀取題庫，請確認 Google 試算表已發布。"
      );
    }

    const csvText = await response.text();

    if (
      csvText.trim().startsWith("<!DOCTYPE html") ||
      csvText.trim().startsWith("<html")
    ) {
      throw new Error(
        "取得的不是 CSV，請確認發布網址與存取權限。"
      );
    }

    const rows = parseCSV(csvText);
    const newBank = convertQuestions(rows);

    if (newBank.length === 0) {
      throw new Error(
        "找不到有效題目。請檢查欄位名稱及正確答案格式。"
      );
    }

    questionBank = newBank;
    startQuiz();

    statusMessage =
      `題庫更新成功，共 ${questionBank.length} 題`;
  } catch (error) {
    errorMessage = error.message ||
      "題庫載入失敗，請檢查網路連線。";

    console.error("題庫讀取錯誤：", error);
  } finally {
    loading = false;
    redraw();
  }
}

// 10. 隨機抽取題目
function startQuiz() {
  const shuffled = [...questionBank];

  // Fisher-Yates 洗牌，避免排序亂數造成偏差
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] =
      [shuffled[j], shuffled[i]];
  }

  quizQuestions = shuffled.slice(
    0,
    Math.min(QUESTIONS_PER_QUIZ, shuffled.length)
  );

  currentIndex = 0;
  score = 0;
  selectedAnswer = -1;
  answered = false;

  optionRects = [];
}

// 11. 繪製主畫面
function draw() {
  background("#F3F6FB");

  // 每次繪製前重新設定中文字型
  textFont("Noto Sans TC");
  textStyle(NORMAL);
  noStroke();

  if (loading) {
    drawMessage("正在載入 Google 試算表題庫……");
    return;
  }

  if (errorMessage) {
    drawError();
    return;
  }

  if (quizQuestions.length === 0) {
    drawMessage("目前沒有可使用的題目。");
    return;
  }

  if (currentIndex >= quizQuestions.length) {
    drawResult();
    return;
  }

  drawQuiz();
}

// 12. 繪製共用訊息
function drawMessage(message) {
  fill("#243247");
  textSize(responsiveSize(20));
  text(message, 20, height / 2, width - 40, height - 40);
}

// 13. 繪製錯誤畫面
function drawError() {
  fill("#B42318");
  textSize(responsiveSize(20));
  text("題庫載入失敗", 20, height * 0.35, width - 40, 50);

  fill("#344054");
  textSize(responsiveSize(14));
  text(
    errorMessage,
    24, height * 0.45, width - 48, 100
  );

  reloadRect = {
    x: width / 2 - 100,
    y: height * 0.62,
    w: 200,
    h: 48
  };

  drawButton(reloadRect, "重新載入題庫");
}

// 14. 繪製測驗畫面
function drawQuiz() {
  const q = quizQuestions[currentIndex];
  const mobile = width < 600;

  const margin = mobile ? 18 : 40;
  const contentW = Math.min(width - margin * 2, 760);
  const left = (width - contentW) / 2;

  // 頁面標題
  fill("#172B4D");
  textSize(responsiveSize(25));
  textStyle(BOLD);
  text("國文知識挑戰", width / 2, 34);

  textStyle(NORMAL);
  fill("#667085");
  textSize(responsiveSize(13));

  text(
    `第 ${currentIndex + 1} 題 / 共 ${quizQuestions.length} 題`,
    width / 2, 69
  );

  // 進度條
  const progressY = 88;

  noStroke();
  fill("#DDE5F0");
  rect(left, progressY, contentW, 7, 5);

  fill("#3974D8");
  rect(
    left,
    progressY,
    contentW * ((currentIndex + 1) / quizQuestions.length),
    7,
    5
  );

  // 題目卡片
  const cardY = 112;
  const cardH = mobile ? 125 : 140;

  fill("#FFFFFF");
  stroke("#E1E7F0");
  strokeWeight(1);
  rect(left, cardY, contentW, cardH, 16);
  noStroke();

  fill("#1D2939");
  textStyle(BOLD);
  textSize(responsiveSize(mobile ? 18 : 21));

  text(
    q.question,
    left + 16,
    cardY + 12,
    contentW - 32,
    cardH - 24
  );

  textStyle(NORMAL);

  // 四個選項
  optionRects = [];

  const optionGap = 10;
  const optionH = mobile ? 51 : 56;
  const optionStartY = cardY + cardH + 16;

  for (let i = 0; i < 4; i++) {
    const rectData = {
      x: left,
      y: optionStartY + i * (optionH + optionGap),
      w: contentW,
      h: optionH
    };

    optionRects.push(rectData);

    let bg = "#FFFFFF";
    let borderColor = "#D7DFEA";

    if (answered && i === q.answerIndex) {
      bg = "#DDF7E5";
      borderColor = "#39A66B";
    } else if (
      answered &&
      i === selectedAnswer &&
      selectedAnswer !== q.answerIndex
    ) {
      bg = "#FDE7E7";
      borderColor = "#D9534F";
    }

    fill(bg);
    stroke(borderColor);
    strokeWeight(1.2);
    rect(
      rectData.x, rectData.y,
      rectData.w, rectData.h, 12
    );

    noStroke();
    fill("#253247");
    textSize(responsiveSize(mobile ? 15 : 17));

    const labels = ["A", "B", "C", "D"];

    text(
      `${labels[i]}. ${q.options[i]}`,
      rectData.x + 12,
      rectData.y + 5,
      rectData.w - 24,
      rectData.h - 10
    );
  }

  // 答題結果與解析
  const bottomY = optionStartY + 4 * (optionH + optionGap) + 4;

  if (answered) {
    fill(selectedAnswer === q.answerIndex ? "#16834A" : "#C43232");
    textStyle(BOLD);
    textSize(responsiveSize(17));

    const labels = ["A", "B", "C", "D"];

    const resultText =
      selectedAnswer === q.answerIndex
        ? "答對了！ +20 分"
        : `答錯了，正確答案是 ${labels[q.answerIndex]}`;

    text(resultText, width / 2, bottomY + 10);

    textStyle(NORMAL);
    fill("#475467");
    textSize(responsiveSize(14));

    text(
      "解析：" + q.explanation,
      left + 8,
      bottomY + 36,
      contentW - 16,
      Math.max(45, height - bottomY - 105)
    );

    nextRect = {
      x: width / 2 - 95,
      y: height - 64,
      w: 190,
      h: 44
    };

    drawButton(
      nextRect,
      currentIndex === quizQuestions.length - 1
        ? "查看測驗成績"
        : "下一題"
    );
  } else {
    nextRect = null;

    fill("#667085");
    textSize(responsiveSize(13));
    text("請點選一個答案", width / 2, height - 30);
  }
}

// 15. 繪製結果頁
function drawResult() {
  const total = quizQuestions.length * POINTS_PER_QUESTION;
  const percentage = total > 0
    ? Math.round(score / total * 100)
    : 0;

  fill("#172B4D");
  textStyle(BOLD);
  textSize(responsiveSize(29));
  text("測驗完成！", width / 2, height * 0.25);

  fill("#3974D8");
  textSize(responsiveSize(36));
  text(`${score} / ${total} 分`, width / 2, height * 0.40);

  fill("#475467");
  textStyle(NORMAL);
  textSize(responsiveSize(18));
  text(`答對率：${percentage}%`, width / 2, height * 0.49);

  fill("#667085");
  textSize(responsiveSize(14));
  text(
    `本次完成 ${quizQuestions.length} 題`,
    width / 2, height * 0.55
  );

  restartRect = {
    x: width / 2 - 100,
    y: height * 0.63,
    w: 200,
    h: 48
  };

  drawButton(restartRect, "再測驗一次");

  reloadRect = {
    x: width / 2 - 100,
    y: height * 0.63 + 60,
    w: 200,
    h: 48
  };

  drawButton(reloadRect, "更新雲端題庫");
}

// 16. 繪製按鈕
function drawButton(rectData, label) {
  if (!rectData) return;

  noStroke();
  fill("#3974D8");
  rect(
    rectData.x,
    rectData.y,
    rectData.w,
    rectData.h,
    12
  );

  fill("#FFFFFF");
  textStyle(BOLD);
  textSize(responsiveSize(15));
  text(
    label,
    rectData.x + 8,
    rectData.y + 5,
    rectData.w - 16,
    rectData.h - 10
  );

  textStyle(NORMAL);
}

// 17. 依照螢幕大小調整字體
function responsiveSize(baseSize) {
  const scale = Math.min(
    width / 390,
    height / 650,
    1.25
  );

  return Math.max(12, baseSize * scale);
}

// 18. 處理滑鼠點擊與觸控
function mousePressed() {
  handleClick(mouseX, mouseY);
}

function touchStarted() {
  handleClick(mouseX, mouseY);
  return false;
}

function handleClick(x, y) {
  if (loading) return;

  // 錯誤畫面的重新載入按鈕
  if (errorMessage) {
    if (insideRect(x, y, reloadRect)) {
      loadQuestions();
    }
    return;
  }

  // 結果畫面
  if (currentIndex >= quizQuestions.length) {
    if (insideRect(x, y, restartRect)) {
      startQuiz();
    } else if (insideRect(x, y, reloadRect)) {
      loadQuestions();
    }
    return;
  }

  // 尚未作答時，點選四個選項
  if (!answered) {
    for (let i = 0; i < optionRects.length; i++) {
      if (insideRect(x, y, optionRects[i])) {
        selectedAnswer = i;
        answered = true;

        if (
          selectedAnswer ===
          quizQuestions[currentIndex].answerIndex
        ) {
          score += POINTS_PER_QUESTION;
        }

        return;
      }
    }
  } else if (insideRect(x, y, nextRect)) {
    // 前往下一題
    currentIndex++;
    selectedAnswer = -1;
    answered = false;
  }
}

// 19. 判斷是否點擊按鈕範圍
function insideRect(x, y, rectData) {
  return rectData &&
    x >= rectData.x &&
    x <= rectData.x + rectData.w &&
    y >= rectData.y &&
    y <= rectData.y + rectData.h;
}

// 20. 瀏覽器視窗改變時調整畫布
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
