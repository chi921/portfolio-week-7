// ============ Nav bar scroll style ============
// Each page hardcodes its active nav link, so scroll-spy is no longer needed.
// We still keep the compact "scrolled" nav style when the page is scrolled.
const nav = document.querySelector(".nav");

function handleNavScroll() {
  nav.classList.toggle("scrolled", window.scrollY > 40);
}

window.addEventListener("scroll", handleNavScroll);

// ============ Dark mode toggle ============
const themeToggle = document.getElementById("theme-toggle");
const STORAGE_KEY = "theme";

function getPreferredTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

applyTheme(getPreferredTheme());

themeToggle.addEventListener("click", () => {
  const isDark =
    document.documentElement.getAttribute("data-theme") === "dark";
  const next = isDark ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem(STORAGE_KEY, next);
});

// ============ Card scroll-in animation ============
const cards = document.querySelectorAll(".card");
cards.forEach((card) => card.classList.add("reveal"));

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        setTimeout(() => {
          entry.target.classList.add("visible");
        }, i * 80);
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15 }
);

cards.forEach((card) => observer.observe(card));

// ============ Init ============
handleNavScroll();

// ============ Projects: To-Do App ============
// Only runs on the Projects page; bail out silently on Home/About.
(function () {
  if (!document.getElementById("cal-days")) return;
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  // ---- Supabase client ----
  const SUPABASE_URL = "https://tijmqcatborqrquekmhw.supabase.co";
  const SUPABASE_KEY =
    "sb_publishable_06i_yweDMcD2zsXcqFYTwg_yemk3zxl";
  const TABLE = "todos";

  // Initialize once as a singleton. If the SDK failed to load from CDN,
  // we fall back to localStorage so the app still works.
  const supabase =
    window.supabase && typeof window.supabase.createClient === "function"
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
      : null;
  const useLocalFallback = !supabase;
  const STORAGE_KEY = "todo-tasks-v1";

  let tasks = {};
  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();
  let selectedKey = toKey(today);

  // Priority picker state
  const priorityEmoji = { low: "🟢", medium: "🟡", high: "🔴" };
  let currentPriority = "medium";

  // DOM refs
  const calTitle = document.getElementById("cal-title");
  const calDays = document.getElementById("cal-days");
  const calPrev = document.getElementById("cal-prev");
  const calNext = document.getElementById("cal-next");
  const dateDisplay = document.getElementById("todo-date-display");
  const form = document.getElementById("todo-form");
  const input = document.getElementById("todo-input");
  const list = document.getElementById("todo-list");
  const empty = document.getElementById("todo-empty");
  const counter = document.getElementById("todo-counter");
  const errorEl = document.getElementById("todo-error");
  const priorityBtns = document.querySelectorAll(".priority-btn");

  // ---- helpers ----
  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.style.display = "block";
  }

  function clearError() {
    if (errorEl) errorEl.style.display = "none";
  }

  // The `todos` table has columns: id, task, date, is_complete.
  // `is_complete` is the source of truth for a task's done state.
  // There is no `priority` column in Supabase, so that piece of per-task
  // state is kept in localStorage keyed by the row id.
  const META_KEY = "todo-meta-v1";

  function loadMeta() {
    try {
      return JSON.parse(localStorage.getItem(META_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveMeta(meta) {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  }

  function setMeta(id, patch) {
    const meta = loadMeta();
    meta[id] = { ...(meta[id] || {}), ...patch };
    saveMeta(meta);
  }

  function deleteMeta(id) {
    const meta = loadMeta();
    delete meta[id];
    saveMeta(meta);
  }

  // Group an array of todo rows by their `date` into the { key: [items] }
  // shape the rest of the UI expects. `is_complete` comes from the DB;
  // `priority` is still read from local meta (no DB column for it).
  function groupByDate(rows) {
    const meta = loadMeta();
    const map = {};
    (rows || []).forEach((row) => {
      // `date` may arrive as a Date, "2026-09-18" string, or ISO string.
      const d = new Date(row.date);
      if (isNaN(d.getTime())) return;
      const key = toKey(d);
      if (!map[key]) map[key] = [];
      const m = meta[row.id] || {};
      map[key].push({
        id: row.id,
        text: row.task,
        done: !!row.is_complete,
        priority: m.priority || "medium",
      });
    });
    return map;
  }

  function loadTasksLocal() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveTasksLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }

  // Fetch all todos ordered by the task's `date` (the only temporal column
  // on the table), using `id` as a stable tie-breaker within a date.
  async function loadTasks() {
    if (useLocalFallback) {
      tasks = loadTasksLocal();
      return;
    }
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("id, task, date, is_complete")
        .order("date", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      tasks = groupByDate(data);
      clearError();
    } catch (err) {
      console.error("Failed to load todos:", err);
      showError(
        "Couldn't load tasks from the database: " + (err?.message || err)
      );
      tasks = {};
    }
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function parseKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function fmtDisplay(key) {
    if (!key) return "—";
    const d = parseKey(key);
    return d.toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---- calendar ----
  function renderCalendar() {
    calTitle.textContent = `${monthNames[viewMonth]} ${viewYear}`;
    calDays.innerHTML = "";

    const startWeekday = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const todayKey = toKey(new Date());

    for (let i = 0; i < startWeekday; i++) {
      const blank = document.createElement("span");
      blank.className = "cal-cell cal-blank";
      calDays.appendChild(blank);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cal-cell";
      if (key === todayKey) cell.classList.add("is-today");
      if (key === selectedKey) cell.classList.add("is-selected");
      if (tasks[key] && tasks[key].length) cell.classList.add("has-tasks");
      cell.textContent = d;
      cell.setAttribute("aria-label", fmtDisplay(key));
      cell.addEventListener("click", () => {
        selectedKey = key;
        renderCalendar();
        renderList();
      });
      calDays.appendChild(cell);
    }
  }

  // ---- task list ----
  function renderList() {
    dateDisplay.textContent = fmtDisplay(selectedKey);
    list.innerHTML = "";
    const items = tasks[selectedKey] || [];
    const total = items.length;
    const done = items.filter((t) => t.done).length;

    if (total === 0) {
      counter.style.display = "none";
      counter.textContent = "";
      empty.style.display = "block";
      list.style.display = "none";
      return;
    }
    counter.style.display = "inline-block";
    counter.textContent = `${done} of ${total} ${
      total === 1 ? "task" : "tasks"
    } completed`;
    empty.style.display = "none";
    list.style.display = "flex";

    // active tasks first, done tasks last
    const sorted = [...items].sort((a, b) => Number(a.done) - Number(b.done));
    sorted.forEach((item) => {
      const li = document.createElement("li");
      li.className = "todo-item" + (item.done ? " done" : "");
      li.dataset.id = item.id;

      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "todo-check";
      check.checked = item.done;
      check.setAttribute("aria-label", "Mark task done");
      check.addEventListener("change", () => toggleDone(item.id));

      const text = document.createElement("span");
      text.className = "todo-text";
      text.textContent = item.text;
      text.title = "Click to edit";
      text.addEventListener("click", () => startEdit(item.id, text));

      const del = document.createElement("button");
      del.type = "button";
      del.className = "todo-delete";
      del.setAttribute("aria-label", "Delete task");
      del.innerHTML = "&times;";
      del.addEventListener("click", () => deleteTask(item.id));

      // Priority badge (emoji)
      const priority = item.priority || "medium";
      const badge = document.createElement("span");
      badge.className = "task-priority";
      badge.textContent = priorityEmoji[priority] || "🟡";
      badge.title =
        priority.charAt(0).toUpperCase() + priority.slice(1) + " priority";
      badge.setAttribute("aria-label", badge.title);

      li.appendChild(check);
      li.appendChild(badge);
      li.appendChild(text);
      li.appendChild(del);
      list.appendChild(li);
    });
  }

  // ---- mutations ----
  async function addTask(text) {
    const trimmed = text.trim();
    if (!trimmed || !selectedKey) return;

    if (useLocalFallback) {
      if (!tasks[selectedKey]) tasks[selectedKey] = [];
      tasks[selectedKey].push({
        id: uid(),
        text: trimmed,
        done: false,
        priority: currentPriority,
      });
      saveTasksLocal();
      renderCalendar();
      renderList();
      return;
    }

    try {
      // The todos table has columns: id, task, date.
      // `done`/`priority` are not DB columns, so we only insert task + date
      // and persist the chosen priority in local meta keyed by the new row id.
      const { data, error } = await supabase
        .from(TABLE)
        .insert({ task: trimmed, date: selectedKey })
        .select("id");
      if (error) throw error;
      // If the insert returned the new row, save its priority in meta.
      const newId = Array.isArray(data) && data[0] ? data[0].id : null;
      if (newId) setMeta(newId, { priority: currentPriority, done: false });
      clearError();
      await loadTasks();
      renderCalendar();
      renderList();
    } catch (err) {
      console.error("Failed to add todo:", err);
      showError("Couldn't save this task: " + (err?.message || err));
    }
  }

  async function toggleDone(id) {
    const items = tasks[selectedKey] || [];
    const item = items.find((t) => t.id === id);
    if (!item) return;

    if (useLocalFallback) {
      item.done = !item.done;
      saveTasksLocal();
      renderList();
      return;
    }

    // Update the `is_complete` column in Supabase so the done state is
    // persisted to the database (not just localStorage).
    const nextDone = !item.done;
    // Optimistic UI update for instant feedback.
    item.done = nextDone;
    renderList();

    try {
      const { error } = await supabase
        .from(TABLE)
        .update({ is_complete: nextDone })
        .eq("id", id);
      if (error) throw error;
      clearError();
      // Refresh from the DB so `is_complete` is the source of truth.
      await loadTasks();
      renderList();
    } catch (err) {
      console.error("Failed to update todo completion:", err);
      showError("Couldn't update the task: " + (err?.message || err));
      // Revert the optimistic change.
      item.done = !nextDone;
      renderList();
    }
  }

  async function deleteTask(id) {
    if (useLocalFallback) {
      const items = tasks[selectedKey] || [];
      const next = items.filter((t) => t.id !== id);
      if (next.length) tasks[selectedKey] = next;
      else delete tasks[selectedKey];
      saveTasksLocal();
      renderCalendar();
      renderList();
      return;
    }

    try {
      const { error } = await supabase.from(TABLE).delete().eq("id", id);
      if (error) throw error;
      deleteMeta(id); // drop the local done/priority state too
      clearError();
      await loadTasks();
      renderCalendar();
      renderList();
    } catch (err) {
      console.error("Failed to delete todo:", err);
      showError("Couldn't delete that task: " + (err?.message || err));
    }
  }

  async function editTask(id, newText) {
    const trimmed = newText.trim();
    const items = tasks[selectedKey] || [];
    const item = items.find((t) => t.id === id);
    // Only persist when the new text is non-empty and actually changed.
    if (!item || !trimmed || trimmed === item.text) {
      renderList();
      return;
    }

    if (useLocalFallback) {
      item.text = trimmed;
      saveTasksLocal();
      renderList();
      return;
    }

    try {
      const { error } = await supabase
        .from(TABLE)
        .update({ task: trimmed })
        .eq("id", id);
      if (error) throw error;
      clearError();
      await loadTasks();
      renderList();
    } catch (err) {
      console.error("Failed to edit todo:", err);
      showError("Couldn't save the edit: " + (err?.message || err));
      renderList();
    }
  }

  // Inline editing: swap the text span for an input on click.
  // Enter / blur → save, Escape → revert.
  function startEdit(id, spanEl) {
    const items = tasks[selectedKey] || [];
    const item = items.find((t) => t.id === id);
    if (!item) return;

    const inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.className = "todo-edit-input";
    inputEl.value = item.text;
    inputEl.setAttribute("aria-label", "Edit task");

    spanEl.replaceWith(inputEl);
    inputEl.focus();
    inputEl.select();

    let finished = false;
    function finish(save) {
      if (finished) return;
      finished = true;
      if (save) editTask(id, inputEl.value);
      else renderList();
    }

    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    inputEl.addEventListener("blur", () => finish(true));
  }

  // ---- events ----
  calPrev.addEventListener("click", () => {
    viewMonth -= 1;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear -= 1;
    }
    renderCalendar();
  });

  calNext.addEventListener("click", () => {
    viewMonth += 1;
    if (viewMonth > 11) {
      viewMonth = 0;
      viewYear += 1;
    }
    renderCalendar();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await addTask(input.value);
    input.value = "";
    input.focus();
  });

  // Priority picker — clicking a pill sets the priority for the next added task
  priorityBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentPriority = btn.dataset.priority;
      priorityBtns.forEach((b) =>
        b.classList.toggle("active", b === btn)
      );
    });
  });

  // ---- initial render ----
  (async function init() {
    await loadTasks();
    renderCalendar();
    renderList();
  })();
})();

