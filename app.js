/* League UI (tablet-first)
   - LocalStorage persistence
   - League -> Seasons -> Divisions -> Teams
   - Round-robin schedule generator (circle method)
   - Standings: arrows (up/down/flat), rank color strip, last5 dots
   - Team tap: team page (results + edit)
*/

const STORAGE_KEY = "league_ui_v1";

const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(2,6);

function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._tm);
  toast._tm = setTimeout(()=>t.classList.remove("show"), 1500);
}

function deepClone(obj){ return JSON.parse(JSON.stringify(obj)); }

function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(raw){
    try { return JSON.parse(raw); } catch {}
  }
  return seedState();
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function seedState(){
  const leagueId = uid();
  const div1 = uid();
  const seasonId = uid();

  const teams = [
    "Luton","Northampton","Cardiff","Wycombe","Plymouth",
    "Huddersfield","Burton","Stockport","Mansfield","Blackpool",
    "Leyton Orient","Port Vale","Rotherham","AFC Wimbledon",
    "Stevenage","Reading","Lincoln","Barnsley","Exeter","Doncaster",
    "Bolton","Wigan"
  ].map(name => ({ id: uid(), name, logoDataUrl: "", note: "" }));

  const divisions = [{ id: div1, name: "Div.1", logoDataUrl: "", teams }];

  const rankColorRules = {
    [div1]: [
      { from: 1, to: 1, color: "#FFD54A", label: "優勝" },
      { from: 8, to: 8, color: "#FF9B3D", label: "入れ替え戦" },
      { from: 9, to: 10, color: "#FF4D4D", label: "降格" },
    ]
  };

  const season = {
    id: seasonId,
    number: 1,
    createdAt: Date.now(),
    divisions: deepClone(divisions),
    rankColorRules: deepClone(rankColorRules),
    scheduleByDiv: {},
    lastRankByDivTeam: {},
  };

  return {
    ui: {
      activeLeagueId: leagueId,
      activeSeasonId: seasonId,
      activeDivId: div1,
      scheduleRound: 1,
    },
    leagues: [{
      id: leagueId,
      name: "League One",
      logoDataUrl: "", note: "",
      seasons: [season]
    }]
  };
}

let state = loadState();

// ---------- Modal ----------
function openModal(title, bodyNode, footNode){
  $("#modalTitle").textContent = title;
  const body = $("#modalBody");
  const foot = $("#modalFoot");
  body.innerHTML = "";
  foot.innerHTML = "";
  body.appendChild(bodyNode);
  if(footNode) foot.appendChild(footNode);
  $("#modalRoot").classList.remove("hidden");
  $("#modalRoot").setAttribute("aria-hidden", "false");
}
function closeModal(){
  $("#modalRoot").classList.add("hidden");
  $("#modalRoot").setAttribute("aria-hidden", "true");
}
$("#modalBack").addEventListener("click", closeModal);
$("#modalClose").addEventListener("click", closeModal);
document.addEventListener("keydown", (e)=>{ if(e.key==="Escape" && !$("#modalRoot").classList.contains("hidden")) closeModal(); });


function openConfirm(title, message, confirmText, onConfirm){
  const body = document.createElement("div");
  body.innerHTML = `<div class="small">${String(message).replaceAll("\n","<br>")}</div>`;
  const foot = document.createElement("div");

  const cancel = document.createElement("button");
  cancel.className = "btn btn--ghost";
  cancel.textContent = "キャンセル";
  cancel.onclick = closeModal;

  const ok = document.createElement("button");
  ok.className = "btn";
  ok.innerHTML = `<span class="danger">${confirmText}</span>`;
  ok.onclick = () => {
    try { onConfirm(); } finally { closeModal(); }
  };

  foot.appendChild(cancel);
  foot.appendChild(ok);
  openModal(title, body, foot);
}

// ---------- Getters ----------
function getActiveLeague(){
  return state.leagues.find(l => l.id === state.ui.activeLeagueId) || state.leagues[0];
}
function getActiveSeason(){
  const league = getActiveLeague();
  return league.seasons.find(s => s.id === state.ui.activeSeasonId) || league.seasons[league.seasons.length-1];
}
function getActiveDiv(){
  const season = getActiveSeason();
  return season.divisions.find(d => d.id === state.ui.activeDivId) || season.divisions[0];
}
function getDivById(divId){
  const season = getActiveSeason();
  return season.divisions.find(d => d.id === divId);
}
function teamById(divId, teamId){
  const div = getDivById(divId);
  return div?.teams.find(t=>t.id===teamId);
}

// ---------- Standings ----------
function computeStandingsInSeason(season, divId){
  const div = season.divisions.find(d=>d.id===divId);
  if(!div) return [];
  const matches = (season.scheduleByDiv?.[divId] || []);
  const table = new Map();
  for(const t of div.teams){
    table.set(t.id, {teamId:t.id, played:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0});
  }
  const done = matches.filter(m=>m.homeScore!=null && m.awayScore!=null);
  for(const m of done){
    const home = table.get(m.homeId); const away = table.get(m.awayId);
    if(!home || !away) continue;
    home.played++; away.played++;
    home.gf += m.homeScore; home.ga += m.awayScore;
    away.gf += m.awayScore; away.ga += m.homeScore;
    if(m.homeScore>m.awayScore){ home.w++; away.l++; home.pts+=3; }
    else if(m.homeScore<m.awayScore){ away.w++; home.l++; away.pts+=3; }
    else { home.d++; away.d++; home.pts+=1; away.pts+=1; }
  }
  for(const r of table.values()){ r.gd = r.gf - r.ga; }

  const rows = Array.from(table.values());
  rows.sort((a,b)=> (b.pts-a.pts) || (b.gd-a.gd) || (b.gf-a.gf) || (a.ga-b.ga) || ((findTeamInSeason(season,a.teamId)?.name||"").localeCompare(findTeamInSeason(season,b.teamId)?.name||"")));
  rows.forEach((r,i)=> r.rank=i+1);
  return rows;
}

function computeStandings(divId){
  const season = getActiveSeason();
  const div = getDivById(divId);
  const matches = (season.scheduleByDiv[divId] || []);
  const table = new Map();

  for(const team of div.teams){
    table.set(team.id, { teamId: team.id, played:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0 });
  }

  const completed = matches
    .filter(m => m.homeScore != null && m.awayScore != null)
    .sort((a,b)=> (a.round-b.round) || (a.createdAt-b.createdAt));

  for(const m of completed){
    const h = table.get(m.homeId);
    const a = table.get(m.awayId);
    if(!h || !a) continue;

    h.played++; a.played++;
    h.gf += m.homeScore; h.ga += m.awayScore;
    a.gf += m.awayScore; a.ga += m.homeScore;

    if(m.homeScore > m.awayScore){
      h.w++; a.l++; h.pts += 3;
    }else if(m.homeScore < m.awayScore){
      a.w++; h.l++; a.pts += 3;
    }else{
      h.d++; a.d++; h.pts += 1; a.pts += 1;
    }
  }

  for(const row of table.values()){
    row.gd = row.gf - row.ga;
  }

  const rows = Array.from(table.values());
  rows.sort((x,y)=>{
    if(y.pts !== x.pts) return y.pts - x.pts;
    if(y.gd !== x.gd) return y.gd - x.gd;
    if(y.gf !== x.gf) return y.gf - x.gf;
    const tx = teamById(divId, x.teamId)?.name || "";
    const ty = teamById(divId, y.teamId)?.name || "";
    return tx.localeCompare(ty, "ja");
  });

  rows.forEach((r,i)=> r.rank = i+1);
  return rows;
}

