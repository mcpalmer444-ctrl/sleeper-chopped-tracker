const $=x=>document.getElementById(x),fmt=n=>(+n||0).toFixed(2),esc=s=>String(s??"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function rounds(){let a=[];for(let w=2;w<=18;w+=2)a.push([w,w+1]);return a.filter(x=>x[1]<=18)}
function matchup(weekly,id,w){return (weekly[w]||[]).find(x=>String(x.roster_id)===String(id))}
function rawPlayerPoints(m,id){return +(m?.players_points?.[id]??0)}

function livePlayerScore(teamName,p){
  const raw=+p.points||0;
  if(String(teamName).toLowerCase()==="taypalm93" && raw>4) return raw-1.25;
  return raw;
}

function weekPlayerRows(m,players,teamName){
  if(!m)return [];
  const pp=m?.players_points||{};
  const ids=[...new Set([...(m.players||[]).map(String),...Object.keys(pp).map(String)])];

  return ids.map(id=>{
    const meta=players?.[id]||{};
    const raw=+(pp[id]??0);

    return {
      id,
      meta,
      rawPoints:raw,
      points:livePlayerScore(teamName,{points:raw}),
      contributor:false
    };
  }).sort((a,b)=>(b.points-a.points)||(a.meta.full_name||"").localeCompare(b.meta.full_name||""));
}

function bestBallWeek(m,players,teamName){
  const rows=weekPlayerRows(m,players,teamName);
  const byPos={QB:[],RB:[],WR:[],TE:[]};

  for(const p of rows){
    const pos=String(p.meta?.position||"").toUpperCase();
    if(byPos[pos])byPos[pos].push(p);
  }

  const chosen=[];

  for(const pos of ["QB","RB","WR","TE"]){
    const p=byPos[pos]?.sort(
      (a,b)=>
        (b.points-a.points)||
        (b.rawPoints-a.rawPoints)||
        (a.meta.full_name||"").localeCompare(b.meta.full_name||"")
    )[0];

    if(p){
      p.contributor=true;
      p.bestBallPosition=pos;
      chosen.push(p);
    }
  }

  return {
    rows,
    contributors:chosen,
    total:chosen.reduce((sum,p)=>sum+p.points,0)
  };
}

function score(weekly,id,w,players,teamName){
  return bestBallWeek(
    matchup(weekly,id,w),
    players,
    teamName
  ).total;
}

/* ---------------- PROJECTED CUT ODDS ---------------- */

function projectionScoringKey(d){
  const rec=+(d.league?.scoring_settings?.rec??0);

  if(rec>=0.999)return "pts_ppr";
  if(rec>0)return "pts_half_ppr";
  return "pts_std";
}

function penaltyRaw(teamName,raw){
  raw=+raw||0;

  if(
    String(teamName).toLowerCase()==="taypalm93" &&
    raw>4
  ){
    return raw-1.25;
  }

  return raw;
}

function seededRandom(seed){
  let x=seed>>>0;

  return function(){
    x+=0x6D2B79F5;
    let t=x;
    t=Math.imul(t^(t>>>15),t|1);
    t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}

function normalRandom(rand){
  let u=0,v=0;

  while(u===0)u=rand();
  while(v===0)v=rand();

  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}

function projectionPlayer(m,id,week,d,teamName){
  const actualRaw=+(m?.players_points?.[id]??0);
  const proj=d.projections?.[week]?.[id];
  const key=projectionScoringKey(d);
  const projectionRaw=proj?.[key];

  const nflWeek=+(d.nflState?.week||0);
  const completed=week<nflWeek;

  if(completed){
    return {
      id,
      mean:penaltyRaw(teamName,actualRaw),
      rawMean:actualRaw,
      rawSd:0,
      sd:0,
      actualRaw,
      meta:d.players?.[id]||{}
    };
  }

  if(projectionRaw==null){
    return {
      id,
      mean:penaltyRaw(teamName,actualRaw),
      rawMean:actualRaw,
      rawSd:0,
      sd:0,
      actualRaw,
      meta:d.players?.[id]||{}
    };
  }

  const remaining=Math.max(0,+projectionRaw-actualRaw);
  const rawMean=actualRaw+remaining;
  const sd=remaining>0?Math.max(1.5,remaining*0.35):0;

  return {
    id,
    mean:penaltyRaw(teamName,rawMean),
    rawMean,
    rawSd:sd,
    sd,
    actualRaw,
    meta:d.players?.[id]||{}
  };
}

function projectedWeekCandidates(m,id,week,d,teamName){
  const players=d.players||{};
  const ids=[
    ...new Set([
      ...(m?.players||[]).map(String),
      ...Object.keys(m?.players_points||{}).map(String)
    ])
  ];

  const byPos={
    QB:[],
    RB:[],
    WR:[],
    TE:[]
  };

  for(const playerId of ids){
    const meta=players[playerId]||{};
    const pos=String(meta.position||"").toUpperCase();

    if(!byPos[pos])continue;

    byPos[pos].push(
      projectionPlayer(
        m,
        playerId,
        week,
        d,
        teamName
      )
    );
  }

  return byPos;
}

function projectedTeamModel(team,d,weeks){
  const byWeek=[];

  for(const week of weeks){
    const m=matchup(d.weekly,team.id,week);
    const candidates=projectedWeekCandidates(
      m,
      team.id,
      week,
      d,
      team.t.name
    );

    byWeek.push({
      week,
      candidates
    });
  }

  return byWeek;
}

function simulatedTeamScore(model,rand){
  let total=0;

  for(const week of model){
    for(const pos of ["QB","RB","WR","TE"]){
      const candidates=week.candidates[pos]||[];

      if(!candidates.length)continue;

      let best=0;

      for(const p of candidates){
        let raw;

        if(p.rawMean!=null){
          raw=Math.max(
            0,
            p.rawMean+(p.rawSd||0)*normalRandom(rand)
          );
        }else{
          raw=p.mean;
        }

        const value=penaltyRaw(
          p.meta?.teamName||"",
          raw
        );

        /*
          Use the actual league team name for the special penalty.
          projectionPlayer already applies it to the mean, but the
          simulation needs the same rule at the individual-player level.
        */
        const adjusted=
          String(teamNameForPenalty(p,model)||"").toLowerCase()==="taypalm93"
            ? penaltyRaw("taypalm93",raw)
            : value;

        if(adjusted>best)best=adjusted;
      }

      total+=best;
    }
  }

  return total;
}

function teamNameForPenalty(p,model){
  return p.__leagueTeamName||"";
}

function projectedTeamDistribution(team,d,weeks){
  const model=projectedTeamModel(team,d,weeks);
  console.log("BEST BALL MODEL:", team.t.name, JSON.stringify(model));

  /*
    Attach the actual league team name so the taypalm93 rule is
    applied inside the simulations too.
  */
  for(const week of model){
    for(const pos of ["QB","RB","WR","TE"]){
      for(const p of week.candidates[pos]||[]){
        p.__leagueTeamName=team.t.name;
      }
    }
  }

  const mean=(()=>{
    let total=0;

    for(const week of model){
      for(const pos of ["QB","RB","WR","TE"]){
        const candidates=week.candidates[pos]||[];
        if(candidates.length){
          total+=Math.max(...candidates.map(p=>p.mean));
        }
      }
    }

    return total;
  })();

  return {model,mean};
}

function projectedCutOdds(s,d){
  if(!s.rows?.length||!d.projections)return new Map();

  const weeks=s.cur;

  const teams=s.rows.map(r=>{
    const projected=projectedTeamDistribution(r,d,weeks);

    return {
      ...r,
      projected
    };
  });

  const hasProjection=teams.some(t=>
    t.projected.model.some(w=>
      Object.values(w.candidates).some(arr=>
        arr.some(p=>p.rawMean!=null)
      )
    )
  );

  if(!hasProjection)return new Map();

  const seedText=
    `${d.fetchedAt}|${s.cur.join("-")}|`+
    teams.map(t=>t.id).join(",");

  let seed=0;

  for(let i=0;i<seedText.length;i++){
    seed=((seed<<5)-seed+seedText.charCodeAt(i))|0;
  }

  const rand=seededRandom(seed);

  const counts=new Map(
    teams.map(t=>[t.id,0])
  );

  const SIMULATIONS=500;

  for(let sim=0;sim<SIMULATIONS;sim++){
    let lowest=Infinity;
    let losers=[];

    for(const team of teams){
      const total=simulatedTeamScore(
        team.projected.model,
        rand
      );

      if(total<lowest-0.0001){
        lowest=total;
        losers=[team.id];
      }else if(Math.abs(total-lowest)<=0.0001){
        losers.push(team.id);
      }
    }

    for(const id of losers){
      counts.set(
        id,
        (counts.get(id)||0)+(1/losers.length)
      );
    }
  }

  const result=new Map();

  for(const team of teams){
    const probability=
      (counts.get(team.id)||0)/SIMULATIONS;

    result.set(team.id,{
      probability,
      percent:probability*100,
      projected:team.projected.mean,
      current:team.a+team.b
    });
  }

  return result;
}
/* ---------------- EXISTING SITE ---------------- */

function state(d){
  let us=new Map(
    (d.users||[]).map(u=>[
      String(u.user_id),
      u
    ])
  );

  let ts=new Map();

  for(let r of d.rosters||[]){
    let u=us.get(String(r.owner_id));

    ts.set(String(r.roster_id),{
      id:String(r.roster_id),
      name:u?.metadata?.team_name||
        u?.display_name||
        `Roster ${r.roster_id}`,
      avatar:u?.avatar
        ?`https://sleepercdn.com/avatars/thumbs/${u.avatar}`
        :null
    });
  }

  let active=new Set(ts.keys()),done=[];

  const nflWeek=+(d.nflState?.week||0);
  const sameSeason=
    String(d.nflState?.season||"")===
    String(d.league?.season||"");

  for(let i=0;i<rounds().length;i++){
    let [a,b]=rounds()[i],
        data=d.weekly?.[b]||[];

    const hasScores=
      data.length&&
      data.some(x=>
        x.points!=null||
        x.custom_points!=null||
        Object.keys(x.players_points||{}).length
      );

    const weekFinished=
      sameSeason
        ? nflWeek>b
        : hasScores&&data.length>0;

    if(!weekFinished||!data.length)break;

    let ss=[...active]
      .map(id=>({
        id,
        total:
          score(
            d.weekly,
            id,
            a,
            d.players,
            ts.get(id)?.name
          )+
          score(
            d.weekly,
            id,
            b,
            d.players,
            ts.get(id)?.name
          )
      }))
      .sort((x,y)=>x.total-y.total);

    if(!ss.length)break;

    let l=ss[0];

    active.delete(l.id);

    done.push({
      n:i+1,
      w:[a,b],
      loser:l
    });
  }

  let cur=
    rounds()[
      Math.min(
        done.length,
        rounds().length-1
      )
    ]||[2,3];

  let rows=[...active]
    .map(id=>({
      id,
      t:ts.get(id),
      a:score(
        d.weekly,
        id,
        cur[0],
        d.players,
        ts.get(id)?.name
      ),
      b:score(
        d.weekly,
        id,
        cur[1],
        d.players,
        ts.get(id)?.name
      )
    }))
    .sort((x,y)=>
      x.a+x.b-y.a-y.b
    );

  return{
    ts,
    active,
    done,
    cur,
    rows
  };
}

function renderBattle(s,d,odds){
  const first=s.rows[0],
        second=s.rows[1];

  $("battleTitle").textContent=
    first&&second
      ?`${first.t.name} vs ${second.t.name}`
      :first?.t.name||
       "Waiting for live scores";

  if(!first||!second){
    $("battleSub").textContent=
      "More active teams are needed to show the live battle.";

    $("battleGap").textContent="—";
    $("battleGrid").innerHTML="";
    return;
  }

  const gap=
    (second.a+second.b)-
    (first.a+first.b);

  const firstOdds=odds.get(first.id);
  const secondOdds=odds.get(second.id);

  $("battleSub").textContent=
    `${first.t.name} is on the line. The next team is ${fmt(gap)} points ahead.`+
    (firstOdds
      ?` Projected cut odds: ${Math.round(firstOdds.percent)}%.`
      :"");

  $("battleGap").textContent=
    `+${fmt(gap)} to safety`;

  const cards=[first,second]
    .map((r,i)=>{
      const [a,b]=s.cur,
            total=r.a+r.b;

      const pct=Math.max(
        3,
        Math.min(
          100,
          (total/(second.a+second.b||1))*100
        )
      );

      const ba=bestBallWeek(
        matchup(d.weekly,r.id,a),
        d.players,
        r.t.name
      );

      const bb=bestBallWeek(
        matchup(d.weekly,r.id,b),
        d.players,
        r.t.name
      );

      const contributors=new Map();

      for(const p of ba.contributors){
        contributors.set(
          p.id,
          {...p,a:p.points,b:0}
        );
      }

      for(const p of bb.contributors){
        contributors.set(
          p.id,
          {
            ...(contributors.get(p.id)||p),
            a:contributors.get(p.id)?.a||0,
            b:p.points
          }
        );
      }

      const contrib=[...contributors.values()]
        .sort((x,y)=>
          (y.a+y.b)-(x.a+x.b)
        );

      const teamOdds=odds.get(r.id);

      return `
        <div class="battleCard ${i===0?'dangerBattle':''}">
          <div class="battleTeam">
            <div class="team">
              ${r.t.avatar
                ?`<img class="avatar" src="${esc(r.t.avatar)}">`
                :`<div class="avatar"></div>`}
              <div>
                <b>${esc(r.t.name)}</b>
                <span>${i===0?'ON THE LINE':'NEXT SAFE TEAM'}</span>
              </div>
            </div>
            <strong>${fmt(total)}</strong>
          </div>

          <div class="bar">
            <i style="width:${pct}%"></i>
          </div>

          <div class="battleMeta">
            <span>Wk ${a}: ${fmt(r.a)}</span>
            <span>Wk ${b}: ${fmt(r.b)}</span>
          </div>

          ${teamOdds
            ?`<div class="battleMeta">
                <span>PROJECTED FINISH: ${fmt(teamOdds.projected)}</span>
                <span>PROJECTED: ${teamOdds.projected.toFixed(2)} · CUT ODDS: ${Math.round(teamOdds.percent)}%</span>
              </div>`
            :""}

          <div class="contrib">
            <div class="mini">BEST-BALL CONTRIBUTORS</div>
            ${
              contrib.length
                ?contrib.slice(0,8).map(p=>
                  `<div class="contribRow">
                    <span>
                      ${esc(p.meta.full_name||p.id)}
                      <em>${esc(p.meta.position||'')}</em>
                    </span>
                    <b>${fmt(p.a+p.b)}</b>
                  </div>`
                ).join('')
                :`<div class="muted">No player-level points returned yet.</div>`
            }
          </div>
        </div>
      `;
    }).join('');

  $("battleGrid").innerHTML=cards;
}

function playerDetailHtml(r,d,a,b){
  const ba=bestBallWeek(
    matchup(d.weekly,r.id,a),
    d.players,
    r.t.name
  );

  const bb=bestBallWeek(
    matchup(d.weekly,r.id,b),
    d.players,
    r.t.name
  );

  const wa=ba.rows,
        wb=bb.rows;

  const ids=[
    ...new Set([
      ...wa.map(x=>x.id),
      ...wb.map(x=>x.id)
    ])
  ];

  const ma=new Map(
    wa.map(x=>[x.id,x])
  );

  const mb=new Map(
    wb.map(x=>[x.id,x])
  );

  const rowHtml=(p)=>
    p
      ?`<div class="playerRow ${p.contributor?'contributor':''}">
          <span>
            <b>${esc(p.meta.full_name||p.id)}</b>
            <em>${esc(p.meta.position||'—')} · ${esc(p.meta.team||'FA')}</em>
          </span>
          <strong>${fmt(p.points)}</strong>
        </div>`
      :'';

  return `
    <tr class="playerDetail">
      <td></td>
      <td colspan="5">
        <div class="playerPanel">
          <div class="playerPanelHead">
            <b>Best-ball player breakdown</b>
            <span>
              Contributing players update live as the highest scorer at each position changes.
            </span>
          </div>

          <div class="playerGrid">
            <div class="playerWeek">
              <div class="mini">WEEK ${a}</div>
              ${ids.map(id=>rowHtml(ma.get(id))).join('')}
            </div>

            <div class="playerWeek">
              <div class="mini">WEEK ${b}</div>
              ${ids.map(id=>rowHtml(mb.get(id))).join('')}
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function render(d){
  let s=state(d),
      [a,b]=s.cur,
      first=s.rows[0],
      odds=projectedCutOdds(s,d),
      now=new Date(d.fetchedAt)
        .toLocaleTimeString([],{
          hour:'numeric',
          minute:'2-digit',
          second:'2-digit'
        });

  $("league").textContent=
    d.league?.name||"Sleeper League";

  $("round").textContent=
    `Round ${s.done.length+1}`;

  $("weeks").textContent=
    `Weeks ${a} + ${b}`;

  $("left").textContent=
    s.active.size;

  $("elimCount").textContent=
    `${s.done.length} eliminated`;

  $("danger").textContent=
    first?.t.name||"—";

  $("dangerTotal").textContent=
    first
      ?`${fmt(first.a+first.b)} pts`
      :"—";

  $("spotTeam").textContent=
    first?.t.name||"—";

  $("spotText").textContent=
    `Currently lowest ${a}+${b} total`;

  $("spotScore").textContent=
    first
      ?fmt(first.a+first.b)
      :"—";

  $("updated").textContent=
    `Updated ${now}`;

  $("live").textContent=
    `LIVE • ${now}`;

  $("footerStatus").textContent=
    `Last sync ${now}`;

  $("rows").innerHTML=
    s.rows.map((r,i)=>{
      let danger=i===0;
      const o=odds.get(r.id);

      let badgeText=
        danger
          ?'CHOPPING BLOCK'
          :'SAFE';

      if(o){
        badgeText+=
          ` · ${o.projected.toFixed(2)} PROJ · ${Math.round(o.percent)}% CUT`;
      }

      return `
        <tr class="teamRow ${danger?'dangerRow':'safeRow'}"
            data-roster="${r.id}">
          <td class="rank">${i+1}</td>

          <td>
            <button class="teamButton" type="button">
              <div class="team">
                ${
                  r.t.avatar
                    ?`<img class="avatar" src="${esc(r.t.avatar)}">`
                    :`<div class="avatar"></div>`
                }

                <span class="name">
                  ${esc(r.t.name)}
                </span>

                <span class="expand">＋</span>
              </div>
            </button>
          </td>

          <td>${fmt(r.a)}</td>
          <td>${fmt(r.b)}</td>
          <td class="total">${fmt(r.a+r.b)}</td>

          <td>
            <span class="badge ${danger?'danger':'safe'}">
              ${badgeText}
            </span>
          </td>
        </tr>
      `;
    }).join('');

  $("history").innerHTML=
    s.done.length
      ?s.done.map(x=>
        `<div class="round">
          <div class="roundTop">
            <b>Round ${x.n} · Weeks ${x.w[0]} + ${x.w[1]}</b>
            <span class="red">
              ✂ ${esc(s.ts.get(x.loser.id)?.name||'Team')}
            </span>
          </div>

          <div class="muted">
            Eliminated at ${fmt(x.loser.total)} total points
          </div>
        </div>`
      ).join('')
      :`<div class="muted">No completed rounds yet.</div>`;

  renderBattle(s,d,odds);

  document
    .querySelectorAll('.teamButton')
    .forEach(btn=>
      btn.addEventListener('click',()=>{
        const tr=btn.closest('tr');
        const id=tr.dataset.roster;
        const old=tr.nextElementSibling;

        if(old?.classList.contains('playerDetail')){
          old.remove();
          tr.querySelector('.expand').textContent='＋';
          return;
        }

        const r=s.rows.find(x=>x.id===id);

        tr.insertAdjacentHTML(
          'afterend',
          playerDetailHtml(r,d,a,b)
        );

        tr.querySelector('.expand').textContent='−';
      })
    );
}

async function load(){
  try{
    let r=await fetch(
      '/api/data',
      {cache:'no-store'}
    );

    if(!r.ok)throw Error(`API ${r.status}`);

    render(await r.json());
  }catch(e){
    $("live").textContent='OFFLINE';
    $("footerStatus").textContent=e.message;
  }
}

document
  .querySelectorAll('.tab')
  .forEach(b=>
    b.onclick=()=>{
      document
        .querySelectorAll('.tab')
        .forEach(x=>x.classList.remove('active'));

      b.classList.add('active');

      document
        .querySelectorAll('.tabbody')
        .forEach(x=>x.classList.add('hidden'));

      $(`${b.dataset.tab}Tab`)
        .classList.remove('hidden');
    }
  );

$("refresh").onclick=load;

load();

setInterval(load,45000);
