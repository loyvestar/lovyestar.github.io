/* =========================================================
   report.js — 진단 계산 및 A4 3쪽 리포트 HTML 생성
   ========================================================= */

const Report = (function () {
  'use strict';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ---------- 점수 계산 ---------- */
  function computeScores(d) {
    const base = BASELINE[d.region] || BASELINE.mid;
    return {
      diversity: Math.round(clamp(d.subjects / NATIONAL.total * 100, 0, 100)),
      real:      Math.round(clamp((d.subjects - d.dup) / base.real * 100, 0, 100)),
      fit:       Math.round(clamp(d.want, 0, 100)),
      access:    Math.round(clamp(d.coop / 12 * 100, 0, 100)),
      infra:     Math.round(clamp(d.net, 0, 100))
    };
  }

  const band = v => (v >= 75 ? 'high' : v >= 50 ? 'mid' : 'low');
  const bandLabel = v => (v >= 75 ? '양호' : v >= 50 ? '보통' : '취약');

  /* ---------- 과목 추천 ---------- */
  function buildSubjects(d) {
    const t = TRACKS[d.track] || TRACKS.ai;
    let pool;
    if (d.grade === '1')      pool = t.general.slice();
    else if (d.grade === '2') pool = t.general.slice(0, 3).concat(t.career.slice(0, 4));
    else                      pool = t.career.concat(t.fusion);

    if (d.level === 'low')  pool = pool.filter(s => !t.scarce.includes(s)).slice(0, 7);
    if (d.level === 'high') pool = pool.concat(t.career.slice(-3));
    pool = [...new Set(pool)];

    let coop = pool.filter(s => t.scarce.includes(s));
    const scores = computeScores(d);
    if (scores.diversity < 55) {
      coop = [...new Set(coop.concat(pool.filter(s => !coop.includes(s)).slice(-2)))];
    } else if (scores.diversity >= 85) {
      coop = coop.slice(0, Math.max(1, Math.ceil(coop.length / 2)));
    }
    const inSchool = pool.filter(s => !coop.includes(s));
    const credits = inSchool.length * GRADUATION.unit + coop.length * 2;
    return { track: t, inSchool, coop, credits, ratio: Math.round(credits / GRADUATION.subject * 100) };
  }

  /* ---------- 레이더 SVG (인쇄용 흑백 대비 강화) ---------- */
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

  /* ---------- 공통 조각 ---------- */
  function head(d, page, total) {
    return `<div class="r-head">
      <div class="r-head-l">
        <span class="r-logo" aria-hidden="true"></span>
        <span class="r-title">고교학점제 과목 선택 진단 리포트 | 과목나침반</span>
      </div>
      <div class="r-head-r">${esc(d.name || '이름')} · ${page} / ${total}</div>
    </div>`;
  }
  function foot(d) {
    return `<div class="r-foot">
      <span>발행 ${esc(d.date || '')}${d.counselor ? ' · ' + esc(d.counselor) : ''}</span>
      <span>본 리포트는 참고 자료이며 공식 수강신청을 대체하지 않습니다.</span>
    </div>`;
  }

  /* ---------- 1쪽 ---------- */
  function page1(d, s) {
    const values = AXES.map(a => s[a.key]);
    const total = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    const weakIdx = values.indexOf(Math.min(...values));
    const strongIdx = values.indexOf(Math.max(...values));
    const base = BASELINE[d.region];

    const rows = AXES.map((a, i) => {
      const v = values[i];
      return `<tr>
        <td>${a.label}</td>
        <td class="num">${v}</td>
        <td><div class="r-gauge"><i style="width:${v}%"></i></div></td>
        <td class="tagcell"><span class="r-tag t-${band(v)}">${bandLabel(v)}</span></td>
      </tr>`;
    }).join('');

    return `<section class="r-page">
      ${head(d, 1, 3)}
      <div class="r-body">
        <div class="r-idcard">
          <div><span>이름</span><b>${esc(d.name) || '&nbsp;'}</b></div>
          <div><span>학번</span><b>${esc(d.no) || '&nbsp;'}</b></div>
          <div><span>학년</span><b>${esc(d.grade)}학년</b></div>
          <div><span>희망 계열</span><b>${esc(TRACKS[d.track].label)}</b></div>
          <div><span>이수 수준</span><b>${LEVEL_LABEL[d.level]}</b></div>
          <div><span>지역 구분</span><b>${base.label}</b></div>
        </div>

        <h2 class="r-h2">1. 교육과정 여건 진단</h2>
        <div class="r-2col">
          <div class="r-radarbox">
            ${radarSVG(values)}
            <p class="r-caption">점선은 전국 평균 수준 기준선입니다.</p>
          </div>
          <div>
            <div class="r-scorebox">
              <b class="s-${band(total)}">${total}</b>
              <span>종합 지수 / 100점</span>
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
            가장 강한 축은 <b>${AXES[strongIdx].label}(${values[strongIdx]}점)</b>이며,
            가장 시급히 보완할 축은 <b>${AXES[weakIdx].label}(${values[weakIdx]}점)</b>입니다.
            소속 학교는 ${base.label} 기준(중복 제외 ${base.real}과목)과 비교했을 때
            실질 선택과목 ${Math.max(0, d.subjects - d.dup)}과목을 확보하고 있습니다.
            구체적인 보완 방법은 3쪽 개인별 조언에 정리했습니다.
          </p>
        </div>
      </div>
      ${foot(d)}
    </section>`;
  }

  /* ---------- 2쪽 ---------- */
  function page2(d, s, r) {
    const listRows = (arr, note) => arr.length
      ? arr.map(x => `<tr><td class="chk">□</td><td>${esc(x)}</td><td class="note">${note}</td></tr>`).join('')
      : `<tr><td class="chk">–</td><td colspan="2" class="note">해당 과목이 없습니다.</td></tr>`;

    const road = (ROADMAP[d.grade] || []).map(x => `<li>${esc(x)}</li>`).join('');

    return `<section class="r-page">
      ${head(d, 2, 3)}
      <div class="r-body">
        <h2 class="r-h2">2. 맞춤 과목 설계</h2>
        <p class="r-intro">${esc(r.track.reason)}${d.goal ? ` 관심 분야로 밝힌 <b>${esc(d.goal)}</b>와 연결되는 과목을 우선 배치했습니다.` : ''}</p>

        <h3 class="r-h3">교내 이수 권장 <span class="r-count">${r.inSchool.length}과목</span></h3>
        <table class="r-table r-list">
          <thead><tr><th class="chk">확인</th><th>과목명</th><th>비고</th></tr></thead>
          <tbody>${listRows(r.inSchool, '편제표 확인 후 신청')}</tbody>
        </table>

        <h3 class="r-h3">공동교육과정 탐색 권장 <span class="r-count amber">${r.coop.length}과목</span></h3>
        <table class="r-table r-list">
          <thead><tr><th class="chk">확인</th><th>과목명</th><th>비고</th></tr></thead>
          <tbody>${listRows(r.coop, '거점학교 · 온라인 강좌 검색')}</tbody>
        </table>

        <div class="r-2col r-2col-b">
          <div class="r-box">
            <h4>예상 누적 학점</h4>
            <p class="r-big">약 ${r.credits}학점</p>
            <p class="r-fine">
              졸업 기준 ${GRADUATION.total}학점(교과 ${GRADUATION.subject} + 창의적 체험활동 ${GRADUATION.activity}) 중
              교과 영역의 약 ${r.ratio}%에 해당합니다.
            </p>
          </div>
          <div class="r-box">
            <h4>${esc(d.grade)}학년 실행 순서</h4>
            <ol class="r-ol">${road}</ol>
          </div>
        </div>

        <div class="r-callout">
          <b>이수 인정 기준</b>
          교내 과목과 공동교육과정 과목 모두 <b>출석률 수업 횟수의 3분의 2 이상</b>과
          <b>학업성취율 40% 이상</b>을 충족해야 학점이 인정됩니다.<br>교양 교과는 출석률 기준만 적용됩니다.
        </div>
      </div>
      ${foot(d)}
    </section>`;
  }

  /* ---------- 3쪽 ---------- */
  function page3(d, s, r) {
    const values = AXES.map(a => s[a.key]);
    const order = AXES.map((a, i) => ({ a, v: values[i], i })).sort((x, y) => x.v - y.v).slice(0, 3);

    const blocks = order.map((o, idx) => {
      const adv = ADVICE[o.a.key][band(o.v)];
      return `<div class="r-advice">
        <div class="r-advice-h">
          <span class="r-num">${idx + 1}</span>
          <div>
            <h4>${adv.title}</h4>
            <p class="r-axis">${o.a.label} · ${o.v}점 · ${bandLabel(o.v)}</p>
          </div>
        </div>
        <p class="r-advice-b">${adv.body}</p>
        <p class="r-do"><b>바로 할 일</b> ${adv.action}</p>
      </div>`;
    }).join('');

    const checks = [
      '학교 편제표에서 희망 과목의 개설 학기를 확인했다.',
      '교내 미개설 과목의 공동교육과정 강좌를 검색했다.',
      '공동교육과정 신청 마감일을 달력에 표시했다.',
      '시간표 충돌 여부를 확인하고 대안 조합을 준비했다.',
      '각 과목에서 남길 탐구 주제를 하나 이상 정했다.',
      '출석률과 성취율 기준을 이해하고 있다.'
    ].map(c => `<li><span class="chk">□</span>${c}</li>`).join('');

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

  /* ---------- 조립 ---------- */
  function render(d) {
    const s = computeScores(d);
    const r = buildSubjects(d);
    return `<article class="r-doc">${page1(d, s)}${page2(d, s, r)}${page3(d, s, r)}</article>`;
  }

  return { render, computeScores, buildSubjects };
})();