function getRankArrow(divId, teamId, newRank){
  const season = getActiveSeason();
  const lastByDiv = season.lastRankByDivTeam[divId] || {};
  const prev = lastByDiv[teamId];
  if(prev == null) return { type:"flat", glyph:"▸" };
  if(newRank < prev) return { type:"up", glyph:"▴" };
  if(newRank > prev) return { type:"down", glyph:"▾" };
  return { type:"flat", glyph:"▸" };
}

function commitLastRanks(divId, standingsRows){
  const season = getActiveSeason();
  season.lastRankByDivTeam[divId] = season.lastRankByDivTeam[divId] || {};
  for(const r of standingsRows){
    season.lastRankByDivTeam[divId][r.teamId] = r.rank;
  }
}

function last5Dots(divId, teamId){
  const season = getActiveSeason();
  const matches = (season.scheduleByDiv[divId] || [])
    .slice()
    .sort((a,b)=> (a.round-b.round) || (a.createdAt-b.createdAt));

  const involved = matches
    .filter(m => m.homeId===teamId || m.awayId===teamId)
    .sort((a,b)=> (b.round-a.round) || (b.createdAt-a.createdAt));

  const dots = [];
  for(const m of involved){
    if(dots.length >= 5) break;
    if(m.homeScore == null || m.awayScore == null){ dots.push("P"); continue; }
    const isHome = m.homeId===teamId;
    const gf = isHome ? m.homeScore : m.awayScore;
    const ga = isHome ? m.awayScore : m.homeScore;
    if(gf>ga) dots.push("W");
    else if(gf<ga) dots.push("L");
    else dots.push("D");
  }
  while(dots.length < 5) dots.push("P");
  return dots.reverse();
}

function rankStripColor(divId, rank){
  const season = getActiveSeason();
  const rules = (season.rankColorRules?.[divId] || []);
  for(const r of rules){
    if(rank >= Number(r.from) && rank <= Number(r.to)) return r.color;
  }
  return "transparent";
}

// ---------- Schedule Generator ----------
function roundRobinPairs(teamIds){
  const ids = teamIds.slice();
  if(ids.length % 2 === 1) ids.push("BYE");

  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;

  const arr = ids.slice();
  const allRounds = [];

  for(let r=0; r<rounds; r++){
    const pairs = [];
    for(let i=0; i<half; i++){
      const a = arr[i];
      const b = arr[n - 1 - i];
      if(a !== "BYE" && b !== "BYE") pairs.push([a,b]);
    }
    allRounds.push(pairs);

    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr.splice(0, arr.length, fixed, ...rest);
  }
  return allRounds;
}

function generateDivisionSchedule(divId, options){
  const season = getActiveSeason();
  const div = getDivById(divId);
  if(div.teams.length < 2){ toast("チームが2つ以上必要"); return; }

  const teamIds = div.teams.map(t=>t.id);
  const baseRounds = roundRobinPairs(teamIds);
  const roundsCount = Math.max(1, Number(options.rounds||1));
  const homeAway = !!options.homeAway;

  const matches = [];
  let roundNo = 1;

  for(let cycle=1; cycle<=roundsCount; cycle++){
    for(let r=0; r<baseRounds.length; r++){
      const pairs = baseRounds[r];
      for(const [a,b] of pairs){
        let home = a, away = b;
        if((r + cycle) % 2 === 1){ home = b; away = a; }
        if(homeAway && cycle % 2 === 0){ [home, away] = [away, home]; }

        matches.push({
          id: uid(),
          divId,
          round: roundNo,
          homeId: home,
          awayId: away,
          homeScore: null,
          awayScore: null,
          createdAt: Date.now() + matches.length
        });
      }
      roundNo++;
    }
  }
  season.scheduleByDiv[divId] = matches;
  state.ui.scheduleRound = 1;
  saveState();
  render();
  toast("日程を生成しました");
}

// ---------- Rendering ----------
function render(){
  const league = getActiveLeague();
  const season = getActiveSeason();
  const div = getActiveDiv();

  $("#leagueName").textContent = league.name;
  $("#seasonName").textContent = `Season ${season.number}`;

  const brand = $("#brandLogo");
  brand.innerHTML = "";
  if(league.logoDataUrl){
    const img = document.createElement("img");
    img.src = league.logoDataUrl;
    brand.appendChild(img);
  }else{
    brand.innerHTML = `<span class="muted2" style="font-weight:500">⚑</span>`;
  }

  const tabs = $("#divisionTabs");
  tabs.innerHTML = "";
  for(const d of season.divisions){
    const b = document.createElement("button");
    b.className = "tab" + (d.id===div.id ? " tab--active" : "");
    b.textContent = d.name;
    b.onclick = () => {
      state.ui.activeDivId = d.id;
      state.ui.scheduleRound = 1;
      saveState();
      render();
    };
    tabs.appendChild(b);
  }

  renderStandings();
  renderSchedule();
  renderResults();
}

