import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename=fileURLToPath(import.meta.url), __dirname=path.dirname(__filename);
const app=express();
const PORT=process.env.PORT||3000;
const LEAGUE_ID=process.env.SLEEPER_LEAGUE_ID||"1405228769190465536";

let playerCache={at:0,data:null};
async function s(p){
  const r=await fetch("https://api.sleeper.app/v1"+p);
  if(!r.ok) throw Error(`Sleeper API ${r.status}`);
  return r.json();
}
async function players(){
  if(playerCache.data && Date.now()-playerCache.at<10*60*1000) return playerCache.data;
  playerCache.data=await s("/players/nfl");
  playerCache.at=Date.now();
  return playerCache.data;
}

app.get("/api/data",async(_q,res)=>{
  try{
    const league=await s(`/league/${LEAGUE_ID}`);
    const [users,rosters,nflState,playerDirectory]=await Promise.all([
      s(`/league/${LEAGUE_ID}/users`),
      s(`/league/${LEAGUE_ID}/rosters`),
      s("/state/nfl"),
      players()
    ]);
    const weekly={};
    for(let w=2;w<=18;w++){
      try{weekly[w]=await s(`/league/${LEAGUE_ID}/matchups/${w}`)}catch{weekly[w]=[]}
    }

    // Only send player metadata that is actually present on league rosters/matchups.
    const ids=new Set();
    for(const week of Object.values(weekly)) for(const m of (week||[])){
      for(const id of (m?.players||[])) ids.add(String(id));
      for(const id of (m?.starters||[])) ids.add(String(id));
      for(const id of Object.keys(m?.players_points||{})) ids.add(String(id));
    }
    const relevantPlayers={};
    for(const id of ids){
      const p=playerDirectory?.[id];
      if(p) relevantPlayers[id]={
        full_name:p.full_name||p.first_name&&p.last_name?`${p.first_name} ${p.last_name}`:id,
        position:p.position||"—",
        team:p.team||"FA",
        status:p.status||null,
        injury_status:p.injury_status||null,
        fantasy_positions:p.fantasy_positions||[]
      };
    }

    res.json({league,users,rosters,weekly,nflState,players:relevantPlayers,fetchedAt:new Date().toISOString()});
  }catch(e){
    res.status(502).json({error:e.message});
  }
});

app.use(express.static(path.join(__dirname,"public")));
app.use((_q,res)=>res.sendFile(path.join(__dirname,"public/index.html")));
app.listen(PORT,"0.0.0.0",()=>console.log(`Chopped Tracker on ${PORT}`));