// ============ Projects: Weather App ============
// Only runs on the Projects page; bails out silently on Home/About/Resume.
(function () {
  const form = document.getElementById("weather-form");
  if (!form) return;

  const input = document.getElementById("weather-input");
  const statusEl = document.getElementById("weather-status");
  const resultsEl = document.getElementById("weather-results");
  const unitBtns = document.querySelectorAll(".unit-btn");

  const API = "https://uapis.cn/api/v1/misc/weather";

  // Temperature unit preference, remembered like the site's theme setting.
  const UNIT_KEY = "weather-unit";
  let currentUnit = localStorage.getItem(UNIT_KEY) === "F" ? "F" : "C";

  // Last rendered result set, so switching units redraws without refetching.
  let lastQuery = null;
  let lastList = [];

  // Pinyin names that map to more than one Chinese city. The weather API
  // fuzzy-matches a single best guess, so an ambiguous name would otherwise
  // hide the alternatives — typing "Suzhou" returns only 宿州, never 苏州.
  // Every pair below was verified against the live API.
  const AMBIGUOUS = {
    suzhou: ["苏州", "宿州"], // Jiangsu / Anhui
    fuzhou: ["福州", "抚州"], // Fujian / Jiangxi
    taizhou: ["台州", "泰州"], // Zhejiang / Jiangsu
    yulin: ["榆林", "玉林"], // Shaanxi / Guangxi
    yichun: ["宜春", "伊春"], // Jiangxi / Heilongjiang
  };

  // Second data source, for the forecast only. UAPI's weather endpoint
  // returns current conditions and nothing else, so the 3-day outlook comes
  // from Open-Meteo (free, no API key, CORS-enabled).
  const GEO_API = "https://geocoding-api.open-meteo.com/v1/search";
  const FORECAST_API = "https://api.open-meteo.com/v1/forecast";

  // WMO weather codes (Open-Meteo) -> our icon names.
  function iconFromWmo(code) {
    const c = Number(code);
    if (c === 0) return "sun";
    if (c === 1 || c === 2) return "partly";
    if (c === 3) return "cloud";
    if (c === 45 || c === 48) return "fog";
    if (c >= 51 && c <= 67) return "rain";
    if (c >= 71 && c <= 77) return "snow";
    if (c >= 80 && c <= 82) return "rain";
    if (c === 85 || c === 86) return "snow";
    if (c >= 95) return "thunder";
    return "cloud";
  }

  const WMO_EN = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Dense drizzle",
    56: "Freezing drizzle",
    57: "Freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Light showers",
    81: "Showers",
    82: "Violent showers",
    85: "Snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Thunderstorm with heavy hail",
  };

  // GeoNames (behind Open-Meteo's geocoder) indexes Latin names only, so the
  // Chinese name UAPI returns can't be geocoded directly. When one query maps
  // to several cities we disambiguate by comparing UAPI's province to the
  // geocoder's `admin1`.
  const PROVINCE_EN = {
    "北京市": "Beijing",
    "天津市": "Tianjin",
    "上海市": "Shanghai",
    "重庆市": "Chongqing",
    "河北省": "Hebei",
    "山西省": "Shanxi",
    "辽宁省": "Liaoning",
    "吉林省": "Jilin",
    "黑龙江省": "Heilongjiang",
    "江苏省": "Jiangsu",
    "浙江省": "Zhejiang",
    "安徽省": "Anhui",
    "福建省": "Fujian",
    "江西省": "Jiangxi",
    "山东省": "Shandong",
    "河南省": "Henan",
    "湖北省": "Hubei",
    "湖南省": "Hunan",
    "广东省": "Guangdong",
    "海南省": "Hainan",
    "四川省": "Sichuan",
    "贵州省": "Guizhou",
    "云南省": "Yunnan",
    "陕西省": "Shaanxi",
    "甘肃省": "Gansu",
    "青海省": "Qinghai",
    "台湾省": "Taiwan",
    "内蒙古自治区": "Nei Mongol",
    "广西壮族自治区": "Guangxi",
    "西藏自治区": "Xizang",
    "宁夏回族自治区": "Ningxia",
    "新疆维吾尔自治区": "Xinjiang",
    "香港特别行政区": "Hong Kong",
    "澳门特别行政区": "Macau",
  };

  // Inline SVG weather icons (stroke style, matches the rest of the site).
  // All are drawn in a 24x24 viewBox so they scale cleanly.
  const ICON_SVG = {
    sun:
      '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/>',
    partly:
      '<circle cx="8" cy="7.5" r="3"/><path d="M8 2v1.6M8 11.4V13M2.5 7.5H4.1M11.9 7.5h1.6M4.2 3.7l1.1 1.1M10.7 10.2l1.1 1.1"/><path d="M18.5 12.5h-.9A6.2 6.2 0 1 0 11.5 19.5h7a3.5 3.5 0 0 0 0-7z"/>',
    cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
    rain:
      '<path d="M17 10.5h-.95A6.6 6.6 0 1 0 10 17.5h7a3.5 3.5 0 0 0 0-7z"/><path d="M8.5 20l-1 2.4M12.5 20l-1 2.4M16.5 20l-1 2.4"/>',
    thunder:
      '<path d="M17 10.5h-.95A6.6 6.6 0 1 0 10 17.5h7a3.5 3.5 0 0 0 0-7z"/><path d="M13 18.2l-2.2 3h1.8l-2.2 3"/>',
    snow:
      '<path d="M17 10.5h-.95A6.6 6.6 0 1 0 10 17.5h7a3.5 3.5 0 0 0 0-7z"/><path d="M9 20.5v.01M12.5 22v.01M16 20.5v.01"/>',
    fog:
      '<path d="M17 10.5h-.95A6.6 6.6 0 1 0 10 17.5h7a3.5 3.5 0 0 0 0-7z"/><path d="M5 21h14"/>',
    wind:
      '<path d="M2.5 8.5h10.5a2.8 2.8 0 1 0-2.8-2.8"/><path d="M2.5 12.5h15a2.8 2.8 0 1 1-2.8 2.8"/><path d="M2.5 16.5h8.5"/>',
  };

  function renderIcon(name) {
    const body = ICON_SVG[name] || ICON_SVG.cloud;
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      body +
      "</svg>"
    );
  }

  // The API returns its `weather_icon` as a numeric code string.
  //   1xx clear/cloudy, 2xx wind, 3xx rain, 4xx snow, 5xx fog/haze
  function iconName(code, condition) {
    if (condition && /雷|闪电/.test(condition)) return "thunder";
    const n = parseInt(code, 10);
    if (isNaN(n)) return "cloud";
    if (n === 100) return "sun";
    if (n === 101 || n === 102 || n === 103) return "partly";
    if (n === 104) return "cloud";
    if (n >= 200 && n < 300) return "wind";
    if (n >= 300 && n < 400) return "rain";
    if (n >= 400 && n < 500) return "snow";
    if (n >= 500 && n < 600) return "fog";
    return "cloud";
  }

  // The API describes conditions in Chinese; map the common ones to English
  // so the card reads consistently with the rest of the (English) site.
  const CONDITION_EN = {
    "晴": "Sunny",
    "多云": "Cloudy",
    "少云": "Partly cloudy",
    "晴间多云": "Mostly cloudy",
    "阴": "Overcast",
    "阴天": "Overcast",
    "小雨": "Light rain",
    "中雨": "Rain",
    "大雨": "Heavy rain",
    "暴雨": "Rainstorm",
    "大暴雨": "Torrential rain",
    "雷阵雨": "Thunderstorm",
    "强雷阵雨": "Severe thunderstorm",
    "阵雨": "Showers",
    "毛毛雨": "Drizzle",
    "小毛毛雨": "Light drizzle",
    "小雪": "Light snow",
    "中雪": "Snow",
    "大雪": "Heavy snow",
    "雨夹雪": "Sleet",
    "雾": "Fog",
    "霾": "Haze",
    "浮尘": "Dust",
    "扬沙": "Blowing sand",
    "沙尘暴": "Sandstorm",
    "大风": "Windy",
    "强风": "Strong wind",
    "龙卷风": "Tornado",
  };

  function setStatus(msg, kind) {
    statusEl.textContent = msg || "";
    statusEl.className = "weather-status" + (kind ? " is-" + kind : "");
    statusEl.hidden = !msg;
  }

  // Build one result card: current conditions on top, 3-day outlook below.
  function buildResultCard(item) {
    const data = item.data;

    const card = document.createElement("div");
    card.className = "weather-result";

    const current = document.createElement("div");
    current.className = "weather-current";

    const icon = document.createElement("div");
    icon.className = "weather-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = renderIcon(iconName(data.weather_icon, data.weather));

    const info = document.createElement("div");
    info.className = "weather-info";

    const city = document.createElement("div");
    city.className = "weather-city";
    const region =
      data.province && data.city && data.province !== data.city
        ? ", " + data.province
        : "";
    city.textContent = (data.city || data.province || "Unknown") + region;

    const temp = document.createElement("div");
    temp.className = "weather-temp";
    temp.textContent = formatTemp(data.temperature);

    const cond = document.createElement("div");
    cond.className = "weather-cond";
    const condEn = CONDITION_EN[data.weather] || data.weather || "—";
    cond.textContent =
      data.weather && condEn !== data.weather
        ? condEn + " · " + data.weather
        : condEn;

    const meta = document.createElement("div");
    meta.className = "weather-meta";
    const bits = [];
    if (data.wind_direction || data.wind_power) {
      bits.push([data.wind_direction, data.wind_power].filter(Boolean).join(" "));
    }
    if (typeof data.humidity === "number") {
      bits.push("Humidity " + data.humidity + "%");
    }
    if (data.report_time) bits.push(data.report_time);
    meta.textContent = bits.join(" · ");

    info.appendChild(city);
    info.appendChild(temp);
    info.appendChild(cond);
    info.appendChild(meta);
    current.appendChild(icon);
    current.appendChild(info);
    card.appendChild(current);

    if (item.daily && item.daily.time && item.daily.time.length) {
      card.appendChild(buildForecast(item.daily));
    }

    return card;
  }

  // The Open-Meteo daily array: parallel lists of time/weather_code/min/max.
  function buildForecast(daily) {
    const wrap = document.createElement("div");
    wrap.className = "weather-forecast";

    const title = document.createElement("p");
    title.className = "forecast-title";
    title.textContent = "3-day forecast · °" + currentUnit;
    wrap.appendChild(title);

    const days = document.createElement("div");
    days.className = "forecast-days";

    daily.time.forEach((iso, i) => {
      const code = daily.weather_code[i];

      const day = document.createElement("div");
      day.className = "forecast-day";

      const label = document.createElement("span");
      label.className = "forecast-name";
      label.textContent = dayLabel(iso, i);

      const ic = document.createElement("span");
      ic.className = "forecast-icon";
      ic.title = WMO_EN[code] || "Forecast";
      ic.innerHTML = renderIcon(iconFromWmo(code));

      const tp = document.createElement("span");
      tp.className = "forecast-temp";
      const hi = document.createElement("span");
      hi.className = "forecast-hi";
      hi.textContent = tempNumber(daily.temperature_2m_max[i]) + "°";
      const lo = document.createElement("span");
      lo.textContent = " / " + tempNumber(daily.temperature_2m_min[i]) + "°";
      tp.appendChild(hi);
      tp.appendChild(lo);

      day.appendChild(label);
      day.appendChild(ic);
      day.appendChild(tp);
      days.appendChild(day);
    });

    wrap.appendChild(days);
    return wrap;
  }

  // Both sources report Celsius; convert for display when °F is selected.
  function tempNumber(celsius) {
    if (typeof celsius !== "number" || isNaN(celsius)) return "—";
    return Math.round(currentUnit === "F" ? (celsius * 9) / 5 + 32 : celsius);
  }

  function formatTemp(celsius) {
    const n = tempNumber(celsius);
    return n === "—" ? "—" : n + "°" + currentUnit;
  }

  function dayLabel(isoDate, index) {
    if (index === 0) return "Today";
    const p = isoDate.split("-").map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);
    return d.toLocaleDateString("en-US", { weekday: "short" });
  }

  // Geocode once per search. A Chinese query yields no candidates (the index
  // is Latin-only), which simply means no forecast — current weather is
  // unaffected.
  async function geocodeCandidates(query) {
    try {
      const url =
        GEO_API +
        "?name=" +
        encodeURIComponent(query) +
        "&count=10&language=en&format=json";
      const res = await fetch(url);
      if (!res.ok) return [];
      const json = await res.json();
      return (json && json.results) || [];
    } catch (err) {
      return [];
    }
  }

  // Choose the candidate whose province matches the one UAPI reported.
  function pickCoords(candidates, provinceCn) {
    if (!candidates.length) return null;
    const want = provinceCn ? PROVINCE_EN[provinceCn] : null;
    if (want) {
      const hit = candidates.find((c) => c.admin1 === want);
      if (hit) return hit;
    }
    return candidates[0];
  }

  async function fetchDaily(latitude, longitude) {
    try {
      const url =
        FORECAST_API +
        "?latitude=" +
        latitude +
        "&longitude=" +
        longitude +
        "&daily=weather_code,temperature_2m_max,temperature_2m_min" +
        "&timezone=auto&forecast_days=3";
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = await res.json();
      return json && json.daily ? json.daily : null;
    } catch (err) {
      return null;
    }
  }

  // Redraw whatever was last fetched, using the current unit.
  function paintResults() {
    resultsEl.innerHTML = "";
    if (lastList.length > 1 && lastQuery) {
      const head = document.createElement("p");
      head.className = "weather-matches";
      head.textContent =
        lastList.length + ' matches for "' + lastQuery.trim() + '"';
      resultsEl.appendChild(head);
    }
    lastList.forEach((item) => resultsEl.appendChild(buildResultCard(item)));
    resultsEl.hidden = lastList.length === 0;
  }

  function clearResults() {
    lastQuery = null;
    lastList = [];
    resultsEl.innerHTML = "";
    resultsEl.hidden = true;
  }

  // Render one or more cards. A query that matched several cities gets a
  // short header so it's clear they are alternatives, not duplicates.
  function renderResults(query, list) {
    lastQuery = query;
    lastList = list;
    paintResults();
  }

  // Fetch one city. Returns a tagged result instead of throwing, so the
  // caller can distinguish "no such city" from "too many requests".
  async function fetchWeatherFor(city) {
    const res = await fetch(API + "?city=" + encodeURIComponent(city));
    if (res.status === 404) return { kind: "notfound" };
    if (res.status === 429) return { kind: "ratelimited" };
    if (!res.ok) return { kind: "error" };
    const data = await res.json();
    if (!data || (data.city == null && data.weather == null)) {
      return { kind: "notfound" };
    }
    return { kind: "ok", data: data };
  }

  async function searchWeather(rawQuery) {
    clearResults();
    setStatus("Loading…", "loading");

    // Normalise so "Su Zhou", "suzhou" and "Suzhou" all hit the same key.
    const key = rawQuery.trim().toLowerCase().replace(/\s+/g, "");
    const variants = AMBIGUOUS[key];

    try {
      let items;

      if (variants && variants.length > 1) {
        // Ambiguous pinyin: look up every candidate and show them all.
        const settled = await Promise.all(variants.map(fetchWeatherFor));
        const ok = settled.filter((r) => r.kind === "ok");
        if (!ok.length) {
          setStatus(
            settled.some((r) => r.kind === "ratelimited")
              ? "Too many requests — please wait a moment and try again."
              : "Couldn't find that city — check the spelling.",
            "error"
          );
          return;
        }
        items = ok.map((r) => ({ data: r.data, daily: null }));
      } else {
        const r = await fetchWeatherFor(rawQuery);
        if (r.kind === "notfound") {
          setStatus("Couldn't find that city — check the spelling.", "error");
          return;
        }
        if (r.kind === "ratelimited") {
          setStatus(
            "Too many requests — please wait a moment and try again.",
            "error"
          );
          return;
        }
        if (r.kind === "error") {
          setStatus(
            "Something went wrong fetching the weather. Please try again.",
            "error"
          );
          return;
        }
        items = [{ data: r.data, daily: null }];
      }

      // The outlook comes from Open-Meteo: one geocode for the whole search,
      // then one forecast per city. A missing forecast is non-fatal — the
      // current-conditions card still renders.
      const candidates = await geocodeCandidates(rawQuery);
      await Promise.all(
        items.map(async (item) => {
          const hit = pickCoords(candidates, item.data.province);
          if (hit) item.daily = await fetchDaily(hit.latitude, hit.longitude);
        })
      );

      setStatus("", null);
      renderResults(variants ? rawQuery : null, items);
    } catch (err) {
      console.error("Weather lookup failed:", err);
      setStatus(
        "Couldn't reach the weather service. Check your connection and try again.",
        "error"
      );
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const city = input.value.trim();

    // Empty input: show the hint and never hit the API.
    if (!city) {
      clearResults();
      setStatus("Enter a city first.", "error");
      return;
    }

    searchWeather(city);
  });

  // °C / °F toggle — redraws existing results, never refetches.
  function applyUnitButtons() {
    unitBtns.forEach((btn) => {
      const on = btn.dataset.unit === currentUnit;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  unitBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (currentUnit === btn.dataset.unit) return;
      currentUnit = btn.dataset.unit;
      localStorage.setItem(UNIT_KEY, currentUnit);
      applyUnitButtons();
      if (lastList.length) paintResults();
    });
  });

  applyUnitButtons();
})();