function renderStandings(){
  const season = getActiveSeason();
  const div = getActiveDiv();
  const body = $("#standingsBody");
  body.innerHTML = "";

  const rows = computeStandings(div.id);

  for(const r of rows){
    const tr = document.createElement("tr");
    tr.className = "row";
    tr.style.setProperty("--rankStrip", rankStripColor(div.id, r.rank));

    const arrow = getRankArrow(div.id, r.teamId, r.rank);
    const arrowClass = arrow.type==="up" ? "arrow--up" : arrow.type==="down" ? "arrow--down" : "arrow--flat";

    const team = teamById(div.id, r.teamId);

    const teamCell = document.createElement("td");
    teamCell.className = "col-team";
    const pill = document.createElement("div");
    pill.className = "teamPill";
    pill.onclick = () => openTeamModal(div.id, r.teamId);
    const logo = document.createElement("div");
    logo.className = "teamLogo";
    if(team?.logoDataUrl){
      const img = document.createElement("img");
      img.src = team.logoDataUrl;
      logo.appendChild(img);
    }
    const name = document.createElement("div");
    name.className = "teamName";
    name.textContent = team?.name || "Team";

    pill.appendChild(logo);
    pill.appendChild(name);
    teamCell.appendChild(pill);

        const formTd = document.createElement("td");
    const marks = document.createElement("div");
    marks.className = "formDots";
    for(const d of last5Dots(div.id, r.teamId)){
      const m = document.createElement("span");
      m.className = "formMark " + (d==="W" ? "formMark--win" : d==="D" ? "formMark--draw" : d==="L" ? "formMark--loss" : "formMark--pending");
      m.textContent = (d==="W" || d==="D" || d==="L") ? "○" : "";
      marks.appendChild(m);
    }
    formTd.appendChild(marks);

    tr.innerHTML = `
      <td class="col-rank">
        <div class="rankCell">
          <span>${r.rank}</span>
          <span class="arrow ${arrowClass}">${arrow.glyph}</span>
        </div>
      </td>
    `;
    tr.appendChild(teamCell);
    tr.insertAdjacentHTML("beforeend", `
      <td>${r.played}</td>
      <td>${r.w}</td>
      <td>${r.d}</td>
      <td>${r.l}</td>
      <td>${r.gf}</td>
      <td>${r.ga}</td>
      <td>${r.gd}</td>
      <td>${r.pts}</td>
    `);
    tr.appendChild(formTd);
    body.appendChild(tr);
  }

  // update last ranks after render (so arrows compare to previous render)
  commitLastRanks(div.id, rows);
  saveState();
}

function divRoundLabel(){
  const div = getActiveDiv();
  const round = state.ui.scheduleRound || 1;
  return `${div.name} 第${round}節`;
}

function renderSchedule(){
  const season = getActiveSeason();
  const div = getActiveDiv();
  const matches = season.scheduleByDiv[div.id] || [];

  const maxRound = matches.length ? Math.max(...matches.map(m=>m.round)) : 1;
  state.ui.scheduleRound = Math.min(Math.max(1, state.ui.scheduleRound||1), maxRound);
  saveState();

  $("#scheduleSubhead").textContent = divRoundLabel();
  $("#roundPill").textContent = String(state.ui.scheduleRound||1);

  const list = $("#scheduleList");
  list.innerHTML = "";

  const roundMatches = matches.filter(m => m.round === (state.ui.scheduleRound||1));
  if(roundMatches.length === 0){
    const p = document.createElement("div");
    p.className = "small";
    p.textContent = "日程が未生成です。「日程生成」から作成してください。";
    list.appendChild(p);
    return;
  }

  for(const m of roundMatches){
    const home = teamById(div.id, m.homeId);
    const away = teamById(div.id, m.awayId);

    const item = document.createElement("div");
    item.className = "item";
    const scoreText = (m.homeScore==null || m.awayScore==null) ? "未" : `${m.homeScore} - ${m.awayScore}`;

    item.innerHTML = `
      <div class="item__side">
        <div class="item__team">${home?.name || "Home"}</div>
      </div>
      <div class="badge"><span class="item__score">${scoreText}</span></div>
      <div class="item__side right">
        <div class="item__team">${away?.name || "Away"}</div>
        <button class="item__btn">入力</button>
      </div>
    `;
    item.querySelector(".item__btn").onclick = () => openResultModal(div.id, m.id);
    list.appendChild(item);
  }
}

