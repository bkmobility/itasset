/* IT 자산관리시스템 v1.9 - 관리자 웹 (정적 페이지, Supabase 연동) */
(function () {
  'use strict';
  var $app = document.getElementById('app');
  var cfg = window.ITAM_CONFIG || {};
  var params = new URLSearchParams(location.search);
  var DEMO = params.has('demo') || !cfg.SUPABASE_URL || /YOUR-PROJECT/.test(cfg.SUPABASE_URL);
  var sb = null;
  if (!DEMO) sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  var PC_CATS = ['PC', '노트북', 'PC 본체'];
  var S = { assets: [], employees: [], devices: [], history: [], support: [], supportErr: false, imports: [], impErr: false, user: null };
  var F = { q: '', cat: '', status: '', collect: '', page: 1, sel: {} };
  var HOLD_KEY = 'itam_hold_v1';

  // ---------- 유틸 ----------
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function ymd(d) { var x = new Date(d); if (isNaN(x)) return ''; return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2); }
  function hm(d) { var x = new Date(d); return ('0' + x.getHours()).slice(-2) + ':' + ('0' + x.getMinutes()).slice(-2); }
  function dayDiff(d) {
    if (!d) return null;
    var a = new Date(d), b = new Date();
    a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0);
    return Math.round((b - a) / 86400000);
  }
  function seen(d) {
    var n = dayDiff(d);
    if (n == null) return { cls: '', txt: '—', lvl: 'none' };
    if (n <= 0) return { cls: '#1e8e3e', txt: '오늘 ' + hm(d), lvl: 'today' };
    if (n < 3) return { cls: '#1e8e3e', txt: n + '일 전', lvl: 'ok' };
    if (n < 7) return { cls: '#faad14', txt: n + '일 전', lvl: 'warn' };
    return { cls: '#c42b1c', txt: n + '일 전', lvl: 'stale' };
  }
  function seenHtml(d) { var s = seen(d); return s.cls ? '<span class="dot" style="background:' + s.cls + '"></span>' + esc(s.txt) : '—'; }
  function badge(t, c) { return '<span class="badge b-' + c + '">' + esc(t) + '</span>'; }
  function warrantyBadge(d, calc) {
    if (!d) return '—';
    var n = -dayDiff(d), t = esc(ymd(d)), c = calc ? ' <span class="note" title="제조년월 + 5년으로 계산">계산</span>' : '';
    if (n < 0) return '<span style="color:#c42b1c;font-weight:600">' + t + ' · 만료</span>' + c;
    if (n <= 90) return '<span style="color:#d46b08;font-weight:600">' + t + ' · 3개월 이내</span>' + c;
    return '<span style="color:#1e8e3e">' + t + '</span>' + c;
  }
  function warrOf(a) {   // 대장에 보증만료일이 있으면 그 값, 없으면 제조년월 + 5년(제조월 말일)
    if (a.warranty_end) return { d: a.warranty_end, calc: false };
    var m = /(\d{4})\D+(\d{1,2})/.exec(String(a.mfg_ym || ''));
    if (!m) return { d: null, calc: false };
    var y = +m[1] + 5, mo = +m[2]; if (mo < 1 || mo > 12) return { d: null, calc: false };
    var e = new Date(y, mo, 0);
    return { d: e.getFullYear() + '-' + ('0' + (e.getMonth() + 1)).slice(-2) + '-' + ('0' + e.getDate()).slice(-2), calc: true };
  }
  function cpuShort(c) {
    if (!c) return '';
    var m = /(i[3579]-\w+|Ryzen\s?\d\s?\w+|Core\s?Ultra\s?\w+|Xeon[^@]*|N\d{3,4}|Celeron[^@]*)/i.exec(c);
    return m ? m[1].trim() : c.replace(/\(R\)|\(TM\)|CPU|@.*$/g, '').trim().slice(0, 22);
  }
  function specStr(a) {
    if (!a.cpu && !a.ram_gb && !a.storage) return '—';
    return [cpuShort(a.cpu), a.ram_gb ? a.ram_gb + 'GB' : '', a.storage || ''].filter(Boolean).join(' / ');
  }
  function osShort(o) {
    if (!o) return '확인 안 됨';
    var m = /Windows\s*(\d+)/i.exec(o);
    return m ? 'Windows ' + m[1] : o.slice(0, 24);
  }
  function isPc(a) { return PC_CATS.indexOf(a.category) >= 0; }
  function groupCount(arr, fn) {
    var m = {}; arr.forEach(function (x) { var k = fn(x) || '(없음)'; m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).map(function (k) { return [k, m[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  }
  function bars(list, color) {
    var max = list.length ? list[0][1] : 1;
    return list.map(function (r) { return '<div class="bar"><div class="l" title="' + esc(r[0]) + '">' + esc(r[0]) + '</div><div class="b"><i style="width:' + Math.max(2, r[1] / max * 100) + '%;' + (color ? 'background:' + color : '') + '"></i></div><div class="v">' + r[1].toLocaleString() + '</div></div>'; }).join('') || '<div class="note">데이터가 없습니다.</div>';
  }
  function getHold() { try { return JSON.parse(localStorage.getItem(HOLD_KEY) || '{}'); } catch (e) { return {}; } }
  function setHold(h) { try { localStorage.setItem(HOLD_KEY, JSON.stringify(h)); } catch (e) { } }
  function toast(msg) {
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:8px;font-size:12.5px;z-index:99';
    t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  }
  function fail(e) { console.error(e); toast('오류: ' + (e && e.message ? e.message : e)); }

  // ---------- 데이터 계층 (Supabase / 데모) ----------
  function demoData() {
    var depts = [['IT지원팀', '경영지원본부'], ['영업1팀', '영업본부'], ['영업2팀', '영업본부'], ['재무팀', '경영지원본부'], ['인사팀', '경영지원본부'], ['개발팀', '기술본부']];
    var names = ['홍길동', '김민수', '이서연', '박지훈', '최유진', '정다은', '강현우', '오민재', '윤서아', '한지우', '송태윤', '임하준', '서지안', '문도윤', '배수아', '신유찬'];
    var emps = names.map(function (n, i) { return { emp_no: 'A' + (20230 + i), name: n, dept: depts[i % 6][0], team: depts[i % 6][1], title: ['사원', '대리', '과장', '파트장'][i % 4], active: true }; });
    var assets = [], devices = [], hist = [], now = Date.now();
    var models = [['PC', '삼성', 'DM500TFA'], ['PC', 'HP', 'ProDesk 400'], ['노트북', 'LG', '15U70P'], ['노트북', 'Lenovo', 'T14'], ['모니터', '삼성', 'S24R350'], ['모니터', 'LG', '27UL500']];
    for (var i = 0; i < 70; i++) {
      var m = models[i % 6], e = emps[i % emps.length], cat = m[0];
      var buy = new Date(now - (200 + (i * 53) % 2200) * 86400000);
      var a = { asset_no: 'A-' + (cat === 'PC' ? 'PC' : cat === '노트북' ? 'NB' : 'MN') + '-' + ('000000' + (100 + i)).slice(-6), category: cat, manufacturer: m[1], model: m[2], mfg_ym: ymd(buy).slice(0, 7), status: i % 17 === 16 ? '재고' : '사용중', user_name: i % 17 === 16 ? '(재고)' : e.name, user_id: e.emp_no, dept: e.dept, title: e.title, location: ['본사 3F', '본사 4F', '본사 5F'][i % 3], purchase_date: ymd(buy), warranty_end: ymd(new Date(buy.getTime() + 1095 * 86400000)), memo: '' };
      assets.push(a);
      if (PC_CATS.indexOf(cat) >= 0 && i % 17 !== 16 && i % 5 !== 4) {
        var age = i % 9 === 0 ? 9 : i % 11 === 0 ? 4 : 0;
        var who = i % 13 === 0 ? emps[(i + 3) % emps.length] : e;
        devices.push({ id: 'd' + i, mac: 'A4-BB-6D-' + ('0' + (i * 7 % 256).toString(16)).slice(-2).toUpperCase() + '-3F-90', computer_name: 'ENTIA_' + ('00' + i).slice(-3), ip: '192.168.0.' + (20 + i), os: i % 4 === 0 ? 'Windows 10 Pro' : 'Windows 11 Pro', cpu: ['Intel(R) Core(TM) i7-10700F CPU @ 2.90GHz', 'Intel(R) Core(TM) i5-12400 CPU', 'Intel(R) Core(TM) i3-8100 CPU @ 3.60GHz'][i % 3], ram_gb: [8, 16, 32][i % 3], storage: ['SSD 512 GB', 'SSD 256 GB', 'HDD 500 GB'][i % 3], gpu: '내장 그래픽', agent_version: '1.2.0.0', emp_no: who.emp_no, asset_no: a.asset_no, link_source: 'auto', first_seen: new Date(now - 90 * 86400000).toISOString(), last_seen: new Date(now - age * 86400000 - (i % 5) * 3600000).toISOString() });
      }
    }
    devices.push({ id: 'dX1', mac: 'D8-BB-C1-45-2E-18', computer_name: 'ENTIA_NEW01', ip: '192.168.0.201', os: 'Windows 11 Pro', cpu: 'Intel(R) Core(TM) i5-13400', ram_gb: 16, storage: 'SSD 512 GB', gpu: '내장 그래픽', agent_version: '1.2.0.0', emp_no: 'A20231', asset_no: null, link_source: null, first_seen: new Date().toISOString(), last_seen: new Date().toISOString() });
    hist.push({ id: 1, asset_no: 'A-NB-000102', kind: 'spec', detail: 'RAM(GB): 8 → 16', created_at: new Date(now - 86400000).toISOString() });
    hist.push({ id: 2, asset_no: 'A-PC-000100', kind: 'ip', detail: 'IP: 192.168.0.19 → 192.168.0.20', created_at: new Date(now - 2 * 86400000).toISOString() });
    hist.push({ id: 3, asset_no: 'A-PC-000106', kind: 'link', detail: '자동 연결 (사번 A20236)', created_at: new Date(now - 3 * 86400000).toISOString() });
    var sup = [
      { id: 's4', req_no: 'R-20261117-004', emp_no: emps[0].emp_no, computer_name: 'ENTIA_APLUS', ip: '192.168.0.23', asset_no: assets[0].asset_no, symptom: '프린터가 인쇄되지 않아요', status: 'received', handler: null, note: null, created_at: new Date(now - 600000).toISOString() },
      { id: 's3', req_no: 'R-20261117-003', emp_no: emps[1].emp_no, computer_name: 'SALES-NB-014', ip: '192.168.1.57', asset_no: null, symptom: '엑셀이 느려요', status: 'working', handler: '데모 관리자', note: null, created_at: new Date(now - 5400000).toISOString() },
      { id: 's2', req_no: 'R-20261117-002', emp_no: emps[2].emp_no, computer_name: 'FIN-PC-007', ip: '192.168.2.31', asset_no: null, symptom: 'VPN 연결 실패', status: 'done', handler: '데모 관리자', note: 'VPN 클라이언트 재설치', created_at: new Date(now - 21600000).toISOString() }
    ];
    return { assets: assets, employees: emps, devices: devices, history: hist, support: sup };
  }
  async function fetchAll(table, order) {
    var out = [], from = 0, step = 1000;
    for (;;) {
      var r = await sb.from(table).select('*').order(order).range(from, from + step - 1);
      if (r.error) throw r.error;
      out = out.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    return out;
  }
  function demoDates() {
    var n = new Date(), y = n.getFullYear(), m = n.getMonth();
    S.employees.forEach(function (e, i) { if (e.joined_at === undefined) { e.joined_at = i < 4 ? dstr(new Date(y, m, 1 + i)) : (i < 8 ? dstr(new Date(y, m - 1, 5 + i)) : null); e.left_at = null; e.joined_est = i < 2; e.left_est = false; } });
    var q = S.employees[S.employees.length - 1]; if (q && !q.__d) { q.__d = 1; q.active = false; q.left_at = dstr(new Date(y, m, 2)); q.left_est = true; }
  }
  async function loadAll() {
    if (DEMO) { var d = demoData(); S.assets = d.assets.map(function (a) { return a; }); S.employees = d.employees; S.devices = d.devices; S.history = d.history; S.support = d.support; S.imports = S.imports || []; S.dates = true; S.est = true; demoDates(); rebuildAssets(); return; }
    var res = await Promise.all([fetchAll('assets', 'asset_no'), fetchAll('employees', 'emp_no'), fetchAll('devices', 'mac'),
      sb.from('asset_history').select('*').order('created_at', { ascending: false }).limit(50)]);
    S.assets = res[0]; S.employees = res[1]; S.devices = res[2]; S.history = res[3].data || [];
    var dr = await sb.from('employees').select('joined_at,left_at').limit(1); S.dates = !dr.error;
    var er = await sb.from('employees').select('joined_est,left_est').limit(1); S.est = !er.error;
    var ir = await sb.from('employee_imports').select('*').order('applied_at', { ascending: false }).limit(50);
    S.impErr = !!ir.error; S.imports = ir.error ? [] : ir.data;   // v1.6 DB 업데이트 전에도 나머지 화면은 동작
    var sr = await sb.from('support_requests').select('*').order('created_at', { ascending: false }).limit(300);
    S.supportErr = !!sr.error; S.support = sr.error ? [] : sr.data;   // v1.0 DB(표 없음)에서도 나머지 화면은 동작
    rebuildAssets();
  }
  // 자산 + 연결된 PC + 사용자 불일치를 클라이언트에서 계산 (v_assets 와 같은 규칙)
  function rebuildAssets() {
    var empBy = {}; S.employees.forEach(function (e) { empBy[e.emp_no] = e; });
    var devBy = {}; S.devices.forEach(function (d) { if (d.asset_no) devBy[d.asset_no] = d; });
    S.empBy = empBy;
    S.assets.forEach(function (a) {
      var d = devBy[a.asset_no], e = d && d.emp_no ? empBy[d.emp_no] : null;
      a._dev = d || null; a._emp = e || null; var w = warrOf(a); a.warr_end = w.d; a.warr_calc = w.calc;
      a.pc_name = d ? d.computer_name : null; a.ip = d ? d.ip : null; a.cpu = d ? d.cpu : null; a.ram_gb = d ? d.ram_gb : null;
      a.storage = d ? d.storage : null; a.os = d ? d.os : null; a.gpu = d ? d.gpu : null; a.mac = d ? d.mac : null; a.last_seen = d ? d.last_seen : null;
      a.user_mismatch = !!(a.user_name && e && a.user_name !== e.name && a.user_name.charAt(0) !== '(');
    });
  }
  async function dbUpdateAsset(no, patch) {
    patch.updated_at = new Date().toISOString();
    if (!DEMO) { var r = await sb.from('assets').update(patch).eq('asset_no', no); if (r.error) throw r.error; }
    var a = S.assets.filter(function (x) { return x.asset_no === no; })[0]; if (a) Object.assign(a, patch);
    rebuildAssets();
  }
  async function dbHistory(no, kind, detail, deviceId) {
    var row = { asset_no: no, device_id: deviceId || null, kind: kind, detail: detail };
    if (!DEMO) { var r = await sb.from('asset_history').insert(row); if (r.error) throw r.error; }
    S.history.unshift(Object.assign({ id: Date.now(), created_at: new Date().toISOString() }, row));
  }
  async function dbLink(deviceId, assetNo) {
    var patch = { asset_no: assetNo, link_source: assetNo ? 'manual' : null };
    if (!DEMO) { var r = await sb.from('devices').update(patch).eq('id', deviceId); if (r.error) throw r.error; }
    var d = S.devices.filter(function (x) { return x.id === deviceId; })[0]; if (d) Object.assign(d, patch);
    rebuildAssets();
  }
  async function dbUpsert(table, rows, conflict) {
    for (var i = 0; i < rows.length; i += 500) {
      var chunk = rows.slice(i, i + 500);
      if (!DEMO) { var r = await sb.from(table).upsert(chunk, { onConflict: conflict }); if (r.error) throw r.error; }
    }
    if (DEMO) {
      var list = table === 'assets' ? S.assets : S.employees;
      rows.forEach(function (row) {
        var f = list.filter(function (x) { return x[conflict] === row[conflict]; })[0];
        if (f) Object.assign(f, row); else list.push(row);
      });
    }
  }

  // ---------- 화면 틀 ----------
  var ROUTES = [['dashboard', '대시보드'], ['assets', '자산'], ['check', 'PC 점검'], ['support', '지원 요청'], ['employees', '인사 명단'], ['data', '데이터 관리']];
  function shell(active, html) {
    var nav = ROUTES.map(function (r) { var n = r[0] === 'support' ? S.support.filter(function (x) { return x.status === 'received'; }).length : 0; return '<a href="#/' + r[0] + '" class="' + (r[0] === active ? 'on' : '') + '">' + r[1] + (n ? '<span class="cnt">' + n + '</span>' : '') + '</a>'; }).join('');
    var soon = ['소프트웨어·라이선스', '수명주기·보증', '실사(재물조사)', '신청·승인'].map(function (t) { return '<div class="soon">' + t + '<i>예정</i></div>'; }).join('');
    $app.innerHTML = (DEMO ? '<div class="demo">데모 모드 — 예시 데이터이며 저장되지 않습니다. config.js 에 Supabase 정보를 넣으면 실제 데이터가 표시됩니다.</div>' : '') +
      '<div class="layout"' + (DEMO ? ' style="height:calc(100vh - 26px)"' : '') + '><div class="side"><div class="brand">IT Asset<span>v1.9</span></div><div class="nav">' + nav + '<div class="sep">다음 버전</div>' + soon + '</div></div>' +
      '<div class="main"><div class="top"><input type="search" id="gs" class="gs" placeholder="자산번호·사용자·PC 이름·사번 검색 (Enter)" value="' + esc(F.q) + '"><div class="sp"></div><div class="who">' + esc(S.user ? S.user.email : '데모 관리자') + '</div>' + (DEMO ? '' : '<button class="btn sm" id="logout">로그아웃</button>') + '</div><div class="content" id="view">' + html + '</div></div></div>';
    var gs = $('#gs'); if (gs) gs.onkeydown = function (e) { if (e.key !== 'Enter') return; F.q = gs.value; F.cat = ''; F.status = ''; F.collect = ''; F.page = 1; if (location.hash === '#/assets') pageAssets(); else location.hash = '#/assets'; };
    var lo = $('#logout'); if (lo) lo.onclick = async function () { await sb.auth.signOut(); location.reload(); };
  }

  // ---------- 대시보드 (v1.7) ----------
  var PAL = ['#2f7df6', '#1e8e3e', '#e9a100', '#c42b1c', '#7a4bd6', '#b0b7c3'];
  var ST_COL = { '사용중': '#2f7df6', '재고': '#1e8e3e', '수리중': '#e9a100', '폐기 예정': '#c42b1c', '폐기': '#c42b1c' };
  function top4(arr, fn, colFn) {
    var g = groupCount(arr, fn), parts = [], etc = 0;
    g.forEach(function (x, i) { if (i < 4) parts.push([x[0], x[1], colFn ? colFn(x[0], i) : PAL[i]]); else etc += x[1]; });
    if (etc) parts.push(['기타', etc, '#b0b7c3']);
    return parts;
  }
  function donut(parts, center) {
    var tot = parts.reduce(function (t, p) { return t + p[1]; }, 0), r = 40, C = 2 * Math.PI * r, off = 0, segs = '<circle cx="55" cy="55" r="40" fill="none" stroke="#eef1f5" stroke-width="14"/>';
    parts.forEach(function (p) { if (!p[1]) return; var L = C * p[1] / tot; segs += '<circle cx="55" cy="55" r="40" fill="none" stroke="' + p[2] + '" stroke-width="14" stroke-dasharray="' + L.toFixed(1) + ' ' + (C - L).toFixed(1) + '" stroke-dashoffset="' + (-off).toFixed(1) + '" transform="rotate(-90 55 55)"/>'; off += L; });
    return '<svg width="104" height="104" viewBox="0 0 110 110" style="flex:none">' + segs + '<text x="55" y="52" text-anchor="middle" font-size="17" font-weight="700" fill="#1a1a1a">' + center + '</text><text x="55" y="68" text-anchor="middle" font-size="9" fill="#5c5c5c">전체</text></svg>';
  }
  function legend(parts) { return parts.map(function (p) { return '<div class="lg"><i style="background:' + p[2] + '"></i><span>' + esc(p[0]) + '</span><b>' + p[1].toLocaleString() + '</b></div>'; }).join('') || '<div class="note">데이터가 없습니다.</div>'; }
  function ageYears(a) {
    var d = a.purchase_date ? new Date(a.purchase_date) : a.mfg_ym ? new Date(a.mfg_ym.length === 7 ? a.mfg_ym + '-01' : a.mfg_ym) : null;
    if (!d || isNaN(d)) return null;
    return (Date.now() - d.getTime()) / (365.25 * 86400000);
  }
  function pageDashboard() {
    var A = S.assets, pcs = A.filter(isPc), today = 0, stale = 0, within = 0;
    S.devices.forEach(function (d) { var l = seen(d.last_seen).lvl; if (l === 'today') today++; else if (l === 'stale') stale++; else within++; });
    var mism = A.filter(function (a) { return a.user_mismatch; }).length;
    var unreg = S.devices.filter(function (d) { return !d.asset_no; }).length;
    var noDev = pcs.filter(function (a) { return !a._dev; }).length;
    var recv = S.support.filter(function (x) { return x.status === 'received'; }).length;
    var todayKey = ymd(new Date()), recvToday = S.support.filter(function (x) { return ymd(x.created_at) === todayKey; }).length;
    var leaver = S.devices.filter(function (d) { var e = d.emp_no && S.empBy[d.emp_no]; return e && e.active === false; });
    // 보증 만료·교체 알림
    var wr = [];
    A.forEach(function (a) {
      if (/^폐기/.test(a.status || '')) return;
      var n = a.warr_end ? -dayDiff(a.warr_end) : null, yr = isPc(a) ? ageYears(a) : null;
      var who = (a.user_name || '') + (a.dept ? ' · ' + a.dept : '');
      if (n != null && n <= 30 && n >= -90) wr.push({ no: a.asset_no, cat: a.category, who: who, date: ymd(a.warr_end), st: n < 0 ? '만료됨' : 'D-' + n, col: n <= 14 ? '#c42b1c' : '#e9a100', k: n });
      else if (yr != null && yr >= 5) wr.push({ no: a.asset_no, cat: a.category, who: who, date: '사용 ' + Math.floor(yr) + '년차', st: '교체 권장', col: '#5c5c5c', k: 1000 - yr });
    });
    wr.sort(function (x, y) { return x.k - y.k; });
    var warrSoon = A.filter(function (a) { if (!a.warr_end) return false; var n = -dayDiff(a.warr_end); return n >= 0 && n <= 30; }).length;
    // 최근 활동 (자산 변경 이력 + 인사 명단 적용)
    var act = S.history.map(function (h) { return { t: h.created_at, a: h.asset_no || '(미등록 PC)', d: h.detail }; })
      .concat(S.imports.map(function (x) { return { t: x.applied_at, a: '인사 명단' + (x.reverted_at ? ' (되돌림)' : ''), d: (x.file_name || '') + ' · 신규 ' + x.added + ' · 변경 ' + x.changed + ' · 퇴사 ' + x.deactivated }; }))
      .sort(function (x, y) { return new Date(y.t) - new Date(x.t); }).slice(0, 6);
    function k(t, n, s, c, href) { return '<a class="dk" href="' + href + '"><span class="ic" style="background:' + c + '22"><i style="background:' + c + '"></i></span><span><span class="t">' + t + '</span><span class="n">' + n + '</span><span class="s">' + s + '</span></span></a>'; }
    function todoCard(t, cnt, sub, link, href) { var c = cnt ? (t === '미등록 PC' || t === '사용자 불일치' ? '#e9a100' : '#c42b1c') : '#1e8e3e'; return '<a class="todo" href="' + href + '"><div class="th"><span class="dot" style="background:' + c + '"></span>' + t + ' <b>' + cnt + '</b></div><div class="ts">' + sub + '</div><div class="tl">' + link + ' ›</div></a>'; }
    var allClear = !unreg && !stale && !mism && !leaver.length;
    var todo = allClear ? '<div class="note" style="padding:8px 0">오늘 처리할 일이 없습니다. ✓</div>' : '<div class="todos">' +
      todoCard('미등록 PC', unreg, '관리번호 연결 필요', '연결하기', '#/check/unreg') +
      todoCard('7일 이상 미확인', stale, '프로그램 실행 확인 필요', '목록 보기', '#/check/stale') +
      todoCard('사용자 불일치', mism, '대장 vs 실제 사용자', '확인', '#/check/mismatch') +
      todoCard('퇴사자 사번 PC', leaver.length, leaver.length ? esc(leaver.slice(0, 2).map(function (d) { return d.computer_name; }).join(', ')) + (leaver.length > 2 ? ' 외 ' + (leaver.length - 2) : '') + ' — 회수·초기화 확인' : '회수·초기화 확인', '명단 보기', '#/employees/all') + '</div>';
    var coll = [['오늘 확인', today, '#1e8e3e'], ['7일 이내', within, '#2f7df6'], ['7일 이상 미확인', stale, '#c42b1c'], ['미수집 PC(대장)', noDev, '#b0b7c3']];
    var ctot = coll.reduce(function (t, p) { return t + p[1]; }, 0) || 1;
    var cbar = '<div class="sbar">' + coll.map(function (p) { return p[1] ? '<i style="flex:' + p[1] + ';background:' + p[2] + '" title="' + esc(p[0]) + ' ' + p[1] + '"></i>' : ''; }).join('') + '</div>';
    var typ = top4(A, function (a) { return a.category; }), sts = top4(A, function (a) { return a.status; }, function (n, i) { return ST_COL[n] || PAL[Math.min(i, 5)]; });
    var wrows = wr.slice(0, 6).map(function (w) { return '<tr><td class="mono"><a href="#/asset/' + encodeURIComponent(w.no) + '">' + esc(w.no) + '</a></td><td>' + esc(w.cat || '') + '</td><td>' + esc(w.who) + '</td><td>' + esc(w.date) + '</td><td style="color:' + w.col + ';font-weight:600">' + w.st + '</td></tr>'; }).join('') || '<tr><td colspan="5" class="note" style="text-align:center;padding:12px">알림이 없습니다.</td></tr>';
    var arows = act.map(function (h) { return '<div class="ar"><span class="at">' + esc(ymd(h.t).slice(5) + ' ' + hm(h.t)) + '</span><span class="ab">' + esc(h.a) + '</span><span class="ad">' + esc(h.d) + '</span></div>'; }).join('') || '<div class="note">활동 이력이 없습니다.</div>';
    shell('dashboard', '<div class="row"><h1>대시보드</h1><span class="note">' + esc(ymd(new Date()) + ' ' + hm(new Date())) + ' 기준</span></div>' +
      '<div class="dks">' + k('전체 자산', A.length.toLocaleString(), '엑셀 가져오기 기준', '#2f7df6', '#/assets') + k('오늘 확인된 PC', today.toLocaleString(), '수집률 ' + (pcs.length ? Math.round(today / pcs.length * 100) : 0) + '%', '#1e8e3e', '#/assets') + k('점검 필요', stale.toLocaleString(), '7일 이상 미확인', '#c42b1c', '#/check/stale') + k('보증 만료 예정', warrSoon.toLocaleString(), '30일 이내', '#e9a100', '#/assets') + k('지원 요청', recv.toLocaleString(), '미처리 · 오늘 접수 ' + recvToday, '#7a4bd6', '#/support') + '</div>' +
      '<div class="card dwide" style="border-left:4px solid #e9a100"><h3>오늘 처리할 일 <span class="note" style="font-weight:400">— 누르면 해당 목록으로 이동</span></h3>' + todo + '</div>' +
      '<div class="dcols"><div class="dleft"><div class="card"><h3>PC 수집 현황</h3>' + cbar + legend(coll) + '<div class="note" style="margin-top:6px">프로그램을 한 번도 실행하지 않은 PC는 미수집으로 집계됩니다.</div></div>' +
      '<div class="card"><h3>부서별 자산 수 <span class="note" style="font-weight:400">상위 5개</span></h3>' + bars(groupCount(A, function (a) { return a.dept; }).slice(0, 5)) + '</div></div>' +
      '<div class="dright"><div class="card"><h3>자산 유형</h3><div class="dn">' + donut(typ, A.length.toLocaleString()) + '<div class="lgs">' + legend(typ) + '</div></div></div>' +
      '<div class="card"><h3>자산 상태</h3><div class="dn">' + donut(sts, A.length.toLocaleString()) + '<div class="lgs">' + legend(sts) + '</div></div></div></div></div>' +
      '<div class="card dwide"><div class="row"><h3 style="flex:1;margin:0">보증 만료·교체 알림</h3>' + (wr.length > 6 ? '<span class="note">외 ' + (wr.length - 6) + '건</span>' : '') + '<a href="#/assets" style="font-size:11.5px">자산 목록 ›</a></div><table class="tbl dtbl"><thead><tr><th>자산번호</th><th>유형</th><th>사용자</th><th>만료일/기준</th><th>상태</th></tr></thead><tbody>' + wrows + '</tbody></table><div class="note" style="margin-top:6px">보증 만료 30일 전~만료 후 90일, 그리고 구매일(없으면 제조년월) 기준 5년 이상 사용한 PC·노트북을 표시합니다.</div></div>' +
      '<div class="card dwide"><h3>최근 활동</h3>' + arows + '</div>');
  }

  // ---------- 자산 목록 ----------
  function filtered() {
    var q = F.q.trim().toLowerCase();
    return S.assets.filter(function (a) {
      if (F.cat && a.category !== F.cat) return false;
      if (F.status && a.status !== F.status) return false;
      if (F.collect) {
        var l = seen(a.last_seen).lvl;
        if (F.collect === 'today' && l !== 'today') return false;
        if (F.collect === 'stale' && l !== 'stale') return false;
        if (F.collect === 'none' && !(isPc(a) && !a._dev)) return false;
        if (F.collect === 'mismatch' && !a.user_mismatch) return false;
      }
      if (q) {
        var hay = [a.asset_no, a.category, a.manufacturer, a.model, a.user_name, a.user_id, a.dept, a.title, a.location, a.pc_name, a.ip, a.mac].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  var PS = 20;
  function pageAssets() {
    var list = filtered(), pages = Math.max(1, Math.ceil(list.length / PS)); if (F.page > pages) F.page = pages;
    var cats = groupCount(S.assets, function (a) { return a.category; }).map(function (x) { return x[0]; });
    var stats = groupCount(S.assets, function (a) { return a.status; }).map(function (x) { return x[0]; });
    var rows = list.slice((F.page - 1) * PS, F.page * PS).map(function (a) {
      return '<tr class="clk" data-no="' + esc(a.asset_no) + '"><td><input type="checkbox" class="sel" data-no="' + esc(a.asset_no) + '"' + (F.sel[a.asset_no] ? ' checked' : '') + '></td>' +
        '<td class="mono">' + esc(a.asset_no) + '</td><td>' + esc(a.category) + '</td><td>' + esc(a.manufacturer) + '</td><td>' + esc(a.model) + '</td><td>' + esc(a.mfg_ym) + '</td><td>' + esc(a.status) + '</td>' +
        '<td>' + esc(a.user_name) + (a.user_mismatch ? ' ' + badge('불일치', 'warn') : '') + '</td><td>' + esc(a.dept) + '</td><td>' + esc(a.title) + '</td><td>' + warrantyBadge(a.warr_end, a.warr_calc) + '</td>' +
        '<td class="auto">' + esc(a.pc_name || '—') + '</td><td class="auto mono">' + esc(a.ip || '—') + '</td><td class="auto">' + esc(specStr(a)) + '</td><td class="auto">' + seenHtml(a.last_seen) + '</td></tr>';
    }).join('') || '<tr><td colspan="15" class="note" style="padding:24px;text-align:center">조건에 맞는 자산이 없습니다.</td></tr>';
    var nsel = Object.keys(F.sel).length;
    shell('assets', '<div class="row wrap"><h1>자산</h1><span class="badge b-gray">전체 ' + S.assets.length.toLocaleString() + '</span><div class="grow"></div>' +
      '<input type="text" id="q" placeholder="통합 검색 (관리번호·사용자·컴퓨터 이름·IP·MAC)" style="width:300px" value="' + esc(F.q) + '">' +
      sel('cat', '자산분류: 전체', cats, F.cat) + sel('status', '자산상태: 전체', stats, F.status) +
      '<select id="collect"><option value="">수집상태: 전체</option><option value="today"' + (F.collect === 'today' ? ' selected' : '') + '>오늘 확인</option><option value="stale"' + (F.collect === 'stale' ? ' selected' : '') + '>7일 이상 미확인</option><option value="none"' + (F.collect === 'none' ? ' selected' : '') + '>미수집 PC</option><option value="mismatch"' + (F.collect === 'mismatch' ? ' selected' : '') + '>사용자 불일치</option></select>' +
      '<button class="btn" id="xl">엑셀 다운로드</button></div>' +
      '<div class="note" style="margin:6px 0">기존 시스템 항목 · <span style="color:#0f6cbd">파란 배경 = 프로그램이 자동으로 채우는 항목</span> · <span class="dot" style="background:#1e8e3e"></span>오늘 <span class="dot" style="background:#faad14"></span>3일 이상 <span class="dot" style="background:#c42b1c"></span>7일 이상 미확인</div>' +
      (nsel ? '<div class="bulk"><b>' + nsel + '개 선택됨</b><span>|</span><button class="btn sm" id="b-status">상태 변경</button><button class="btn sm" id="b-qr">QR코드 출력</button><button class="btn sm" id="b-xl">선택 항목 엑셀</button><button class="btn sm" id="b-clear">선택 해제</button></div>' : '') +
      '<div style="overflow:auto"><table class="tbl"><thead><tr><th><input type="checkbox" id="all"></th><th>관리번호</th><th>자산분류</th><th>제조사</th><th>모델명</th><th>제조년월</th><th>자산상태</th><th>사용자명</th><th>소속명</th><th>직책</th><th>보증 (제조년월+5년)</th><th class="auto">컴퓨터 이름</th><th class="auto">IP</th><th class="auto">사양 (CPU / RAM / 저장)</th><th class="auto">최종 확인</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="pager"><span>' + (list.length ? ((F.page - 1) * PS + 1) + '–' + Math.min(list.length, F.page * PS) : 0) + ' / ' + list.length.toLocaleString() + '건</span><span><button class="btn sm" id="prev"' + (F.page <= 1 ? ' disabled' : '') + '>‹ 이전</button> ' + F.page + ' / ' + pages + ' <button class="btn sm" id="next"' + (F.page >= pages ? ' disabled' : '') + '>다음 ›</button></span></div>');
    function sel(id, ph, opts, cur) { return '<select id="' + id + '"><option value="">' + ph + '</option>' + opts.map(function (o) { return '<option' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>'; }
    var qEl = $('#q'), qComp = false;
    function qGo() { F.q = qEl.value; F.page = 1; var pos = qEl.selectionStart; pageAssets(); var n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); }
    qEl.addEventListener('compositionstart', function () { qComp = true; });
    qEl.addEventListener('compositionend', function () { qComp = false; qGo(); });
    qEl.oninput = function (e) { if (qComp || (e && e.isComposing)) return; qGo(); };
    ['cat', 'status', 'collect'].forEach(function (id) { $('#' + id).onchange = function (e) { F[id] = e.target.value; F.page = 1; pageAssets(); }; });
    $('#prev').onclick = function () { F.page--; pageAssets(); }; $('#next').onclick = function () { F.page++; pageAssets(); };
    $('#all').onchange = function (e) { list.slice((F.page - 1) * PS, F.page * PS).forEach(function (a) { if (e.target.checked) F.sel[a.asset_no] = 1; else delete F.sel[a.asset_no]; }); pageAssets(); };
    $$('.sel').forEach(function (c) { c.onclick = function (e) { e.stopPropagation(); if (c.checked) F.sel[c.dataset.no] = 1; else delete F.sel[c.dataset.no]; pageAssets(); }; });
    $$('tr.clk').forEach(function (r) { r.onclick = function () { location.hash = '#/asset/' + encodeURIComponent(r.dataset.no); }; });
    $('#xl').onclick = function () { exportXlsx(list, '자산목록'); };
    var bx = $('#b-xl'); if (bx) bx.onclick = function () { exportXlsx(S.assets.filter(function (a) { return F.sel[a.asset_no]; }), '선택자산'); };
    var bc = $('#b-clear'); if (bc) bc.onclick = function () { F.sel = {}; pageAssets(); };
    var bq = $('#b-qr'); if (bq) bq.onclick = function () { printQr(Object.keys(F.sel)); };
    var bs = $('#b-status'); if (bs) bs.onclick = async function () {
      var v = prompt('변경할 자산상태를 입력하세요 (예: 사용중, 재고, 수리중, 폐기)'); if (!v) return;
      try { for (var no in F.sel) { await dbUpdateAsset(no, { status: v.trim() }); await dbHistory(no, 'etc', '자산상태 변경 → ' + v.trim()); } F.sel = {}; toast('상태를 변경했습니다.'); pageAssets(); } catch (e) { fail(e); }
    };
  }
  function exportXlsx(list, name) {
    var rows = list.map(function (a) {
      return { '관리번호': a.asset_no, '자산분류': a.category, '제조사': a.manufacturer, '모델명': a.model, '제조년월': a.mfg_ym, '자산상태': a.status, '사용자명': a.user_name, '사용자 ID': a.user_id, '소속명': a.dept, '직책': a.title, '위치': a.location, '구매일': a.purchase_date, '보증만료': a.warranty_end, '컴퓨터 이름': a.pc_name, 'IP': a.ip, 'MAC': a.mac, 'OS': a.os, 'CPU': a.cpu, 'RAM(GB)': a.ram_gb, '저장장치': a.storage, '그래픽카드': a.gpu, '최종 확인': a.last_seen ? ymd(a.last_seen) + ' ' + hm(a.last_seen) : '', '비고': a.memo };
    });
    var ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, name); XLSX.writeFile(wb, name + '_' + ymd(new Date()) + '.xlsx');
  }
  function printQr(nos) {
    var w = window.open('', '_blank'); if (!w) { toast('팝업이 차단되었습니다. 허용 후 다시 시도하세요.'); return; }
    var cells = nos.map(function (no) { var q = qrcode(0, 'M'); q.addData(no); q.make(); return '<div class="l">' + q.createSvgTag({ cellSize: 3, margin: 0 }) + '<div>' + esc(no) + '</div></div>'; }).join('');
    w.document.write('<!doctype html><meta charset="utf-8"><title>QR 라벨</title><style>body{font-family:sans-serif;margin:10mm}.g{display:flex;flex-wrap:wrap;gap:4mm}.l{width:38mm;border:1px dashed #999;padding:3mm;text-align:center;font-size:9pt;page-break-inside:avoid}.l svg{width:26mm;height:26mm}@media print{.np{display:none}}</style><button class="np" onclick="print()">인쇄</button><div class="g">' + cells + '</div>');
    w.document.close();
  }

  // ---------- 자산 상세 ----------
  async function pageDetail(no) {
    var a = S.assets.filter(function (x) { return x.asset_no === no; })[0];
    if (!a) { shell('assets', '<h1>자산을 찾을 수 없습니다</h1><p><a href="#/assets">‹ 자산 목록</a></p>'); return; }
    var hist = S.history.filter(function (h) { return h.asset_no === no; });
    if (!DEMO) { var r = await sb.from('asset_history').select('*').eq('asset_no', no).order('created_at', { ascending: false }).limit(30); if (!r.error) hist = r.data; }
    var d = a._dev, e = a._emp, q = qrcode(0, 'M'); q.addData(no); q.make();
    function kv(k, v) { return '<div class="kv"><div class="k">' + k + '</div><div class="v">' + (v == null || v === '' ? '—' : v) + '</div></div>'; }
    function inp(id, label, val, type) { return '<div class="kv"><div class="k">' + label + '</div><div class="v"><input type="' + (type || 'text') + '" id="f_' + id + '" value="' + esc(val || '') + '" style="width:100%"></div></div>'; }
    shell('assets', '<div class="row wrap"><a href="#/assets">‹ 자산</a><h1 class="mono">' + esc(no) + '</h1>' + badge(a.status || '—', a.status === '사용중' ? 'ok' : 'gray') + (a.user_mismatch ? badge('사용자 불일치', 'warn') : '') + '<div class="grow"></div><button class="btn" id="qr">QR코드 출력</button><button class="btn pri" id="save">저장</button></div>' +
      '<div class="cards" style="margin-top:12px"><div class="card" style="flex:1.2"><h3>기본 정보 (대장)</h3><div class="row" style="align-items:flex-start"><div class="grow">' +
      kv('자산분류', esc(a.category)) + kv('제조사', esc(a.manufacturer)) + kv('모델명', esc(a.model)) + kv('제조년월', esc(a.mfg_ym)) +
      inp('status', '자산상태', a.status) + inp('user_name', '사용자명', a.user_name) + inp('user_id', '사용자 ID', a.user_id) + inp('dept', '소속명', a.dept) + inp('title', '직책', a.title) + inp('location', '위치', a.location) + inp('purchase_date', '구매일', a.purchase_date, 'date') + inp('warranty_end', '보증 만료', a.warranty_end, 'date') +
      '</div><div style="text-align:center;font-size:10px;color:#8a8a8a">' + q.createSvgTag({ cellSize: 3, margin: 0 }) + '<div>QR = 관리번호</div></div></div><div class="kv"><div class="k">메모</div><div class="v"><textarea id="f_memo">' + esc(a.memo || '') + '</textarea></div></div></div>' +
      '<div class="card" style="background:#f2f8fe"><h3>자동 수집 정보' + (d ? '' : ' <span class="badge b-gray">미수집</span>') + '</h3>' +
      (d ? kv('컴퓨터 이름', esc(d.computer_name)) + kv('OS', esc(d.os)) + kv('IP / MAC', esc(d.ip) + ' / ' + esc(d.mac)) + kv('CPU', esc(d.cpu)) + kv('RAM / 저장장치', esc((d.ram_gb || '—') + ' GB / ' + (d.storage || '—'))) + kv('그래픽카드', esc(d.gpu)) + kv('최종 확인', seenHtml(d.last_seen)) +
        kv('실행 사번', e ? esc(d.emp_no + ' (' + e.name + ', ' + (e.dept || '') + ')') : esc(d.emp_no)) +
        '<div style="margin-top:8px">' + (a.user_mismatch ? badge('대장 사용자와 다름', 'warn') : badge('대장 사용자와 일치', 'ok')) + ' ' + badge(d.link_source === 'auto' ? '자동 연결' : '수동 연결', 'gray') + ' <button class="btn sm" id="unlink">연결 해제</button></div>'
        : '<div class="note">이 자산에 연결된 PC가 없습니다. 사용자가 프로그램을 실행하면 자동으로 연결되거나, <a href="#/check/unreg">PC 점검 &gt; 미등록 PC</a>에서 연결할 수 있습니다.' + (isPc(a) ? '' : '<br>(모니터·서버 등은 자동 수집 대상이 아닙니다)') + '</div>') + '</div></div>' +
      '<div class="card" style="margin-top:12px"><h3>변경 이력</h3>' + (hist.map(function (h) { return '<div class="hist"><span class="d"></span><span class="t">' + esc(ymd(h.created_at) + ' ' + hm(h.created_at)) + '</span><span>' + esc(h.detail) + '</span></div>'; }).join('') || '<div class="note">이력이 없습니다.</div>') + '</div>');
    $('#qr').onclick = function () { printQr([no]); };
    var ul = $('#unlink'); if (ul) ul.onclick = async function () { if (!confirm('연결을 해제할까요?')) return; try { await dbLink(d.id, null); await dbHistory(no, 'link', '연결 해제 (수동)', d.id); pageDetail(no); } catch (er) { fail(er); } };
    $('#save').onclick = async function () {
      var patch = {}; ['status', 'user_name', 'user_id', 'dept', 'title', 'location', 'purchase_date', 'warranty_end', 'memo'].forEach(function (k) { var v = $('#f_' + k).value.trim(); patch[k] = v === '' ? null : v; });
      try {
        if ((patch.user_name || '') !== (a.user_name || '')) await dbHistory(no, 'user', '사용자 변경: ' + (a.user_name || '없음') + ' → ' + (patch.user_name || '없음') + ' (수동)', d && d.id);
        await dbUpdateAsset(no, patch); toast('저장했습니다.'); pageDetail(no);
      } catch (er) { fail(er); }
    };
  }

  // ---------- PC 점검 ----------
  function cpuYear(c) {   // CPU 이름에서 출시 연도를 추정 (모르면 null)
    c = String(c || ''); var m;
    if ((m = /Core\(TM\)\s*Ultra/i.exec(c))) return 2024;
    if ((m = /i[3579]-\s*(\d{4,5})/i.exec(c))) { var n = m[1], g = n.length === 5 ? +n.slice(0, 2) : +n.slice(0, 1);
      var T = { 2: 2011, 3: 2012, 4: 2013, 5: 2015, 6: 2015, 7: 2017, 8: 2017, 9: 2018, 10: 2020, 11: 2021, 12: 2021, 13: 2022, 14: 2023 }; return T[g] || null; }
    if ((m = /Ryzen\s*\d\s*(?:PRO\s*)?(\d)\d{3}/i.exec(c))) { var R = { 1: 2017, 2: 2018, 3: 2019, 4: 2021, 5: 2021, 6: 2022, 7: 2022, 8: 2024, 9: 2024 }; return R[m[1]] || null; }
    return null;
  }
  function assetYear(a) { var m = /(\d{4})/.exec(String(a.mfg_ym || a.purchase_date || '')); return m ? +m[1] : null; }
  function pageCheck(tab) {
    tab = tab || 'mismatch';
    var hold = getHold();
    var mism = S.assets.filter(function (a) { return a.user_mismatch && !hold[a.asset_no]; });
    var stale = S.devices.filter(function (d) { return seen(d.last_seen).lvl === 'stale'; });
    var unreg = S.devices.filter(function (d) { return !d.asset_no; });
    function tabA(id, t, n) { return '<a href="#/check/' + id + '" class="' + (tab === id ? 'on' : '') + '">' + t + '<span class="c">' + n + '</span></a>'; }
    var body = '';
    if (tab === 'mismatch') {
      body = '<div class="note">자산대장의 사용자와 실제로 프로그램을 실행한 사번이 다른 PC입니다. 인사 이동이나 PC 교환이 대장에 반영되지 않았을 수 있습니다.</div><table class="tbl" style="margin-top:10px"><thead><tr><th>관리번호</th><th>컴퓨터 이름</th><th>대장 사용자</th><th>실제 실행 사번 / 성명</th><th>최종 확인</th><th>조치</th></tr></thead><tbody>' +
        (mism.map(function (a) { var e = a._emp; return '<tr><td class="mono"><a href="#/asset/' + encodeURIComponent(a.asset_no) + '">' + esc(a.asset_no) + '</a></td><td>' + esc(a.pc_name) + '</td><td>' + esc(a.user_name) + ' (' + esc(a.dept) + ')</td><td>' + esc(a._dev.emp_no) + ' / ' + esc(e.name) + ' (' + esc(e.dept) + ')</td><td>' + seenHtml(a.last_seen) + '</td><td><button class="btn sm pri fix" data-no="' + esc(a.asset_no) + '">대장을 실제 사용자로 수정</button> <button class="btn sm hold" data-no="' + esc(a.asset_no) + '">보류</button></td></tr>'; }).join('') || '<tr><td colspan="6" class="note" style="padding:20px;text-align:center">불일치 건이 없습니다.</td></tr>') + '</tbody></table>';
    } else if (tab === 'stale') {
      body = '<div class="note">7일 이상 프로그램이 실행되지 않은 PC입니다. 휴가·퇴사·고장 여부를 확인하세요.</div><table class="tbl" style="margin-top:10px"><thead><tr><th>관리번호</th><th>컴퓨터 이름</th><th>사용자(실행 사번)</th><th>IP</th><th>최종 확인</th></tr></thead><tbody>' +
        (stale.sort(function (a, b) { return new Date(a.last_seen) - new Date(b.last_seen); }).map(function (d) { var e = S.empBy[d.emp_no]; return '<tr><td class="mono">' + (d.asset_no ? '<a href="#/asset/' + encodeURIComponent(d.asset_no) + '">' + esc(d.asset_no) + '</a>' : '미등록') + '</td><td>' + esc(d.computer_name) + '</td><td>' + esc(e ? e.name + ' (' + e.dept + ')' : d.emp_no) + '</td><td class="mono">' + esc(d.ip) + '</td><td>' + seenHtml(d.last_seen) + '</td></tr>'; }).join('') || '<tr><td colspan="5" class="note" style="padding:20px;text-align:center">해당 PC가 없습니다.</td></tr>') + '</tbody></table>';
    } else {
      var linked = {}; S.devices.forEach(function (d) { if (d.asset_no) linked[d.asset_no] = 1; });
      var free = S.assets.filter(function (a) { return isPc(a) && !linked[a.asset_no]; });
      S.skip = S.skip || {};
      function fld(k, v) { return '<div class="uk"><div class="note">' + k + '</div><b>' + esc(v || '—') + '</b></div>'; }
      body = '<div class="note">프로그램은 실행됐지만 대장의 관리번호(QR 스티커 번호)와 연결되지 않은 PC입니다. 수집한 사양과 대장 정보를 비교해 연결하세요.</div><datalist id="free">' + free.slice(0, 800).map(function (a) { return '<option value="' + esc(a.asset_no) + '">' + esc((a.user_name || '') + ' ' + (a.model || '')) + '</option>'; }).join('') + '</datalist>' +
        (unreg.filter(function (d) { return !S.skip[d.id]; }).map(function (d) {
          var e = S.empBy[d.emp_no], cy = cpuYear(d.cpu);
          var cands = free.filter(function (a) { return e && a.user_name === e.name; }).map(function (a) {
            var ay = assetYear(a), ok = null, diff = null;
            if (cy && ay) { diff = ay - cy; ok = diff >= 0 && diff <= 3 ? true : (diff < 0 || diff > 5 ? false : null); }
            return { a: a, ay: ay, ok: ok, diff: diff };
          });
          var best = null; cands.forEach(function (c) { if (c.ok === true && (!best || c.diff < best.diff)) best = c; });
          var sel = best || cands[0] || null;
          var cards = cands.length ? cands.map(function (c) {
            var why = c.ok === true ? '<span style="color:#1e8e3e">CPU 출시 ' + cy + '년 → 제조년월 ' + esc(c.a.mfg_ym || '') + '과 <b>시기 일치</b></span>' :
              c.ok === false ? '<span style="color:#c42b1c">CPU 출시(' + cy + '년)와 이 PC의 제조 시기(' + c.ay + '년)가 맞지 않음 → <b>시기 불일치</b></span>' :
              '<span class="note">' + (cy ? '시기를 판단하기 어렵습니다.' : '수집된 CPU로 출시 연도를 알 수 없어 비교하지 않았습니다.') + '</span>';
            return '<label class="ucand' + (sel === c ? ' on' : '') + '"><div class="ut"><input type="radio" name="pk' + esc(d.id) + '" value="' + esc(c.a.asset_no) + '"' + (sel === c ? ' checked' : '') + '> <b class="mono">' + esc(c.a.asset_no) + '</b>' + (best === c ? ' ' + badge('추천', 'ok') : '') + '</div>' +
              '<div style="font-size:12px;line-height:1.7">' + esc(c.a.manufacturer || '') + ' ' + esc(c.a.model || '') + ' · 제조년월 ' + esc(c.a.mfg_ym || '—') + ' · 구매일 ' + esc(c.a.purchase_date ? ymd(c.a.purchase_date) : '—') + '<br>소속 ' + esc(c.a.dept || '—') + ' · ' + esc(c.a.title || '') + ' · 상태 ' + esc(c.a.status || '') + '</div><div class="uw">' + why + '</div></label>';
          }).join('') : '<div class="note">같은 사용자(' + esc(e ? e.name : '?') + ') 명의의 연결 가능한 PC가 대장에 없습니다. 아래에 관리번호를 직접 입력하세요.</div>';
          return '<div class="card ucard" data-id="' + esc(d.id) + '"><div style="margin-bottom:8px"><b style="font-size:14px">' + esc(d.computer_name) + '</b> <span class="note">프로그램 실행: ' + seenHtml(d.last_seen) + ' · 사번 ' + esc(d.emp_no) + ' / ' + esc(e ? e.name : '?') + '</span></div>' +
            '<div class="uspec">' + fld('CPU', d.cpu) + fld('RAM', d.ram_gb ? d.ram_gb + ' GB' : '') + fld('그래픽카드', d.gpu) + fld('저장장치', d.storage) + fld('Windows', d.os) + fld('MAC', d.mac) + fld('IP', d.ip) + '</div>' +
            '<div style="font-size:12px;font-weight:600;margin:10px 0 6px">연결할 관리번호 선택' + (cands.length > 1 ? ' <span class="note" style="font-weight:400">· 같은 사용자 명의의 PC ' + cands.length + '대입니다. 수집한 사양과 대장 정보를 비교해 보세요</span>' : '') + '</div>' +
            '<div class="ucands">' + cards + '</div>' +
            '<div class="row" style="margin-top:10px"><span class="note">목록에 없으면</span><input type="text" list="free" class="ln" data-id="' + esc(d.id) + '" placeholder="관리번호 직접 입력" style="width:190px"><span class="grow"></span><button class="btn skip" data-id="' + esc(d.id) + '">건너뛰기</button><button class="btn pri link" data-id="' + esc(d.id) + '">' + (sel ? esc(sel.a.asset_no) + ' 으로 연결' : '연결') + '</button></div></div>';
        }).join('') || '<div class="note" style="padding:20px;text-align:center">미등록 PC가 없습니다.</div>') +
        '<div class="note">추천은 참고용입니다. CPU 출시 연도와 대장의 제조년월·구매일을 비교해 가장 가까운 후보를 미리 선택해 둡니다. 연결 후에는 이 PC에서 프로그램을 실행할 때마다 해당 자산이 자동으로 갱신됩니다.</div>';
    }
    shell('check', '<h1>PC 점검</h1><div class="tabs">' + tabA('mismatch', '사용자 불일치', mism.length) + tabA('stale', '7일 이상 미확인', stale.length) + tabA('unreg', '미등록 PC', unreg.length) + '</div>' + body);
    $$('.fix').forEach(function (b) { b.onclick = async function () {
      var a = S.assets.filter(function (x) { return x.asset_no === b.dataset.no; })[0], e = a._emp;
      try { await dbHistory(a.asset_no, 'user', '사용자 정정: ' + a.user_name + ' → ' + e.name + ' (점검 화면)', a._dev && a._dev.id);
        await dbUpdateAsset(a.asset_no, { user_name: e.name, user_id: e.emp_no, dept: e.dept, title: e.title }); toast('대장을 수정했습니다.'); pageCheck('mismatch'); } catch (er) { fail(er); }
    }; });
    $$('.hold').forEach(function (b) { b.onclick = function () { var h = getHold(); h[b.dataset.no] = 1; setHold(h); pageCheck('mismatch'); }; });
    $$('.skip').forEach(function (b) { b.onclick = function () { S.skip = S.skip || {}; S.skip[b.dataset.id] = 1; pageCheck('unreg'); }; });
    $$('.ucand input').forEach(function (r) { r.onchange = function () { var card = r.closest('.ucard'); card.querySelectorAll('.ucand').forEach(function (x) { x.classList.remove('on'); }); r.closest('.ucand').classList.add('on'); card.querySelector('.link').textContent = r.value + ' 으로 연결'; }; });
    $$('.link').forEach(function (b) { b.onclick = async function () {
      var rd = document.querySelector('input[name="pk' + b.dataset.id + '"]:checked'), no = ($('.ln[data-id="' + b.dataset.id + '"]').value.trim()) || (rd ? rd.value : '');
      var a = S.assets.filter(function (x) { return x.asset_no === no; })[0];
      if (!a) { toast('대장에 없는 관리번호입니다.'); return; }
      if (S.devices.some(function (d) { return d.asset_no === no; })) { toast('이미 다른 PC와 연결된 관리번호입니다.'); return; }
      try { await dbLink(b.dataset.id, no); await dbHistory(no, 'link', '수동 연결 (미등록 PC 점검)', b.dataset.id); toast('연결했습니다.'); pageCheck('unreg'); } catch (er) { fail(er); }
    }; });
  }

  // ---------- 데이터 관리 (엑셀 업로드/다운로드) ----------
  var ASSET_MAP = { asset_no: ['관리번호', '자산번호', 'QR번호', '자산코드'], category: ['자산분류', '분류', '자산유형'], manufacturer: ['제조사'], model: ['모델명', '모델'], mfg_ym: ['제조년월', '제조일'], status: ['자산상태', '상태'], user_name: ['사용자명', '사용자', '사용자 이름'], user_id: ['사용자 ID', '사용자ID', '사번', '사용자ID(사번)'], dept: ['소속명', '부서', '부서명', '조직명'], title: ['직책', '직위'], location: ['위치', '설치위치', '소속위치'], purchase_date: ['구매일', '구입일', '구매일자', '입고일자', '취득일자'], warranty_end: ['보증만료', '보증 만료', '보증만료일'], memo: ['비고', '메모'] };
  var EMP_MAP = {
    emp_no: ['사번', '사원번호', '직원번호', '인사ID', '인사아이디'], name: ['성명', '이름'],
    dept: ['조직명', '부서', '부서명'], team: ['본부/팀', '소속', '본부', '소속명'],
    title: ['임직원호칭', '직책', '직위', '직급'], sales_title: ['영업직책'], duty: ['업무'],
    ext_no: ['회사번호(내선번호)', '내선번호', '회사번호'], address: ['주소'], joined_at: ['입사일', '입사일자'], status: ['재직상태', '재직구분']
  };
  var IMP = { assets: null, employees: null };
  function normDate(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') { var d = new Date(Math.round((v - 25569) * 86400 * 1000)); return isNaN(d) ? null : ymd(d); }
    if (v instanceof Date) return ymd(v);
    var s = String(v).trim().replace(/[./]/g, '-'); var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : null;
  }
  function normYm(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && v > 20000) return ymd(normDate(v)).slice(0, 7);
    var s = String(v).trim().replace(/[./]/g, '-'); var m = /^(\d{4})-?(\d{1,2})/.exec(s);
    return m ? m[1] + '-' + ('0' + m[2]).slice(-2) : s;
  }
  function normH(h) { return String(h == null ? '' : h).replace(/\s+/g, '').toLowerCase(); }
  function parseSheet(buf, map, keyField) {
    var wb = XLSX.read(buf, { type: 'array', cellDates: true }), ws = wb.Sheets[wb.SheetNames[0]];
    var grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: false });
    if (!grid.length) return { rows: [], cols: [], skipped: 0 };
    // 항목 이름 줄 찾기: 위쪽 15줄 중 인식되는 항목이 가장 많은 줄 (보통 첫 줄)
    function matchRow(row) {
      var hs = row.map(normH), pick = {}, cols = [];
      Object.keys(map).forEach(function (f) {
        var idx = -1;
        map[f].some(function (n) { var k = hs.indexOf(normH(n)); if (k >= 0) { idx = k; return true; } return false; });
        if (idx >= 0) { pick[f] = idx; cols.push(f); }
      });
      return { pick: pick, cols: cols };
    }
    var best = { pick: {}, cols: [] }, bestAt = 0;
    for (var hi = 0; hi < Math.min(grid.length, 15); hi++) { var m = matchRow(grid[hi]); if (m.cols.length > best.cols.length) { best = m; bestAt = hi; } }
    var pick = best.pick, cols = best.cols, rows = [], skipped = 0;
    if (cols.indexOf(keyField) < 0) return { rows: [], cols: cols, skipped: 0 };
    grid.slice(bestAt + 1).forEach(function (r0) {
      var o = {};
      cols.forEach(function (f) {
        var v = r0[pick[f]];
        if (f === 'purchase_date' || f === 'warranty_end' || f === 'joined_at') v = normDate(v);
        else if (f === 'mfg_ym') v = normYm(v);
        else {
          v = (v == null || String(v).trim() === '') ? null : String(v).trim();
          if (v !== null && f !== keyField && /^[.\-]+$/.test(v)) v = null;   // "." 같은 빈칸 표시
        }
        o[f] = v;
      });
      if (!o[keyField]) { skipped++; return; }
      if (keyField === 'emp_no') o.emp_no = o.emp_no.toUpperCase();
      rows.push(o);
    });
    return { rows: rows, cols: cols, skipped: skipped };
  }

  // ---------- 지원 요청 (원격 지원 접수) ----------
  var SUP_ST = { received: ['접수', 'warn'], working: ['진행중', 'blue'], done: ['완료', 'ok'] };
  async function dbSupport(id, patch) {
    patch.updated_at = new Date().toISOString();
    if (!DEMO) { var r = await sb.from('support_requests').update(patch).eq('id', id); if (r.error) throw r.error; }
    var x = S.support.filter(function (q) { return q.id === id; })[0]; if (x) Object.assign(x, patch);
  }
  function pageSupport(arg) {
    var f = (arg || '').split('/'), tab = f[0] === 'all' || f[0] === 'done' ? f[0] : 'open', sel = f[1] || '';
    var open = S.support.filter(function (x) { return x.status !== 'done'; }), done = S.support.filter(function (x) { return x.status === 'done'; });
    var list = tab === 'all' ? S.support : tab === 'done' ? done : open;
    var cur = S.support.filter(function (x) { return x.id === sel; })[0] || list[0] || null;
    function tabA(id, t, n) { return '<a href="#/support/' + id + '" class="' + (tab === id ? 'on' : '') + '">' + t + '<span class="c">' + n + '</span></a>'; }
    var today = S.support.filter(function (x) { return dayDiff(x.created_at) <= 0; }).length;
    var rec = S.support.filter(function (x) { return x.status === 'received'; }).length, wk = S.support.filter(function (x) { return x.status === 'working'; }).length;
    var kpi = '<div class="kpis"><div class="kpi warn"><div class="t">접수 대기</div><div class="n">' + rec + '</div></div><div class="kpi"><div class="t">진행중</div><div class="n">' + wk + '</div></div><div class="kpi ok"><div class="t">완료</div><div class="n">' + done.length + '</div></div><div class="kpi"><div class="t">오늘 접수</div><div class="n">' + today + '</div></div></div>';
    var rows = list.map(function (x) {
      var e = S.empBy[x.emp_no], st = SUP_ST[x.status] || SUP_ST.received;
      return '<tr class="' + (cur && cur.id === x.id ? 'sel' : '') + '" data-id="' + esc(x.id) + '" style="cursor:pointer"><td class="mono">' + esc(x.req_no) + '</td><td>' + esc(ymd(x.created_at).slice(5) + ' ' + hm(x.created_at)) + '</td><td>' + esc(e ? e.name + ' / ' + e.dept : x.emp_no) + '</td><td>' + esc(x.computer_name) + '</td><td>' + esc(x.symptom || '—') + '</td><td>' + badge(st[0], st[1]) + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="note" style="padding:20px;text-align:center">접수된 요청이 없습니다.</td></tr>';
    var side = '';
    if (cur) {
      var e = S.empBy[cur.emp_no], a = S.assets.filter(function (z) { return z.asset_no === cur.asset_no; })[0], dv = S.devices.filter(function (z) { return z.computer_name === cur.computer_name; })[0] || (a && a._dev);
      side = '<div class="card"><h3 style="margin:0 0 8px;font-size:13px">선택: ' + esc(cur.req_no) + '</h3><div style="font-size:12px;line-height:1.9"><b>' + esc(e ? e.name : cur.emp_no) + '</b> / ' + esc(e ? e.dept : '') + ' / 사번 ' + esc(cur.emp_no) + '<br>' + esc(cur.computer_name) + ' · ' + esc(cur.ip || '') + '<br>' +
        (dv ? esc(osShort(dv.os)) + ' · ' + esc(cpuShort(dv.cpu)) + (dv.ram_gb ? ' · ' + esc(dv.ram_gb) + 'GB' : '') + '<br>' : '') +
        '연결 자산: ' + (cur.asset_no ? '<b><a href="#/asset/' + encodeURIComponent(cur.asset_no) + '">' + esc(cur.asset_no) + '</a></b>' : '미연결') + '<br>증상: ' + esc(cur.symptom || '—') + (cur.note ? '<br>처리 메모: ' + esc(cur.note) : '') + (cur.handler ? '<br>담당: ' + esc(cur.handler) : '') + '</div>' +
        '<textarea id="supnote" class="ln" rows="2" placeholder="처리 메모 (완료 시 자산 이력에 기록)" style="width:100%;margin-top:8px;box-sizing:border-box">' + esc(cur.note || '') + '</textarea>' +
        '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm pri" id="supremote">원격 접속 열기</button>' +
        (cur.status === 'received' ? '<button class="btn sm" id="supwork">처리 시작</button>' : '') + (cur.status !== 'done' ? '<button class="btn sm" id="supdone">완료 처리</button>' : '<button class="btn sm" id="supreopen">다시 열기</button>') + '</div></div>' +
        '<div class="card" style="margin-top:10px"><h3 style="margin:0 0 6px;font-size:13px">접속 방법</h3><div class="note" style="line-height:1.7">1. [원격 접속 열기] → 원격지원 서비스 상담원 화면이 새 창으로 열림<br>2. 직원에게 접수 알림 → 직원이 대기 중인 상담원 번호를 선택<br>3. 상담원 화면에서 해당 직원 PC 접속 연결<br>4. 처리 후 [완료 처리] + 메모 → 자산 이력에 기록</div></div>';
    }
    var warn = S.supportErr ? '<div class="note" style="color:#c42b1c;margin-bottom:8px">지원 요청 표를 읽지 못했습니다. db/update_v1.1.sql 을 SQL Editor에서 실행했는지 확인하세요.</div>' : '';
    shell('support', '<h1>지원 요청</h1>' + warn + kpi + '<div class="tabs">' + tabA('open', '처리 필요', open.length) + tabA('done', '완료', done.length) + tabA('all', '전체', S.support.length) + '</div>' +
      '<div style="display:flex;gap:14px;align-items:flex-start"><div style="flex:1;min-width:0"><table class="tbl"><thead><tr><th>접수번호</th><th>접수 시각</th><th>사용자</th><th>컴퓨터 이름</th><th>증상</th><th>상태</th></tr></thead><tbody>' + rows + '</tbody></table></div><div style="width:320px;flex:none">' + side + '</div></div>');
    $$('tr[data-id]').forEach(function (tr) { tr.onclick = function () { location.hash = '#/support/' + tab + '/' + tr.dataset.id; }; });
    if (!cur) return;
    var note = function () { var n = $('#supnote'); return n ? n.value.trim() : ''; };
    var who = function () { return S.user ? S.user.email : '데모 관리자'; };
    var rm = $('#supremote'); if (rm) rm.onclick = function () {
      var u = (cfg.REMOTE_ADMIN_URL || '').trim();
      if (!/^https?:\/\//i.test(u)) { toast('config.js 의 REMOTE_ADMIN_URL 에 원격지원 상담원 화면 주소를 입력하세요.'); return; }
      window.open(u, '_blank', 'noopener');
    };
    var w = $('#supwork'); if (w) w.onclick = async function () { try { await dbSupport(cur.id, { status: 'working', handler: who() }); pageSupport(arg); } catch (er) { fail(er); } };
    var dn = $('#supdone'); if (dn) dn.onclick = async function () {
      try {
        await dbSupport(cur.id, { status: 'done', handler: cur.handler || who(), note: note() || null });
        if (cur.asset_no) await dbHistory(cur.asset_no, 'etc', '원격 지원 완료 (' + cur.req_no + '): ' + (cur.symptom || '') + (note() ? ' → ' + note() : ''), null);
        toast('완료 처리했습니다.'); pageSupport(arg);
      } catch (er) { fail(er); }
    };
    var ro = $('#supreopen'); if (ro) ro.onclick = async function () { try { await dbSupport(cur.id, { status: 'working' }); pageSupport(arg); } catch (er) { fail(er); } };
  }

  function pageData() {
    var cats = groupCount(S.assets, function (a) { return a.category; }).map(function (x) { return x[0]; });
    var stats = groupCount(S.assets, function (a) { return a.status; }).map(function (x) { return x[0]; });
    var act = S.employees.filter(function (e) { return e.active !== false; }).length;
    function opts(ph, arr) { return '<option value="">' + ph + '</option>' + arr.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join(''); }
    function sec(t, s) { return '<div class="dsec"><i></i>' + t + ' <span class="note">' + s + '</span></div>'; }
    function drop(id, msg) { return '<div class="drop"><input type="file" id="' + id + '" accept=".xlsx,.xls,.csv"><div class="note" style="margin-top:6px;line-height:1.7">' + msg + '</div></div>'; }
    shell('data', '<h1>데이터 관리</h1><div class="note" style="margin:4px 0 12px">자산 대장·인사 대장을 엑셀로 올리고 내려받습니다. 내려받은 파일은 올리는 파일과 같은 항목이라 그대로 다시 올릴 수 있습니다.</div>' +
      (!S.dates ? '<div class="note" style="color:#c42b1c;margin-bottom:8px">입사일·퇴사일 열이 아직 없습니다. 신규 입사자·퇴사자 조회를 쓰려면 SQL Editor에서 db/update_v1.8.sql 을 한 번 실행하세요.</div>' : '') +
      '<div class="dcards"><div class="card dcol"><h2>자산 대장</h2>' +
      sec('업로드', '관리번호(자산코드) 기준으로 추가·덮어쓰기') + drop('f_assets', '필수: 관리번호(자산코드) · 읽는 항목: 자산분류, 제조사, 모델명, 제조년월, 자산상태, 사용자, 소속, 직책, 위치, 구매일, 보증만료, 메모<br>itmgr의 [전체 다운로드] 파일을 그대로 올릴 수 있습니다.') +
      '<div class="dsep"></div>' + sec('다운로드', '현재 시스템에 등록된 자산') +
      '<div class="row wrap"><select id="dl_cat">' + opts('자산분류: 전체', cats) + '</select><select id="dl_st">' + opts('자산상태: 전체', stats) + '</select><span class="note" id="dl_cnt"></span><span class="grow"></span><button class="btn pri" id="dl_assets">엑셀 내려받기</button></div>' +
      '<div class="note" style="margin-top:8px">내려받은 파일은 위 업로드에 그대로 다시 올릴 수 있습니다. <button class="btn sm" id="tpl_assets">빈 양식 내려받기</button></div></div>' +
      '<div class="card dcol"><h2>인사 대장</h2>' +
      sec('업로드', '미리보기 → 적용 · 적용 이력에서 되돌리기') + drop('f_emp', '필수: 인사ID(사번), 이름(성명) · 읽는 항목: 본부/팀, 조직명, 임직원호칭, 영업직책, 업무, 회사번호(내선번호), 주소, 입사일<br><b>[적용]을 누르기 전에는 아무것도 바뀌지 않습니다.</b>') +
      '<div class="dsep"></div>' + sec('다운로드', '현재 시스템에 등록된 인사 명단') +
      '<div class="row wrap"><label style="font-size:12px"><input type="radio" name="dl_hr" value="act" checked> 재직자만 (' + act.toLocaleString() + '명)</label><label style="font-size:12px"><input type="radio" name="dl_hr" value="all"> 퇴사 포함 (' + S.employees.length.toLocaleString() + '명)</label><span class="grow"></span><button class="btn pri" id="dl_hr">엑셀 내려받기</button></div>' +
      '<div class="note" style="margin-top:8px">퇴사 포함 파일을 다시 올려도 "재직상태"가 퇴사인 사람은 재직으로 되돌아가지 않습니다. <button class="btn sm" id="tpl_hr">빈 양식 내려받기</button></div></div></div>' +
      '<div id="pv_wide" style="margin-top:12px"></div>');
    function filt() { return S.assets.filter(function (a) { return (!$('#dl_cat').value || a.category === $('#dl_cat').value) && (!$('#dl_st').value || a.status === $('#dl_st').value); }); }
    function cnt() { $('#dl_cnt').innerHTML = '해당 <b style="color:#1a1a1a">' + filt().length.toLocaleString() + '</b>건'; }
    $('#dl_cat').onchange = cnt; $('#dl_st').onchange = cnt; cnt();
    $('#dl_assets').onclick = function () { var l = filt(); if (!l.length) { toast('내려받을 자산이 없습니다.'); return; } exportXlsx(l, '자산대장'); };
    $('#dl_hr').onclick = function () {
      var all = document.querySelector('input[name=dl_hr]:checked').value === 'all';
      var l = S.employees.filter(function (e) { return all || e.active !== false; }); if (!l.length) { toast('내려받을 명단이 없습니다.'); return; }
      empXlsx(l, all ? '인사명단_퇴사포함' : '인사명단');
    };
    function tpl(heads, name) { var ws = XLSX.utils.aoa_to_sheet([heads]), wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1'); XLSX.writeFile(wb, name + '.xlsx'); }
    $('#tpl_assets').onclick = function () { tpl(['관리번호', '자산분류', '제조사', '모델명', '제조년월', '자산상태', '사용자명', '사용자 ID', '소속명', '직책', '위치', '구매일', '보증만료', '비고'], '자산대장_양식'); };
    $('#tpl_hr').onclick = function () { tpl(['인사ID', '이름', '본부/팀', '조직명', '임직원호칭', '영업직책', '업무', '회사번호(내선번호)', '주소', '입사일'], '인사대장_양식'); };

    // ---- 자산 대장 업로드
    $('#f_assets').onchange = function (e) {
      var f = e.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var p = parseSheet(rd.result, ASSET_MAP, 'asset_no'), pv = $('#pv_wide');
          if (p.cols.indexOf('asset_no') < 0) { pv.innerHTML = '<div class="err">필수 항목(관리번호 또는 자산코드)을 찾지 못했습니다. 첫 줄이 항목 이름인지 확인하세요.</div>'; return; }
          var head = p.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('');
          var body = p.rows.slice(0, 5).map(function (r) { return '<tr>' + p.cols.map(function (c) { return '<td>' + esc(r[c]) + '</td>'; }).join('') + '</tr>'; }).join('');
          pv.innerHTML = '<div class="card"><h3>자산 대장 미리보기 <span class="note" style="font-weight:400">· ' + esc(f.name) + '</span></h3><div style="margin-bottom:6px"><b>' + p.rows.length.toLocaleString() + '건</b> 인식' + (p.skipped ? ' · 관리번호가 없어 제외 ' + p.skipped + '건' : '') + ' · 같은 관리번호는 덮어쓰고, 파일에 없는 항목은 그대로 둡니다.</div><div style="overflow:auto"><table class="tbl"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div><div class="note">처음 5건만 보여 줍니다.</div><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" id="a_cancel">취소</button><button class="btn pri" id="a_go">가져오기 실행 (' + p.rows.length.toLocaleString() + '건)</button></div></div>';
          $('#a_cancel').onclick = function () { pv.innerHTML = ''; $('#f_assets').value = ''; };
          $('#a_go').onclick = async function () {
            var btn = this; btn.disabled = true; btn.textContent = '가져오는 중…';
            try { await dbUpsert('assets', p.rows, 'asset_no'); await loadAll(); toast(p.rows.length.toLocaleString() + '건을 가져왔습니다.'); pageData(); $('#pv_wide').innerHTML = '<div class="badge b-ok">완료: 자산 ' + p.rows.length.toLocaleString() + '건</div>'; }
            catch (er) { fail(er); btn.disabled = false; btn.textContent = '다시 시도'; }
          };
        } catch (er) { fail(er); }
      };
      rd.readAsArrayBuffer(f);
    };

    // ---- 인사 대장 업로드 (미리보기 → 적용)
    $('#f_emp').onchange = function (ev) {
      var f = ev.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var p = parseSheet(rd.result, EMP_MAP, 'emp_no'), pv = $('#pv_wide');
          if (p.cols.indexOf('emp_no') < 0 || p.cols.indexOf('name') < 0) { pv.innerHTML = '<div class="err">필수 항목(사번 또는 인사ID, 성명 또는 이름)을 찾지 못했습니다. 항목 이름 줄을 확인하세요.</div>'; return; }
          var baseD = firstOfMonth();
          function draw(deact) {
            var plan = planEmployees(p, deact);
            var outPct = act ? plan.outs.length / act : 0;
            var sum = '<div class="kpis"><div class="kpi ok"><div class="t">신규</div><div class="n">+' + plan.news.length + '</div></div><div class="kpi warn"><div class="t">변경</div><div class="n">' + plan.chgs.length + '</div></div><div class="kpi bad"><div class="t">퇴사(명단에서 빠짐)</div><div class="n">' + plan.outs.length + '</div></div><div class="kpi"><div class="t">오류·제외</div><div class="n">' + (plan.errs.length + p.skipped) + '</div><div class="s">동일 ' + plan.same + '명</div></div></div>';
            var rows = [];
            plan.chgs.forEach(function (x) { rows.push([x.r.emp_no, x.r.name, x.r.dept, x.r.team, x.r.title, '', '', tagH('변경 · ' + x.diffs.map(function (d) { return DF[d]; }).join('·'), 'warn')]); });
            plan.news.forEach(function (x) { rows.push([x.r.emp_no, x.r.name, x.r.dept, x.r.team, x.r.title, (S.dates ? (x.r.joined_at ? esc(x.r.joined_at) : esc(baseD) + ' <span class="note">예상</span>') : ''), '', tagH('신규', 'ok')]); });
            plan.outs.forEach(function (x) { rows.push([x.c.emp_no, x.c.name, x.c.dept, x.c.team, x.c.title, '', (S.dates ? esc(prevDay(baseD)) + ' <span class="note">예상</span>' : ''), tagH('퇴사 · 명단에서 빠짐', 'bad')]); });
            var shown = rows.slice(0, 200).map(function (r) { return '<tr><td class="mono">' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td>' + esc(r[2] || '') + '</td><td>' + esc(r[3] || '') + '</td><td>' + esc(r[4] || '') + '</td><td>' + (r[5] || '') + '</td><td>' + (r[6] || '') + '</td><td>' + r[7] + '</td></tr>'; }).join('') || '<tr><td colspan="8" class="note" style="padding:14px;text-align:center">바뀌는 내용이 없습니다.</td></tr>';
            var err = plan.errs.length ? '<div class="err" style="margin:6px 0">오류 ' + plan.errs.length + '건은 제외됩니다: ' + esc(plan.errs.slice(0, 5).join(', ')) + (plan.errs.length > 5 ? ' …' : '') + '</div>' : '';
            var big = deact && outPct > 0.3 ? '<div class="err" style="margin:6px 0">퇴사 처리가 재직 인원의 ' + Math.round(outPct * 100) + '%입니다. 일부 인원만 담긴 파일이 아닌지 확인하세요. 아래 체크를 눌러야 적용할 수 있습니다.<br><label><input type="checkbox" id="emp_ok"> 확인했습니다</label></div>' : '';
            var total = plan.news.length + plan.chgs.length + plan.outs.length;
            pv.innerHTML = '<div class="card"><h3>인사 대장 미리보기 <span class="note" style="font-weight:400">· ' + esc(f.name) + ' · ' + p.rows.length.toLocaleString() + '명 인식' + (p.skipped ? ' · 사번 없는 행 ' + p.skipped + '건 제외' : '') + '</span></h3>' + sum +
              (S.dates ? '<div class="basebox"><b>명단 기준일</b><input type="date" id="emp_base" value="' + baseD + '"><span class="chips"><button class="chip' + (baseD === firstOfMonth() ? ' on' : '') + '" data-bd="cur">이번 달 1일</button><button class="chip" data-bd="next">다음 달 1일</button></span><span class="note" style="flex:1;min-width:300px">이 명단을 뽑은 날짜입니다. 새로 나온 사람의 <b>입사일 = 기준일(' + esc(baseD) + ')</b>, 빠진 사람의 <b>퇴사일 = 기준일 전날(' + esc(prevDay(baseD)) + ')</b>로 기록합니다(예상). 엑셀에 입사일 열이 있으면 그 값을 우선합니다.</span></div>' : '') +
              '<label style="font-size:12px;display:block;margin:6px 0"><input type="checkbox" id="emp_deact"' + (deact ? ' checked' : '') + '> 파일에 없는 사번은 퇴사 처리(사번 확인 불가)</label>' + err + big +
              '<div style="overflow:auto;max-height:340px"><table class="tbl"><thead><tr><th>사번(인사ID)</th><th>이름</th><th>조직명</th><th>본부/팀</th><th>호칭</th><th>입사일</th><th>퇴사일</th><th>상태</th></tr></thead><tbody>' + shown + '</tbody></table></div>' + (rows.length > 200 ? '<div class="note">상위 200건만 표시 (전체 ' + rows.length + '건 모두 적용됩니다)</div>' : '') +
              '<div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" id="emp_cancel">취소</button><button class="btn pri" id="emp_go"' + (total ? '' : ' disabled') + '>적용 (' + (S.dates ? '기준일 ' + esc(baseD) + ' · ' : '') + '신규 ' + plan.news.length + ' · 변경 ' + plan.chgs.length + ' · 퇴사 ' + plan.outs.length + ')</button></div></div>';
            $('#emp_deact').onchange = function () { draw(this.checked); };
            var bi = $('#emp_base');
            if (bi) {
              bi.onchange = function () { if (/^\d{4}-\d{2}-\d{2}$/.test(this.value)) { baseD = this.value; draw($('#emp_deact').checked); } };
              $$('[data-bd]').forEach(function (b) { b.onclick = function () { var n = new Date(); baseD = b.dataset.bd === 'next' ? dstr(new Date(n.getFullYear(), n.getMonth() + 1, 1)) : firstOfMonth(); draw($('#emp_deact').checked); }; });
            }
            $('#emp_cancel').onclick = function () { pv.innerHTML = ''; $('#f_emp').value = ''; };
            $('#emp_go').onclick = async function () {
              var ok = $('#emp_ok'); if (big && !(ok && ok.checked)) { toast('퇴사 비율이 높습니다. 확인 체크가 필요합니다.'); return; }
              var btn = this; btn.disabled = true; btn.textContent = '적용 중…';
              try { await applyEmployees(plan, f.name, p.cols, S.dates ? baseD : null); toast('적용했습니다. (신규 ' + plan.news.length + ' · 변경 ' + plan.chgs.length + ' · 퇴사 ' + plan.outs.length + ')'); pageData(); $('#pv_wide').innerHTML = '<div class="badge b-ok">완료: 인사 대장 (신규 ' + plan.news.length + ' · 변경 ' + plan.chgs.length + ' · 퇴사 ' + plan.outs.length + ') — 인사 명단 > 적용 이력에서 되돌릴 수 있습니다.</div>'; }
              catch (er) { fail(er); btn.disabled = false; btn.textContent = '다시 시도'; }
            };
          }
          draw(true);
        } catch (er) { fail(er); }
      };
      rd.readAsArrayBuffer(f);
    };
  }

  // ---------- 인사 명단 (재적·전체·신규 입사자·퇴사자·적용 이력) ----------
  var EMP_FIELDS = ['name', 'dept', 'team', 'title', 'sales_title', 'duty', 'ext_no', 'address'];
  function EF() { return S.dates ? EMP_FIELDS.concat(['joined_at', 'left_at']) : EMP_FIELDS; }
  function tdy() { return ymd(new Date()); }
  function estH(e, k) { return (S.est && e[k + '_est'] && e[k + '_at']) ? ' <span class="note" title="엑셀 명단 기준일로 추정한 날짜입니다. [수정]에서 직접 입력하면 사라집니다.">예상</span>' : ''; }
  function prevDay(d) { var x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - 1); return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2); }
  function firstOfMonth() { var n = new Date(); return n.getFullYear() + '-' + ('0' + (n.getMonth() + 1)).slice(-2) + '-01'; }
  function empSnap(c) { var o = { emp_no: c.emp_no, active: c.active !== false }; EF().forEach(function (f) { o[f] = c[f] == null ? null : c[f]; }); if (S.est) { o.joined_est = !!c.joined_est; o.left_est = !!c.left_est; } return o; }
  var EMPV = { q: '', st: 'all', from: null, to: null, chip: '이번 달' };
  function pad2(n) { return ('0' + n).slice(-2); }
  function dstr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function periodFor(chip) {
    var n = new Date(), y = n.getFullYear(), m = n.getMonth();
    if (chip === '이번 달') return [dstr(new Date(y, m, 1)), dstr(new Date(y, m + 1, 0))];
    if (chip === '지난 달') return [dstr(new Date(y, m - 1, 1)), dstr(new Date(y, m, 0))];
    if (chip === '최근 3개월') return [dstr(new Date(y, m - 2, 1)), dstr(new Date(y, m + 1, 0))];
    if (chip === '올해') return [y + '-01-01', y + '-12-31'];
    return null;
  }
  function period() { if (!EMPV.from) { var p = periodFor('이번 달'); EMPV.from = p[0]; EMPV.to = p[1]; } return [EMPV.from, EMPV.to]; }
  function inRange(d, p) { return !!d && String(d).slice(0, 10) >= p[0] && String(d).slice(0, 10) <= p[1]; }
  function srcOf(no, kind) {
    for (var i = 0; i < S.imports.length; i++) {
      var x = S.imports[i]; if (x.reverted_at) continue;
      var hit = kind === 'add' ? (x.added_keys || []).indexOf(no) >= 0 : (x.deactivated > 0 && (x.before_rows || []).some(function (b) { return b.emp_no === no; }));
      if (hit) return /^직접/.test(x.file_name || '') ? (kind === 'add' ? '직접 등록' : '직접 처리') : '엑셀 적용';
    }
    return '—';
  }
  function devCount(no) { return S.devices.filter(function (d) { return d.emp_no === no; }).length; }
  var EMPV_PLAN = null;
  function planEmployees(p, deactivateMissing) {
    var cur = {}; S.employees.forEach(function (e) { cur[e.emp_no] = e; });
    var seen = {}, plan = { rows: [], news: [], chgs: [], outs: [], same: 0, errs: [] };
    p.rows.forEach(function (r) {
      if (!r.name) { plan.errs.push(r.emp_no + ': 성명 없음'); return; }
      if (seen[r.emp_no]) { plan.errs.push(r.emp_no + ': 파일 안에서 중복'); return; }
      seen[r.emp_no] = 1;
      var c = cur[r.emp_no];
      if (r.status && /퇴사|퇴직/.test(r.status)) { if (c && c.active !== false) plan.outs.push({ c: c }); else plan.same++; return; }   // 내려받은 파일의 '재직상태' 열
      if (!c) { plan.news.push({ r: r }); return; }
      var diffs = [];
      EF().forEach(function (f) { if (f === 'left_at') return; if (p.cols.indexOf(f) >= 0 && String(c[f] == null ? '' : c[f]) !== String(r[f] == null ? '' : r[f])) diffs.push(f); });
      if (c.active === false) diffs.push('active');
      if (diffs.length) plan.chgs.push({ r: r, c: c, diffs: diffs }); else plan.same++;
    });
    if (deactivateMissing) S.employees.forEach(function (e) { if (e.active !== false && !seen[e.emp_no]) plan.outs.push({ c: e }); });
    return plan;
  }
  var DF = { name: '이름', dept: '조직명', team: '본부/팀', title: '호칭', sales_title: '영업직책', duty: '업무', ext_no: '내선', address: '주소', joined_at: '입사일', active: '재직 복귀' };
  function tagH(t, k) { return '<span class="badge b-' + k + '">' + esc(t) + '</span>'; }
  async function applyEmployees(plan, fileName, cols, baseDate) {
    var before = [], addedKeys = [], now = new Date().toISOString(), td = baseDate || tdy(), outD = baseDate ? prevDay(baseDate) : tdy();
    var up = [];
    function mk(x, base) {
      var o = { emp_no: x.r.emp_no, active: true, updated_at: now };
      EMP_FIELDS.forEach(function (f) { o[f] = cols.indexOf(f) >= 0 ? (x.r[f] == null ? null : x.r[f]) : (base && base[f] != null ? base[f] : null); });
      if (S.dates) {
        var hasJ = cols.indexOf('joined_at') >= 0 && x.r.joined_at;
        o.joined_at = hasJ ? x.r.joined_at : (base ? (base.joined_at || null) : td);
        o.left_at = null;
        if (S.est) { o.joined_est = hasJ ? false : (base ? !!base.joined_est : true); o.left_est = false; }
      }
      return o;
    }
    plan.news.forEach(function (x) { addedKeys.push(x.r.emp_no); up.push(mk(x, null)); });
    plan.chgs.forEach(function (x) { before.push(empSnap(x.c)); up.push(mk(x, x.c)); });
    plan.outs.forEach(function (x) { before.push(empSnap(x.c)); var o = empSnap(x.c); o.active = false; o.updated_at = now; if (S.dates) o.left_at = outD; if (S.est) o.left_est = true; up.push(o); });
    await dbUpsert('employees', up, 'emp_no');
    var rec = { applied_at: now, applied_by: S.user ? S.user.email : '데모 관리자', file_name: fileName, added: plan.news.length, changed: plan.chgs.length, deactivated: plan.outs.length, added_keys: addedKeys, before_rows: before, reverted_at: null };
    if (!DEMO) { var r = await sb.from('employee_imports').insert(rec).select().single(); if (r.error) throw r.error; rec = r.data; }
    else rec.id = Date.now();
    S.imports.unshift(rec);
    if (DEMO) { /* dbUpsert 가 데모 목록을 갱신함 */ } else await loadAll();
  }
  async function revertImport(rec) {
    var up = (rec.before_rows || []).map(function (b) { return Object.assign({}, b, { updated_at: new Date().toISOString() }); });
    (rec.added_keys || []).forEach(function (k) {
      var c = S.empBy && S.empBy[k] ? S.empBy[k] : (S.employees.filter(function (e) { return e.emp_no === k; })[0]);
      if (c) { var o = empSnap(c); o.active = false; o.updated_at = new Date().toISOString(); up.push(o); }
    });
    await dbUpsert('employees', up, 'emp_no');
    var ts = new Date().toISOString();
    if (!DEMO) { var r = await sb.from('employee_imports').update({ reverted_at: ts }).eq('id', rec.id); if (r.error) throw r.error; }
    rec.reverted_at = ts;
    if (!DEMO) await loadAll(); else rebuildAssets();
  }
  function dupGroups() {
    var by = {}; S.devices.forEach(function (d) { if (d.emp_no) (by[d.emp_no] = by[d.emp_no] || []).push(d); });
    return Object.keys(by).filter(function (k) { return by[k].length > 1; }).map(function (k) { return { emp_no: k, devs: by[k] }; });
  }
  async function dbDevEmp(deviceId, empNo, hist) {
    if (!DEMO) { var r = await sb.from('devices').update({ emp_no: empNo }).eq('id', deviceId); if (r.error) throw r.error; }
    var d = S.devices.filter(function (x) { return x.id === deviceId; })[0]; if (d) d.emp_no = empNo;
    await dbHistory(d ? d.asset_no : null, 'user', hist, deviceId);
    rebuildAssets();
  }
  // 직접 등록·수정·퇴사 처리 (적용 이력에 "직접 등록"으로 남고 되돌릴 수 있음)
  async function saveManual(rowsBefore, addedKeys, up, label, counts) {
    await dbUpsert('employees', up, 'emp_no');
    var now = new Date().toISOString();
    var rec = { applied_at: now, applied_by: S.user ? S.user.email : '데모 관리자', file_name: label, added: counts[0], changed: counts[1], deactivated: counts[2], added_keys: addedKeys, before_rows: rowsBefore, reverted_at: null };
    if (!DEMO) {
      if (!S.impErr) { var r = await sb.from('employee_imports').insert(rec).select().single(); if (r.error) throw r.error; rec = r.data; }
    } else rec.id = Date.now();
    if (DEMO || !S.impErr) S.imports.unshift(rec);
    if (!DEMO) await loadAll(); else rebuildAssets();
  }
  async function empQuick(no, activate, tab) {
    var c = S.employees.filter(function (e) { return e.emp_no === no; })[0]; if (!c) return;
    if (!confirm(c.name + ' (' + no + ') 님을 ' + (activate ? '재직(복직) 상태로 되돌립니다.' : '퇴사 처리합니다.\n이후 PC 프로그램의 [사번 확인]에서 확인되지 않습니다. (적용 이력에서 되돌릴 수 있습니다)') + '\n계속할까요?')) return;
    var o = empSnap(c); o.active = !!activate; o.updated_at = new Date().toISOString(); if (S.dates) { o.left_at = activate ? null : tdy(); if (S.est) o.left_est = false; }
    try { await saveManual([empSnap(c)], [], [o], '직접 등록 (' + (activate ? '복직' : '퇴사 처리') + ')', [0, activate ? 1 : 0, activate ? 0 : 1]); toast(activate ? '복직 처리했습니다.' : '퇴사 처리했습니다.'); pageEmployees(tab); } catch (er) { fail(er); }
  }
  function empForm(no, tab) {
    var cur = no ? S.employees.filter(function (e) { return e.emp_no === no; })[0] : null;
    var old = $('#emp_dr'); if (old) old.remove();
    function f(id, label, req, ph, val, ro, type) { return '<div class="ff"><label for="ef_' + id + '">' + label + (req ? ' <span style="color:#c42b1c">*</span>' : '') + '</label><input type="' + (type || 'text') + '" id="ef_' + id + '" placeholder="' + ph + '" value="' + esc(val == null ? '' : val) + '"' + (ro ? ' readonly style="background:#f3f4f6"' : '') + ' autocomplete="off"></div>'; }
    var v = cur || {};
    var d = document.createElement('div'); d.id = 'emp_dr'; d.className = 'drawer-wrap';
    d.innerHTML = '<div class="drawer-bg"></div><div class="drawer"><div class="row" style="margin-bottom:12px"><h2 style="flex:1">' + (cur ? '직원 정보 수정' : '직원 직접 등록') + '</h2><button class="btn sm" id="ef_x">✕</button></div>' +
      '<div class="two">' + f('emp_no', '사번(인사ID)', true, '예: 10000003', v.emp_no, !!cur) + f('name', '이름', true, '예: 홍길동', v.name) + '</div>' +
      '<div class="two">' + f('team', '본부/팀', false, '예: 경영지원본부', v.team) + f('dept', '조직명', false, '예: IT지원팀', v.dept) + '</div>' +
      '<div class="two">' + f('title', '임직원호칭', false, '예: 사원', v.title) + f('sales_title', '영업직책', false, '예: TFA', v.sales_title) + '</div>' +
      '<div class="two">' + f('duty', '업무', false, '예: IT 지원', v.duty) + f('ext_no', '회사번호(내선번호)', false, '예: 02-2009-5620', v.ext_no) + '</div>' +
      f('address', '주소', false, '예: 서울 강남구 테헤란로4길 14', v.address) +
      (S.dates ? '<div class="two">' + f('joined_at', '입사일', false, '', v.joined_at, false, 'date') + f('left_at', '퇴사일', false, '', v.left_at, false, 'date') + '</div>' : '') +
      '<div class="note" id="ef_msg" style="background:#f3f8fd;border-radius:6px;padding:8px 10px;margin:8px 0 12px">· 사번이 이미 있으면 "수정"으로 저장되고, 없으면 신규로 등록됩니다.' + (S.dates ? ' 입사일을 비워 두면 오늘 날짜로 기록됩니다.' : '') + '<br>· 저장하면 바로 반영되고, 적용 이력에 "직접 등록"으로 남아 되돌릴 수 있습니다.</div>' +
      '<div class="row" style="justify-content:flex-end"><button class="btn" id="ef_cancel">취소</button><button class="btn pri" id="ef_save">저장</button></div></div>';
    document.body.appendChild(d);
    function close() { d.remove(); document.removeEventListener('keydown', esc2); }
    function esc2(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc2);
    $('#ef_x').onclick = close; $('#ef_cancel').onclick = close; $('.drawer-bg', d).onclick = close;
    setTimeout(function () { var t = $(cur ? '#ef_name' : '#ef_emp_no'); if (t) t.focus(); }, 30);
    $('#ef_save').onclick = async function () {
      var g = function (id) { return $('#ef_' + id).value.trim(); };
      var key = g('emp_no').replace(/\s+/g, '').toUpperCase(), nm = g('name'), msg = $('#ef_msg');
      if (!key || !nm) { msg.style.cssText += ';background:#fdecea;color:#c42b1c'; msg.textContent = '사번(인사ID)과 이름은 꼭 입력해야 합니다.'; return; }
      var ex = S.employees.filter(function (e) { return e.emp_no === key; })[0];
      if (!cur && ex && !confirm(key + ' 는 이미 등록된 사번입니다 (' + ex.name + ').\n입력한 내용으로 수정할까요?')) return;
      var o = { emp_no: key, active: ex ? ex.active !== false : true, updated_at: new Date().toISOString() };
      EMP_FIELDS.forEach(function (fl) { o[fl] = fl === 'name' ? nm : (g(fl) || null); });
      if (S.dates) { var jd = g('joined_at') || null, ld = g('left_at') || null; if (!ex && !jd) jd = tdy(); o.joined_at = jd; o.left_at = ld; if (S.est) { o.joined_est = (ex && jd === ex.joined_at) ? !!ex.joined_est : false; o.left_est = (ex && ld === ex.left_at) ? !!ex.left_est : false; } }
      var btn = this; btn.disabled = true; btn.textContent = '저장 중…';
      try {
        if (ex) await saveManual([empSnap(ex)], [], [o], '직접 등록 (수정)', [0, 1, 0]);
        else await saveManual([], [key], [o], '직접 등록 (신규)', [1, 0, 0]);
        close(); toast(ex ? '수정했습니다.' : '등록했습니다.'); pageEmployees(tab);
      } catch (er) { fail(er); btn.disabled = false; btn.textContent = '저장'; }
    };
  }
  function empXlsx(list, name) {
    var rows = list.map(function (e) { return { '인사ID': e.emp_no, '이름': e.name, '본부/팀': e.team, '조직명': e.dept, '임직원호칭': e.title, '영업직책': e.sales_title, '업무': e.duty, '회사번호(내선번호)': e.ext_no, '주소': e.address, '입사일': e.joined_at, '퇴사일': e.left_at, '재직상태': e.active === false ? '퇴사' : '재직' }; });
    var ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, name); XLSX.writeFile(wb, name + '_' + ymd(new Date()) + '.xlsx');
  }
  function pageEmployees(arg) {
    var tab = { all: 'all', 'new': 'new', out: 'out', history: 'history' }[arg] || 'act';
    var P = period();
    var act = S.employees.filter(function (e) { return e.active !== false; });
    var nw = S.employees.filter(function (e) { return inRange(e.joined_at, P); });
    var outs = S.employees.filter(function (e) { return e.active === false && inRange(e.left_at, P); });
    var dups = dupGroups();
    var warn = S.impErr ? '<div class="note" style="color:#c42b1c;margin-bottom:8px">적용 이력 표를 읽지 못했습니다. db/update_v1.6.sql 을 SQL Editor에서 실행했는지 확인하세요.</div>' : '';
    var warn2 = !S.dates ? '<div class="note" style="color:#c42b1c;margin-bottom:8px">입사일·퇴사일 열이 아직 없습니다. SQL Editor에서 db/update_v1.8.sql 을 한 번 실행하면 신규 입사자·퇴사자 기간 조회가 켜집니다. (그 전에도 나머지 기능은 동작합니다.)</div>' : '';
    function tabA(id, t, n) { return '<a href="#/employees/' + id + '" class="' + (tab === id ? 'on' : '') + '">' + t + (n != null ? '<span class="c">' + n + '</span>' : '') + '</a>'; }
    function kc(id, t, n, s, cls) { return '<a class="kpi ' + (cls || '') + (tab === id ? ' sel' : '') + '" href="#/employees/' + id + '"><div class="t">' + t + '</div><div class="n">' + n + '</div><div class="s">' + s + '</div></a>'; }
    var pl = EMPV.chip === '직접 선택' ? '선택 기간' : EMPV.chip;
    var kpi = '<div class="kpis">' + kc('act', '재적 인원', act.length.toLocaleString(), '현재 명단') + kc('all', '전체 인원', S.employees.length.toLocaleString(), '퇴사자 포함') +
      kc('new', '신규 입사자', '+' + nw.length, pl + ' · 기간 조회', 'ok') + kc('out', '퇴사자', outs.length.toLocaleString(), pl + ' · 기간 조회', 'bad') +
      kc('history', '여러 PC에 등록된 사번', dups.length, '적용 이력 탭에서 확인', 'warn') + '</div>';
    var tabsH = '<div class="tabs">' + tabA('act', '재적 인원', act.length.toLocaleString()) + tabA('all', '전체 인원 (퇴사자 포함)', S.employees.length.toLocaleString()) + tabA('new', '신규 입사자', nw.length) + tabA('out', '퇴사자', outs.length) + tabA('history', '적용 이력·중복 등록', S.imports.length + '/' + dups.length) + '</div>';
    function th(cols) { return '<thead><tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead>'; }
    var body = '';
    if (tab === 'act' || tab === 'all') {
      body = '<div class="row" style="margin-bottom:8px"><input type="search" id="emp_q" placeholder="사번·이름·조직·내선 검색" style="width:280px;height:30px;padding:0 8px" value="' + esc(EMPV.q || '') + '">' +
        (tab === 'all' ? '<span class="chips">' + [['all', '전체'], ['in', '재직'], ['out', '퇴사']].map(function (c) { return '<span class="chip' + (EMPV.st === c[0] ? ' on' : '') + '" data-st="' + c[0] + '">' + c[1] + '</span>'; }).join('') + '</span>' : '') +
        '<span class="grow"></span><button class="btn pri" id="emp_new">＋ 직접 등록</button></div><div id="emp_tbl"></div>';
    } else if (tab === 'new' || tab === 'out') {
      var isNew = tab === 'new', list = isNew ? nw : outs;
      var chips = ['이번 달', '지난 달', '최근 3개월', '올해', '직접 선택'].map(function (c) { return '<span class="chip' + (EMPV.chip === c ? ' on' : '') + '" data-chip="' + c + '">' + c + '</span>'; }).join('');
      var now = new Date(), months = [];
      for (var i = 5; i >= 0; i--) { var dm = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push([dm.getFullYear() + '-' + pad2(dm.getMonth() + 1), (dm.getMonth() + 1) + '월']); }
      var cnt = months.map(function (m) { return S.employees.filter(function (e) { return isNew ? String(e.joined_at || '').slice(0, 7) === m[0] : (e.active === false && String(e.left_at || '').slice(0, 7) === m[0]); }).length; });
      var mx = Math.max.apply(null, cnt.concat([1]));
      var mbar = '<div class="card mbar"><div class="ml"><b>' + (isNew ? '신규 입사자' : '퇴사자') + '</b><div class="note">월별 추이 (참고)</div></div>' + months.map(function (m, i) { return '<div class="mc"><span>' + cnt[i] + '</span><i style="height:' + (4 + Math.round(46 * cnt[i] / mx)) + 'px;background:' + (isNew ? '#1e8e3e' : '#c42b1c') + '"></i><span class="note">' + m[1] + '</span></div>'; }).join('') + '</div>';
      var rows = list.sort(function (a, b) { return String(isNew ? b.joined_at : b.left_at).localeCompare(String(isNew ? a.joined_at : a.left_at)); }).slice(0, 300).map(function (e) {
        var pc = devCount(e.emp_no);
        return isNew ?
          '<tr><td class="mono">' + esc(e.emp_no) + '</td><td>' + esc(e.name) + '</td><td>' + esc(e.dept || '') + '</td><td>' + esc(e.team || '') + '</td><td>' + esc(e.title || '') + '</td><td>' + esc(ymd(e.joined_at)) + estH(e, 'joined') + '</td><td>' + tagH(srcOf(e.emp_no, 'add'), 'gray') + '</td><td>' + (pc ? tagH('연동됨', 'ok') : tagH('미연동', 'warn')) + '</td></tr>' :
          '<tr><td class="mono">' + esc(e.emp_no) + '</td><td>' + esc(e.name) + '</td><td>' + esc(e.dept || '') + '</td><td>' + esc(e.team || '') + '</td><td>' + esc(e.title || '') + '</td><td>' + esc(ymd(e.left_at)) + estH(e, 'left') + '</td><td>' + tagH(srcOf(e.emp_no, 'out'), 'gray') + '</td><td>' + (pc ? '<b style="color:#c42b1c">PC ' + pc + '대 회수 필요</b>' : '<span style="color:#1e8e3e">PC 없음</span>') + '</td><td><button class="btn sm" data-rs="' + esc(e.emp_no) + '">복직</button></td></tr>';
      }).join('') || '<tr><td colspan="9" class="note" style="padding:16px;text-align:center">' + (S.dates ? '이 기간에 해당하는 사람이 없습니다.' : '입사일·퇴사일 열 추가(db/update_v1.8.sql, update_v1.9.sql) 후 조회할 수 있습니다.') + '</td></tr>';
      body = '<div class="card pbox"><b>기간</b><input type="date" id="p_from" value="' + P[0] + '"><span>~</span><input type="date" id="p_to" value="' + P[1] + '"><span class="chips">' + chips + '</span><span class="grow"></span><span class="note">' + (isNew ? '신규 입사자' : '퇴사자') + ' <b style="font-size:14px;color:#1a1a1a">' + list.length + '명</b></span><button class="btn" id="p_xl">엑셀 내려받기</button></div>' + mbar +
        '<div style="overflow:auto"><table class="tbl">' + th(isNew ? ['사번(인사ID)', '이름', '조직명', '본부/팀', '호칭', '입사일', '등록 방법', 'PC 연동'] : ['사번(인사ID)', '이름', '조직명', '본부/팀', '호칭', '퇴사일', '처리 방법', '사용 PC', '관리']) + '<tbody>' + rows + '</tbody></table></div>' +
        '<div class="note" style="margin-top:6px">' + (isNew ? '입사일은 엑셀의 입사일 항목이 있으면 그 값을, 없으면 명단에 처음 반영한 날(적용일)입니다. 사번 [수정]에서 고칠 수 있습니다. "PC 연동"이 미연동인 사람은 아직 PC 프로그램에서 사번 확인을 하지 않은 사람입니다.' : '"사용 PC"는 해당 사번으로 연동된 PC 수입니다. 회수·초기화가 끝나면 자산 상세에서 사용자를 정리하세요. 퇴사일은 엑셀에서 빠진 날(적용일) 또는 [퇴사 처리]한 날입니다.') + ' v1.8 이전에 올라온 명단은 입사일·퇴사일이 비어 있어 기간 조회에 나타나지 않습니다.</div>';
    } else {
      var hrows = S.imports.map(function (x, i) {
        var canRevert = !x.reverted_at && S.imports.filter(function (y) { return !y.reverted_at; })[0] === x;
        return '<tr><td>' + esc(ymd(x.applied_at) + ' ' + hm(x.applied_at)) + '</td><td>' + esc(x.applied_by || '') + '</td><td>' + esc(x.file_name || '') + '</td><td>+' + x.added + '</td><td>' + x.changed + '</td><td>' + x.deactivated + '</td><td>' + (x.reverted_at ? tagH('되돌림 ' + ymd(x.reverted_at).slice(5), 'bad') : canRevert ? '<button class="btn sm" data-rv="' + i + '">이 적용 되돌리기</button>' : '') + '</td></tr>';
      }).join('') || '<tr><td colspan="7" class="note" style="padding:16px;text-align:center">적용 이력이 없습니다.</td></tr>';
      var drows = '';
      dups.forEach(function (g) {
        var e = S.empBy[g.emp_no];
        g.devs.forEach(function (d, i) {
          drows += '<tr><td class="mono">' + (i === 0 ? esc(g.emp_no) : '') + '</td><td>' + (i === 0 ? esc(e ? e.name : '(명단에 없음)') : '') + '</td><td>' + esc(d.computer_name) + ' <span class="note">· ' + esc((d.mac || '').slice(-5)) + '</span></td><td>' + esc(ymd(d.last_seen) + ' ' + hm(d.last_seen)) + '</td><td><button class="btn sm" data-fix="' + esc(d.id) + '">사번 수정</button> <button class="btn sm" data-unl="' + esc(d.id) + '">연동 해제</button></td></tr>';
        });
      });
      if (!drows) drows = '<tr><td colspan="5" class="note" style="padding:16px;text-align:center">여러 PC에 등록된 사번이 없습니다.</td></tr>';
      body = '<h3 style="margin:4px 0 8px;font-size:13px">적용 이력</h3><table class="tbl"><thead><tr><th>적용 일시</th><th>적용자</th><th>파일</th><th>신규</th><th>변경</th><th>퇴사</th><th></th></tr></thead><tbody>' + hrows + '</tbody></table>' +
        '<h3 style="margin:16px 0 4px;font-size:13px">한 사번이 여러 PC에 등록됨</h3><div class="note" style="margin-bottom:8px">노트북+데스크톱처럼 정상일 수도 있습니다. 잘못 등록된 PC는 [사번 수정] 또는 [연동 해제]로 정리하세요.</div>' +
        '<table class="tbl"><thead><tr><th>사번</th><th>성명</th><th>PC</th><th>마지막 확인</th><th></th></tr></thead><tbody>' + drows + '</tbody></table>' +
        '<div class="note" style="margin-top:10px;line-height:1.6">인사 명단에서 빠진(퇴사) 사번은 PC 프로그램의 [사번 확인]에서 확인되지 않습니다. 틀린 사번·성명을 짧은 시간에 여러 번 조회하면 잠시 조회가 막힙니다(같은 PC 5분에 5회, 같은 사번 10분에 10회).</div>';
    }
    shell('employees', '<h1>인사 명단</h1><div class="note" style="margin:4px 0 10px">명단 확인·직접 등록·수정. 엑셀 올리기·내려받기는 <a href="#/data"><b>데이터 관리</b></a> 메뉴에서 합니다. PC 프로그램은 사번과 성명이 이 명단과 모두 일치할 때만 서버와 연동됩니다.</div>' + warn + warn2 + kpi + tabsH + body);
    if (tab === 'act' || tab === 'all') {
      var drawList = function () {
        var q = ($('#emp_q').value || '').trim().toLowerCase();
        var list = (tab === 'act' ? act : S.employees).filter(function (e) {
          if (tab === 'all' && EMPV.st === 'in' && e.active === false) return false;
          if (tab === 'all' && EMPV.st === 'out' && e.active !== false) return false;
          return !q || [e.emp_no, e.name, e.dept, e.team, e.title, e.sales_title, e.duty, e.ext_no].join(' ').toLowerCase().indexOf(q) >= 0;
        });
        var rows = list.slice(0, 300).map(function (e) {
          var btn = tab === 'all' && e.active === false ? '<button class="btn sm" data-ed="' + esc(e.emp_no) + '">수정</button> <button class="btn sm" data-rs="' + esc(e.emp_no) + '">복직</button>' : '<button class="btn sm" data-ed="' + esc(e.emp_no) + '">수정</button> <button class="btn sm" data-out="' + esc(e.emp_no) + '">퇴사 처리</button>';
          return '<tr><td class="mono">' + esc(e.emp_no) + '</td><td>' + esc(e.name) + '</td><td>' + esc(e.dept || '') + '</td><td>' + esc(e.team || '') + '</td><td>' + esc(e.title || '') + '</td><td>' + esc(e.sales_title || '') + '</td><td>' + esc(e.duty || '') + '</td><td>' + esc(e.ext_no || '') + '</td>' +
            (tab === 'all' ? '<td>' + (e.active === false ? tagH('퇴사', 'bad') : tagH('재직', 'ok')) + '</td>' : '') + '<td>' + (e.joined_at ? esc(ymd(e.joined_at)) + estH(e, 'joined') : '<span class="note">미등록</span>') + '</td>' + (tab === 'all' ? '<td>' + (e.left_at ? esc(ymd(e.left_at)) + estH(e, 'left') : '—') + '</td>' : '') + '<td>' + btn + '</td></tr>';
        }).join('') || '<tr><td colspan="12" class="note" style="padding:16px;text-align:center">표시할 명단이 없습니다.</td></tr>';
        $('#emp_tbl').innerHTML = '<div class="note" style="margin-bottom:6px">' + list.length.toLocaleString() + '명' + (list.length > 300 ? ' (상위 300명만 표시, 검색으로 좁혀 보세요)' : '') + '</div><div style="overflow:auto"><table class="tbl">' + th(['사번(인사ID)', '이름', '조직명', '본부/팀', '호칭', '영업직책', '업무', '내선'].concat(tab === 'all' ? ['상태'] : []).concat(['입사일']).concat(tab === 'all' ? ['퇴사일'] : []).concat(['관리'])) + '<tbody>' + rows + '</tbody></table></div>';
        $$('[data-ed]').forEach(function (b) { b.onclick = function () { empForm(b.dataset.ed, tab); }; });
        $$('[data-out]').forEach(function (b) { b.onclick = function () { empQuick(b.dataset.out, false, tab); }; });
        $$('[data-rs]').forEach(function (b) { b.onclick = function () { empQuick(b.dataset.rs, true, tab); }; });
      };
      $('#emp_q').oninput = function (e) { EMPV.q = this.value; if (e && e.isComposing) return; drawList(); }; $('#emp_q').addEventListener('compositionend', function () { EMPV.q = this.value; drawList(); }); drawList();
      $('#emp_new').onclick = function () { empForm(null, tab); };
      $$('[data-st]').forEach(function (c) { c.onclick = function () { EMPV.st = c.dataset.st; pageEmployees('all'); }; });
      return;
    }
    if (tab === 'new' || tab === 'out') {
      $$('[data-chip]').forEach(function (c) { c.onclick = function () { var p = periodFor(c.dataset.chip); EMPV.chip = c.dataset.chip; if (p) { EMPV.from = p[0]; EMPV.to = p[1]; } pageEmployees(tab); }; });
      var pf = $('#p_from'), pt = $('#p_to');
      function chg() { if (pf.value && pt.value) { EMPV.from = pf.value; EMPV.to = pt.value; EMPV.chip = '직접 선택'; pageEmployees(tab); } }
      pf.onchange = chg; pt.onchange = chg;
      $('#p_xl').onclick = function () { empXlsx(tab === 'new' ? nw : outs, tab === 'new' ? '신규입사자' : '퇴사자'); };
      $$('[data-rs]').forEach(function (b) { b.onclick = function () { empQuick(b.dataset.rs, true, tab); }; });
      return;
    }
    $$('[data-rv]').forEach(function (b) { b.onclick = async function () {
      var rec = S.imports[+b.dataset.rv];
      if (!confirm('이 적용(' + ymd(rec.applied_at) + ' ' + hm(rec.applied_at) + ')을 되돌립니다.\n변경·퇴사 처리된 사번은 적용 전 값으로 돌아가고, 새로 들어온 사번은 비활성 처리됩니다.\n계속할까요?')) return;
      try { await revertImport(rec); toast('되돌렸습니다.'); pageEmployees('history'); } catch (er) { fail(er); }
    }; });
    $$('[data-fix]').forEach(function (b) { b.onclick = async function () {
      var d = S.devices.filter(function (x) { return x.id === b.dataset.fix; })[0]; if (!d) return;
      var n = (prompt(d.computer_name + ' 의 올바른 사번을 입력하세요.', '') || '').trim().toUpperCase(); if (!n) return;
      if (!S.empBy[n]) { toast('인사 명단에 없는 사번입니다.'); return; }
      try { await dbDevEmp(d.id, n, '관리자 사번 수정: ' + d.emp_no + ' → ' + n); toast('수정했습니다.'); pageEmployees('history'); } catch (er) { fail(er); }
    }; });
    $$('[data-unl]').forEach(function (b) { b.onclick = async function () {
      var d = S.devices.filter(function (x) { return x.id === b.dataset.unl; })[0]; if (!d) return;
      if (!confirm(d.computer_name + ' 의 사번 연동을 해제할까요? (PC 정보는 그대로 남고 사용자만 비워집니다. 다음 실행 때 다시 사번 확인을 하면 연결됩니다.)')) return;
      try { await dbDevEmp(d.id, null, '관리자 연동 해제: ' + d.emp_no); toast('해제했습니다.'); pageEmployees('history'); } catch (er) { fail(er); }
    }; });
  }

  // ---------- 로그인 / 라우팅 ----------
  function pageLogin(msg) {
    $app.innerHTML = '<div class="login"><h1>IT 자산관리시스템</h1><label>이메일</label><input type="email" id="em" autocomplete="username"><label>비밀번호</label><input type="password" id="pw" autocomplete="current-password"><div style="margin-top:16px"><button class="btn pri" id="go" style="width:100%;height:36px">로그인</button></div><div class="err" id="er">' + esc(msg || '') + '</div></div>';
    async function go() {
      $('#er').textContent = '';
      var r = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
      if (r.error) { $('#er').textContent = '로그인에 실패했습니다. 이메일과 비밀번호를 확인하세요.'; return; }
      start();
    }
    $('#go').onclick = go; $('#pw').onkeydown = function (e) { if (e.key === 'Enter') go(); };
  }
  function route() {
    var h = (location.hash || '#/dashboard').replace(/^#\//, '').split('/'), p = h[0], arg = h.slice(1).join('/');
    try {
      if (p === 'assets') pageAssets();
      else if (p === 'asset') pageDetail(decodeURIComponent(arg));
      else if (p === 'check') pageCheck(arg);
      else if (p === 'support') pageSupport(arg);
      else if (p === 'employees') pageEmployees(arg);
      else if (p === 'data' || p === 'import') pageData();
      else pageDashboard();
    } catch (e) { fail(e); }
  }
  async function start() {
    try {
      if (!DEMO) {
        var s = await sb.auth.getSession();
        if (!s.data.session) { pageLogin(); return; }
        S.user = s.data.session.user;
        var adm = await sb.from('admin_users').select('user_id').eq('user_id', S.user.id).maybeSingle();
        if (!adm.data) { await sb.auth.signOut(); pageLogin('관리자 권한이 없는 계정입니다. 관리자에게 등록을 요청하세요.'); return; }
      }
      $app.innerHTML = '<div style="padding:40px;text-align:center;color:#5c5c5c">불러오는 중…</div>';
      await loadAll();
      window.addEventListener('hashchange', route); route();
    } catch (e) { $app.innerHTML = '<div style="padding:40px"><h1>오류</h1><p class="err">' + esc(e.message || e) + '</p><p class="note">config.js 의 주소와 키, DB 구조(schema.sql) 실행 여부를 확인하세요.</p></div>'; console.error(e); }
  }
  start();
})();
