/* =========================================================
   app.js — 화면 인터랙션 및 인쇄 제어
   ========================================================= */
(function () {
  'use strict';

  const $  = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => [...(c || document).querySelectorAll(s)];

  /* ---------- 헤더 ---------- */
  const header = $('#header');
  const onScroll = () => header.classList.toggle('is-stuck', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const gnb = $('#gnb'), toggle = $('#navToggle');
  toggle.addEventListener('click', () => {
    const open = gnb.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  $$('#gnb a').forEach(a => a.addEventListener('click', () => {
    gnb.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }));

  /* ---------- 계열 셀렉트 ---------- */
  $('#fTrack').innerHTML = Object.entries(TRACKS)
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

  /* ---------- 발행일 기본값 ---------- */
  const today = new Date();
  const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
  $('#fDate').value = iso;
  const fmtDate = v => {
    if (!v) return '';
    const [y, m, d] = v.split('-');
    return `${y}. ${m}. ${d}.`;
  };

  /* ---------- 슬라이더 출력 ---------- */
  const sliders = [
    ['fSubjects', 'oSubjects', v => v + '개'],
    ['fDup',      'oDup',      v => v + '개'],
    ['fWant',     'oWant',     v => v + '%'],
    ['fCoop',     'oCoop',     v => v + '개'],
    ['fNet',      'oNet',      v => (+v < 34 ? '열악' : +v < 67 ? '보통' : '우수')]
  ];
  function syncOutputs() {
    sliders.forEach(([id, out, fmt]) => { $('#' + out).textContent = fmt($('#' + id).value); });
  }
  sliders.forEach(([id]) => $('#' + id).addEventListener('input', () => {
    syncOutputs();
    if (state.built) build();
  }));
  ['fRegion', 'fGrade', 'fTrack', 'fLevel'].forEach(id => {
    $('#' + id).addEventListener('change', () => { if (state.built) build(); });
  });
  syncOutputs();

  /* ---------- 입력 수집 ---------- */
  function collect() {
    return {
      name:      $('#fName').value.trim(),
      no:        $('#fNo').value.trim(),
      grade:     $('#fGrade').value,
      track:     $('#fTrack').value,
      level:     $('#fLevel').value,
      goal:      $('#fGoal').value.trim(),
      region:    $('#fRegion').value,
      subjects:  +$('#fSubjects').value,
      dup:       +$('#fDup').value,
      want:      +$('#fWant').value,
      coop:      +$('#fCoop').value,
      net:       +$('#fNet').value,
      memo:      $('#fMemo').value.trim(),
      counselor: $('#fCounselor').value.trim(),
      date:      fmtDate($('#fDate').value)
    };
  }

  const state = { built: false, mode: 'single' };

  /* ---------- 단일 리포트 ---------- */
  function build() {
    const d = collect();
    const html = Report.render(d);
    $('#previewStage').innerHTML = html;
    $('#printRoot').innerHTML = html;
    state.built = true;
    state.mode = 'single';
  }

  $('#btnBuild').addEventListener('click', () => {
    build();
    $('#preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#btnReset').addEventListener('click', () => {
    ['fName', 'fNo', 'fGoal', 'fMemo', 'fCounselor'].forEach(id => { $('#' + id).value = ''; });
    $('#fGrade').value = '2';
    $('#fTrack').selectedIndex = 0;
    $('#fLevel').value = 'mid';
    $('#fRegion').value = 'big';
    $('#fSubjects').value = 62;
    $('#fDup').value = 18;
    $('#fWant').value = 55;
    $('#fCoop').value = 6;
    $('#fNet').value = 50;
    $('#fDate').value = iso;
    syncOutputs();
    $('#previewStage').innerHTML =
      '<p class="preview-empty">위에서 정보를 입력하고 <strong>리포트 생성</strong>을 누르면 여기에 표시됩니다.</p>';
    $('#printRoot').innerHTML = '';
    state.built = false;
  });

  /* ---------- 인쇄 ---------- */
  function printDoc() {
    if (!$('#printRoot').innerHTML.trim()) {
      alert('먼저 리포트를 생성해 주세요.');
      return;
    }
    window.print();
  }
  $('#btnPrint').addEventListener('click', () => {
    if (state.mode !== 'single' && state.built) build();
    printDoc();
  });

  /* ---------- 일괄 생성 ---------- */
  const SAMPLE = [
    '김○○, 20301, 2, ai, rural, 48, 14, 40, 3, 35, mid',
    '이○○, 20302, 2, med, rural, 48, 14, 65, 3, 35, high',
    '박○○, 20303, 3, human, rural, 48, 14, 70, 5, 60, mid',
    '최○○, 20304, 1, econ, rural, 48, 14, 55, 2, 45, low'
  ].join('\n');

  $('#btnSample').addEventListener('click', () => { $('#batchInput').value = SAMPLE; });

  function parseBatch(text) {
    const base = collect();
    const rows = text.split('\n').map(l => l.trim()).filter(Boolean);
    const out = [], errors = [];
    rows.forEach((line, i) => {
      const c = line.split(',').map(x => x.trim());
      if (c.length < 11) { errors.push(`${i + 1}행: 항목이 ${c.length}개입니다 (11개 필요)`); return; }
      const [name, no, grade, track, region, subjects, dup, want, coop, net, level] = c;
      if (!TRACKS[track])       { errors.push(`${i + 1}행: 알 수 없는 계열코드 "${track}"`); return; }
      if (!BASELINE[region])    { errors.push(`${i + 1}행: 알 수 없는 지역코드 "${region}"`); return; }
      if (!['1', '2', '3'].includes(grade)) { errors.push(`${i + 1}행: 학년은 1~3이어야 합니다`); return; }
      if (!['low', 'mid', 'high'].includes(level)) { errors.push(`${i + 1}행: 알 수 없는 수준코드 "${level}"`); return; }
      out.push({
        name, no, grade, track, region, level,
        subjects: +subjects || 0, dup: +dup || 0, want: +want || 0,
        coop: +coop || 0, net: +net || 0,
        goal: '', memo: '', counselor: base.counselor, date: base.date
      });
    });
    return { out, errors };
  }

  $('#btnBatch').addEventListener('click', () => {
    const { out, errors } = parseBatch($('#batchInput').value);
    const status = $('#batchStatus');
    if (!out.length) {
      status.textContent = errors.length ? errors[0] : '입력된 학생이 없습니다.';
      status.className = 'batch-status is-err';
      return;
    }
    const html = out.map(d => Report.render(d)).join('');
    $('#batchStage').innerHTML = html;
    $('#printRoot').innerHTML = html;
    state.built = true;
    state.mode = 'batch';
    status.textContent = errors.length
      ? `${out.length}명 생성 완료 · 오류 ${errors.length}건 (${errors[0]})`
      : `${out.length}명 생성 완료 · 총 ${out.length * 3}쪽`;
    status.className = 'batch-status' + (errors.length ? ' is-warn' : ' is-ok');
  });

  $('#btnBatchPrint').addEventListener('click', () => {
    if (state.mode !== 'batch') {
      const { out } = parseBatch($('#batchInput').value);
      if (out.length) {
        const html = out.map(d => Report.render(d)).join('');
        $('#batchStage').innerHTML = html;
        $('#printRoot').innerHTML = html;
        state.mode = 'batch';
        state.built = true;
      }
    }
    printDoc();
  });

  /* ---------- 단축키 ---------- */
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
      if (!$('#printRoot').innerHTML.trim()) { e.preventDefault(); alert('먼저 리포트를 생성해 주세요.'); }
    }
  });
})();
