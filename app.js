/* =========================================================
   app.js — 화면 제어 · NEIS 연동 · 학급 단위 일괄 출력
   ---------------------------------------------------------
   로드 순서:  data.js → report.js → neis.js → app.js
   ---------------------------------------------------------
   [자동 보강]
   아래 요소가 HTML에 없으면 app.js가 직접 만들어 넣습니다.
     btnSaveCfg  · 설정 저장 버튼      → fProxy 뒤
     cfgState    · 설정 상태 문구      → 저장 버튼 뒤
     btnLookup   · 개설 과목 조회 버튼 → fSchoolName 뒤
     lookupState · 조회 상태 문구      → 조회 버튼 뒤
     fOffered    · 개설 과목 입력창    → fSchoolName 블록 뒤
     fSchoolType · 학교 유형 셀렉트    → fRegion 앞
   ---------------------------------------------------------
   [일괄 입력 열 순서]
   이름, 학번, 학년, 계열코드, 지역코드, 개설과목수, 중복수,
   희망개설률, 공동강좌수, 인프라, 수준코드, (학교유형코드)
   ========================================================= */

(function () {
  'use strict';

  const $  = id => document.getElementById(id);
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  const val = (id, def) => { const el = $(id); return el ? el.value : def; };
  const setVal = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };
  const numOf = (id, def) => { const n = parseFloat(val(id, '')); return isNaN(n) ? def : n; };

  function say(id, msg, kind) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg || '';
    const base = el.classList.contains('batch-status') ? 'batch-status' : 'state';
    el.className = base + (kind ? ' is-' + kind : '');
  }

  const LS_FORM = 'hcs.form.v3';
  const LS_CFG  = 'hcs.cfg.v3';

  let batch = [];

var PICKED_SCHOOL = null;

function saveSchool(s) {
  PICKED_SCHOOL = s ? {
    name:     s.schoolName || '',
    type:     s.schoolType || 'general',
    code:     s.schoolCode || '',
    office:   s.officeName || '',
    region:   s.region || '',
    district: s.district || '',
    hsType:   s.hsType || s.kind || '',
    found:    s.found || '',
    address:  s.address || '',
    at:       Date.now()
  } : null;

  try {
    if (PICKED_SCHOOL) localStorage.setItem('pickedSchool', JSON.stringify(PICKED_SCHOOL));
    else localStorage.removeItem('pickedSchool');
  } catch (e) {}
}

