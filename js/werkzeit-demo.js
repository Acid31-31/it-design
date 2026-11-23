(function () {
  "use strict";

  if (window.top !== window.self) {
    try { window.top.location.replace(window.self.location.href); } catch (e) {}
  }

  try {
    var params = new URLSearchParams(window.location.search);
    if (params.get("intern") === "1") localStorage.setItem("itdesigns-intern", "1");
    var intern = localStorage.getItem("itdesigns-intern") === "1";
    if (!intern && location.hostname !== "localhost" && location.hostname !== "127.0.0.1" && location.protocol !== "file:") {
      var count = document.createElement("script");
      count.async = true;
      count.src = "https://gc.zgo.at/count.js";
      count.setAttribute("data-goatcounter", "https://itdesigns-kruft.goatcounter.com/count");
      document.head.appendChild(count);
    }
  } catch (e) {}

  var MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
  var STATUS = {
    WORKED: "Arbeit", VACATION: "Urlaub", HALF_VACATION: "Urlaub ½", SICK: "Krank",
    SICK_REST: "Krank Rest", HOME_OFFICE: "Homeoffice", TIME_OFF: "Zeitausgleich",
    HOLIDAY: "Feiertag", BRIDGE_DAY: "Gleittag", SHORT_TIME: "Kurzarbeit",
    ON_CALL: "Bereitschaft", NONE: "", OTHER: "Sonstiges"
  };
  var HOLIDAYS = {
    "2026-01-01": "Neujahr", "2026-04-03": "Karfreitag", "2026-04-06": "Ostermontag",
    "2026-05-01": "Tag der Arbeit", "2026-05-14": "Christi Himmelfahrt",
    "2026-05-25": "Pfingstmontag", "2026-06-04": "Fronleichnam",
    "2026-10-03": "Tag der Deutschen Einheit", "2026-11-01": "Allerheiligen",
    "2026-12-25": "1. Weihnachtstag", "2026-12-26": "2. Weihnachtstag"
  };
  var CODES = [
    { code: "F", name: "Feiertag", factor_type: "NUMBER", behavior: "HOLIDAY" },
    { code: "G", name: "Gleittag", factor_type: "NUMBER", behavior: "BRIDGE_DAY" },
    { code: "K", name: "Krank", factor_type: "NUMBER", behavior: "SICKNESS" },
    { code: "U", name: "Urlaub", factor_type: "NUMBER", behavior: "VACATION" },
    { code: "UH", name: "Urlaub ½ Tag", factor_type: "NUMBER", behavior: "VACATION" },
    { code: "H", name: "Homeoffice", factor_type: "NUMBER", behavior: "HOME_OFFICE" },
    { code: "ZA", name: "Zeitausgleich", factor_type: "NUMBER", behavior: "TIME_OFF" }
  ];
  var NAV = [
    { id: "dashboard", label: "Heute alle" },
    { id: "team", label: "Übersicht alle" },
    { id: "employees", label: "Mitarbeiter anlegen" },
    { id: "excel", label: "Excel" },
    { id: "settings", label: "Einstellungen" }
  ];
  var STORE_KEY = "werkzeit-demo-v2";
  var LABELS = {
    CLOCK_IN: "Kommen", CLOCK_OUT: "Gehen", BREAK_START: "Pause",
    BREAK_END: "Pause Ende", APPOINTMENT_START: "Termin", APPOINTMENT_END: "Wieder da"
  };

  var state = null;
  var me = { username: "admin", role: "admin", display_name: "Geschäftsleitung" };
  var currentView = "dashboard";
  var selectedEmployeeId = null;
  var personTab = "month";
  var lastPunchMsg = "";
  var screenMode = "chef";
  var pendingAction = null;
  var viewingKonto = false;
  var resetTimer = null;
  var busy = false;
  var lastActivity = Date.now();

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function fmtMin(m) {
    m = Math.round(m || 0);
    var sign = m < 0 ? "-" : "";
    m = Math.abs(m);
    return sign + pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  }
  function parseHM(s) {
    if (!s) return 0;
    var p = s.split(":");
    return Number(p[0]) * 60 + Number(p[1] || 0);
  }
  function isoDate(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function isoLocal(d) {
    return isoDate(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }
  function todayStr() { return isoDate(new Date()); }
  function clockText() {
    return new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  function germanDate(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    return p[2] + "." + p[1] + "." + p[0];
  }
  function weekday(dateStr) { return new Date(dateStr + "T12:00:00").getDay(); }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function el(html) {
    var box = document.createElement("div");
    box.innerHTML = html.trim();
    return box.firstElementChild;
  }
  function rng(seed) {
    var x = seed >>> 0;
    return function () {
      x = (Math.imul(1664525, x) + 1013904223) >>> 0;
      return x / 4294967296;
    };
  }
  function hmFromMin(base, jitter, rand) {
    var m = base + Math.round((rand() - 0.5) * jitter);
    if (m < 0) m = 0;
    return pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  }

  function emptyDay(dateStr) {
    var hol = HOLIDAYS[dateStr] || "";
    var wd = weekday(dateStr);
    var weekend = wd === 0 || wd === 6;
    return {
      date: dateStr, holiday_name: hol, kommt1: "", geht1: "", kommt2: "", geht2: "",
      pause: "", code: hol ? "F" : "", ist: "00:00", soll: (weekend || hol) ? "00:00" : "08:00",
      delta: (weekend || hol) ? "00:00" : "-08:00", az: "00:00",
      status: hol ? "HOLIDAY" : (weekend ? "NONE" : "WORKED"), remarks: "",
      incomplete: false, pause_warning: false, ist_min: 0, soll_min: (weekend || hol) ? 0 : 480
    };
  }

  function workDay(dateStr, rand, opts) {
    var row = emptyDay(dateStr);
    if (row.soll_min === 0) return row;
    opts = opts || {};
    if (opts.code === "U") {
      row.code = "U"; row.status = "VACATION"; row.ist = "08:00"; row.ist_min = 480;
      row.delta = "00:00"; row.remarks = "Urlaub"; return row;
    }
    if (opts.code === "K") {
      row.code = "K"; row.status = "SICK"; row.ist = "08:00"; row.ist_min = 480;
      row.delta = "00:00"; row.remarks = "Krank"; return row;
    }
    row.kommt1 = hmFromMin(7 * 60, 24, rand);
    row.geht1 = hmFromMin(16 * 60 + 12, 28, rand);
    row.pause = "00:30";
    var ist = parseHM(row.geht1) - parseHM(row.kommt1) - 30;
    if (ist < 0) ist = 0;
    row.ist_min = ist;
    row.ist = fmtMin(ist);
    row.delta = fmtMin(ist - row.soll_min);
    row.az = row.ist;
    if (opts.incomplete) {
      row.geht1 = ""; row.ist = "00:00"; row.ist_min = 0; row.delta = "-08:00";
      row.incomplete = true; row.remarks = "Geht fehlt";
    }
    return row;
  }

  function seedEmployees() {
    var people = [
      { id: 1, personal_number: "101", first_name: "Anna", last_name: "Müller", rfid_id: "1001", vacation_total: 30, vacation_taken: 18, opening: 744, start: "PRESENT" },
      { id: 2, personal_number: "102", first_name: "Bernd", last_name: "Schmidt", rfid_id: "1002", vacation_total: 30, vacation_taken: 12, opening: -96, start: "ON_BREAK" },
      { id: 3, personal_number: "103", first_name: "Clara", last_name: "Weber", rfid_id: "1003", vacation_total: 30, vacation_taken: 22, opening: 188, start: "ABSENT" },
      { id: 4, personal_number: "104", first_name: "David", last_name: "Hoffmann", rfid_id: "1004", vacation_total: 28, vacation_taken: 16, opening: 42, start: "VACATION" },
      { id: 5, personal_number: "105", first_name: "Eva", last_name: "Klein", rfid_id: "1005", vacation_total: 30, vacation_taken: 9, opening: 315, start: "PRESENT" }
    ];
    var today = new Date();
    var year = today.getFullYear();
    var month = today.getMonth() + 1;
    var todayIso = todayStr();
    return people.map(function (p) {
      var emp = {
        id: p.id,
        personal_number: p.personal_number,
        first_name: p.first_name,
        last_name: p.last_name,
        display_name: p.last_name + ", " + p.first_name,
        rfid_id: p.rfid_id,
        excel_path: "C:\\Zeiterfassung\\Arbeitszeit-" + p.last_name + "-" + p.first_name + ".xlsx",
        vacation_total: p.vacation_total,
        vacation_taken: p.vacation_taken,
        opening: p.opening,
        active: 1,
        days: {},
        punches: [],
        yearMonths: {}
      };
      var rand = rng(p.id * 9176 + 42);
      for (var m = 1; m <= 12; m++) {
        var ist = 0, soll = 0, vac = 0, sick = 0, presence = 0;
        var dim = daysInMonth(year, m);
        for (var d = 1; d <= dim; d++) {
          var dateStr = year + "-" + pad(m) + "-" + pad(d);
          if (dateStr > todayIso) continue;
          var row;
          if (dateStr === todayIso) {
            row = emptyDay(dateStr);
            if (p.start === "VACATION") {
              row = workDay(dateStr, rand, { code: "U" });
            }
          } else if (m === 7 && d >= 6 && d <= 17 && p.id !== 5) {
            row = workDay(dateStr, rand, { code: "U" });
          } else if (m === 8 && d >= 3 && d <= 7 && p.id !== 2) {
            row = workDay(dateStr, rand, { code: "U" });
          } else if (m === month && d === 12 && p.id === 2) {
            row = workDay(dateStr, rand, { incomplete: true });
          } else if (m === month && d === 6 && p.id === 3) {
            row = workDay(dateStr, rand, { code: "U" });
          } else if (m === month && d === 7 && p.id === 3) {
            row = workDay(dateStr, rand, { code: "U" });
          } else if (m === month && d === 19 && p.id === 5) {
            row = workDay(dateStr, rand, { code: "K" });
          } else {
            row = workDay(dateStr, rand, {});
          }
          emp.days[dateStr] = row;
          ist += row.ist_min;
          soll += row.soll_min;
          if (row.code === "U") vac += 1;
          if (row.code === "K") sick += 1;
          if (row.kommt1) presence += 1;
        }
        if (m < month) {
          soll = 168 * 60;
          vac = m === 7 ? 10 : (m === 8 ? 5 : (rand() > 0.78 ? 2 : 0));
          sick = rand() > 0.88 ? 1 : 0;
          presence = 21 + Math.round(rand() * 2);
          ist = soll + Math.round((rand() - 0.42) * 5 * 60);
        }
        emp.yearMonths[m] = {
          month: m, ist: ist, soll: soll, vacation: vac, sick: sick,
          presence: presence, time_off: 0
        };
      }
      var t0 = new Date();
      if (p.start === "PRESENT" || p.start === "ON_BREAK") {
        var inAt = new Date(t0.getTime());
        inAt.setHours(p.id === 5 ? 7 : 6, p.id === 1 ? 52 : 48, 0, 0);
        emp.punches.push({ event: "CLOCK_IN", ts: isoLocal(inAt) });
        emp.days[todayIso].kommt1 = pad(inAt.getHours()) + ":" + pad(inAt.getMinutes());
      }
      if (p.start === "ON_BREAK") {
        var br = new Date(t0.getTime());
        br.setHours(11, 5, 0, 0);
        if (br > t0) br = new Date(t0.getTime() - 18 * 60000);
        emp.punches.push({ event: "BREAK_START", ts: isoLocal(br) });
      }
      return emp;
    });
  }

  function defaultState() {
    var now = new Date();
    return {
      employees: seedEmployees(),
      nextId: 6,
      debounce: 3,
      lastPunchAt: {},
      excelLog: [
        { time: pad(now.getHours()) + ":" + pad(Math.max(0, now.getMinutes() - 8)), name: "Müller, Anna", label: "Kommen", file: "Arbeitszeit-Müller-Anna.xlsx" },
        { time: pad(now.getHours()) + ":" + pad(Math.max(0, now.getMinutes() - 6)), name: "Schmidt, Bernd", label: "Pause", file: "Arbeitszeit-Schmidt-Bernd.xlsx" },
        { time: pad(now.getHours()) + ":" + pad(Math.max(0, now.getMinutes() - 4)), name: "Klein, Eva", label: "Kommen", file: "Arbeitszeit-Klein-Eva.xlsx" }
      ],
      backups: [
        { name: "werkzeit-2026-11-20.db", mtime: "20.11.2026 18:02" },
        { name: "werkzeit-2026-11-13.db", mtime: "13.11.2026 18:04" }
      ]
    };
  }

  function loadState() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.employees || !parsed.employees.length) return defaultState();
      return parsed;
    } catch (e) {
      return defaultState();
    }
  }

  function saveState() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function empById(id) {
    return state.employees.find(function (e) { return e.id === Number(id); });
  }

  function empByCode(code) {
    var token = String(code || "").trim();
    if (!token) return null;
    var candidates = [token];
    if (/^\d+$/.test(token)) {
      candidates.push(token.padStart(4, "0"));
      candidates.push(token.replace(/^0+/, "") || "0");
    }
    return state.employees.find(function (e) {
      return e.active !== 0 && candidates.indexOf(String(e.rfid_id || "")) !== -1;
    }) || null;
  }

  function lastPunch(emp) {
    if (!emp.punches || !emp.punches.length) return null;
    return emp.punches[emp.punches.length - 1];
  }

  function presenceStatus(emp) {
    var p = lastPunch(emp);
    if (!p) return emp.days[todayStr()] && emp.days[todayStr()].code === "U" ? "ABSENT" : "ABSENT";
    if (p.event === "CLOCK_IN" || p.event === "BREAK_END" || p.event === "APPOINTMENT_END") return "PRESENT";
    if (p.event === "BREAK_START") return "ON_BREAK";
    if (p.event === "APPOINTMENT_START") return "ON_APPOINTMENT";
    return "ABSENT";
  }

  function statusLabel(status) {
    if (status === "PRESENT") return "Anwesend";
    if (status === "ON_BREAK") return "Pause";
    if (status === "ON_APPOINTMENT") return "Beim Termin";
    return "Abwesend";
  }

  function nextEvent(status) {
    if (status === "ABSENT") return "CLOCK_IN";
    if (status === "ON_BREAK") return "BREAK_END";
    if (status === "ON_APPOINTMENT") return "APPOINTMENT_END";
    return "CLOCK_OUT";
  }

  function resolveEvent(status, eventType) {
    if (eventType === "APPOINTMENT") return status === "ON_APPOINTMENT" ? "APPOINTMENT_END" : "APPOINTMENT_START";
    if (eventType === "BREAK_START" || eventType === "BREAK_END") return eventType;
    if (eventType === "CLOCK_IN" || eventType === "CLOCK_OUT") return eventType;
    return nextEvent(status);
  }

  function computeToday(emp, now) {
    now = now || new Date();
    var dateStr = isoDate(now);
    var punches = (emp.punches || []).filter(function (p) { return p.ts.slice(0, 10) === dateStr; });
    var kommt1 = "", geht1 = "", kommt2 = "", geht2 = "", pause = 0, work = 0, open = null, br = null, slot = 1;
    punches.forEach(function (p) {
      var t = p.ts.slice(11, 16);
      if (p.event === "CLOCK_IN" || p.event === "BREAK_END" || p.event === "APPOINTMENT_END") {
        open = p.ts;
        if (p.event === "CLOCK_IN") {
          if (slot === 1 && !kommt1) kommt1 = t;
          else if (!kommt2) kommt2 = t;
        }
        if (p.event === "BREAK_END" && br) {
          pause += Math.max(0, Math.round((new Date(p.ts) - new Date(br)) / 60000));
          br = null;
        }
      } else if (p.event === "CLOCK_OUT" || p.event === "BREAK_START" || p.event === "APPOINTMENT_START") {
        if (open) {
          work += Math.max(0, Math.round((new Date(p.ts) - new Date(open)) / 60000));
          open = null;
        }
        if (p.event === "CLOCK_OUT") {
          if (slot === 1 && !geht1) { geht1 = t; slot = 2; }
          else geht2 = t;
        }
        if (p.event === "BREAK_START") br = p.ts;
      }
    });
    if (open) work += Math.max(0, Math.round((now - new Date(open)) / 60000));
    if (br) pause += Math.max(0, Math.round((now - new Date(br)) / 60000));
    var row = emp.days[dateStr] ? Object.assign({}, emp.days[dateStr]) : emptyDay(dateStr);
    if (row.code === "U") return row;
    row.kommt1 = kommt1; row.geht1 = geht1; row.kommt2 = kommt2; row.geht2 = geht2;
    row.pause = pause ? fmtMin(pause) : "";
    row.ist_min = work;
    row.ist = fmtMin(work);
    row.az = row.ist;
    row.delta = fmtMin(work - (row.soll_min || 0));
    row.incomplete = Boolean(kommt1 && !geht1 && presenceStatus(emp) === "ABSENT");
    row.pause_warning = presenceStatus(emp) === "ON_BREAK" && pause >= 45;
    row.status = "WORKED";
    emp.days[dateStr] = row;
    return row;
  }

  function yearIst(emp) {
    var y = new Date().getFullYear();
    var month = new Date().getMonth() + 1;
    var today = computeToday(emp);
    var sum = 0;
    for (var m = 1; m <= 12; m++) {
      var rec = emp.yearMonths[m];
      if (!rec) continue;
      if (m === month) {
        var ist = 0;
        Object.keys(emp.days).forEach(function (d) {
          if (d.slice(0, 7) === y + "-" + pad(m) && d !== today.date) ist += emp.days[d].ist_min || 0;
        });
        ist += today.ist_min || 0;
        sum += ist;
      } else sum += rec.ist || 0;
    }
    return sum;
  }

  function balanceOf(emp) {
    var y = new Date().getFullYear();
    var month = new Date().getMonth() + 1;
    var today = computeToday(emp);
    var acc = emp.opening || 0;
    for (var m = 1; m <= 12; m++) {
      var rec = emp.yearMonths[m];
      if (!rec) continue;
      var ist = rec.ist, soll = rec.soll;
      if (m === month) {
        ist = 0; soll = 0;
        Object.keys(emp.days).forEach(function (d) {
          if (d.slice(0, 7) === y + "-" + pad(m) && d !== today.date) {
            ist += emp.days[d].ist_min || 0;
            soll += emp.days[d].soll_min || 0;
          }
        });
        ist += today.ist_min || 0;
        soll += today.soll_min || 0;
      }
      acc += ist - soll;
    }
    return acc;
  }

  function personView(emp) {
    var today = computeToday(emp);
    var status = presenceStatus(emp);
    return {
      id: emp.id,
      name: emp.display_name,
      personal_number: emp.personal_number,
      status: status,
      today_ist: today.ist,
      balance: fmtMin(balanceOf(emp)),
      year_ist: fmtMin(yearIst(emp)),
      vacation_taken: emp.vacation_taken,
      vacation_total: emp.vacation_total,
      vacation_remaining: emp.vacation_total - emp.vacation_taken,
      excel_path: emp.excel_path,
      rfid_id: emp.rfid_id
    };
  }

  function warnings() {
    var list = [];
    state.employees.forEach(function (emp) {
      var today = computeToday(emp);
      var status = presenceStatus(emp);
      if (today.incomplete) list.push({ employee: emp.display_name, message: "Geht fehlt – Tag unvollständig." });
      if (status === "ON_BREAK" && today.pause_warning) list.push({ employee: emp.display_name, message: "Pause läuft länger als üblich." });
      if (status === "PRESENT") {
        var start = emp.punches.find(function (p) { return p.event === "CLOCK_IN" && p.ts.slice(0, 10) === todayStr(); });
        if (start && (Date.now() - new Date(start.ts).getTime()) > 11 * 3600000) {
          list.push({ employee: emp.display_name, message: "Seit über 11 Stunden anwesend – Gehen prüfen." });
        }
      }
    });
    return list;
  }

  function punchEmployee(emp, eventType) {
    var now = new Date();
    var key = String(emp.id);
    var wait = (state.debounce || 3) * 1000;
    if (state.lastPunchAt[key] && now.getTime() - state.lastPunchAt[key] < wait) {
      return { ignored: true, ignore_reason: "Zu schnell hintereinander – bitte kurz warten" };
    }
    var status = presenceStatus(emp);
    var event = resolveEvent(status, eventType);
    emp.punches.push({ event: event, ts: isoLocal(now) });
    state.lastPunchAt[key] = now.getTime();
    var today = computeToday(emp, now);
    var next = presenceStatus(emp);
    var file = (emp.excel_path || "").split(/[/\\]/).pop();
    state.excelLog.unshift({
      time: pad(now.getHours()) + ":" + pad(now.getMinutes()),
      name: emp.display_name,
      label: LABELS[event] || event,
      file: file || "Excel"
    });
    state.excelLog = state.excelLog.slice(0, 12);
    saveState();
    return {
      ignored: false,
      event_type: event,
      label: LABELS[event] || event,
      time: pad(now.getHours()) + ":" + pad(now.getMinutes()),
      status: next,
      employee: { display_name: emp.display_name },
      rfid_id: emp.rfid_id,
      today_ist: today.ist,
      balance: fmtMin(balanceOf(emp)),
      vacation_remaining: emp.vacation_total - emp.vacation_taken,
      vacation_total: emp.vacation_total,
      vacation_taken: emp.vacation_taken
    };
  }

  function accountData(emp) {
    var today = computeToday(emp);
    var y = new Date().getFullYear();
    var vacDays = Object.keys(emp.days).filter(function (d) {
      return emp.days[d].code === "U" && d.slice(0, 4) === String(y);
    }).map(function (d) { return { date: d, label: "Urlaub" }; }).slice(-8);
    return {
      employee: { display_name: emp.display_name },
      rfid_id: emp.rfid_id,
      status: presenceStatus(emp),
      today_ist: today.ist,
      today_delta: today.delta,
      today_kommt: today.kommt1,
      today_kommt2: today.kommt2,
      today_geht: today.geht1,
      today_geht2: today.geht2,
      balance: fmtMin(balanceOf(emp)),
      opening: fmtMin(emp.opening || 0),
      closing: fmtMin(balanceOf(emp)),
      year: y,
      vacation_remaining: emp.vacation_total - emp.vacation_taken,
      vacation_total: emp.vacation_total,
      vacation_taken: emp.vacation_taken,
      vacation_days: vacDays
    };
  }

  function monthData(emp, year, month) {
    var rows = [];
    var dim = daysInMonth(year, month);
    var todayIso = todayStr();
    for (var d = 1; d <= dim; d++) {
      var dateStr = year + "-" + pad(month) + "-" + pad(d);
      if (dateStr === todayIso) rows.push(computeToday(emp));
      else rows.push(emp.days[dateStr] || emptyDay(dateStr));
    }
    return {
      employee: { display_name: emp.display_name },
      rows: rows,
      vacation: { remaining: emp.vacation_total - emp.vacation_taken, total: emp.vacation_total }
    };
  }

  function yearData(emp, year) {
    var monthNow = new Date().getMonth() + 1;
    var yNow = new Date().getFullYear();
    var months = [];
    var ist = 0, soll = 0;
    for (var m = 1; m <= 12; m++) {
      var rec = emp.yearMonths[m] || { ist: 0, soll: 0, presence: 0, sick: 0, vacation: 0, time_off: 0 };
      var mIst = rec.ist, mSoll = rec.soll, vac = rec.vacation, sick = rec.sick, presence = rec.presence;
      if (year === yNow && m === monthNow) {
        mIst = 0; mSoll = 0; vac = 0; sick = 0; presence = 0;
        Object.keys(emp.days).forEach(function (d) {
          if (d.slice(0, 7) === year + "-" + pad(m)) {
            var row = d === todayStr() ? computeToday(emp) : emp.days[d];
            mIst += row.ist_min || 0;
            mSoll += row.soll_min || 0;
            if (row.code === "U") vac += 1;
            if (row.code === "K") sick += 1;
            if (row.kommt1) presence += 1;
          }
        });
      }
      var running = (emp.opening || 0) + ist + mIst - (soll + mSoll);
      months.push({
        month: m, soll_label: fmtMin(mSoll), ist_label: fmtMin(mIst),
        delta_label: fmtMin(mIst - mSoll), presence: presence, sick: sick,
        vacation: vac, time_off: rec.time_off || 0, balance_label: fmtMin(running)
      });
      ist += mIst; soll += mSoll;
    }
    return {
      opening_label: fmtMin(emp.opening || 0),
      ist_label: fmtMin(ist),
      soll_label: fmtMin(soll),
      closing_label: fmtMin((emp.opening || 0) + ist - soll),
      months: months,
      vacation_account: {
        taken: emp.vacation_taken,
        remaining: emp.vacation_total - emp.vacation_taken,
        total: emp.vacation_total
      }
    };
  }

  function renderNav() {
    var sidebar = document.getElementById("sidebar");
    sidebar.innerHTML = "";
    function addBtn(id, label, extra) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.className = extra === "emp"
        ? ((currentView === "person" && Number(id) === selectedEmployeeId) ? "active emp" : "emp")
        : (id === currentView ? "active" : "");
      button.onclick = function () {
        if (extra === "emp") { selectedEmployeeId = Number(id); personTab = "month"; show("person"); }
        else show(id);
      };
      sidebar.appendChild(button);
    }
    function addLabel(text) {
      var lab = document.createElement("div");
      lab.className = "sidebar-label";
      lab.textContent = text;
      sidebar.appendChild(lab);
    }
    addBtn("dashboard", "Heute alle");
    addBtn("team", "Übersicht alle");
    addLabel("Mitarbeiter");
    state.employees.filter(function (e) { return e.active !== 0; }).forEach(function (e) {
      addBtn(e.id, e.display_name, "emp");
    });
    addLabel("Verwaltung");
    addBtn("employees", "Mitarbeiter anlegen");
    addBtn("excel", "Excel");
    addBtn("settings", "Einstellungen");
  }

  function show(view) {
    currentView = view;
    renderNav();
    var content = document.getElementById("content");
    content.innerHTML = "<p class='muted'>Laden …</p>";
    try {
      if (view === "dashboard") content.replaceChildren(viewDashboard());
      if (view === "team") content.replaceChildren(viewTeam());
      if (view === "person") content.replaceChildren(viewPerson());
      if (view === "employees") content.replaceChildren(viewEmployees());
      if (view === "excel") content.replaceChildren(viewExcel());
      if (view === "settings") content.replaceChildren(viewSettings());
    } catch (error) {
      content.innerHTML = "<p class='error'>" + esc(error.message) + "</p>";
    }
  }

  function viewDashboard() {
    var people = state.employees.map(personView);
    var present = people.filter(function (p) { return p.status !== "ABSENT"; }).length;
    var onLeave = state.employees.filter(function (e) {
      var row = e.days[todayStr()];
      return row && (row.code === "U" || row.code === "K");
    }).length;
    var windows = people.map(function (p) {
      return "<article class='person-window' data-id='" + p.id + "'>" +
        "<header><span class='status-dot " + p.status.toLowerCase() + "'></span><strong>" + esc(p.name) + "</strong></header>" +
        "<div class='person-status " + p.status.toLowerCase() + "'>" + statusLabel(p.status) + "</div>" +
        "<div class='person-stats'>" +
        "<div><span class='muted'>Heute</span><b>" + p.today_ist + "</b></div>" +
        "<div><span class='muted'>Überstunden</span><b>" + p.balance + "</b></div>" +
        "<div><span class='muted'>Urlaub</span><b>" + p.vacation_remaining + " / " + p.vacation_total + "</b></div>" +
        "</div></article>";
    }).join("");
    var warn = warnings();
    var warnHtml = warn.length ? warn.map(function (w) { return "<li>" + esc(w.employee) + ": " + esc(w.message) + "</li>"; }).join("") : "<li>Keine Warnungen</li>";
    var live = lastPunchMsg ? "<p class='muted' id='liveBanner'>Zuletzt am Terminal: " + esc(lastPunchMsg) + "</p>" : "";
    var root = el(
      "<section>" +
      "<h1>Mitarbeiter heute</h1>" +
      "<p class='muted'>Jedes Fenster ist eine Person. Klick öffnet Monat, Urlaub und Überstunden. Stempeln geht über die Stempeluhr oben.</p>" +
      "<div class='grid'>" +
      "<article class='card'><div class='muted'>Fenster</div><div class='kpi'>" + people.length + "</div></article>" +
      "<article class='card'><div class='muted'>Anwesend</div><div class='kpi'>" + present + "</div></article>" +
      "<article class='card'><div class='muted'>Abwesend</div><div class='kpi'>" + (people.length - present) + "</div></article>" +
      "<article class='card'><div class='muted'>Urlaub / Krank</div><div class='kpi'>" + onLeave + "</div></article>" +
      "</div>" + live +
      "<div class='person-board'>" + windows +
      "<article class='person-window add-window' data-id='new'><header><strong>Weitere Person</strong></header>" +
      "<div class='person-status'>Anlegen</div><p class='muted'>Name und Code eintragen. Danach erscheint hier ein eigenes Fenster.</p></article>" +
      "</div>" +
      "<article class='card mt'><h3>Warnungen</h3><ul>" + warnHtml + "</ul></article>" +
      "</section>"
    );
    root.querySelectorAll(".person-window").forEach(function (card) {
      card.onclick = function () {
        if (card.dataset.id === "new") show("employees");
        else { selectedEmployeeId = Number(card.dataset.id); personTab = "month"; show("person"); }
      };
    });
    return root;
  }

  function viewTeam() {
    var year = new Date().getFullYear();
    var rows = state.employees.map(personView).map(function (p) {
      return "<tr class='person-row' data-id='" + p.id + "'>" +
        "<td><span class='status-dot " + p.status.toLowerCase() + "'></span>" + esc(p.name) + "</td>" +
        "<td>" + esc(p.personal_number) + "</td><td>" + statusLabel(p.status) + "</td>" +
        "<td>" + p.today_ist + "</td><td>" + p.balance + "</td><td>" + p.year_ist + "</td>" +
        "<td>" + p.vacation_taken + "</td><td>" + p.vacation_remaining + " / " + p.vacation_total + "</td></tr>";
    }).join("");
    var root = el(
      "<section><h1>Übersicht alle Mitarbeiter " + year + "</h1>" +
      "<p class='muted'>Eine Zeile pro Person. Klick öffnet den Monatsplan.</p>" +
      "<article class='card'><table><thead><tr>" +
      "<th>Name</th><th>PNr</th><th>Jetzt</th><th>Heute IST</th><th>Überstunden</th>" +
      "<th>Jahr IST</th><th>Urlaub genommen</th><th>Urlaub Rest</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></article></section>"
    );
    root.querySelectorAll(".person-row").forEach(function (row) {
      row.onclick = function () { selectedEmployeeId = Number(row.dataset.id); personTab = "month"; show("person"); };
    });
    return root;
  }

  function renderMonthHtml(data) {
    var rows = data.rows.map(function (r) {
      var cls = r.incomplete ? "incomplete" : r.pause_warning ? "warn" : "";
      return "<tr class='" + cls + "'><td>" + germanDate(r.date) + "</td><td>" + esc(r.holiday_name || "") + "</td>" +
        "<td>" + (r.kommt1 || "") + "</td><td>" + (r.geht1 || "") + "</td>" +
        "<td>" + (r.kommt2 || "") + "</td><td>" + (r.geht2 || "") + "</td>" +
        "<td>" + (r.pause || "") + "</td><td>" + esc(r.code || "") + "</td>" +
        "<td>" + r.ist + "</td><td>" + r.soll + "</td><td>" + r.delta + "</td><td>" + r.az + "</td>" +
        "<td>" + esc(STATUS[r.status] || "") + "</td><td>" + esc(r.remarks || "") + "</td></tr>";
    }).join("");
    return "<article class='card'><p class='muted'>" + esc(data.employee.display_name) +
      " · Urlaub Rest: " + data.vacation.remaining + " von " + data.vacation.total + "</p>" +
      "<table><thead><tr><th>Datum</th><th>Feiertag</th><th>Kommt 1</th><th>Geht 1</th><th>Kommt 2</th><th>Geht 2</th>" +
      "<th>Pause</th><th>Code</th><th>IST</th><th>SOLL</th><th>+/-</th><th>AZ</th><th>Status</th><th>Bemerkung</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></article>";
  }

  function renderYearHtml(data) {
    var rows = data.months.map(function (m) {
      return "<tr><td>" + MONTHS[m.month - 1] + "</td><td>" + m.soll_label + "</td><td>" + m.ist_label + "</td>" +
        "<td>" + m.delta_label + "</td><td>" + m.presence + "</td><td>" + m.sick + "</td><td>" + m.vacation + "</td>" +
        "<td>" + m.time_off + "</td><td>" + m.balance_label + "</td></tr>";
    }).join("");
    return "<div class='grid'>" +
      "<article class='card'><div class='muted'>Übertrag</div><div class='kpi'>" + data.opening_label + "</div></article>" +
      "<article class='card'><div class='muted'>IST</div><div class='kpi'>" + data.ist_label + "</div></article>" +
      "<article class='card'><div class='muted'>SOLL</div><div class='kpi'>" + data.soll_label + "</div></article>" +
      "<article class='card'><div class='muted'>Überstunden</div><div class='kpi'>" + data.closing_label + "</div></article>" +
      "</div><article class='card mt'><table><thead><tr>" +
      "<th>Monat</th><th>SOLL</th><th>IST</th><th>+/-</th><th>Anwesenheit</th><th>Krank</th><th>Urlaub</th><th>ZA</th><th>Konto</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table>" +
      "<p class='muted mt'>Urlaub: " + data.vacation_account.taken + " genommen, " +
      data.vacation_account.remaining + " Rest von " + data.vacation_account.total + "</p></article>";
  }

  function viewPerson() {
    var emp = empById(selectedEmployeeId) || state.employees[0];
    selectedEmployeeId = emp.id;
    var now = new Date();
    var root = el(
      "<section><h1>" + esc(emp.display_name) + "</h1>" +
      "<p class='muted'>Monat, Jahr, Urlaub und Überstunden nur für diese Person. Code in der Demo: " + esc(emp.rfid_id) + "</p>" +
      "<div class='toolbar'>" +
      "<button class='btn " + (personTab === "month" ? "accent" : "") + "' type='button' id='tabMonth'>Monat</button>" +
      "<button class='btn " + (personTab === "year" ? "accent" : "") + "' type='button' id='tabYear'>Jahr / Überstunden</button>" +
      "<label>Jahr <input id='year' type='number' value='" + now.getFullYear() + "'></label>" +
      "<label>Monat <select id='month'>" + MONTHS.map(function (name, i) {
        return "<option value='" + (i + 1) + "'" + (i === now.getMonth() ? " selected" : "") + ">" + name + "</option>";
      }).join("") + "</select></label>" +
      "<button class='btn accent' type='button' id='load'>Anzeigen</button></div>" +
      "<div id='personBox'></div></section>"
    );
    function load() {
      var year = Number(document.getElementById("year").value);
      var month = Number(document.getElementById("month").value);
      document.getElementById("personBox").innerHTML = personTab === "year"
        ? renderYearHtml(yearData(emp, year))
        : renderMonthHtml(monthData(emp, year, month));
    }
    root.querySelector("#tabMonth").onclick = function () { personTab = "month"; show("person"); };
    root.querySelector("#tabYear").onclick = function () { personTab = "year"; show("person"); };
    root.querySelector("#load").onclick = load;
    queueMicrotask(load);
    return root;
  }

  function viewEmployees() {
    var rows = state.employees.map(function (e) {
      var file = e.excel_path ? e.excel_path.split(/[/\\]/).pop() : "fehlt";
      return "<tr><td>" + esc(e.personal_number) + "</td><td>" + esc(e.display_name) + "</td>" +
        "<td>" + esc(e.rfid_id || "") + "</td><td>" + esc(file) + "</td>" +
        "<td><input type='text' data-emp='" + e.id + "' class='assignExcel' value='" + esc(file) + "'></td></tr>";
    }).join("");
    var root = el(
      "<section><h1>Mitarbeiter anlegen</h1>" +
      "<p class='muted'>Beim Anlegen die Excel dieser Person zuordnen. Jede Stempelung schreibt danach in genau diese Datei – in der echten App. Hier in der Demo erscheint der Schreibvorgang unter Excel.</p>" +
      "<form class='toolbar' id='newEmp'>" +
      "<label>Personalnr. <input name='personal_number' required></label>" +
      "<label>Vorname <input name='first_name' required></label>" +
      "<label>Nachname <input name='last_name' required></label>" +
      "<label>Code <input name='rfid_id' placeholder='z. B. 1006'></label>" +
      "<label>Excel-Datei <input name='excel_name' placeholder='Arbeitszeit-Name.xlsx'></label>" +
      "<button class='btn accent' type='submit'>Anlegen</button></form>" +
      "<article class='card'><table><thead><tr><th>PNr</th><th>Name</th><th>Code</th><th>Excel</th><th>Excel zuordnen</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table></article></section>"
    );
    root.querySelector("#newEmp").onsubmit = function (event) {
      event.preventDefault();
      var form = event.target;
      var first = form.first_name.value.trim();
      var last = form.last_name.value.trim();
      var code = form.rfid_id.value.trim() || String(1000 + state.nextId);
      var excel = form.excel_name.value.trim() || ("Arbeitszeit-" + last + "-" + first + ".xlsx");
      state.employees.push({
        id: state.nextId++,
        personal_number: form.personal_number.value.trim(),
        first_name: first, last_name: last,
        display_name: last + ", " + first,
        rfid_id: code,
        excel_path: "C:\\Zeiterfassung\\" + excel,
        vacation_total: 30, vacation_taken: 0, opening: 0, active: 1,
        days: {}, punches: [], yearMonths: {}
      });
      saveState();
      show("employees");
    };
    root.querySelectorAll(".assignExcel").forEach(function (input) {
      input.onchange = function () {
        var emp = empById(input.dataset.emp);
        if (!emp) return;
        emp.excel_path = "C:\\Zeiterfassung\\" + input.value.trim();
        saveState();
      };
    });
    return root;
  }

  function employeeSelect(id) {
    return "<label>Mitarbeiter <select id='" + id + "'>" +
      state.employees.map(function (e) { return "<option value='" + e.id + "'>" + esc(e.display_name) + "</option>"; }).join("") +
      "</select></label>";
  }

  function viewExcel() {
    var log = state.excelLog.map(function (row) {
      return "<li><span>" + esc(row.time) + " · " + esc(row.name) + " · " + esc(row.label) +
        "</span><span class='muted'>" + esc(row.file) + "</span></li>";
    }).join("") || "<li class='muted'>Noch keine Stempelung in dieser Demo.</li>";
    var root = el(
      "<section><h1>Excel</h1>" +
      "<article class='card'><h3>Live in die Originaldatei</h3>" +
      "<p class='muted'>Beim Anlegen die Excel der Person wählen. Danach schreibt jede Stempelung automatisch in genau diese Datei. Die Formeln (IST, SOLL, Überstunden) bleiben erhalten. In der Demo wird der Schreibvorgang nur angezeigt.</p>" +
      "<p class='muted' id='excelPath'></p>" +
      "<div class='toolbar'>" + employeeSelect("emp") +
      "<button class='btn accent' type='button' id='btnSync'>Jetzt in Original-Excel schreiben</button></div>" +
      "<p class='muted' id='syncMsg'></p></article>" +
      "<article class='card mt'><h3>Zuletzt geschrieben</h3><ul class='excel-log'>" + log + "</ul></article>" +
      "<article class='card mt'><h3>Historische Datei importieren</h3>" +
      "<p class='muted'>Nur zum ersten Einlesen alter Jahre. In der Demo ohne echte Datei.</p>" +
      "<button class='btn accent' type='button' id='btnImport'>Beispielimport zeigen</button>" +
      "<p class='muted' id='importMsg'></p></article>" +
      "<article class='card mt'><h3>Mit Excel vergleichen</h3>" +
      "<button class='btn' type='button' id='btnCompare'>Vergleichen</button>" +
      "<p class='muted' id='compareMsg'></p></article></section>"
    );
    function refreshPath() {
      var emp = empById(document.getElementById("emp").value);
      document.getElementById("excelPath").textContent = emp && emp.excel_path
        ? "Original: " + emp.excel_path
        : "Keine Originaldatei zugeordnet.";
    }
    queueMicrotask(refreshPath);
    root.querySelector("#emp").onchange = refreshPath;
    root.querySelector("#btnSync").onclick = function () {
      var emp = empById(document.getElementById("emp").value);
      document.getElementById("syncMsg").textContent = "Demo: geschrieben nach " + (emp.excel_path || "Excel") + " – Formeln unverändert.";
    };
    root.querySelector("#btnImport").onclick = function () {
      document.getElementById("importMsg").textContent = "Demo: Jahr 2025, 248 Tage würden übernommen.";
    };
    root.querySelector("#btnCompare").onclick = function () {
      document.getElementById("compareMsg").textContent = "Excel und Software stimmen überein.";
    };
    return root;
  }

  function viewSettings() {
    var backups = state.backups.map(function (b) { return "<tr><td>" + esc(b.name) + "</td><td>" + esc(b.mtime) + "</td></tr>"; }).join("");
    var codes = CODES.map(function (c) {
      return "<tr><td>" + c.code + "</td><td>" + c.name + "</td><td>" + c.factor_type + "</td><td>" + c.behavior + "</td></tr>";
    }).join("");
    var root = el(
      "<section><h1>Einstellungen</h1>" +
      "<article class='card'><h3>System</h3><div class='toolbar'>" +
      "<label>Entprellung Sek. <input id='debounce' value='" + state.debounce + "'></label>" +
      "<button class='btn accent' type='button' id='saveDebounce'>Speichern</button>" +
      "<button class='btn' type='button' id='btnBackup'>Backup jetzt</button></div>" +
      "<p class='muted'>In der Demo ist die Entprellung kurz, damit sich Stempeln schnell testen lässt.</p></article>" +
      "<article class='card mt'><h3>Codes</h3><table><thead><tr><th>Code</th><th>Name</th><th>Faktor</th><th>Verhalten</th></tr></thead><tbody>" +
      codes + "</tbody></table></article>" +
      "<article class='card mt'><h3>Backups</h3><table><thead><tr><th>Datei</th><th>Zeit</th></tr></thead><tbody>" +
      backups + "</tbody></table></article></section>"
    );
    root.querySelector("#saveDebounce").onclick = function () {
      state.debounce = Number(document.getElementById("debounce").value) || 3;
      saveState();
    };
    root.querySelector("#btnBackup").onclick = function () {
      var n = new Date();
      state.backups.unshift({
        name: "werkzeit-" + isoDate(n) + ".db",
        mtime: germanDate(isoDate(n)) + " " + pad(n.getHours()) + ":" + pad(n.getMinutes())
      });
      saveState();
      show("settings");
    };
    return root;
  }

  function setMode(mode) {
    screenMode = mode;
    var chef = document.getElementById("chefRoot");
    var kiosk = document.getElementById("kioskRoot");
    var btnChef = document.getElementById("btnChef");
    var btnKiosk = document.getElementById("btnKiosk");
    if (mode === "kiosk") {
      chef.hidden = true;
      kiosk.hidden = false;
      btnChef.classList.remove("accent", "active");
      btnKiosk.classList.add("accent", "active");
      history.replaceState(null, "", "#terminal");
      rebuildQuickCodes();
      idleScreen();
      var input = document.getElementById("rfid");
      if (input) input.focus();
    } else {
      chef.hidden = false;
      kiosk.hidden = true;
      btnKiosk.classList.remove("accent", "active");
      btnChef.classList.add("accent", "active");
      history.replaceState(null, "", "#chef");
      show(currentView || "dashboard");
    }
  }

  function tickClock() {
    var text = clockText();
    var face = document.getElementById("clock");
    var shadow = document.getElementById("clockShadow");
    if (face) face.textContent = text;
    if (shadow) shadow.textContent = text;
  }

  function setSubline(text) {
    var sub = document.getElementById("subline");
    if (!text) { sub.hidden = true; sub.textContent = ""; return; }
    sub.hidden = false;
    sub.textContent = text;
  }

  function idleScreen() {
    clearTimeout(resetTimer);
    pendingAction = null;
    viewingKonto = false;
    busy = false;
    document.getElementById("headline").textContent = "Mitarbeitercode eingeben";
    document.getElementById("headline").className = "";
    setSubline("");
    document.getElementById("account").hidden = true;
    document.getElementById("account").innerHTML = "";
    document.getElementById("plan").hidden = true;
    document.getElementById("plan").innerHTML = "";
    document.getElementById("who").hidden = true;
    document.getElementById("rfid").hidden = false;
    document.getElementById("rfid").value = "";
    document.getElementById("btnFertig").hidden = true;
    document.getElementById("btnKonto").textContent = "Mein Konto";
    document.getElementById("btnTermin").textContent = "Termin";
    document.getElementById("rfid").focus();
  }

  function showError(text) {
    document.getElementById("headline").textContent = text;
    document.getElementById("headline").className = "err";
    setSubline("Code noch einmal eingeben");
    document.getElementById("account").hidden = true;
    document.getElementById("plan").hidden = true;
    document.getElementById("who").hidden = true;
    document.getElementById("rfid").value = "";
    document.getElementById("btnFertig").hidden = true;
    viewingKonto = false;
    pendingAction = null;
    document.getElementById("rfid").focus();
    resetTimer = setTimeout(idleScreen, 4000);
  }

  function briefNumbers(data) {
    var box = document.getElementById("account");
    box.hidden = false;
    box.innerHTML =
      "<article><div class='muted'>Überstunden</div><div class='kpi'>" + esc(data.balance) + "</div></article>" +
      "<article><div class='muted'>Heute</div><div class='kpi'>" + esc(data.today_ist) + "</div></article>" +
      "<article><div class='muted'>Urlaub Rest</div><div class='kpi'>" + esc(String(data.vacation_remaining)) + "</div></article>";
  }

  function showPunchFlash(data) {
    viewingKonto = false;
    document.getElementById("plan").hidden = true;
    document.getElementById("headline").className = data.event_type === "CLOCK_OUT" ? "out" : "ok";
    document.getElementById("headline").textContent = data.label || "OK";
    setSubline(data.employee.display_name + "  ·  " + data.time + "  ·  " + statusLabel(data.status).toUpperCase());
    var who = document.getElementById("who");
    who.hidden = false;
    who.textContent = "Nächster Kollege kann gleich stempeln";
    briefNumbers(data);
    document.getElementById("btnFertig").hidden = true;
    document.getElementById("btnTermin").textContent = data.status === "ON_APPOINTMENT" ? "Wieder da" : "Termin";
    document.getElementById("rfid").value = "";
    document.getElementById("rfid").focus();
    clearTimeout(resetTimer);
    resetTimer = setTimeout(idleScreen, 4500);
  }

  function showKontoView(emp) {
    var data = accountData(emp);
    viewingKonto = true;
    pendingAction = null;
    document.getElementById("headline").className = "";
    document.getElementById("headline").textContent = emp.display_name;
    setSubline(statusLabel(data.status).toUpperCase() + "  ·  Überstunden " + data.balance + "  ·  Urlaub Rest " + data.vacation_remaining);
    var who = document.getElementById("who");
    who.hidden = false;
    who.textContent = "Nur anschauen. Fertig drücken, dann kann der Nächste stempeln.";
    briefNumbers(data);
    var days = data.vacation_days.length
      ? data.vacation_days.map(function (d) { return "<li><span>" + germanDate(d.date) + "</span><strong>" + d.label + "</strong></li>"; }).join("")
      : "<li>Kein Urlaub eingetragen</li>";
    var kommt = [data.today_kommt, data.today_kommt2].filter(Boolean).join(" / ") || "–";
    var geht = [data.today_geht, data.today_geht2].filter(Boolean).join(" / ") || "–";
    var plan = document.getElementById("plan");
    plan.hidden = false;
    plan.innerHTML =
      "<article><h3>Überstunden " + data.year + "</h3>" +
      "<p>Übertrag <strong>" + data.opening + "</strong></p>" +
      "<p>Aktuelles Konto <strong>" + data.closing + "</strong></p>" +
      "<p>Heute +/- <strong>" + data.today_delta + "</strong></p>" +
      "<p>Heute Kommt <strong>" + kommt + "</strong> · Geht <strong>" + geht + "</strong></p></article>" +
      "<article><h3>Urlaub " + data.year + "</h3>" +
      "<p>Anspruch " + data.vacation_total + " · genommen " + data.vacation_taken + " · Rest <strong>" + data.vacation_remaining + "</strong></p>" +
      "<ul>" + days + "</ul></article>";
    document.getElementById("btnFertig").hidden = false;
    document.getElementById("rfid").value = "";
    document.getElementById("rfid").focus();
    clearTimeout(resetTimer);
    resetTimer = setTimeout(function () {
      if (Date.now() - lastActivity < 45000) { showKontoView(emp); return; }
      idleScreen();
    }, 20000);
  }

  function waitForChip(action, title, hint) {
    pendingAction = action;
    viewingKonto = false;
    document.getElementById("plan").hidden = true;
    document.getElementById("account").hidden = true;
    document.getElementById("headline").className = "";
    document.getElementById("headline").textContent = title;
    setSubline(hint);
    document.getElementById("who").hidden = true;
    document.getElementById("btnFertig").hidden = false;
    document.getElementById("rfid").value = "";
    document.getElementById("rfid").focus();
    clearTimeout(resetTimer);
    resetTimer = setTimeout(idleScreen, 12000);
  }

  function onChip(code) {
    var emp = empByCode(code);
    if (!emp) { showError("Unbekannter Code"); return; }
    if (pendingAction === "konto") { showKontoView(emp); return; }
    if (busy) return;
    busy = true;
    var result = punchEmployee(emp, pendingAction);
    busy = false;
    pendingAction = null;
    if (result.ignored) { showError(result.ignore_reason); return; }
    lastPunchMsg = result.employee.display_name + ": " + result.label + " um " + result.time;
    showPunchFlash(result);
  }

  function bindKiosk() {
    var input = document.getElementById("rfid");
    document.getElementById("punchForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var code = input.value.trim();
      if (code) onChip(code);
    });
    document.querySelectorAll("[data-event]").forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        var code = input.value.trim();
        var action = button.dataset.event;
        if (code) { pendingAction = action; onChip(code); return; }
        var labels = {
          BREAK_START: ["Pause", "Jetzt Code eingeben, dann startet die Pause."],
          BREAK_END: ["Pause Ende", "Jetzt Code eingeben für Pause Ende."],
          APPOINTMENT: ["Termin", "Jetzt Code eingeben für Termin."]
        };
        var pair = labels[action] || ["Taste", "Jetzt Code eingeben."];
        waitForChip(action, pair[0], pair[1]);
      });
    });
    document.getElementById("btnKonto").addEventListener("click", function (event) {
      event.preventDefault();
      var code = input.value.trim();
      if (code) { pendingAction = "konto"; onChip(code); return; }
      waitForChip("konto", "Mein Konto", "Jetzt Code eingeben. Es wird nicht gestempelt.");
    });
    document.getElementById("btnFertig").addEventListener("click", function (event) {
      event.preventDefault();
      idleScreen();
    });
    rebuildQuickCodes();
  }

  function rebuildQuickCodes() {
    var input = document.getElementById("rfid");
    var quick = document.getElementById("quickCodes");
    quick.innerHTML = "";
    state.employees.filter(function (e) { return e.active !== 0 && e.rfid_id; }).forEach(function (e) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = e.rfid_id + " " + e.first_name;
      btn.onclick = function () {
        input.value = e.rfid_id;
        onChip(e.rfid_id);
      };
      quick.appendChild(btn);
    });
  }

  function init() {
    state = loadState();
    document.getElementById("btnChef").onclick = function () { setMode("chef"); };
    document.getElementById("btnKiosk").onclick = function () { setMode("kiosk"); };
    document.getElementById("btnOpenKiosk").onclick = function () { setMode("kiosk"); };
    document.getElementById("btnReset").onclick = function () {
      sessionStorage.removeItem(STORE_KEY);
      location.href = "werkzeit-demo.html#chef";
      location.reload();
    };
    ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"].forEach(function (name) {
      document.addEventListener(name, function () { lastActivity = Date.now(); }, { passive: true });
    });
    bindKiosk();
    tickClock();
    setInterval(tickClock, 1000);
    setInterval(function () {
      if (screenMode === "chef" && (currentView === "dashboard" || currentView === "team")) show(currentView);
    }, 120000);
    if (location.hash === "#terminal") setMode("kiosk");
    else setMode("chef");
  }

  init();
})();