function renderResults(){
  const season = getActiveSeason();
  const div = getActiveDiv();
  const matches = (season.scheduleByDiv[div.id] || []).slice();

  const completed = matches.filter(m => m.homeScore!=null && m.awayScore!=null);
  completed.sort((a,b)=> (b.round-a.round) || (b.createdAt-a.createdAt));

  $("#resultsSubhead").textContent = completed.length ? `${div.name} 最新` : `${div.name}（未入力）`;

  const list = $("#resultsList");
  list.innerHTML = "";

  const show = completed.slice(0, 8);
  if(show.length === 0){
    const p = document.createElement("div");
    p.className = "small";
    p.textContent = "結果がまだありません。日程からスコアを入力してください。";
    list.appendChild(p);
    return;
  }

  for(const m of show){
    const home = teamById(div.id, m.homeId);
    const away = teamById(div.id, m.awayId);

    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <div class="item__side">
        <div class="item__team">${home?.name || "Home"}</div>
      </div>
      <div class="badge"><span class="item__score">${m.homeScore} - ${m.awayScore}</span></div>
      <div class="item__side right">
        <div class="item__team">${away?.name || "Away"}</div>
        <button class="item__btn">編集</button>
      </div>
    `;
    item.querySelector(".item__btn").onclick = () => openResultModal(div.id, m.id);
    list.appendChild(item);
  }
}

// ---------- Modals: Result ----------
function openResultModal(divId, matchId){
  const season = getActiveSeason();
  const div = getDivById(divId);
  const matches = season.scheduleByDiv[divId] || [];
  const m = matches.find(x=>x.id===matchId);
  if(!m) return;

  const home = teamById(divId, m.homeId);
  const away = teamById(divId, m.awayId);

  const body = document.createElement("div");
  body.innerHTML = `
    <div class="small">${div.name} 第${m.round}節</div>
    <div class="hr"></div>
    <div class="grid2">
      <div class="field">
        <div class="label">${home?.name || "Home"}</div>
        <input class="input" id="homeScore" inputmode="numeric" pattern="[0-9]*" placeholder="0" value="${m.homeScore ?? ""}">
      </div>
      <div class="field">
        <div class="label">${away?.name || "Away"}</div>
        <input class="input" id="awayScore" inputmode="numeric" pattern="[0-9]*" placeholder="0" value="${m.awayScore ?? ""}">
      </div>
    </div>
    <div class="small">勝点: 勝ち=3 / 分け=1 / 負け=0（自動計算）</div>
  `;

  const foot = document.createElement("div");
  const btnCancel = document.createElement("button");
  btnCancel.className = "btn btn--ghost";
  btnCancel.textContent = "キャンセル";
  btnCancel.onclick = closeModal;

  const btnClear = document.createElement("button");
  btnClear.className = "btn btn--ghost";
  btnClear.textContent = "未入力に戻す";
  btnClear.onclick = () => {
    m.homeScore = null; m.awayScore = null;
    saveState(); render(); closeModal(); toast("未入力に戻しました");
  };

  const btnSave = document.createElement("button");
  btnSave.className = "btn";
  btnSave.textContent = "保存";
  btnSave.onclick = () => {
    const hs = $("#homeScore", body).value.trim();
    const as = $("#awayScore", body).value.trim();
    if(hs==="" || as===""){ toast("スコアを入力してください"); return; }
    const h = Number(hs), a = Number(as);
    if(!Number.isFinite(h) || !Number.isFinite(a) || h<0 || a<0){ toast("0以上の数で入力"); return; }
    m.homeScore = h; m.awayScore = a;
    saveState();
    render();
    closeModal();
    toast("保存しました");
  };

  foot.appendChild(btnCancel);
  foot.appendChild(btnClear);
  foot.appendChild(btnSave);

  openModal("結果入力", body, foot);
}

// ---------- Modals: Team ----------

function openTeamModal(divId, teamId){
  const league = getActiveLeague();
  const activeSeason = getActiveSeason();
  const teamNow = teamById(divId, teamId) || findTeamInSeason(activeSeason, teamId);
  if(!teamNow) return;

  const seasons = league.seasons.slice().sort((a,b)=>b.number-a.number);

  // compute season summaries for this team
  const summaries = [];
  for(const s of seasons){
    // find division containing this team in that season
    const d = s.divisions.find(x => (x.teams||[]).some(t=>t.id===teamId));
    if(!d) continue;
    const rows = computeStandingsInSeason(s, d.id);
    const row = rows.find(r=>r.teamId===teamId);
    if(!row) continue;
    const wr = row.played ? (row.w/row.played*100) : 0;
    summaries.push({
      seasonNo: s.number,
      seasonId: s.id,
      divName: d.name,
      rank: row.rank,
      pts: row.pts,
      played: row.played,
      w: row.w, d: row.d, l: row.l,
      gf: row.gf, ga: row.ga, gd: row.gd,
      winrate: wr
    });
  }

  const body = document.createElement("div");

  // big header like your screenshot vibe
  body.innerHTML = `
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:10px">
      <div id="bigLogo" style="width:90px;height:90px;border-radius:22px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);overflow:hidden;display:grid;place-items:center"></div>
      <div style="min-width:0">
        <div style="font-size:18px;font-weight:500;line-height:1.1">${escapeHtml(teamNow.name)}</div>
        <div class="small">現在のリーグ: ${escapeHtml(league.name)}</div>
        <div class="small muted2">※Seasonが変わっても、このクラブの過去戦績をここで見れます</div>
      </div>
    </div>

    <div class="field">
      <div class="label">クラブ情報（コメント）</div>
      <textarea class="input" id="teamNote" rows="4" placeholder="クラブ情報/メモ">${escapeHtml(teamNow.note || "")}</textarea>
      <div class="small muted2">Viewerは編集できません（管理ロック解除が必要）</div>
    </div>

    <div class="label">シーズン別戦績</div>
    <div id="seasonTable"></div>

    <div class="hr"></div>
    <div class="small muted2">試合の詳細は「日程/結果」側で確認・入力できます。</div>
  `;

  // logo
  const big = $("#bigLogo", body);
  if(teamNow.logoDataUrl){
    const img = document.createElement("img");
    img.src = teamNow.logoDataUrl;
    img.style.width="100%"; img.style.height="100%"; img.style.objectFit="cover";
    big.appendChild(img);
  }else{
    big.innerHTML = `<div class="muted2" style="font-weight:500;font-size:22px">⚑</div>`;
  }

  // season table
  const tbl = document.createElement("table");
  tbl.className="table";
  tbl.innerHTML = `
    <thead>
      <tr>
        <th style="text-align:left">Season</th>
        <th style="text-align:left">Div</th>
        <th>順位</th>
        <th>勝点</th>
        <th>試合</th>
        <th>勝</th>
        <th>分</th>
        <th>負</th>
        <th>得失点</th>
        <th>勝率</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tb = tbl.querySelector("tbody");
  for(const s of summaries){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="text-align:left">Season ${s.seasonNo}</td>
      <td style="text-align:left">${escapeHtml(s.divName)}</td>
      <td>${s.rank}</td>
      <td>${s.pts}</td>
      <td>${s.played}</td>
      <td>${s.w}</td>
      <td>${s.d}</td>
      <td>${s.l}</td>
      <td>${s.gf}-${s.ga} (${s.gd})</td>
      <td>${s.winrate.toFixed(1)}%</td>
    `;
    tb.appendChild(tr);
  }
  const wrap = $("#seasonTable", body);
  wrap.appendChild(tbl);

  // lock note editing
  const noteEl = $("#teamNote", body);
  noteEl.disabled = !isAdminUnlocked();

  const foot = document.createElement("div");
  const close = document.createElement("button");
  close.className="btn btn--ghost";
  close.textContent="閉じる";
  close.onclick=closeModal;

  const save = document.createElement("button");
  save.className="btn";
  save.textContent="保存";
  save.onclick=()=>{
    if(!isAdminUnlocked()){ toast("管理ロック解除が必要です"); return; }
    // Update note on the team object in current season (team id is shared across seasons)
    const t = findTeamInSeason(activeSeason, teamId);
    if(t) t.note = noteEl.value;
    saveState();
    render();
    closeModal();
    toast("保存しました");
  };

  foot.appendChild(close);
  foot.appendChild(save);
  openModal("クラブ", body, foot);
}


// ---------- Modals: Rank Colors ----------
function openRankColorModal(){
  const season = getActiveSeason();
  const div = getActiveDiv();
  season.rankColorRules = season.rankColorRules || {};
  season.rankColorRules[div.id] = season.rankColorRules[div.id] || [];

  const body = document.createElement("div");
  const rulesWrap = document.createElement("div");
  body.appendChild(rulesWrap);

  function renderRules(){
    rulesWrap.innerHTML = "";
    const rules = season.rankColorRules[div.id];

    const info = document.createElement("div");
    info.className="small";
    info.textContent = `例: 1位=優勝(黄) / 8位=入れ替え戦(橙) / 9-10位=降格(赤) など。チーム数: ${div.teams.length}`;
    rulesWrap.appendChild(info);
    rulesWrap.appendChild(document.createElement("div")).className="hr";

    for(const r of rules){
      const row = document.createElement("div");
      row.className="rowLine";
      row.innerHTML = `
        <div class="rowLineLeft" style="flex:1">
          <div class="colorChip" style="background:${r.color}"></div>
          <div style="min-width:0">
            <div class="small">順位 ${r.from} - ${r.to}</div>
            <div class="small muted2">${escapeHtml(r.label || "")}</div>
          </div>
        </div>
        <button class="item__btn">編集</button>
        <button class="item__btn"><span class="danger">削除</span></button>
      `;
      const [editBtn, delBtn] = row.querySelectorAll("button");
      editBtn.onclick = ()=> editRule(r);
      delBtn.onclick = ()=> {
        season.rankColorRules[div.id] = season.rankColorRules[div.id].filter(x=>x!==r);
        saveState(); render(); renderRules();
      };
      rulesWrap.appendChild(row);
    }

    const add = document.createElement("button");
    add.className="btn";
    add.textContent="ルール追加";
    add.onclick = ()=> {
      const nr = { from: 1, to: 1, color: "#33D17A", label: "" };
      season.rankColorRules[div.id].push(nr);
      saveState(); render(); renderRules();
      editRule(nr);
    };
    rulesWrap.appendChild(add);
  }

  function editRule(rule){
    const editor = document.createElement("div");
    editor.innerHTML = `
      <div class="grid3">
        <div class="field">
          <div class="label">From</div>
          <input class="input" id="from" inputmode="numeric" value="${rule.from}">
        </div>
        <div class="field">
          <div class="label">To</div>
          <input class="input" id="to" inputmode="numeric" value="${rule.to}">
        </div>
        <div class="field">
          <div class="label">Color</div>
          <input class="input" id="color" type="color" value="${rule.color}">
        </div>
      </div>
      <div class="field">
        <div class="label">名前（任意）</div>
        <input class="input" id="label" value="${escapeHtml(rule.label || "")}">
      </div>
      <div class="small">※範囲が重なると「先に並んでるルール」が優先されます。</div>
    `;

    const foot = document.createElement("div");
    const b1 = document.createElement("button");
    b1.className="btn btn--ghost";
    b1.textContent="戻る";
    b1.onclick = ()=> { closeModal(); openRankColorModal(); };

    const b2 = document.createElement("button");
    b2.className="btn";
    b2.textContent="保存";
    b2.onclick = ()=> {
      const from = Number($("#from", editor).value);
      const to = Number($("#to", editor).value);
      const color = $("#color", editor).value;
      const label = $("#label", editor).value.trim();

      if(!Number.isFinite(from) || !Number.isFinite(to) || from<1 || to<1){ toast("順位は1以上"); return; }
      if(from>to){ toast("From <= To にしてください"); return; }
      if(from>div.teams.length || to>div.teams.length){ toast("チーム数より大きい順位は不可"); return; }

      rule.from = from; rule.to = to; rule.color = color; rule.label = label;
      saveState(); render();
      closeModal();
      openRankColorModal();
      toast("保存しました");
    };

    foot.appendChild(b1);
    foot.appendChild(b2);
    openModal("順位カラー 編集", editor, foot);
  }

  renderRules();

  const foot = document.createElement("div");
  const close = document.createElement("button");
  close.className="btn";
  close.textContent="閉じる";
  close.onclick = ()=> { saveState(); render(); closeModal(); };
  foot.appendChild(close);

  openModal("順位カラー", body, foot);
}

// ---------- Modals: Manage ----------
function openManageModal(){
  const league = getActiveLeague();
  const season = getActiveSeason();
  const div = getActiveDiv();

  const body = document.createElement("div");

  // league
  const leagueBox = document.createElement("div");
  leagueBox.innerHTML = `
    <div class="label">リーグ</div>
    <div class="grid2">
      <div class="field">
        <div class="label">リーグ名</div>
        <input class="input" id="leagueNameInput" value="${escapeHtml(league.name)}">
      </div>
      <div class="field">
        <div class="label">リーグロゴ</div>
        <input class="input" id="leagueLogoFile" type="file" accept="image/*">
      </div>
    </div>
    <div class="pillRow" id="leagueSwitchRow"></div>
    <div class="small">※複数リーグ作れます（追加/削除）</div>
    <div class="hr"></div>
  `;
  body.appendChild(leagueBox);

  const leagueSwitchRow = $("#leagueSwitchRow", leagueBox);
  function renderLeagueSwitch(){
    leagueSwitchRow.innerHTML = "";
    for(const l of state.leagues){
      const p = document.createElement("div");
      p.className = "pill" + (l.id===league.id ? " pill--active" : "");
      p.textContent = l.name;
      p.onclick = ()=> {
        state.ui.activeLeagueId = l.id;
        const ls = getActiveLeague();
        const lastSeason = ls.seasons[ls.seasons.length-1];
        state.ui.activeSeasonId = lastSeason.id;
        state.ui.activeDivId = lastSeason.divisions[0]?.id;
        state.ui.scheduleRound = 1;
        saveState();
        closeModal();
        render();
        openManageModal();
      };
      leagueSwitchRow.appendChild(p);
    }
    const add = document.createElement("div");
    add.className = "pill";
    add.textContent = "+ リーグ追加";
    add.onclick = ()=> {
      const id = uid();
      const divId = uid();
      const seasonId = uid();
      const newLeague = {
        id,
        name: `New League`,
        logoDataUrl: "", note: "",
        seasons: [{
          id: seasonId,
          number: 1,
          createdAt: Date.now(),
          divisions: [{
            id: divId,
            name: "Div.1",
            teams: [{ id: uid(), name:"Team A", logoDataUrl:"",note:"" }, { id: uid(), name:"Team B", logoDataUrl:"",note:"" }]
          }],
          rankColorRules: { [divId]: [] },
          scheduleByDiv: {},
          lastRankByDivTeam: {},
        }]
      };
      state.leagues.push(newLeague);
      state.ui.activeLeagueId = id;
      state.ui.activeSeasonId = seasonId;
      state.ui.activeDivId = divId;
      state.ui.scheduleRound = 1;
      saveState();
      closeModal();
      render();
      openManageModal();
      toast("リーグを追加しました");
    };
    leagueSwitchRow.appendChild(add);

    if(state.leagues.length>1){
      const del = document.createElement("div");
      del.className="pill";
      del.innerHTML = `<span class="danger">リーグ削除</span>`;
      del.onclick = ()=> {
        const idx = state.leagues.findIndex(x=>x.id===league.id);
        state.leagues.splice(idx,1);
        // switch to first
        state.ui.activeLeagueId = state.leagues[0].id;
        const ls = getActiveLeague();
        state.ui.activeSeasonId = ls.seasons[ls.seasons.length-1].id;
        state.ui.activeDivId = ls.seasons[ls.seasons.length-1].divisions[0].id;
        state.ui.scheduleRound = 1;
        saveState();
        closeModal();
        render();
        openManageModal();
        toast("削除しました");
      };
      leagueSwitchRow.appendChild(del);
    }
  }
  renderLeagueSwitch();

  // seasons switch
  const seasonBox = document.createElement("div");
  seasonBox.innerHTML = `
    <div class="label">シーズン</div>
    <div class="pillRow" id="seasonRow"></div>
    <div class="small">※過去シーズンも保持されます</div>
    <div class="hr"></div>
  `;
  body.appendChild(seasonBox);

  const seasonRow = $("#seasonRow", seasonBox);
  function renderSeasonRow(){
    seasonRow.innerHTML = "";
    const league = getActiveLeague();
    const seasons = league.seasons.slice().sort((a,b)=>a.number-b.number);
    for(const s of seasons){
      const p = document.createElement("div");
      p.className = "pill" + (s.id===state.ui.activeSeasonId ? " pill--active" : "");
      p.textContent = `Season ${s.number}`;
      p.onclick = ()=> {
        state.ui.activeSeasonId = s.id;
        state.ui.activeDivId = s.divisions[0]?.id;
        state.ui.scheduleRound = 1;
        saveState();
        closeModal();
        render();
        openManageModal();
      };
      seasonRow.appendChild(p);
    }
    
    const add = document.createElement("div");
    add.className="pill";
    add.textContent = "+ 新シーズン";
    add.onclick = ()=> { createNewSeason(); closeModal(); render(); openManageModal(); };
    seasonRow.appendChild(add);

    if(seasons.length > 1){
      const del = document.createElement("div");
      del.className = "pill";
      del.innerHTML = "<span class=\"danger\">シーズン削除</span>";
      del.onclick = ()=> {
        const body = document.createElement("div");
        body.innerHTML = `
          <div class="small danger">このシーズンを削除します。</div>
          <div class="small">日程・結果・順位など全データが完全に消えます。</div>
          <div class="small">※この操作は取り消せません。</div>
        `;
        const foot = document.createElement("div");
        const cancel = document.createElement("button");
        cancel.className="btn btn--ghost";
        cancel.textContent="キャンセル";
        cancel.onclick=closeModal;

        const ok = document.createElement("button");
        ok.className="btn";
        ok.textContent="削除する";
        ok.onclick=()=>{
          const idx = league.seasons.findIndex(s=>s.id===state.ui.activeSeasonId);
          league.seasons.splice(idx,1);
          const last = league.seasons[league.seasons.length-1];
          state.ui.activeSeasonId = last.id;
          state.ui.activeDivId = last.divisions[0]?.id;
          state.ui.scheduleRound = 1;
          saveState();
          closeModal();
          render();
          toast("シーズンを削除しました");
        };

        foot.appendChild(cancel);
        foot.appendChild(ok);
        openModal("シーズン削除確認", body, foot);
      };
      seasonRow.appendChild(del);
    }

  }
  renderSeasonRow();

  // divisions
  const divBox = document.createElement("div");
  divBox.innerHTML = `
    <div class="label">ディビジョン</div>
    <div id="divList"></div>
    <button class="btn btn--ghost" id="btnAddDiv">+ ディビジョン追加</button>
    <div class="hr"></div>
  `;
  body.appendChild(divBox);

  const divList = $("#divList", divBox);

  function renderDivList(){
    const season = getActiveSeason();
    divList.innerHTML = "";
    for(const d of season.divisions){
      const line = document.createElement("div");
      line.className = "rowLine";
      line.innerHTML = `
        <div class="rowLineLeft" style="flex:1">
          <div class="small">${escapeHtml(d.name)}（${d.teams.length}チーム）</div>
        </div>
        <button class="item__btn">編集</button>
        <button class="item__btn"><span class="danger">削除</span></button>
      `;
      const [editBtn, delBtn] = line.querySelectorAll("button");
      editBtn.onclick = ()=> openDivisionEditModal(d.id);
      delBtn.onclick = ()=> {
        const season = getActiveSeason();
        if(season.divisions.length<=1){ toast("最低1ディビジョン必要"); return; }
        season.divisions = season.divisions.filter(x=>x.id!==d.id);
        delete season.scheduleByDiv[d.id];
        delete season.rankColorRules?.[d.id];
        delete season.lastRankByDivTeam?.[d.id];
        if(state.ui.activeDivId === d.id){
          state.ui.activeDivId = season.divisions[0].id;
          state.ui.scheduleRound = 1;
        }
        saveState(); render(); renderDivList();
        toast("削除しました");
      };
      divList.appendChild(line);
    }
  }
  renderDivList();

  $("#btnAddDiv", divBox).onclick = ()=> {
    const season = getActiveSeason();
    const newId = uid();
    const d = { id:newId, name:`Div.${season.divisions.length+1}`, logoDataUrl:"", teams:[{id:uid(),name:"Team A",logoDataUrl:"",note:""},{id:uid(),name:"Team B",logoDataUrl:"",note:""}] };
    season.divisions.push(d);
    season.rankColorRules = season.rankColorRules || {};
    season.rankColorRules[newId] = [];
    saveState(); render(); renderDivList();
    toast("追加しました");
  };

  // footer
  const foot = document.createElement("div");

  const btnClose = document.createElement("button");
  btnClose.className="btn btn--ghost";
  btnClose.textContent="閉じる";
  btnClose.onclick = closeModal;

  const btnSave = document.createElement("button");
  btnSave.className="btn";
  btnSave.textContent="保存";
  btnSave.onclick = async ()=> {
    league.name = $("#leagueNameInput", leagueBox).value.trim() || league.name;

    const fileInput = $("#leagueLogoFile", leagueBox);
    if(fileInput.files && fileInput.files[0]){
      league.logoDataUrl = await fileToDataUrl(fileInput.files[0]);
    }

    saveState();
    render();
    closeModal();
    toast("保存しました");
  };

  foot.appendChild(btnClose);
  foot.appendChild(btnSave);

  openModal("管理", body, foot);
}

function openDivisionEditModal(divId){
  const season = getActiveSeason();
  const div = season.divisions.find(d=>d.id===divId);
  if(!div) return;

  const body = document.createElement("div");
  body.innerHTML = `
    <div class="field">
      <div class="label">ディビジョン名</div>
      <input class="input" id="divName" value="${escapeHtml(div.name)}">
    </div>

    <div class="label">チーム</div>
    <div id="teamList"></div>
    <button class="btn btn--ghost" id="btnAddTeam">+ チーム追加</button>
    <div class="small">※チーム数変更OK（その都度、順位カラーも編集できます）</div>
  `;

  const teamList = $("#teamList", body);
  function renderTeamList(){
    teamList.innerHTML = "";
    for(const t of div.teams){
      const line = document.createElement("div");
      line.className="rowLine";
      line.innerHTML = `
        <div class="rowLineLeft" style="flex:1">
          <div class="small">${escapeHtml(t.name)}</div>
        </div>
        <button class="item__btn">編集</button>
        <button class="item__btn"><span class="danger">削除</span></button>
      `;
      const [editBtn, delBtn] = line.querySelectorAll("button");
      editBtn.onclick = ()=> { closeModal(); openTeamModal(divId, t.id); };
      delBtn.onclick = ()=> {
        if(div.teams.length<=2){ toast("最低2チーム必要"); return; }
        div.teams = div.teams.filter(x=>x.id!==t.id);
        season.scheduleByDiv[divId] = (season.scheduleByDiv[divId] || []).filter(m => m.homeId!==t.id && m.awayId!==t.id);
        if(season.lastRankByDivTeam?.[divId]) delete season.lastRankByDivTeam[divId][t.id];
        saveState(); render(); renderTeamList();
      };
      teamList.appendChild(line);
    }
  }
  renderTeamList();

  $("#btnAddTeam", body).onclick = ()=> {
    div.teams.push({ id: uid(), name:`Team ${div.teams.length+1}`, logoDataUrl:"",note:"" });
    saveState(); render(); renderTeamList();
    toast("追加しました");
  };

  const foot = document.createElement("div");
  const btnBack = document.createElement("button");
  btnBack.className="btn btn--ghost";
  btnBack.textContent="戻る";
  btnBack.onclick = ()=> { closeModal(); openManageModal(); };

  const btnSave = document.createElement("button");
  btnSave.className="btn";
  btnSave.textContent="保存";
  btnSave.onclick = ()=> {
    div.name = $("#divName", body).value.trim() || div.name;
    // if active div changed name, update UI
    saveState(); render();
    closeModal(); openManageModal();
    toast("保存しました");
  };

  foot.appendChild(btnBack);
  foot.appendChild(btnSave);

  openModal("ディビジョン編集", body, foot);
}

// ---------- Seasons ----------
function createNewSeason(){
  const league = getActiveLeague();
  const current = getActiveSeason();
  const nextNumber = Math.max(...league.seasons.map(s=>s.number)) + 1;

  // copy league structure (divisions + teams), reset schedule & history
  const newSeason = {
    id: uid(),
    number: nextNumber,
    createdAt: Date.now(),
    divisions: deepClone(current.divisions),
    rankColorRules: deepClone(current.rankColorRules || {}),
    scheduleByDiv: {},
    lastRankByDivTeam: {},
  };
  league.seasons.push(newSeason);
  state.ui.activeSeasonId = newSeason.id;
  state.ui.activeDivId = newSeason.divisions[0]?.id;
  state.ui.scheduleRound = 1;
  saveState();
  toast(`Season ${nextNumber} を作成しました`);
}

function gotoSeason(offset){
  const league = getActiveLeague();
  const seasons = league.seasons.slice().sort((a,b)=>a.number-b.number);
  const idx = seasons.findIndex(s=>s.id===state.ui.activeSeasonId);
  const next = seasons[idx + offset];
  if(!next){ toast("これ以上ありません"); return; }
  state.ui.activeSeasonId = next.id;
  state.ui.activeDivId = next.divisions[0]?.id;
  state.ui.scheduleRound = 1;
  saveState();
  render();
}

// ---------- Generate Schedule Modal ----------
function openGenerateScheduleModal(){
  const div = getActiveDiv();
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="small">対象: ${escapeHtml(div.name)}（${div.teams.length}チーム）</div>
    <div class="hr"></div>
    <div class="grid2">
      <div class="field">
        <div class="label">総当たりを何回？</div>
        <select class="select" id="rounds">
          <option value="1">1回</option>
          <option value="2">2回</option>
          <option value="3">3回</option>
          <option value="4">4回</option>
        </select>
      </div>
      <div class="field">
        <div class="label">Home & Away（2回目以降を反転）</div>
        <select class="select" id="homeAway">
          <option value="yes">あり</option>
          <option value="no">なし</option>
        </select>
      </div>
    </div>
    <div class="small">※生成するとこのDivの既存日程は上書きされます（過去入力も消えます）</div>
  `;

  const foot = document.createElement("div");
  const cancel = document.createElement("button");
  cancel.className="btn btn--ghost";
  cancel.textContent="キャンセル";
  cancel.onclick=closeModal;

  const ok = document.createElement("button");
  ok.className="btn";
  ok.textContent="生成";
  ok.onclick=()=>{
    const rounds = Number($("#rounds", body).value);
    const homeAway = $("#homeAway", body).value === "yes";
    generateDivisionSchedule(getActiveDiv().id, { rounds, homeAway });
    closeModal();
  };

  foot.appendChild(cancel);
  foot.appendChild(ok);
  openModal("日程生成", body, foot);
}

// ---------- Utils ----------
function findTeamInSeason(season, teamId){
  for(const d of season.divisions){
    const t = (d.teams||[]).find(x=>x.id===teamId);
    if(t) return t;
  }
  return null;
}

let _adminUnlockedUntil = 0;
function isAdminUnlocked(){ return Date.now() < _adminUnlockedUntil; }

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

function fileToDataUrl(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(String(reader.result||""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}


function openAdminLockModal(){
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="small">管理者のみ編集できます。パスワードを入力してください。</div>
    <div class="hr"></div>
    <div class="field">
      <div class="label">管理者パスワード</div>
      <input class="input" id="adminPw" type="password" placeholder="password">
    </div>
    <div class="small muted2">※この版はブラウザ内ロックです（後でFirebase版に移行できます）</div>
  `;
  const foot = document.createElement("div");
  const cancel = document.createElement("button");
  cancel.className="btn btn--ghost";
  cancel.textContent="キャンセル";
  cancel.onclick=closeModal;

  const ok = document.createElement("button");
  ok.className="btn";
  ok.textContent="解除";
  ok.onclick=()=>{
    const pw = $("#adminPw", body).value;
    if(pw === "admin"){ // 変更したければここを編集
      _adminUnlockedUntil = Date.now() + 12*60*60*1000; // 12h
      closeModal();
      applyAdminUI();
      toast("管理ロックを解除しました");
    }else{
      toast("パスワードが違います");
    }
  };
  foot.appendChild(cancel);
  foot.appendChild(ok);
  openModal("管理ロック", body, foot);
}

function applyAdminUI(){
  const enabled = isAdminUnlocked();
  const ids = ["btnManage","btnNewSeason","btnRankColors","btnGenerateSchedule"];
  for(const id of ids){
    const el = document.getElementById(id);
    if(el) el.disabled = !enabled;
  }
}

function openSeasonEndModal(){
  if(!isAdminUnlocked()){ toast("管理ロック解除が必要です"); return; }
  const league = getActiveLeague();
  const season = getActiveSeason();

  // divisions order by name like Div.1, Div.2 ...
  const divs = season.divisions.slice();
  const divIndex = new Map(divs.map((d,i)=>[d.id,i]));

  const body = document.createElement("div");
  body.innerHTML = `
    <div class="small">このシーズンを終了して、次シーズンを作成します。</div>
    <div class="small muted2">昇格/降格/入れ替え戦は「順位カラー」の名前で判定します（例: 昇格 / 降格 / 入れ替え戦）。</div>
    <div class="hr"></div>
    <div class="label">入れ替え戦（勝者の行き先を選択）</div>
    <div id="playoffWrap"></div>
  `;

  // build standings once
  const standingsByDiv = {};
  for(const d of divs){
    standingsByDiv[d.id] = computeStandingsInSeason(season, d.id);
  }

  // derive movements by label keyword
  const autoMoves = []; // {teamId, fromDivId, toDivId}
  const playoffs = [];  // {teamId, fromDivId, upDivId, downDivId}
  for(const d of divs){
    const rules = (season.rankColorRules?.[d.id] || []);
    const rows = standingsByDiv[d.id];
    for(const row of rows){
      const rule = rules.find(r => row.rank>=Number(r.from) && row.rank<=Number(r.to) && r.label);
      if(!rule) continue;
      const label = String(rule.label||"");
      const idx = divIndex.get(d.id);
      if(label.includes("昇格") && idx>0){
        autoMoves.push({teamId: row.teamId, fromDivId: d.id, toDivId: divs[idx-1].id});
      }else if(label.includes("降格") && idx<divs.length-1){
        autoMoves.push({teamId: row.teamId, fromDivId: d.id, toDivId: divs[idx+1].id});
      }else if(label.includes("入れ替") && idx<divs.length-1){
        playoffs.push({teamId: row.teamId, fromDivId: d.id, upDivId: idx>0?divs[idx-1].id:"", downDivId: divs[idx+1].id});
      }
    }
  }

  const playoffWrap = $("#playoffWrap", body);
  const playoffDecision = new Map(); // teamId -> destinationDivId
  if(playoffs.length===0){
    playoffWrap.innerHTML = `<div class="small">入れ替え戦対象がありません。</div>`;
  }else{
    for(const p of playoffs){
      const from = divs.find(d=>d.id===p.fromDivId);
      const up = p.upDivId ? divs.find(d=>d.id===p.upDivId) : null;
      const down = p.downDivId ? divs.find(d=>d.id===p.downDivId) : null;
      const t = findTeamInSeason(season, p.teamId);
      const row = document.createElement("div");
      row.className="rowLine";
      row.innerHTML = `
        <div class="rowLineLeft" style="flex:1;min-width:0">
          <div class="small">${escapeHtml(t?.name||"")}（${escapeHtml(from?.name||"")}）</div>
        </div>
        <select class="select" style="max-width:220px"></select>
      `;
      const sel = row.querySelector("select");
      if(up){
        const o1 = document.createElement("option");
        o1.value = up.id;
        o1.textContent = `勝ち: ${up.name}（昇格）`;
        sel.appendChild(o1);
      }
      if(down){
        const o2 = document.createElement("option");
        o2.value = down.id;
        o2.textContent = `負け: ${down.name}（降格/残留）`;
        sel.appendChild(o2);
      }
      // default: stay/down
      playoffDecision.set(p.teamId, down ? down.id : (from?.id||""));
      sel.value = playoffDecision.get(p.teamId);
      sel.onchange = ()=> playoffDecision.set(p.teamId, sel.value);
      playoffWrap.appendChild(row);
    }
  }

  const foot = document.createElement("div");
  const cancel = document.createElement("button");
  cancel.className="btn btn--ghost";
  cancel.textContent="キャンセル";
  cancel.onclick=closeModal;

  const ok = document.createElement("button");
  ok.className="btn";
  ok.textContent="シーズン終了して次へ";
  ok.onclick=()=>{
    // Create next season
    const nextNumber = Math.max(...league.seasons.map(s=>s.number)) + 1;
    const newSeason = {
      id: uid(),
      number: nextNumber,
      createdAt: Date.now(),
      divisions: deepClone(season.divisions),
      rankColorRules: deepClone(season.rankColorRules || {}),
      scheduleByDiv: {},
      lastRankByDivTeam: {},
    };

    function moveTeam(teamId, fromDivId, toDivId){
      if(!toDivId || fromDivId===toDivId) return;
      const from = newSeason.divisions.find(d=>d.id===fromDivId);
      const to = newSeason.divisions.find(d=>d.id===toDivId);
      if(!from || !to) return;
      const idx = from.teams.findIndex(t=>t.id===teamId);
      if(idx<0) return;
      const [t] = from.teams.splice(idx,1);
      if(!to.teams.some(x=>x.id===teamId)) to.teams.push(t);
    }

    for(const mv of autoMoves){
      moveTeam(mv.teamId, mv.fromDivId, mv.toDivId);
    }
    for(const p of playoffs){
      const dest = playoffDecision.get(p.teamId) || p.fromDivId;
      moveTeam(p.teamId, p.fromDivId, dest);
    }

    league.seasons.push(newSeason);
    state.ui.activeSeasonId = newSeason.id;
    state.ui.activeDivId = newSeason.divisions[0]?.id;
    state.ui.scheduleRound = 1;

    saveState();
    render();
    closeModal();
    toast(`Season ${nextNumber} を作成しました`);
  };

  foot.appendChild(cancel);
  foot.appendChild(ok);
  openModal("シーズン終了", body, foot);
}

// ---------- Buttons ----------
$("#btnManage").onclick = openManageModal;
$("#btnNewSeason").onclick = ()=>{ createNewSeason(); render(); };
$("#btnPrevSeason").onclick = ()=> gotoSeason(-1);
$("#btnNextSeason").onclick = ()=> gotoSeason(1);

$("#btnRankColors").onclick = openRankColorModal;
$("#btnGenerateSchedule").onclick = openGenerateScheduleModal;

$("#btnRoundPrev").onclick = ()=>{ state.ui.scheduleRound = Math.max(1, (state.ui.scheduleRound||1)-1); saveState(); renderSchedule(); };
$("#btnRoundNext").onclick = ()=>{
  const season = getActiveSeason();
  const div = getActiveDiv();
  const matches = season.scheduleByDiv[div.id] || [];
  const maxRound = matches.length ? Math.max(...matches.map(m=>m.round)) : 1;
  state.ui.scheduleRound = Math.min(maxRound, (state.ui.scheduleRound||1)+1);
  saveState(); renderSchedule();
};

$("#btnShowAllResults").onclick = ()=>{
  const season = getActiveSeason();
  const div = getActiveDiv();
  const matches = (season.scheduleByDiv[div.id] || []).slice()
    .sort((a,b)=> (b.round-a.round) || (b.createdAt-a.createdAt));

  const body = document.createElement("div");
  const list = document.createElement("div");
  body.appendChild(list);

  const completed = matches.filter(m=>m.homeScore!=null && m.awayScore!=null);
  if(completed.length===0){
    const p = document.createElement("div");
    p.className="small";
    p.textContent="結果がまだありません。";
    list.appendChild(p);
  }else{
    for(const m of completed){
      const home = teamById(div.id, m.homeId);
      const away = teamById(div.id, m.awayId);
      const row = document.createElement("div");
      row.className="rowLine";
      row.innerHTML = `
        <div class="rowLineLeft" style="flex:1">
          <div class="small">${div.name} 第${m.round}節</div>
          <div class="small">${home?.name || "Home"} vs ${away?.name || "Away"}</div>
        </div>
        <div class="pill">${m.homeScore}-${m.awayScore}</div>
      `;
      row.onclick = ()=> openResultModal(div.id, m.id);
      list.appendChild(row);
    }
  }

  const foot = document.createElement("div");
  const close = document.createElement("button");
  close.className="btn";
  close.textContent="閉じる";
  close.onclick=closeModal;
  foot.appendChild(close);

  openModal("全結果", body, foot);
};

// Initial render
render();
