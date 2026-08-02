/* =========================================================
   report.js — 진단 계산 및 A4 3쪽 리포트 생성
   · 학교 유형(일반고/과학고/외고·국제고/예고/체고/특성화고) 반영
   · 계열별 전문 교과(special) 분리 표기
   ========================================================= */

const Report = (function () {
  'use strict';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function computeScores(d) {
    const base = BASELINE[d.region] || BASELINE.mid;
    const st = SCHOOL_TYPES[d.schoolType] || SCHOOL_TYPES.general;
    const boost = st.boost || {};

    /* 특목고이면서 해당 유형의 주력 계열을 지망하는 경우에만 가산 */
    const aligned = !st.tracks || st.tracks.includes(d.track);

    const raw = {
      diversity: d.subjects / NATIONAL.total * 100,
      real:      (d.subjects - d.dup) / base.real * 100,
      fit:       d.want,
      access:    d.coop / 12 * 100,
      infra:     d.net
    };

    const out = {};
    AXES.forEach(a => {
      const add = aligned ? (boost[a.key] || 0) : 0;
      out[a.key] = Math.round(clamp(raw[a.key] + add, 0, 100));
    });
    out._aligned = aligned;
    return out;
  }

  const band = v => (v >= 75 ? 'high' : v >= 50 ? 'mid' : 'low');
  const bandLabel = v => (v >= 75 ? '양호' : v >= 50 ? '보통' : '취약');

  /* ---------- 과목 설계 ---------- */
  function buildSubjects(d) {
    const t = TRACKS[d.track] || TRACKS.ai;
    const st = SCHOOL_TYPES[d.schoolType] || SCHOOL_TYPES.general;
    const isSpecial = d.schoolType && d.schoolType !== 'general';

    let pool;
    if (d.grade === '1')      pool = t.general.slice();
    else if (d.grade === '2') pool = t.general.slice(0, 3).concat(t.career.slice(0, 4));
    else                      pool = t.career.concat(t.fusion);

    if (d.level === 'low')  pool = pool.filter(s => !t.scarce.includes(s)).slice(0, 7);
    if (d.level === 'high') pool = pool.concat(t.career.slice(-3));

    /* 특목고: 해당 유형에서 실제로 편성되는 전문 교과를 추천에 포함 */
    let specialPool = [];
    if (isSpecial && Array.isArray(t.special)) {
      specialPool = t.special.filter(s => st.specialized.includes(s));
      if (d.level === 'low') specialPool = specialPool.slice(0, 3);
      if (d.grade === '1')   specialPool = specialPool.slice(0, 2);
    }

    pool = [...new Set(pool)];
    specialPool = [...new Set(specialPool)].filter(s => !pool.includes(s));

    const offered = Array.isArray(d.offered) ? d.offered : [];
    const hasData = offered.length > 0;
    let inSchool, coop, verified = false;

    if (hasData) {
      inSchool = pool.filter(s => offered.includes(s));
      coop     = pool.filter(s => !offered.includes(s));
      /* 전문 교과는 개설 목록에 있으면 교내, 없으면 외부 */
      specialPool.forEach(s => (offered.includes(s) ? inSchool : coop).push(s));
      verified = true;
    } else {
      const sc = computeScores(d);
      coop = pool.filter(s => t.scarce.includes(s));
      if (sc.diversity < 55) coop = [...new Set(coop.concat(pool.filter(s => !coop.includes(s)).slice(-2)))];
      else if (sc.diversity >= 85) coop = coop.slice(0, Math.max(1, Math.ceil(coop.length / 2)));
      inSchool = pool.filter(s => !coop.includes(s));
      /* 특목고 전문 교과는 교내 편성으로 간주 */
      inSchool = inSchool.concat(specialPool);
    }

    inSchool = [...new Set(inSchool)];
    coop = [...new Set(coop)];

    const related = hasData
      ? [...new Set(t.general.concat(t.career, t.fusion, t.special || []))]
          .filter(s => offered.includes(s) && !inSchool.includes(s) && !coop.includes(s)).slice(0, 10)
      : [];

    const credits = inSchool.length * GRADUATION.unit + coop.length * 2;
    return {
      track: t, schoolType: st, isSpecial,
      inSchool, coop, related, verified,
      specialCount: specialPool.length,
      offeredCount: offered.length,
      credits, ratio: Math.round(credits / GRADUATION.subject * 100)
    };
  }

  /* ---------- 레이더 ---------- */
  function radarSVG(values) {
    const cx = 200, cy = 178, R = 118, n = AXES.length;
    const pt = (i, r) => {
      const a = -Math.PI / 2 + i * 2 * Math.PI / n;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };
    const poly = r => [...Array(n)].map((_, i) => pt(i, r).join(',')).join(' ');
    let g = '';
    [0.25, 0.5, 0.75, 1].forEach(f => {
      g += `<polygon points="${poly(R * f)}" fill="none" stroke="#d5dce8" stroke-width="0.8"/>`;
    });
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i, R);
      g += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#d5dce8" stroke-width="0.8"/>`;
    }
    g += `<polygon points="${poly(R * 0.72)}" fill="none" stroke="#9aa8c2" stroke-width="1" stroke-dasharray="4 3"/>`;
    const shape = values.map((v, i) => pt(i, R * Math.max(v, 3) / 100).join(',')).join(' ');
    g += `<polygon points="${shape}" fill="rgba(37,99,235,.16)" stroke="#1d4ed8" stroke-width="1.8" stroke-linejoin="round"/>`;
    values.forEach((v, i) => {
      const [x, y] = pt(i, R * Math.max(v, 3) / 100);
      g += `<circle cx="${x}" cy="${y}" r="3.4" fill="#fff" stroke="#1d4ed8" stroke-width="1.8"/>`;
    });
    AXES.forEach((a, i) => {
      const [x, y] = pt(i, R + 26);
      g += `<text x="${x}" y="${y}" font-size="10.5" font-weight="600" fill="#33405c" text-anchor="middle" dominant-baseline="middle">${a.label}</text>`;
    });
    return `<svg viewBox="0 0 400 360" class="r-radar" role="img" aria-label="교육과정 여건 진단 레이더">${g}</svg>`;
  }

  const SRC_LABEL = { auto: '개설 과목이 자동 조회되었습니다.', manual: '개설 과목을 직접 입력하였습니다.', mixed: '자동 조회 이후 직접 보정하였습니다.' };

  function head(d, n) {
  var school = d.schoolName
    ? '<span class="r-school">' + esc(d.schoolName) + '</span>' : '';

  return '<div class="r-head">' +
    '<div class="r-head-l">' +
      '<span class="r-logo"></span>' +
      '<span class="r-title">과목나침반 진단 리포트 | 과목나침반</span>' +
      school +
    '</div>' +
    '<div class="r-head-r">' + esc(d.name) +  ' 학생 | ' + n + ' / 3</div>' +
  '</div>';
}
  function foot(d) {
    const src = d.source ? ' · ' + SRC_LABEL[d.source] : '';
    return `<div class="r-foot">
      <span>${esc(d.date || '')}${d.counselor ? ' · ' + esc(d.counselor) : ''}${src}</span>
      <span>참고 자료이며 공식 수강신청을 대체하지 않습니다.</span>
    </div>`;
  }

  /* ---------- 1쪽 ---------- */
  function page1(d, s, r) {
    const values = AXES.map(a => s[a.key]);
    const total = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    const weak = values.indexOf(Math.min(...values));
    const strong = values.indexOf(Math.max(...values));
    const base = BASELINE[d.region];
    const subBits = [
      d.schoolInfo && d.schoolInfo.region,
      r.schoolType.short,
      d.schoolInfo && d.schoolInfo.found
    ].filter(Boolean);

    const schoolSub = subBits.length
      ? `<div class="r-sub">${esc(subBits.join(' · '))}</div>`
      : '';
    const rows = AXES.map((a, i) => {
      const v = values[i];
      return `<tr><td>${a.label}</td><td class="num">${v}</td>
        <td><div class="r-gauge"><i style="width:${v}%"></i></div></td>
        <td class="tagcell"><span class="r-tag t-${band(v)}">${bandLabel(v)}</span></td></tr>`;
    }).join('');

    /* 특목고인데 주력 계열과 다른 진로를 지망하는 경우 안내 */
    const mismatch = (r.isSpecial && !s._aligned)
      ? `<p class="r-warn">${esc(r.schoolType.short)}의 주력 계열과 다른 진로를 지망하고 있습니다.
         전공 관련 전문 교과 대신 보통교과 중심으로 설계했으며, 부족한 부분은 공동교육과정으로 보완해야 합니다.</p>`
      : '';

    return `<section class="r-page">
      ${head(d, 1, 3)}
      <div class="r-body">
      <div class="r-idcard">
        <div><span>이름</span><b>${esc(d.name) || '&nbsp;'}</b></div>
        <div><span>학번</span><b>${esc(d.no) || '&nbsp;'}</b></div>
        <div><span>학년</span><b>${esc(d.grade)}학년</b></div>
        <div><span>학교</span><b>${esc(d.schoolName) || '&nbsp;'}${schoolSub}</b></div>
        <div><span>희망 계열</span><b>${esc(r.track.label)}</b></div>
        <div><span>이수 수준 · 지역</span><b>${LEVEL_LABEL[d.level]} · ${base.label}</b></div>
      </div>
        <h2 class="r-h2">1. 교육과정 여건 진단</h2>
        <div class="r-2col">
          <div class="r-radarbox">
            ${radarSVG(values)}
            <p class="r-caption">점선은 전국 평균 수준 기준선입니다.</p>
          </div>
          <div>
            <div class="r-scorebox">
              <b class="s-${band(total)}">${total}</b><span>종합 지수 / 100점</span>
            </div>
            <table class="r-table">
              <thead><tr><th>진단 축</th><th class="num">점수</th><th>분포</th><th>판정</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>

        <div class="r-summary">
          <h3>종합 소견</h3>
          <p>
            ${esc(d.name || '학생')}의 교육과정 여건 종합 지수는 <b>${total}점</b>입니다.
            가장 강한 축은 <b>${AXES[strong].label}(${values[strong]}점)</b>,
            가장 시급한 보완 지점은 <b>${AXES[weak].label}(${values[weak]}점)</b>입니다.
            ${r.verified
              ? `실제 개설 과목 <b>${r.offeredCount}개</b>를 확인한 결과, 권장 과목 중
                 <b>${r.inSchool.length}과목</b>은 교내 이수가 가능하고 <b>${r.coop.length}과목</b>은 확인되지 않았습니다.`
              : `${base.label} 기준(중복 제외 ${base.real}과목)과 비교해
                 실질 선택과목 <b>${Math.max(0, d.subjects - d.dup)}과목</b>을 확보하고 있습니다.`}
            ${r.isSpecial ? esc(r.schoolType.note) : ''}
          </p>
          ${mismatch}
        </div>
      </div>
      ${foot(d)}
    </section>`;
  }

  /* ---------- 2쪽 ---------- */
  function page2(d, s, r) {
    const rowsOf = (arr, note) => arr.length
      ? arr.map(x => `<tr><td class="chk">□</td><td>${esc(x)}</td><td class="note">${note}</td></tr>`).join('')
      : `<tr><td class="chk">–</td><td colspan="2" class="note">해당 과목이 없습니다.</td></tr>`;

    const road = (ROADMAP[d.grade] || []).map(x => `<li>${esc(x)}</li>`).join('');

    const badge = r.verified
      ? '<span class="r-verify">개설 목록 대조 완료</span>'
      : '<span class="r-verify r-verify-off">일반 기준 추정</span>';

    const specialNote = (r.isSpecial && r.specialCount)
      ? `<p class="r-relnote">${esc(r.schoolType.label)} 편성 전문 교과 <b>${r.specialCount}과목</b>이 권장 목록에 포함되어 있습니다.</p>`
      : '';

    const relatedBlock = r.related.length ? `
      <h3 class="r-h3">교내 개설 중인 관련 과목 <span class="r-count teal">${r.related.length}과목</span></h3>
      <p class="r-relnote">권장 목록에는 없지만 학교에서 열리는 계열 연관 과목입니다. 여유 학점이 있다면 검토해 보세요.</p>
      <div class="r-relchips">${r.related.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : '';

    return `<section class="r-page">
      ${head(d, 2, 3)}
      <div class="r-body">
        <h2 class="r-h2">2. 맞춤 과목 설계 ${badge}</h2>
        <p class="r-intro">${esc(r.track.reason)}${d.goal ? `<br> 관심 분야로 밝힌 <b>${esc(d.goal)}</b>와 연결되는 과목을 우선 배치했습니다.` : ''}</p>
        ${specialNote}

        <h3 class="r-h3">교내 이수 권장 <span class="r-count">${r.inSchool.length}과목</span></h3>
        <table class="r-table r-list">
          <thead><tr><th class="chk">확인</th><th>과목명</th><th>비고</th></tr></thead>
          <tbody>${rowsOf(r.inSchool, r.verified ? '개설 확인됨 · 신청 가능' : '편제표 확인 후 신청')}</tbody>
        </table>

        <h3 class="r-h3">공동교육과정 탐색 권장 <span class="r-count amber">${r.coop.length}과목</span></h3>
        <table class="r-table r-list">
          <thead><tr><th class="chk">확인</th><th>과목명</th><th>비고</th></tr></thead>
          <tbody>${rowsOf(r.coop, r.verified ? '교내 미확인 · 거점학교·온라인 검색' : '거점학교 · 온라인 강좌 검색')}</tbody>
        </table>

        ${relatedBlock}

        <div class="r-2col r-2col-b">
          <div class="r-box">
            <h4>예상 누적 학점</h4>
            <p class="r-big">약 ${r.credits}학점</p>
            <p class="r-fine">졸업 기준 ${GRADUATION.total}학점(교과 ${GRADUATION.subject} + 창의적 체험활동 ${GRADUATION.activity}) 중<br>교과 영역의 약 ${r.ratio}%입니다.</p>
          </div>
          <div class="r-box">
            <h4>${esc(d.grade)}학년 실행 순서</h4>
            <ol class="r-ol">${road}</ol>
          </div>
        </div>

<div class="r-callout" style="word-break: keep-all !important; word-wrap: break-word !important;"> 
  <b>이수 인정 기준</b> 
  교내 과목과 공동교육과정 과목 모두 <b/>출석률 수업 횟수의 3분의 2 이상과 학업성취율 40% 이상을</b>
  충족해야 학점이 인정됩니다. 교양 교과는 출석률 기준만 적용됩니다. 
</div>

      </div>
      ${foot(d)}
    </section>`;
  }

  /* ---------- 3쪽 ---------- */
  function page3(d, s, r) {
    const values = AXES.map(a => s[a.key]);
    const order = AXES.map((a, i) => ({ a, v: values[i] })).sort((x, y) => x.v - y.v).slice(0, 3);

    const blocks = order.map((o, i) => {
      const adv = ADVICE[o.a.key][band(o.v)];
      return `<div class="r-advice">
        <div class="r-advice-h">
          <span class="r-num">${i + 1}</span>
          <div><h4>${adv.title}</h4><p class="r-axis">${o.a.label} · ${o.v}점 · ${bandLabel(o.v)}</p></div>
        </div>
        <p class="r-advice-b">${adv.body}</p>
        <p class="r-do"><b>바로 할 일</b> ${adv.action}</p>
      </div>`;
    }).join('');

    const checkItems = [
      r.verified ? '교내 개설이 확인된 과목의 신청 학기를 확인했다.'
                 : '학교 편제표에서 희망 과목의 개설 학기를 확인했다.',
      '교내 미개설 과목의 공동교육과정 강좌를 검색했다.',
      '공동교육과정 신청 마감일을 달력에 표시했다.',
      '시간표 충돌 여부를 확인하고 대안을 준비했다.',
      '각 과목에서 남길 탐구 주제를 하나 이상 정했다.',
      '출석률과 성취율 기준을 이해하고 있다.'
    ];
    const checks = checkItems.map(c => `<li><span class="chk">□</span>${c}</li>`).join('');

    const memo = d.memo
      ? `<p class="r-memo-text">${esc(d.memo).replace(/\n/g, '<br>')}</p>`
      : '<div class="r-lines"><span></span><span></span><span></span><span></span></div>';

    return `<section class="r-page">
      ${head(d, 3, 3)}
      <div class="r-body">
        <h2 class="r-h2">3. 개인별 조언</h2>
        <p class="r-intro">진단 결과 가장 취약한 세 축에 대한 조언입니다. 위에서부터 순서대로 실행하세요.</p>
        ${blocks}

        <div class="r-tipbox">
          <b>${esc(r.track.label)} 지망 학생을 위한 조언</b>
          <p>${esc(r.track.tip)}</p>
        </div>

        <h3 class="r-h3">실행 확인 목록</h3>
        <ul class="r-check">${checks}</ul>

        <h3 class="r-h3">상담 기록</h3>
        <div class="r-memo">${memo}</div>

        <div class="r-sign">
          <div><span>학생 확인</span><i></i></div>
          <div><span>보호자 확인</span><i></i></div>
          <div><span>담당 교사</span><i></i></div>
        </div>
      </div>
      ${foot(d)}
    </section>`;
  }

  function render(d) {
    const s = computeScores(d);
    const r = buildSubjects(d);
    return `<article class="r-doc">${page1(d, s, r)}${page2(d, s, r)}${page3(d, s, r)}</article>`;
  }

  return { render, computeScores, buildSubjects };
})();
