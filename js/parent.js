// Parent Corner (家长区): math gate, first-run setup, progress table,
// pause toggle, export/import, and the missing-illustrations list.

import {
  saveProgress,
  seedCharacter,
  todayLocalDateString,
  exportProgressJson,
  importProgressJson,
} from "./progress.js";
import { growthStageFor, isDue } from "./scheduler.js";

const STAGE_NAMES = ["种子", "发芽", "小苗", "花苞", "开花", "金花"];

// ---------- math gate ----------

let currentGateAnswer = null;

export function generateGateQuestion({ clearFeedback = true } = {}) {
  const a = 10 + Math.floor(Math.random() * 90);
  const b = 10 + Math.floor(Math.random() * 90);
  currentGateAnswer = a * b;
  document.getElementById("parent-gate-question").textContent = `${a} × ${b} = ?`;
  document.getElementById("parent-gate-input").value = "";
  if (clearFeedback) {
    document.getElementById("parent-gate-feedback").textContent = "";
  }
}

export function checkGateAnswer() {
  const input = document.getElementById("parent-gate-input");
  const feedback = document.getElementById("parent-gate-feedback");
  const submitted = Number(input.value);

  if (submitted === currentGateAnswer) {
    return true;
  }

  generateGateQuestion({ clearFeedback: false });
  feedback.textContent = "不对哦，再试一次。";
  return false;
}

// ---------- CJK character extraction ----------

function extractChineseCharacters(text) {
  return text.match(/[一-鿿]/g) || [];
}

// ---------- main render ----------

export function renderParentContent(progress, charMap, onChange) {
  const container = document.getElementById("parent-content");
  container.innerHTML = `
    <section class="parent-section">
      <h3>已认识的字</h3>
      <p class="parent-hint">粘贴她已经认识的字（任何格式都可以，空格、逗号或连在一起）。这些字会从"金花"阶段开始，第一周会有很多轻松的复习。</p>
      <textarea id="known-chars-input" class="parent-textarea" rows="3" placeholder="例如：的了是我你他她不在有这那"></textarea>
      <button id="btn-import-known" class="big-button" type="button">导入</button>
      <p id="known-import-result" class="parent-hint"></p>
    </section>

    <section class="parent-section">
      <h3>每天学习设置</h3>
      <label class="parent-field">
        每天新字数量：
        <select id="daily-new-count">
          <option value="0">0（暂停学新字）</option>
          <option value="1">1（默认）</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="5">5</option>
        </select>
      </label>
      <label class="parent-field">
        熊猫的名字：
        <input id="panda-name-input" type="text" maxlength="10" />
      </label>
      <label class="parent-field">
        开始日期：
        <input id="start-date-input" type="date" />
      </label>
      <label class="parent-field parent-checkbox">
        <input id="paused-toggle" type="checkbox" />
        暂停模式（只复习，不学新字，适合忙碌的一周）
      </label>
    </section>

    <section class="parent-section">
      <h3>学习进度</h3>
      <div class="parent-table-wrap">
        <table class="parent-table" id="progress-table"></table>
      </div>
    </section>

    <section class="parent-section">
      <h3>备份与恢复</h3>
      <p class="parent-hint">导出的文件可以在另一台设备上导入，作为手动同步的方式。</p>
      <button id="btn-export" class="icon-button parent-action-button" type="button">⬇️ 导出进度</button>
      <label class="icon-button parent-action-button parent-file-label">
        ⬆️ 导入进度
        <input id="btn-import-file" type="file" accept="application/json" class="parent-file-input" />
      </label>
    </section>

    <section class="parent-section">
      <h3>缺少插图的字</h3>
      <p class="parent-hint">下面这些字还没有 /assets/img/{字}.png 插图，目前用 emoji 代替。可以复制这份列表去批量制作插图。</p>
      <textarea id="missing-images-list" class="parent-textarea" rows="3" readonly>正在检查…</textarea>
      <button id="btn-copy-missing" class="icon-button parent-action-button" type="button">📋 复制列表</button>
    </section>

    <section class="parent-section">
      <a href="print.html" class="icon-button parent-action-button" style="display:inline-block; text-decoration:none;">🖨️ 打开打印页面</a>
    </section>
  `;

  fillSettingsFields(progress);
  renderProgressTable(progress, charMap);
  checkMissingImages(progress, charMap);
  wireEvents(progress, charMap, onChange);
}