// ============ Projects: World Time ============
// Only runs on the Projects page; bails out silently on Home/About/Resume.
(function () {
  const form = document.getElementById("worldtime-form");
  if (!form) return;

  const input = document.getElementById("worldtime-input");
  const statusEl = document.getElementById("worldtime-status");
  const resultsEl = document.getElementById("worldtime-results");

  const API = "https://uapis.cn/api/v1/misc/worldtime";

  // Clock icon, drawn in the same 24x24 stroke style as the weather icons.
  const CLOCK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="9"/><path d="M12 7.4V12l3.2 2"/></svg>';

  function setStatus(msg, kind) {
    statusEl.textContent = msg || "";
    statusEl.className = "weather-status" + (kind ? " is-" + kind : "");
    statusEl.hidden = !msg;
  }

  function clearResults() {
    resultsEl.innerHTML = "";
    resultsEl.hidden = true;
  }

  // The API's `offset_string` reads "UTC8" / "UTC-4" — no sign on positive
  // offsets, and no half-hour zones — so derive a conventional label instead.
  function offsetLabel(seconds) {
    if (typeof seconds !== "number" || isNaN(seconds)) return "";
    const abs = Math.abs(seconds);
    const hours = Math.floor(abs / 3600);
    const mins = Math.floor((abs % 3600) / 60);
    const sign = seconds < 0 ? "-" : "+";
    return "UTC" + sign + hours + (mins ? ":" + String(mins).padStart(2, "0") : "");
  }

  // "2026-10-16 09:43:51" -> "09:43"
  function clockTime(datetime) {
    const m = /(\d{2}:\d{2})/.exec(datetime || "");
    return m ? m[1] : "—";
  }

  // "2026-10-16" + "Friday" -> "Friday, 16 October 2026"
  function dateLabel(datetime, weekday) {
    const p = /^(\d{4})-(\d{2})-(\d{2})/.exec(datetime || "");
    if (!p) return weekday || "";
    const d = new Date(Number(p[1]), Number(p[2]) - 1, Number(p[3]));
    const date = d.toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return weekday ? weekday + ", " + date : date;
  }

  // Reuses the weather card's classes so both project cards look alike.
  function buildCard(data) {
    const card = document.createElement("div");
    card.className = "weather-result";

    const row = document.createElement("div");
    row.className = "weather-current";

    const icon = document.createElement("div");
    icon.className = "weather-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = CLOCK_SVG;

    const info = document.createElement("div");
    info.className = "weather-info";

    const city = document.createElement("div");
    city.className = "weather-city";
    city.textContent = data.query || "Unknown";

    const time = document.createElement("div");
    time.className = "worldtime-time";
    time.textContent = clockTime(data.datetime);

    const day = document.createElement("div");
    day.className = "weather-cond";
    day.textContent = dateLabel(data.datetime, data.weekday);

    const meta = document.createElement("div");
    meta.className = "weather-meta";
    meta.textContent = [data.timezone, offsetLabel(data.offset_seconds)]
      .filter(Boolean)
      .join(" · ");

    info.appendChild(city);
    info.appendChild(time);
    info.appendChild(day);
    info.appendChild(meta);
    row.appendChild(icon);
    row.appendChild(info);
    card.appendChild(row);
    return card;
  }

  // Returns a tagged result instead of throwing, so the caller can tell
  // "no such city" apart from "too many requests".
  async function fetchTimeFor(city) {
    const res = await fetch(API + "?city=" + encodeURIComponent(city));
    if (res.status === 404) return { kind: "notfound" };
    if (res.status === 429) return { kind: "ratelimited" };
    if (!res.ok) return { kind: "error" };
    const data = await res.json();
    if (!data || !data.datetime) return { kind: "notfound" };
    return { kind: "ok", data: data };
  }

  async function searchTime(rawQuery) {
    clearResults();
    setStatus("Loading…", "loading");

    try {
      let r = await fetchTimeFor(rawQuery);

      // The API's city list is keyed by unspaced names ("NewYork", not
      // "New York"), so retry once without spaces before giving up.
      if (r.kind === "notfound" && /\s/.test(rawQuery)) {
        r = await fetchTimeFor(rawQuery.replace(/\s+/g, ""));
      }

      if (r.kind === "notfound") {
        setStatus("Couldn't find that city — check the spelling.", "error");
        return;
      }
      if (r.kind === "ratelimited") {
        setStatus("Too many requests — please wait a moment and try again.", "error");
        return;
      }
      if (r.kind === "error") {
        setStatus("Something went wrong fetching the time. Please try again.", "error");
        return;
      }

      setStatus("", null);
      resultsEl.appendChild(buildCard(r.data));
      resultsEl.hidden = false;
    } catch (err) {
      console.error("World time lookup failed:", err);
      setStatus(
        "Couldn't reach the time service. Check your connection and try again.",
        "error"
      );
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const city = input.value.trim();

    // Empty input: show the hint and never hit the API.
    if (!city) {
      clearResults();
      setStatus("Enter a city first.", "error");
      return;
    }

    searchTime(city);
  });
})();
