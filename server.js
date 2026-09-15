import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __filename=fileURLToPath(import.meta.url), __dirname=path.dirname(__filename);
const app=express(), PORT=process.env.PORT||3000, LEAGUE_ID=process.env.SLEEPER_LEAGUE_ID||"1405228769190465536";
async function s(p){const r=await fetch("https://api.sleeper.app/v1"+p);if(!r.ok)throw Error(`Sleeper API ${r.status}`);return r.json()}
app.get("/api/data",async(_q,res)=>{try{
 const league=await s(`/league/${LEAGUE_ID}`), [users,rosters]=await Promise.all([s(`/league/${LEAGUE_ID}/users`),s(`/league/${LEAGUE_ID}/rosters`)]);
 const weekly={}; for(let w=2;w<=18;w++){try{weekly[w]=await s(`/league/${LEAGUE_ID}/matchups/${w}`)}catch{weekly[w]=[]}}
 res.json({league,users,rosters,weekly,fetchedAt:new Date().toISOString()})
}catch(e){res.status(502).json({error:e.message})}});
app.use(express.static(path.join(__dirname,"public")));
app.use((_q,res)=>res.sendFile(path.join(__dirname,"public/index.html")));
app.listen(PORT,()=>console.log(`Chopped Tracker on ${PORT}`));