function fillSettingsFields(progress) {
  document.getElementById("daily-new-count").value = String(progress.settings.dailyNewCount);
  document.getElementById("panda-name-input").value = progress.pandaName;
  document.getElementById("start-date-input").value = progress.settings.startDate;
  document.getElementById("paused-toggle").checked = progress.settings.paused;
}

function renderProgressTable(progress, charMap) {
  const table = document.getElementById("progress-table");
  const today = todayLocalDateString();
  const rows = Object.entries(progress.characters).sort(
    (a, b) => charMap.get(a[0]).rank - charMap.get(b[0]).rank
  );

  const accuracyFor = (state) =>
    state.timesSeen > 0 ? `${Math.round((state.timesCorrect / state.timesSeen) * 100)}%` : "—";

  table.innerHTML = `
    <thead>
      <tr><th>字</th><th>阶段</th><th>正确率</th><th>学习次数</th><th>下次复习</th></tr>
    </thead>
    <tbody>
      ${
        rows.length === 0
          ? `<tr><td colspan="5" class="empty-state-message">还没有学习记录，等她种下第一颗种子后这里会显示进度。</td></tr>`
          : rows
              .map(([char, state]) => {
                const stage = growthStageFor(state, today);
                return `
                  <tr>
                    <td>${char}</td>
                    <td>${STAGE_NAMES[stage]}</td>
                    <td>${accuracyFor(state)}</td>
                    <td>${state.timesSeen}</td>
                    <td>${state.nextDue}${isDue(state, today) ? " ⏰" : ""}</td>
                  </tr>
                `;
              })
              .join("")
      }
    </tbody>
  `;
}

async function checkMissingImages(progress, charMap) {
  const chars = Object.keys(progress.characters);
  const missing = [];

  for (const char of chars) {
    try {
      const res = await fetch(`assets/img/${encodeURIComponent(char)}.png`, { method: "HEAD" });
      if (!res.ok) missing.push(char);
    } catch {
      missing.push(char);
    }
  }

  const textarea = document.getElementById("missing-images-list");
  if (textarea) {
    textarea.value = missing.length > 0 ? missing.join("") : "太棒了，所有插图都齐了！";
  }
}

function wireEvents(progress, charMap, onChange) {
  document.getElementById("btn-import-known").addEventListener("click", () => {
    const text = document.getElementById("known-chars-input").value;
    const chars = extractChineseCharacters(text);
    const today = todayLocalDateString();

    let added = 0;
    let alreadyKnown = 0;
    let unsupported = 0;

    for (const char of new Set(chars)) {
      if (!charMap.has(char)) {
        unsupported++;
        continue;
      }
      if (progress.characters[char]) {
        alreadyKnown++;
        continue;
      }
      seedCharacter(progress, char, { box: 4, source: "known-import", dateLearned: today });
      added++;
    }

    saveProgress(progress);
    document.getElementById(
      "known-import-result"
    ).textContent = `已导入 ${added} 个字（${alreadyKnown} 个已经在学习中，${unsupported} 个字不在这 200 字的范围内）。`;
    document.getElementById("known-chars-input").value = "";
    renderProgressTable(progress, charMap);
    checkMissingImages(progress, charMap);
    onChange?.();
  });

  document.getElementById("daily-new-count").addEventListener("change", (e) => {
    progress.settings.dailyNewCount = Number(e.target.value);
    saveProgress(progress);
  });

  document.getElementById("panda-name-input").addEventListener("change", (e) => {
    progress.pandaName = e.target.value.trim() || "熊猫";
    saveProgress(progress);
  });

  document.getElementById("start-date-input").addEventListener("change", (e) => {
    progress.settings.startDate = e.target.value;
    saveProgress(progress);
  });

  document.getElementById("paused-toggle").addEventListener("change", (e) => {
    progress.settings.paused = e.target.checked;
    saveProgress(progress);
    onChange?.();
  });

  document.getElementById("btn-export").addEventListener("click", () => {
    const json = exportProgressJson(progress);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hanzi-garden-progress-${todayLocalDateString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("btn-import-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const confirmed = confirm("导入会覆盖当前的学习进度，确定要继续吗？");
    if (!confirmed) {
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = importProgressJson(reader.result);
        saveProgress(imported);
        alert("导入成功！页面将会刷新。");
        location.reload();
      } catch {
        alert("这个文件看起来不是有效的进度文件。");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  document.getElementById("btn-copy-missing").addEventListener("click", async () => {
    const textarea = document.getElementById("missing-images-list");
    try {
      await navigator.clipboard.writeText(textarea.value);
    } catch {
      textarea.select();
      document.execCommand("copy");
    }
  });
}
