import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const LEAGUE_ID =
  process.env.SLEEPER_LEAGUE_ID || "1405228769190465536";

let playerCache = { at: 0, data: null };

async function sleeperApp(pathname) {
  const r = await fetch("https://api.sleeper.app/v1" + pathname);

  if (!r.ok) {
    throw Error(`Sleeper API ${r.status}`);
  }

  return r.json();
}

async function sleeperCom(pathname) {
  const r = await fetch("https://api.sleeper.com" + pathname);

  if (!r.ok) {
    throw Error(`Sleeper projections API ${r.status}`);
  }

  return r.json();
}

async function players() {
  if (
    playerCache.data &&
    Date.now() - playerCache.at < 10 * 60 * 1000
  ) {
    return playerCache.data;
  }

  playerCache.data = await sleeperApp("/players/nfl");
  playerCache.at = Date.now();

  return playerCache.data;
}

async function projections(season, week) {
  if (!season || !week || week < 1 || week > 18) {
    return {};
  }

  try {
    return await sleeperCom(
  `/projections/nfl/${season}/${week}?season_type=regular&position=QB&position=RB&position=WR&position=TE`
);
  } catch {
    return {};
  }
}

app.get("/api/data", async (_q, res) => {
  try {
    const league = await sleeperApp(`/league/${LEAGUE_ID}`);

    const [
      users,
      rosters,
      nflState,
      playerDirectory
    ] = await Promise.all([
      sleeperApp(`/league/${LEAGUE_ID}/users`),
      sleeperApp(`/league/${LEAGUE_ID}/rosters`),
      sleeperApp("/state/nfl"),
      players()
    ]);

    const weekly = {};

    for (let w = 2; w <= 18; w++) {
      try {
        weekly[w] = await sleeperApp(
          `/league/${LEAGUE_ID}/matchups/${w}`
        );
      } catch {
        weekly[w] = [];
      }
    }

    // Find every player that is actually relevant to this league.
    const ids = new Set();

    for (const week of Object.values(weekly)) {
      for (const matchup of week || []) {
        for (const id of matchup?.players || []) {
          ids.add(String(id));
        }

        for (const id of matchup?.starters || []) {
          ids.add(String(id));
        }

        for (const id of Object.keys(
          matchup?.players_points || {}
        )) {
          ids.add(String(id));
        }
      }
    }

    // Also include players currently on rosters.
    for (const roster of rosters || []) {
      for (const id of roster?.players || []) {
        ids.add(String(id));
      }
    }

    const relevantPlayers = {};

    for (const id of ids) {
      const p = playerDirectory?.[id];

      if (p) {
        relevantPlayers[id] = {
          full_name:
            p.full_name ||
            (p.first_name && p.last_name
              ? `${p.first_name} ${p.last_name}`
              : id),

          position: p.position || "—",

          team: p.team || "FA",

          status: p.status || null,

          injury_status: p.injury_status || null,

          fantasy_positions: p.fantasy_positions || []
        };
      }
    }

    /*
      PROJECTED CUT ODDS DATA

      We pull projections for the current NFL week and the
      following week. The front end can then combine:

        completed games -> actual points
        remaining games -> projected points

      This is refreshed whenever /api/data is called, so the
      projection data participates in the site's normal live
      refresh cycle.
    */

    const currentWeek = Number(nflState?.week || 0);
    const season = String(
      nflState?.season || league?.season || ""
    );

    const projectionWeeks = new Set();

    if (currentWeek >= 1 && currentWeek <= 18) {
      projectionWeeks.add(currentWeek);
    }

    if (currentWeek + 1 <= 18) {
      projectionWeeks.add(currentWeek + 1);
    }

    const projectionResults = {};

    await Promise.all(
      [...projectionWeeks].map(async (week) => {
        projectionResults[week] = await projections(
          season,
          week
        );
      })
    );

    // Only send projections for players actually relevant to
    // this league, keeping the response much smaller.
    const relevantProjections = {};

for (const [week, projectionData] of Object.entries(
  projectionResults
)) {
  relevantProjections[week] = {};

  for (const p of Array.isArray(projectionData)
    ? projectionData
    : []) {
    const id = String(p?.player_id || "");

    if (!ids.has(id)) continue;

    const stats = p?.stats || {};

    relevantProjections[week][id] = {
      pts_ppr: stats.pts_ppr ?? null,
      pts_half_ppr: stats.pts_half_ppr ?? null,
      pts_std: stats.pts_std ?? null
    };
      }
  }

    console.log("SCORING SETTINGS:", league?.scoring_settings);
    res.json({
      league,
      users,
      rosters,
      weekly,
      nflState,
      players: relevantPlayers,

      // New projection data for the projected cut-odds system.
      projections: relevantProjections,

      fetchedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(502).json({
      error: e.message
    });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.use((_q, res) =>
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  )
);

app.listen(PORT, "0.0.0.0", () =>
  console.log(`Chopped Tracker on ${PORT}`)
);