function loadSchool() {
  try {
    var raw = localStorage.getItem('pickedSchool');
    if (raw) PICKED_SCHOOL = JSON.parse(raw);
  } catch (e) {}
}
loadSchool();

  /* =======================================================
     0. 누락 요소 자동 생성
     ======================================================= */

  /* 입력 요소를 감싸는 가장 가까운 블록을 찾음 */
  function fieldBox(el) {
    if (!el) return null;
    return el.closest('.field, .form-row, .input-row, .card, .row') || el.parentElement;
  }

  function makeEl(tag, attrs, text) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
    if (text) e.textContent = text;
    return e;
  }

  function ensureUI() {
    const made = [];

    /* --- 학교 유형 셀렉트 --- */
    if (!$('fSchoolType')) {
      const anchor = $('fRegion') || $('fGrade');
      const box = fieldBox(anchor);
      if (box) {
        const wrap = makeEl('div', { class: 'field' });
        wrap.appendChild(makeEl('label', { for: 'fSchoolType' }, '학교 유형'));
        wrap.appendChild(makeEl('select', { id: 'fSchoolType' }));
        box.parentElement.insertBefore(wrap, box);
        made.push('fSchoolType');
      }
    }

    /* --- 개설 과목 조회 버튼 · 상태 --- */
    const sn = $('fSchoolName');
    if (sn) {
      const box = fieldBox(sn);

      if (!$('btnLookup')) {
        const btn = makeEl('button',
          { id: 'btnLookup', type: 'button', class: 'btn btn-primary btn-sm' },
          '개설 과목 조회');
        sn.insertAdjacentElement('afterend', btn);
        made.push('btnLookup');
      }
      if (!$('lookupState')) {
        const p = makeEl('p', { id: 'lookupState', class: 'state', 'aria-live': 'polite' });
        ($('btnLookup') || sn).insertAdjacentElement('afterend', p);
        made.push('lookupState');
      }

      /* --- 개설 과목 입력창 --- */
      if (!$('fOffered') && box) {
        const wrap = makeEl('div', { class: 'field' });
        wrap.appendChild(makeEl('label', { for: 'fOffered' }, '개설 과목 목록'));
        const ta = makeEl('textarea', {
          id: 'fOffered', rows: '5', spellcheck: 'false',
          placeholder: '조회하면 자동으로 채워집니다. 직접 입력할 때는 쉼표나 줄바꿈으로 구분하세요.\n예) 대수, 미적분Ⅰ, 확률과 통계, 물리학, 정보'
        });
        wrap.appendChild(ta);
        wrap.appendChild(makeEl('p', { class: 'hint' },
          '비워 두면 지역 기준값으로 추정합니다. 채우면 실제 개설 여부를 대조합니다.'));
        box.insertAdjacentElement('afterend', wrap);
        made.push('fOffered');
      }
    }

    /* --- 설정 저장 버튼 · 상태 --- */
    const px = $('fProxy');
    if (px) {
      if (!$('btnSaveCfg')) {
        const btn = makeEl('button',
          { id: 'btnSaveCfg', type: 'button', class: 'btn btn-ghost btn-sm' },
          '인증 설정 저장');
        px.insertAdjacentElement('afterend', btn);
        made.push('btnSaveCfg');
      }
      if (!$('cfgState')) {
        const p = makeEl('p', { id: 'cfgState', class: 'state', 'aria-live': 'polite' });
        ($('btnSaveCfg') || px).insertAdjacentElement('afterend', p);
        made.push('cfgState');
      }
    }

    /* --- 최소 스타일 주입 (없을 때만) --- */
    if (made.length && !$('hcsAutoStyle')) {
      const css = `
        #fOffered{width:100%;min-height:96px;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;
          padding:10px 12px;border:1px solid #d5dce8;border-radius:8px;resize:vertical;box-sizing:border-box}
        .state{margin:6px 0 0;font-size:12.5px;color:#5b6880;min-height:1em}
        .state.is-ok{color:#15803d}.state.is-err{color:#b91c1c}
        .state.is-warn{color:#b45309}.state.is-busy{color:#1d4ed8}
        .btn-sm{margin-top:8px;padding:7px 14px;font-size:13px;cursor:pointer;
          border-radius:8px;border:1px solid #cbd5e1;background:#fff}
        .btn-sm.btn-primary{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
        .hint{margin:6px 0 0;font-size:12px;color:#7c8598}
      `;
      const st = makeEl('style', { id: 'hcsAutoStyle' });
      st.textContent = css;
      document.head.appendChild(st);
    }

    if (made.length) console.info('[app.js] 자동 생성:', made.join(', '));
    return made;
  }

  /* =======================================================
     1. 셀렉트 채우기
     ======================================================= */
  function initSelects() {
    const st = $('fSchoolType');
    if (st) {
      const keep = st.value;
      st.innerHTML = Object.entries(SCHOOL_TYPES)
        .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
      if (keep) st.value = keep;
    }

    const tr = $('fTrack');
    if (tr) {
      const keep = tr.value;
      tr.innerHTML = TRACK_GROUPS.map(g => {
        const opts = Object.entries(TRACKS)
          .filter(([, v]) => v.group === g)
          .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
        return `<optgroup label="${g}">${opts}</optgroup>`;
      }).join('');
      if (keep && TRACKS[keep]) tr.value = keep;
    }

    const rg = $('fRegion');
    if (rg && !rg.options.length) {
      rg.innerHTML = Object.entries(BASELINE)
        .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    }

    const lv = $('fLevel');
    if (lv && !lv.options.length) {
      lv.innerHTML = Object.entries(LEVEL_LABEL)
        .map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    }

    const gr = $('fGrade');
    if (gr && !gr.options.length) {
      gr.innerHTML = [1, 2, 3].map(n => `<option value="${n}">${n}학년</option>`).join('');
    }

    if ($('fDate') && !val('fDate', '')) setVal('fDate', today());
    renderLegend();
  }

  function renderLegend() {
    const box = document.querySelector('.code-legend');
    if (!box) return;
    const byGroup = TRACK_GROUPS.map(g => {
      const items = Object.entries(TRACKS)
        .filter(([, v]) => v.group === g)
        .map(([k, v]) => `${k} ${v.label.split(' · ')[0]}`).join(' / ');
      return `<li><b>계열코드 · ${g}</b> ${items}</li>`;
    }).join('');
    const types = Object.entries(SCHOOL_TYPES).map(([k, v]) => `${k} ${v.short}`).join(' / ');
    box.innerHTML = byGroup +
      '<li><b>지역코드</b> big 대도시 / mid 중소도시 / rural 읍면지역</li>' +
      '<li><b>수준코드</b> low 기초 / mid 보통 / high 심화</li>' +
      `<li><b>학교유형</b>(12번째 열, 생략 가능) ${types}</li>`;
  }

  function today() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}.`;
  }

  /* =======================================================
     2. 값 수집
     ======================================================= */
  function parseOffered(text) {
    return [...new Set(String(text || '')
      .split(/[,\n;·|]/).map(s => s.trim()).filter(Boolean))];
  }

  const currentOffered = () => parseOffered(val('fOffered', ''));

  function collect() {
    const offered = currentOffered();
    return {
      schoolName: PICKED_SCHOOL ? PICKED_SCHOOL.name : (fSchoolName.value.trim() || ''),
      schoolInfo: PICKED_SCHOOL,
      name:       val('fName', '').trim(),
      no:         val('fNo', '').trim(),
      grade:      String(val('fGrade', '1')),
      schoolType: val('fSchoolType', 'general'),
      region:     val('fRegion', 'mid'),
      track:      val('fTrack', 'ai'),
      level:      val('fLevel', 'mid'),
      goal:       val('fGoal', '').trim(),
      memo:       val('fMemo', '').trim(),
      counselor:  val('fCounselor', '').trim(),
      date:       val('fDate', today()),
      subjects:   numOf('fSubjects', 80),
      dup:        numOf('fDup', 12),
      want:       numOf('fWant', 60),
      coop:       numOf('fCoop', 5),
      net:        numOf('fNet', 70),
      offered:    offered,
      source:     offered.length ? (window.__autoLoaded ? 'auto' : 'manual') : null
    };
  }

  /* =======================================================
     3. 단일 미리보기
     ======================================================= */
  let timer = null;

  function previewBox() {
    return $('preview') || $('stage')
      || document.querySelector('.preview-stage:not(#batchStage)');
  }

  function renderOne() {
    const box = previewBox();
    if (box) box.innerHTML = Report.render(collect());
  }

  function renderSoon() {
    clearTimeout(timer);
    timer = setTimeout(() => { renderOne(); saveForm(); }, 180);
  }

  /* =======================================================
     4. 저장 · 복원
     ======================================================= */
  const FORM_IDS = ['fName', 'fNo', 'fGrade', 'fSchoolType', 'fRegion', 'fTrack', 'fLevel',
    'fGoal', 'fMemo', 'fCounselor', 'fDate', 'fSubjects', 'fDup', 'fWant', 'fCoop', 'fNet',
    'fOffered', 'fSchoolName'];

  function saveForm() {
    try {
      const o = {};
      FORM_IDS.forEach(id => { if ($(id)) o[id] = val(id, ''); });
      const b = $('batchInput'); if (b) o.batchInput = b.value;
      localStorage.setItem(LS_FORM, JSON.stringify(o));
    } catch (e) {}
  }

  function loadForm() {
    try {
      const o = JSON.parse(localStorage.getItem(LS_FORM) || '{}');
      Object.entries(o).forEach(([id, v]) => setVal(id, v));
    } catch (e) {}
  }

  function saveCfg() {
    try {
      localStorage.setItem(LS_CFG, JSON.stringify({
        key:   val('fKey', '').trim(),
        proxy: val('fProxy', '').trim().replace(/\/+$/, '')
      }));
      say('cfgState', '나이스 API키가 정상적으로 적용되었습니다.', 'ok');
    } catch (e) {
      say('cfgState', '브라우저 저장소를 사용할 수 없습니다.', 'err');
    }
  }

  function loadCfg() {
    try {
      const c = JSON.parse(localStorage.getItem(LS_CFG) || '{}');
      setVal('fKey', c.key || '');
      setVal('fProxy', c.proxy || '');
      return c;
    } catch (e) { return {}; }
  }

  /* =======================================================
     5. NEIS 조회
     ======================================================= */
  async function lookup() {
    const name = val('fSchoolName', '').trim();
    if (!name) { say('lookupState', '학교명을 입력해 주세요.', 'err'); return; }
    if (typeof window.Neis === 'undefined' || !window.Neis.fetchOffered) {
      say('lookupState', 'neis.js가 로드되지 않았습니다. 개설 과목을 직접 입력해 주세요.', 'err');
      return;
    }

    const cfg = { key: val('fKey', '').trim(), proxy: val('fProxy', '').trim().replace(/\/+$/, '') };
    const btn = $('btnLookup');
    fSchoolName.addEventListener('blur', function () {
    var v = fSchoolName.value.trim();
    if (!v) return;
    if (!PICKED_SCHOOL || PICKED_SCHOOL.name !== v) {
      saveSchool({ schoolName: v });
      renderSoon();
       }
     });
    if (btn) btn.disabled = true;
    say('lookupState', '조회 중입니다…', 'busy');
    var result = await Neis.fetchOffered(name, cfg);
    saveSchool(result.school);          // ← 추가
    fOffered.value = result.subjects.join(', ');
    if (fSchoolType) fSchoolType.value = result.schoolType;
    renderSoon();                            // ← 미리보기 갱신

    try {
      const res = await window.Neis.fetchOffered(name, cfg);
      if (!res || !res.subjects || !res.subjects.length) {
        say('lookupState', '개설 과목을 찾지 못했습니다. 직접 입력해 주세요.', 'err');
        return;
      }
      setVal('fOffered', res.subjects.join(', '));
      if (res.schoolType && $('fSchoolType') && SCHOOL_TYPES[res.schoolType]) {
        setVal('fSchoolType', res.schoolType);
      }
      window.__autoLoaded = true;
      say('lookupState', `${res.schoolName || name} · ${res.subjects.length}과목을 불러왔습니다.`, 'ok');
      renderSoon();
    } catch (err) {
      const code = (err && err.code) ? ` (${err.code})` : '';
      say('lookupState', `조회에 실패했습니다.${code} 개설 과목을 직접 입력해 주세요.`, 'err');
      console.error('[neis]', err);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* =======================================================
     6. 코드 해석
     ======================================================= */
  function toSchoolType(v, fallback) {
    const s = String(v || '').trim();
    if (!s) return fallback;
    if (SCHOOL_TYPES[s]) return s;
    const hit = Object.entries(SCHOOL_TYPES).find(([, o]) =>
      o.short === s || o.label === s || o.label.indexOf(s) >= 0);
    return hit ? hit[0] : fallback;
  }

  function toRegion(v) {
    const s = String(v || '').trim();
    if (BASELINE[s]) return s;
    const hit = Object.entries(BASELINE).find(([, o]) => o.label === s);
    if (hit) return hit[0];
    if (/대도시|광역|특별/.test(s)) return 'big';
    if (/읍|면|농어촌|도서/.test(s)) return 'rural';
    return 'mid';
  }

  function toTrack(v) {
    const s = String(v || '').trim();
    if (TRACKS[s]) return s;
    const exact = Object.entries(TRACKS).find(([, o]) => o.label === s);
    if (exact) return exact[0];
    const part = s && Object.entries(TRACKS).find(([, o]) => o.label.indexOf(s) >= 0);
    return part ? part[0] : null;
  }

  function toLevel(v) {
    const s = String(v || '').trim();
    if (LEVEL_LABEL[s]) return s;
    if (/기초/.test(s)) return 'low';
    if (/심화|도전/.test(s)) return 'high';
    return 'mid';
  }

  function toNum(v, def) {
    const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, ''));
    return isNaN(n) ? def : n;
  }

  function splitLine(line) {
    const out = []; let cell = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"') { if (line[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === '\t') { out.push(cell.trim()); cell = ''; }
      else cell += c;
    }
    out.push(cell.trim());
    return out;
  }

  /* =======================================================
     7. 일괄 파싱
     ======================================================= */
  function parseBatch(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
      .map(s => s.trim()).filter(Boolean);

    const offered = currentOffered();
    const common = {
      counselor: val('fCounselor', '').trim(),
      date: val('fDate', today()),
      offered: offered,
      source: offered.length ? (window.__autoLoaded ? 'auto' : 'manual') : null
    };
    const fallbackType = val('fSchoolType', 'general');
    const list = [], warn = [];

    lines.forEach((line, i) => {
      if (i === 0 && /이름/.test(line) && /학번/.test(line)) return;

      const c = splitLine(line);
      if (!c[0]) { warn.push(`${i + 1}행: 이름 없음`); return; }
      if (c.length < 3) { warn.push(`${i + 1}행: 항목 부족`); return; }

      const track = toTrack(c[3]);
      if (c[3] && !track) warn.push(`${i + 1}행: 계열코드 '${c[3]}' 인식 불가`);

      const g = String(toNum(c[2], 1));
      list.push({
        name: c[0],
        no: c[1] || '',
        grade: (g === '1' || g === '2' || g === '3') ? g : '1',
        track: track || 'ai',
        region: toRegion(c[4]),
        subjects: toNum(c[5], 80),
        dup: toNum(c[6], 12),
        want: toNum(c[7], 60),
        coop: toNum(c[8], 5),
        net: toNum(c[9], 70),
        level: toLevel(c[10]),
        schoolType: toSchoolType(c[11], fallbackType),
        goal: '', memo: '',
        counselor: common.counselor,
        date: common.date,
        offered: common.offered,
        source: common.source
      });
    });

    return { list, warn };
  }

  /* =======================================================
     8. 일괄 생성 · 인쇄
     ======================================================= */
  function runBatch() {
    const ta = $('batchInput'), stage = $('batchStage');
    if (!ta || !stage) return;

    const raw = ta.value.trim();
    if (!raw) {
      stage.innerHTML = ''; batch = [];
      say('batchStatus', '학생 정보를 입력해 주세요.', 'err');
      return;
    }

    const { list, warn } = parseBatch(raw);
    batch = list;

    if (!list.length) {
      stage.innerHTML = '';
      say('batchStatus', warn[0] || '읽을 수 있는 줄이 없습니다.', 'err');
      return;
    }

    stage.innerHTML = list.map(d => Report.render(d)).join('');

    const tc = {};
    list.forEach(s => { const k = SCHOOL_TYPES[s.schoolType].short; tc[k] = (tc[k] || 0) + 1; });
    const detail = Object.entries(tc).map(([k, v]) => `${k} ${v}명`).join(' · ');
    const n = currentOffered().length;
    const offMsg = n ? ` · 개설 과목 ${n}개 반영` : ' · 개설 과목 미반영(추정)';

    say('batchStatus',
      `${list.length}명 · ${list.length * 3}쪽 (${detail})${offMsg}` +
      (warn.length ? ` · 확인 필요 ${warn.length}건` : ''),
      warn.length ? 'warn' : 'ok');

    if (warn.length) console.warn('[batch]', warn);
    stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function printBatch() {
    if (!batch.length) runBatch();
    if (!batch.length) return;
    document.body.classList.add('print-batch');
    setTimeout(() => {
      window.print();
      setTimeout(() => document.body.classList.remove('print-batch'), 500);
    }, 200);
  }

  function fillSample() {
    const ta = $('batchInput');
    if (!ta) return;
    ta.value = [
      '김서연, 20301, 2, ai, big, 88, 14, 70, 6, 80, mid, general',
      '박준호, 20302, 2, sci, big, 95, 10, 85, 8, 90, high, science',
      '이하늘, 20303, 2, intl, mid, 76, 11, 65, 5, 75, mid, foreign',
      '정유진, 20304, 2, music, mid, 70, 9, 72, 4, 70, mid, art',
      '최민서, 20305, 2, sport, rural, 62, 16, 55, 3, 60, low, sports',
      '한지우, 20306, 2, edu, rural, 48, 14, 40, 3, 35, low'
    ].join('\n');
    say('batchStatus', '예시 6명을 채웠습니다. 일괄 생성을 눌러 주세요.', 'ok');
    saveForm();
  }

  /* =======================================================
     9. 초기화 · 이벤트
     ======================================================= */
  function reset() {
    if (!confirm('입력한 내용을 모두 지울까요?')) return;
    FORM_IDS.forEach(id => { const el = $(id); if (el && el.tagName !== 'SELECT') el.value = ''; });
    const ta = $('batchInput'); if (ta) ta.value = '';
    const stage = $('batchStage'); if (stage) stage.innerHTML = '';
    batch = []; window.__autoLoaded = false;
    setVal('fDate', today());
    try { localStorage.removeItem(LS_FORM); } catch (e) {}
    say('batchStatus', ''); say('lookupState', ''); say('cfgState', '');
    renderOne();
  }

  function bind() {
    FORM_IDS.forEach(id => {
      const el = $(id);
      if (!el) return;
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', renderSoon);
    });

    on('fOffered', 'input', () => { window.__autoLoaded = false; });
    on('batchInput', 'input', () => { clearTimeout(timer); timer = setTimeout(saveForm, 400); });

    on('btnRender', 'click', renderOne);
    on('btnPrint', 'click', () => { renderOne(); setTimeout(() => window.print(), 200); });
    on('btnReset', 'click', reset);
    on('btnLookup', 'click', lookup);
    on('btnSaveCfg', 'click', saveCfg);
    on('btnSample', 'click', fillSample);
    on('btnBatch', 'click', runBatch);
    on('btnBatchPrint', 'click', printBatch);

    const sn = $('fSchoolName');
    if (sn) sn.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); lookup(); }
    });

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault(); renderOne();
        setTimeout(() => window.print(), 150);
      }
    });
  }

  /* =======================================================
     10. 부팅
     ======================================================= */
  function boot() {
    if (typeof SCHOOL_TYPES === 'undefined' || typeof TRACKS === 'undefined'
        || typeof Report === 'undefined') {
      const box = previewBox() || document.body;
      box.innerHTML = '<p style="padding:24px;color:#b91c1c;font-size:14px">' +
        'data.js 또는 report.js가 로드되지 않았습니다.<br>' +
        'index.html에서 data.js → report.js → neis.js → app.js 순서인지, ' +
        '네 파일 모두 defer 없이(또는 모두 defer로) 통일되어 있는지 확인해 주세요.</p>';
      console.error('[app.js] data.js / report.js must load first');
      return;
    }

    ensureUI();
    initSelects();
    loadCfg();
    loadForm();
    bind();
    renderOne();

    console.info('[app.js] ready ·',
      Object.keys(TRACKS).length, 'tracks ·',
      Object.keys(SCHOOL_TYPES).length, 'school types');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.HCS = { renderOne, runBatch, collect, ensureUI, getBatch: () => batch };
})();
(function () {
  var chip = document.getElementById('keyChip');
  var tx   = document.getElementById('keyChipTx');
  var key  = document.getElementById('fKey');
  var prox = document.getElementById('fProxy');
  var save = document.getElementById('btnSaveCfg');
  if (!chip || !key) return;

  function refresh() {
    var hasKey = key.value.trim().length > 0;
    var hasPx  = prox && prox.value.trim().length > 0;

    chip.classList.toggle('is-on', hasKey);
    tx.textContent = hasKey
      ? '나이스 인증키 적용됨' + (hasPx ? ' · 프록시 연결' : '')
      : '인증키 없음 · 직접 입력으로 진행';
  }

  key.addEventListener('input', refresh);
  if (prox) prox.addEventListener('input', refresh);
  if (save) save.addEventListener('click', function () { setTimeout(refresh, 60); });

  refresh();
})();
