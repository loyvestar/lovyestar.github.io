/* =========================================================
   neis.js — 나이스 교육정보 개방 포털 연동 + 학교 선택창
   ---------------------------------------------------------
   조회 흐름
     1) schoolInfo   학교명 → 후보 목록
     2) 후보가 둘 이상이면 선택창을 띄워 사용자가 지목
     3) hisTimetable 시간표 → ITRT_CNTNT에서 과목명 수집
   ---------------------------------------------------------
   공개 API
     Neis.fetchOffered(학교명, opt)  → { schoolName, schoolType, subjects[], ... }
     Neis.searchSchools(학교명, opt) → 후보 배열 (선택창 없음)
     Neis.pickSchool(후보배열, 검색어) → 선택창을 직접 띄움
     Neis.ping(opt)                  → 프록시 연결 확인

   opt = { key, proxy, pick }
     pick: 'ask'(기본) 선택창 표시 / 'auto' 첫 후보 자동 선택
   ---------------------------------------------------------
   이 파일 하나만 교체하면 됩니다. 선택창 스타일은 내장되어
   있으므로 index.html과 style.css는 손대지 않아도 됩니다.
   ========================================================= */

window.Neis = (function () {
  'use strict';

  const BASE = 'https://open.neis.go.kr/hub';
  const TIMEOUT = 12000;
  const DEFAULT_KEY = '';

  /* ---------- 오류 객체 ---------- */
  function err(code, message, extra) {
    const e = new Error(message || code);
    e.code = code;
    if (extra) Object.assign(e, extra);
    return e;
  }

  /* ---------- URL 조립 ---------- */
  function buildUrl(endpoint, params, opt) {
    const u = new URL(BASE + '/' + endpoint);
    u.searchParams.set('Type', 'json');
    u.searchParams.set('pIndex', '1');
    u.searchParams.set('pSize', String(params.pSize || 100));

    const key = (opt && opt.key) || DEFAULT_KEY;
    if (key) u.searchParams.set('KEY', key);

    Object.entries(params).forEach(([k, v]) => {
      if (k !== 'pSize' && v != null && v !== '') u.searchParams.set(k, v);
    });

    const raw = u.toString();
    const proxy = opt && opt.proxy ? String(opt.proxy).replace(/\/+$/, '') : '';
    return proxy ? proxy + '/?url=' + encodeURIComponent(raw) : raw;
  }

  /* ---------- 요청 ---------- */
  async function request(endpoint, params, opt) {
    const url = buildUrl(endpoint, params, opt);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);

    let res;
    try {
      res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw err('TIMEOUT', '응답 시간이 초과되었습니다.');
      throw err('NETWORK', '연결하지 못했습니다. 프록시 주소를 확인해 주세요.');
    }
    clearTimeout(timer);

    const text = await res.text();

    if (!res.ok) {
      let msg = '';
      try { const j = JSON.parse(text); msg = j.message || j.error || ''; } catch (e) {}
      throw err('HTTP_' + res.status, msg || `서버가 ${res.status}를 반환했습니다.`);
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw err('PARSE', '응답을 해석하지 못했습니다. 프록시가 HTML을 반환했을 수 있습니다.');
    }

    if (json.RESULT && json.RESULT.CODE && json.RESULT.CODE !== 'INFO-000') {
      const c = json.RESULT.CODE;
      if (c === 'INFO-200') throw err('NO_DATA', '해당하는 데이터가 없습니다.');
      if (c === 'INFO-300' || c === 'ERROR-290') throw err('BAD_KEY', '인증키가 유효하지 않습니다.');
      if (c === 'ERROR-337') throw err('QUOTA', '일일 호출 한도를 초과했습니다.');
      throw err(c, json.RESULT.MESSAGE || '조회에 실패했습니다.');
    }

    const block = json[endpoint];
    if (!Array.isArray(block)) throw err('NO_DATA', '결과가 비어 있습니다.');

    const rowBlock = block.find(b => Array.isArray(b.row));
    return rowBlock ? rowBlock.row : [];
  }

  /* ---------- 학교 유형 매핑 ---------- */
  function mapSchoolType(row) {
    const all = [row.HS_SC_NM, row.SPCLY_PURPS_HS_ORD_NM,
                 row.SCHUL_KND_SC_NM, row.HS_GNRL_BUSNS_SC_NM].join(' ');

    if (/과학|영재/.test(all)) return 'science';
    if (/외국어|국제/.test(all)) return 'foreign';
    if (/예술|예고/.test(all)) return 'art';
    if (/체육|체고/.test(all)) return 'sports';
    if (/마이스터|산업수요/.test(all)) return 'voc';
    if (/특성화|전문계/.test(all)) return 'voc';
    return 'general';
  }

  /* ---------- 후보 정규화 ---------- */
  function toSchool(r) {
    const addr = [r.ORG_RDNMA, r.ORG_RDNDA].filter(Boolean).join(' ').trim();

    return {
      officeCode: r.ATPT_OFCDC_SC_CODE,
      officeName: r.ATPT_OFCDC_SC_NM || '',
      schoolCode: r.SD_SCHUL_CODE,
      schoolName: (r.SCHUL_NM || '').trim(),
      kind:       r.SCHUL_KND_SC_NM || '',      /* 고등학교 / 중학교 */
      hsType:     r.HS_SC_NM || '',             /* 일반고 / 특목고 */
      purpose:    r.SPCLY_PURPS_HS_ORD_NM || '',
      found:      r.FOND_SC_NM || '',           /* 공립 / 사립 */
      coedu:      r.COEDU_SC_NM || '',          /* 남 / 여 / 남여공학 */
      dght:       r.DGHT_SC_NM || '',           /* 주간 / 야간 */
      region:     r.LCTN_SC_NM || '',
      district:   r.JU_ORG_NM || '',            /* 관할 교육지원청 */
      address:    addr,
      tel:        r.ORG_TELNO || '',
      homepage:   r.HMPG_ADRES || '',
      branch:     /분교/.test(r.SCHUL_NM || ''),
      schoolType: mapSchoolType(r)
    };
  }

  /* 주소에서 시·군·구까지만 뽑기 */
  function shortAddr(s) {
    if (!s.address) return s.region || '';
    const m = s.address.match(/^(\S+)\s+(\S+)(?:\s+(\S+))?/);
    if (!m) return s.address;
    const parts = [m[1], m[2]];
    if (m[3] && /(구|군|읍|면)$/.test(m[3])) parts.push(m[3]);
    return parts.join(' ');
  }

  /* 유형 라벨 한 줄 */
  function typeLabel(s) {
    const bits = [];
    if (s.hsType) bits.push(s.hsType);
    else if (s.kind) bits.push(s.kind);
    if (s.purpose && s.purpose !== s.hsType) bits.push(s.purpose);
    if (s.found) bits.push(s.found);
    if (s.dght && s.dght !== '주간') bits.push(s.dght);
    if (s.coedu) bits.push(s.coedu === '남여공학' ? '공학' : s.coedu);
    return bits.join(' · ');
  }

  /* ---------- 1단계: 학교 검색 ---------- */
  async function searchSchools(name, opt) {
    const q = String(name || '').trim();
    if (!q) throw err('NO_INPUT', '학교명을 입력해 주세요.');

    const rows = await request('schoolInfo', { SCHUL_NM: q, pSize: 200 }, opt);

    /* 학교코드 기준 중복 제거 */
    const seen = new Set();
    const list = [];
    rows.forEach(r => {
      const c = r.SD_SCHUL_CODE;
      if (!c || seen.has(c)) return;
      seen.add(c);
      list.push(toSchool(r));
    });

    /* 동명 학교 표시 */
    const nameCount = {};
    list.forEach(s => { nameCount[s.schoolName] = (nameCount[s.schoolName] || 0) + 1; });
    list.forEach(s => { s.isDuplicate = nameCount[s.schoolName] > 1; });

    /* 정렬: 이름 정확히 일치 → 고등학교 → 본교 → 지역명 */
    list.sort((a, b) => {
      const ea = a.schoolName === q ? 0 : 1;
      const eb = b.schoolName === q ? 0 : 1;
      if (ea !== eb) return ea - eb;

      const ha = /고등학교/.test(a.kind) ? 0 : 1;
      const hb = /고등학교/.test(b.kind) ? 0 : 1;
      if (ha !== hb) return ha - hb;

      if (a.branch !== b.branch) return a.branch ? 1 : -1;
      return (a.region + a.schoolName).localeCompare(b.region + b.schoolName, 'ko');
    });

    return list;
  }

  /* =========================================================
     학교 선택창
     ========================================================= */

  const CSS = `
.nsp-back{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;
  padding:24px;background:rgba(15,23,42,.5);backdrop-filter:blur(4px);
  -webkit-backdrop-filter:blur(4px);animation:nspFade .18s ease}
@keyframes nspFade{from{opacity:0}to{opacity:1}}
@keyframes nspUp{from{opacity:0;transform:translateY(12px) scale(.98)}
  to{opacity:1;transform:none}}
.nsp{width:min(620px,100%);max-height:min(78vh,720px);display:flex;flex-direction:column;
  background:#fff;border-radius:18px;overflow:hidden;
  box-shadow:0 24px 60px rgba(15,23,42,.28);animation:nspUp .22s cubic-bezier(.22,.61,.36,1);
  font-family:"Pretendard Variable",Pretendard,"Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;
  color:#0f172a}
.nsp-h{padding:20px 24px 14px;border-bottom:1px solid #eef2f7}
.nsp-h h3{margin:0;font-size:16px;font-weight:800;letter-spacing:-.03em}
.nsp-h p{margin:5px 0 0;font-size:12.5px;color:#64748b;line-height:1.6}
.nsp-h b{color:#1d4ed8}
.nsp-filter{position:relative;margin-top:13px}
.nsp-filter input{width:100%;padding:9px 12px 9px 34px;font:inherit;font-size:13.5px;
  border:1px solid #e2e8f0;border-radius:8px;background:#fcfdff;color:#0f172a;
  box-sizing:border-box}
.nsp-filter input:focus{outline:none;border-color:#3b82f6;
  box-shadow:0 0 0 3.5px rgba(59,130,246,.13)}
.nsp-filter svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);
  width:15px;height:15px;color:#94a3b8;pointer-events:none}
.nsp-list{overflow-y:auto;padding:8px;flex:1;scrollbar-width:thin}
.nsp-list::-webkit-scrollbar{width:8px}
.nsp-list::-webkit-scrollbar-thumb{background:#d7dee8;border-radius:99px;border:2px solid #fff}
.nsp-grp{padding:11px 14px 5px;font-size:11px;font-weight:700;color:#94a3b8;
  letter-spacing:.05em}
.nsp-item{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;
  padding:12px 14px;border:1px solid transparent;border-radius:11px;background:none;
  font:inherit;cursor:pointer;transition:background .14s,border-color .14s}
.nsp-item:hover,.nsp-item.on{background:#f4f8ff;border-color:#d6e4ff}
.nsp-item:focus-visible{outline:2px solid #3b82f6;outline-offset:-2px}
.nsp-ico{flex:none;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;
  background:#eff5ff;color:#1d4ed8;font-size:11px;font-weight:800;letter-spacing:-.02em}
.nsp-item.on .nsp-ico,.nsp-item:hover .nsp-ico{background:#1d4ed8;color:#fff}
.nsp-tx{min-width:0;flex:1}
.nsp-nm{display:flex;align-items:center;gap:6px;flex-wrap:wrap;
  font-size:14.5px;font-weight:700;letter-spacing:-.02em;line-height:1.4}
.nsp-badge{padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700;
  background:#fef6e7;color:#b45309}
.nsp-badge.br{background:#f4f1fe;color:#6d4aca}
.nsp-meta{margin:3px 0 0;font-size:12px;color:#475569;line-height:1.55}
.nsp-addr{margin:1px 0 0;font-size:11.5px;color:#94a3b8;line-height:1.5;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nsp-code{flex:none;font-size:10.5px;color:#94a3b8;font-variant-numeric:tabular-nums;
  padding-top:3px;font-family:ui-monospace,Menlo,Consolas,monospace}
.nsp-empty{padding:36px 20px;text-align:center;font-size:13px;color:#94a3b8}
.nsp-f{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:13px 20px;border-top:1px solid #eef2f7;background:#fafbfd}
.nsp-hint{font-size:11.5px;color:#94a3b8}
.nsp-hint kbd{padding:1px 5px;border:1px solid #e2e8f0;border-bottom-width:2px;
  border-radius:4px;background:#fff;font-size:10px;font-family:inherit;color:#64748b}
.nsp-x{padding:8px 16px;font:inherit;font-size:13px;font-weight:600;color:#334155;
  background:#fff;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer}
.nsp-x:hover{background:#f8fafc;border-color:#cbd5e1}
@media(max-width:520px){
  .nsp-back{padding:12px;align-items:flex-end}
  .nsp{max-height:86vh;border-radius:16px}
  .nsp-code{display:none}
}
@media(prefers-reduced-motion:reduce){.nsp-back,.nsp{animation:none}}`;

  function injectCss() {
    if (document.getElementById('nsp-css')) return;
    const st = document.createElement('style');
    st.id = 'nsp-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 아이콘에 넣을 두 글자 */
  function initials(s) {
    const n = s.schoolName.replace(/(초등학교|중학교|고등학교|학교)$/, '');
    return n.slice(0, 2) || '학교';
  }

  /**
   * 후보 목록에서 하나를 고르게 합니다.
   * @returns {Promise<Object|null>} 선택된 학교, 취소하면 null
   */
  function pickSchool(list, query) {
    injectCss();

    return new Promise(resolve => {
      const back = document.createElement('div');
      back.className = 'nsp-back';
      back.setAttribute('role', 'dialog');
      back.setAttribute('aria-modal', 'true');

      const dupCount = list.filter(s => s.isDuplicate).length;
      const desc = dupCount
        ? `<b>${list.length}곳</b>이 검색되었습니다. 이름이 같은 학교가 있으니 지역과 주소를 확인하세요.`
        : `<b>${list.length}곳</b>이 검색되었습니다. 조회할 학교를 골라 주세요.`;

      back.innerHTML =
        '<div class="nsp">' +
          '<div class="nsp-h">' +
            '<h3>학교 선택</h3>' +
            '<p>' + desc + '</p>' +
            '<div class="nsp-filter">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
                   'stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
              '<input type="text" placeholder="지역이나 학교명으로 좁히기" spellcheck="false">' +
            '</div>' +
          '</div>' +
          '<div class="nsp-list"></div>' +
          '<div class="nsp-f">' +
            '<span class="nsp-hint"><kbd>↑</kbd><kbd>↓</kbd> 이동 · <kbd>Enter</kbd> 선택 · <kbd>Esc</kbd> 닫기</span>' +
            '<button type="button" class="nsp-x">취소</button>' +
          '</div>' +
        '</div>';

      const listEl = back.querySelector('.nsp-list');
      const input  = back.querySelector('.nsp-filter input');
      const prevFocus = document.activeElement;
      let shown = [];
      let cursor = 0;

      function draw(filter) {
        const f = (filter || '').trim().toLowerCase();
        shown = !f ? list.slice() : list.filter(s =>
          (s.schoolName + s.region + s.district + s.address + s.hsType + s.found)
            .toLowerCase().includes(f));

        if (!shown.length) {
          listEl.innerHTML = '<p class="nsp-empty">조건에 맞는 학교가 없습니다.</p>';
          return;
        }

        let html = '';
        let lastRegion = null;

        shown.forEach((s, i) => {
          if (s.region !== lastRegion) {
            lastRegion = s.region;
            html += '<div class="nsp-grp">' + esc(s.region || '지역 미상') + '</div>';
          }

          const meta = [typeLabel(s), s.district].filter(Boolean).join('  ·  ');

          html +=
            '<button type="button" class="nsp-item' + (i === 0 ? ' on' : '') + '" data-i="' + i + '">' +
              '<span class="nsp-ico">' + esc(initials(s)) + '</span>' +
              '<span class="nsp-tx">' +
                '<span class="nsp-nm">' + esc(s.schoolName) +
                  (s.isDuplicate ? '<span class="nsp-badge">동명</span>' : '') +
                  (s.branch ? '<span class="nsp-badge br">분교</span>' : '') +
                '</span>' +
                (meta ? '<p class="nsp-meta">' + esc(meta) + '</p>' : '') +
                '<p class="nsp-addr">' + esc(s.address || shortAddr(s)) + '</p>' +
              '</span>' +
              '<span class="nsp-code">' + esc(s.schoolCode) + '</span>' +
            '</button>';
        });

        listEl.innerHTML = html;
        cursor = 0;
      }

      function move(step) {
        const items = listEl.querySelectorAll('.nsp-item');
        if (!items.length) return;
        items[cursor] && items[cursor].classList.remove('on');
        cursor = (cursor + step + items.length) % items.length;
        items[cursor].classList.add('on');
        items[cursor].scrollIntoView({ block: 'nearest' });
      }

      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        back.remove();
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(result);
      }

      function onKey(e) {
        if (e.key === 'Escape')    { e.preventDefault(); close(null); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowUp')   { e.preventDefault(); move(-1); }
        else if (e.key === 'Enter')     { e.preventDefault(); if (shown[cursor]) close(shown[cursor]); }
      }

      listEl.addEventListener('click', e => {
        const btn = e.target.closest('.nsp-item');
        if (btn) close(shown[+btn.dataset.i]);
      });
      input.addEventListener('input', () => draw(input.value));
      back.querySelector('.nsp-x').addEventListener('click', () => close(null));
      back.addEventListener('mousedown', e => { if (e.target === back) close(null); });
      document.addEventListener('keydown', onKey, true);

      draw('');
      document.body.appendChild(back);
      input.focus();
    });
  }

  /* ---------- 과목명 정리 ---------- */
  const DROP = /^(창의적?\s*체험활동|창체|자율|동아리|진로활동?|봉사|재량|토론|자습|보충|방과후|상담|조회|종례|점심|중식|석식|청소|시험|고사|평가|휴업|행사|축제|체험학습|현장학습|수능|모의고사|담임|HR|아침|독서|계기교육|안전교육|기타|없음|-|\s*)$/;

  function cleanSubject(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';

    s = s.replace(/[（(【[][^）)】\]]*[）)】\]]/g, '');
    s = s.split(/[\/｜|·:：]/)[0];
    s = s.replace(/^[\s\-*·※]+|[\s\-*·※]+$/g, '');
    s = s.replace(/\bII\b/g, 'Ⅱ').replace(/\bI\b/g, 'Ⅰ')
         .replace(/(\S)2$/, (m, a) => /[가-힣]/.test(a) ? a + 'Ⅱ' : m)
         .replace(/(\S)1$/, (m, a) => /[가-힣]/.test(a) ? a + 'Ⅰ' : m);
    s = s.replace(/\s{2,}/g, ' ').trim();

    if (s.length < 2 || s.length > 20) return '';
    if (DROP.test(s)) return '';
    if (!/[가-힣]/.test(s)) return '';
    return s;
  }

  function knownSubjects() {
    if (typeof TRACKS === 'undefined') return [];
    const set = new Set();
    Object.values(TRACKS).forEach(t => {
      ['general', 'career', 'fusion', 'special'].forEach(k => {
        (t[k] || []).forEach(s => set.add(s));
      });
    });
    return [...set];
  }

  function normalize(list) {
    const known = knownSubjects();
    const out = new Set();

    list.forEach(raw => {
      const s = cleanSubject(raw);
      if (!s) return;
      if (known.includes(s)) { out.add(s); return; }
      const flat = s.replace(/[\s·․ㆍ]/g, '');
      const hit = known.find(k => k.replace(/[\s·․ㆍ]/g, '') === flat);
      out.add(hit || s);
    });

    return [...out].sort((a, b) => a.localeCompare(b, 'ko'));
  }

  /* ---------- 2단계: 시간표 ---------- */
  function academicYear() {
    const d = new Date();
    return String(d.getMonth() + 1 < 3 ? d.getFullYear() - 1 : d.getFullYear());
  }

  async function fetchTimetable(school, opt) {
    const ay = academicYear();
    const collected = [];
    const log = [];

    for (const sem of ['1', '2']) {
      for (const grade of ['1', '2', '3']) {
        try {
          const rows = await request('hisTimetable', {
            ATPT_OFCDC_SC_CODE: school.officeCode,
            SD_SCHUL_CODE: school.schoolCode,
            AY: ay, SEM: sem, GRADE: grade, pSize: 1000
          }, opt);
          rows.forEach(r => { if (r.ITRT_CNTNT) collected.push(r.ITRT_CNTNT); });
          log.push(`${sem}학기 ${grade}학년 ${rows.length}건`);
        } catch (e) {
          if (e.code === 'NO_DATA') { log.push(`${sem}학기 ${grade}학년 없음`); continue; }
          if (e.code === 'BAD_KEY' || e.code === 'QUOTA') throw e;
          log.push(`${sem}학기 ${grade}학년 실패`);
        }
      }
    }
    return { raw: collected, log, year: ay };
  }

  /* ---------- 공개 함수 ---------- */
  async function fetchOffered(name, opt) {
    opt = opt || {};

    const list = await searchSchools(name, opt);
    if (!list.length) {
      throw err('NOT_FOUND', '학교를 찾지 못했습니다. 정확한 학교명을 입력해 주세요.');
    }

    /* 후보가 둘 이상이면 사용자가 직접 고릅니다 */
    let school;
    if (list.length === 1 || opt.pick === 'auto') {
      school = list[0];
    } else {
      school = await pickSchool(list, String(name).trim());
      if (!school) throw err('CANCELLED', '학교 선택을 취소했습니다.');
    }

    const tt = await fetchTimetable(school, opt);

    if (!tt.raw.length) {
      throw err('NO_TIMETABLE',
        `${school.schoolName}의 시간표 데이터가 없습니다. 학교가 나이스에 공개하지 않았을 수 있습니다.`,
        { school: school.schoolName, log: tt.log });
    }

    const subjects = normalize(tt.raw);
    if (!subjects.length) {
      throw err('NO_SUBJECT', '수업 내용에서 과목명을 찾지 못했습니다.', { log: tt.log });
    }

    return {
      schoolName: school.schoolName,
      schoolType: school.schoolType,
      schoolCode: school.schoolCode,
      officeCode: school.officeCode,
      subjects: subjects,
      school: school,
      meta: {
        year: tt.year,
        rawCount: tt.raw.length,
        candidates: list.length,
        picked: list.length > 1,
        region: school.region,
        district: school.district,
        address: school.address,
        hsType: school.hsType || school.kind,
        found: school.found,
        label: [school.region, school.district, school.hsType, school.found]
                 .filter(Boolean).join(' · '),
        log: tt.log
      }
    };
  }

  /* ---------- 프록시 연결 확인 ---------- */
  async function ping(opt) {
    const proxy = opt && opt.proxy ? String(opt.proxy).replace(/\/+$/, '') : '';
    if (!proxy) return { ok: false, message: '프록시 주소가 없습니다.' };

    try {
      const res = await fetch(proxy + '/health');
      const j = await res.json();
      return {
        ok: !!j.ok,
        hasKey: !!j.hasKey,
        message: j.ok
          ? `프록시 정상 · 서버 키 ${j.hasKey ? '있음' : '없음'}`
          : '프록시가 응답했으나 형식이 다릅니다.'
      };
    } catch (e) {
      return { ok: false, message: '프록시에 연결하지 못했습니다.' };
    }
  }

  return {
    fetchOffered, searchSchools, pickSchool, ping,
    cleanSubject, normalize, typeLabel
  };
})();
