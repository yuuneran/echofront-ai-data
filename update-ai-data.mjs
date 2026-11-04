// このファイルは Server/tools/build-pages.mjs が作った（もとは Server/tools/pages-entry.mjs と Server/src/）。手で直さない。
// GitHub Pages 用のリポジトリのいちばん上にコピーして使う。使い方は Server/README.md。

// tools/pages-entry.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// src/schema.js
var SCHEMA_VERSION = 2;
var pct = (key, label, jitter2 = 4) => ({ key, label, unit: "%", kind: "number", scale: 10, min: 0, max: 100, jitter: jitter2 });
var FIELDS = [
  // ── 基本 ──（0〜5）
  { key: "match_minutes", label: "試合に出ていた時間", unit: "分", kind: "number", scale: 100, min: 0, max: 180, required: true, jitter: 0, agg: "count" },
  { key: "side", label: "攻めか守りか", unit: "0 攻め 1 守り", kind: "category", scale: 1, min: 0, max: 1, required: true },
  { key: "platform", label: "VR かデスクトップか", unit: "0 VR 1 デスクトップ", kind: "category", scale: 1, min: 0, max: 1, required: true },
  { key: "class_main", label: "いちばん長く使ったクラス", unit: "番号", kind: "category", scale: 1, min: 0, max: 7 },
  { key: "weapon_main", label: "いちばん長く使った武器", unit: "weaponId", kind: "category", scale: 1, min: 0, max: 31 },
  { key: "sight_main", label: "いちばん長く使った照準器", unit: "scopeId", kind: "category", scale: 1, min: 0, max: 15 },
  // ── 撃ち方 ──（6〜15）
  pct("accuracy", "命中率", 3),
  pct("headshot_rate", "頭に当たった割合", 3),
  { key: "reaction_ms", label: "見えてから撃ち始めるまで", unit: "ミリ秒", kind: "number", scale: 1, min: 0, max: 3e3, reject: { below: 100 }, jitter: 50 },
  pct("hold_near", "撃たない割合・近（20m まで）"),
  pct("hold_mid", "撃たない割合・中（20〜60m）"),
  pct("hold_far", "撃たない割合・遠（60m より遠く）"),
  { key: "engage_dist_m", label: "よく戦う距離", unit: "m", kind: "number", scale: 10, min: 0, max: 300, jitter: 5 },
  { key: "burst_near", label: "引き金 1 回の弾・近", unit: "発", kind: "number", scale: 10, min: 1, max: 200, jitter: 1 },
  { key: "burst_mid", label: "引き金 1 回の弾・中", unit: "発", kind: "number", scale: 10, min: 1, max: 200, jitter: 1 },
  { key: "burst_far", label: "引き金 1 回の弾・遠", unit: "発", kind: "number", scale: 10, min: 1, max: 200, jitter: 1 },
  // ── 動き方 ──（16〜23）
  pct("move_ratio", "動いている割合"),
  { key: "crouch_per_min", label: "しゃがむ回数", unit: "回/分", kind: "number", scale: 10, min: 0, max: 60, jitter: 1 },
  pct("move_while_shoot", "動きながら撃った割合"),
  pct("reload_at_pct", "リロードしたときの残り", 5),
  { key: "stop_sec", label: "1 回に止まる時間", unit: "秒", kind: "number", scale: 10, min: 0, max: 1800, jitter: 0.5 },
  { key: "move_sec", label: "1 回に動く時間", unit: "秒", kind: "number", scale: 10, min: 0, max: 1800, jitter: 1 },
  { key: "switch_per_min", label: "止まる・動くの切り替え", unit: "回/分", kind: "number", scale: 10, min: 0, max: 120, jitter: 1 },
  pct("retreat_rate", "傷ついたときに下がった割合"),
  // ── 体のさらし方 ──（24）
  pct("exposed_ratio", "敵から見えていた割合"),
  // ── 目標と仲間 ──（25〜31）
  pct("obj_time_ratio", "拠点にいた割合"),
  { key: "plants", label: "爆弾を置いた回数", unit: "回", kind: "number", scale: 1, min: 0, max: 50, jitter: 0, agg: "count" },
  { key: "defuses", label: "爆弾を解除した回数", unit: "回", kind: "number", scale: 1, min: 0, max: 50, jitter: 0, agg: "count" },
  { key: "front_pos", label: "味方の中での前後", unit: "0 後ろ 100 前", kind: "number", scale: 10, min: 0, max: 100, jitter: 4 },
  pct("squad_ratio", "分隊の仲間の近くにいた割合"),
  { key: "supplies", label: "補給の箱を置いた回数", unit: "回", kind: "number", scale: 1, min: 0, max: 200, jitter: 0, agg: "count" },
  pct("revive_rate", "蘇生する割合"),
  // ── 実力 ──（32〜34。近い強さの AI を選ぶのに使う。ずらさない）
  { key: "kills", label: "倒した数", unit: "人", kind: "number", scale: 1, min: 0, max: 300, required: true, jitter: 0, agg: "count" },
  { key: "deaths", label: "倒された数", unit: "回", kind: "number", scale: 1, min: 0, max: 300, required: true, jitter: 0, agg: "count" },
  { key: "kd", label: "K/D", unit: "—", kind: "number", scale: 100, min: 0, max: 300, jitter: 0 },
  // ── 結果 ──（35。攻める側と守る側の勝ちやすさを見る。AI の動きには使わない）
  { key: "won", label: "勝ち負け", unit: "0 負け 1 勝ち", kind: "category", scale: 1, min: 0, max: 1 }
];
function stepOf(field) {
  return 1 / field.scale;
}
function roundTo(value, step) {
  const decimals = step >= 1 ? 0 : Math.ceil(-Math.log10(step) - 1e-9);
  const f = 10 ** decimals;
  const s = Math.round(value / step) * step;
  return Math.round(s * f) / f;
}
function kdOf(kills, deaths) {
  return deaths > 0 ? kills / deaths : kills;
}
var STRENGTH_WEIGHTS = {
  kills_per_10min: 1,
  deaths_per_10min: -0.5,
  accuracy: 0.1,
  headshot_rate: 0.02
};
function strengthOf(stats) {
  const minutes = Math.max(stats.match_minutes ?? 0, 1);
  const w = STRENGTH_WEIGHTS;
  const s = w.kills_per_10min * ((stats.kills ?? 0) * 10) / minutes + w.deaths_per_10min * ((stats.deaths ?? 0) * 10) / minutes + w.accuracy * (stats.accuracy ?? 0) + w.headshot_rate * (stats.headshot_rate ?? 0);
  return Math.round(s * 100) / 100;
}
var SEED_UNTIL = 20;
var SEED_PROFILES = [
  {
    id: "seed-weak",
    stats: {
      match_minutes: 20,
      side: 0,
      platform: 0,
      class_main: 0,
      weapon_main: 0,
      sight_main: 0,
      accuracy: 12,
      headshot_rate: 6,
      reaction_ms: 900,
      hold_near: 10,
      hold_mid: 30,
      hold_far: 70,
      engage_dist_m: 25,
      burst_near: 8,
      burst_mid: 8,
      burst_far: 6,
      move_ratio: 40,
      crouch_per_min: 0,
      move_while_shoot: 20,
      reload_at_pct: 0,
      stop_sec: 6,
      move_sec: 6,
      switch_per_min: 5,
      retreat_rate: 10,
      exposed_ratio: 45,
      obj_time_ratio: 30,
      plants: 0,
      defuses: 0,
      front_pos: 50,
      squad_ratio: 30,
      supplies: 0,
      revive_rate: 10,
      kills: 4,
      deaths: 14,
      kd: 0.29,
      won: 0
    }
  },
  {
    id: "seed-normal",
    stats: {
      match_minutes: 20,
      side: 0,
      platform: 0,
      class_main: 0,
      weapon_main: 0,
      sight_main: 1,
      accuracy: 22,
      headshot_rate: 12,
      reaction_ms: 500,
      hold_near: 5,
      hold_mid: 20,
      hold_far: 50,
      engage_dist_m: 35,
      burst_near: 6,
      burst_mid: 4,
      burst_far: 3,
      move_ratio: 55,
      crouch_per_min: 2,
      move_while_shoot: 35,
      reload_at_pct: 25,
      stop_sec: 4,
      move_sec: 8,
      switch_per_min: 8,
      retreat_rate: 30,
      exposed_ratio: 35,
      obj_time_ratio: 40,
      plants: 1,
      defuses: 1,
      front_pos: 50,
      squad_ratio: 45,
      supplies: 2,
      revive_rate: 30,
      kills: 12,
      deaths: 10,
      kd: 1.2,
      won: 0
    }
  },
  {
    id: "seed-strong",
    stats: {
      match_minutes: 20,
      side: 0,
      platform: 0,
      class_main: 0,
      weapon_main: 0,
      sight_main: 1,
      accuracy: 32,
      headshot_rate: 20,
      reaction_ms: 300,
      hold_near: 2,
      hold_mid: 10,
      hold_far: 35,
      engage_dist_m: 45,
      burst_near: 5,
      burst_mid: 3,
      burst_far: 2,
      move_ratio: 65,
      crouch_per_min: 4,
      move_while_shoot: 50,
      reload_at_pct: 40,
      stop_sec: 3,
      move_sec: 9,
      switch_per_min: 11,
      retreat_rate: 50,
      exposed_ratio: 28,
      obj_time_ratio: 50,
      plants: 2,
      defuses: 2,
      front_pos: 60,
      squad_ratio: 55,
      supplies: 4,
      revive_rate: 50,
      kills: 24,
      deaths: 7,
      kd: 3.43,
      won: 0
    }
  }
];

// src/validate.js
var ENOUGH_KILLS = 5;
var RULES = [
  {
    name: "too_short",
    label: "試合に出ていた時間が 4 分より短い（成績として当てにならない）",
    test: (s) => s.match_minutes < 4
  },
  {
    name: "deaths_per_min",
    label: "1 分に 4 回より多く倒されている（出撃の待ち時間があるので出せない）",
    test: (s) => s.deaths / s.match_minutes > 4
  },
  {
    name: "accuracy",
    label: `${ENOUGH_KILLS} 人以上倒して、命中率が 85% より高い`,
    test: (s) => s.kills >= ENOUGH_KILLS && (s.accuracy ?? 0) > 85
  },
  {
    name: "headshot",
    label: `${ENOUGH_KILLS} 人以上倒して、当たったうち 90% より多くが頭`,
    test: (s) => s.kills >= ENOUGH_KILLS && (s.headshot_rate ?? 0) > 90
  },
  {
    name: "kd",
    label: "K/D が、倒した数と倒された数から出した値と合わない",
    test: (s) => s.kd != null && Math.abs(s.kd - kdOf(s.kills, s.deaths)) > 0.02
  }
];
function validateStats(stats) {
  for (const f of FIELDS) {
    if (f.required && stats[f.key] == null) return { ok: false, reason: "missing" };
  }
  for (const f of FIELDS) {
    const v = stats[f.key];
    if (v == null) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < f.min || v > f.max) return { ok: false, reason: `extreme_${f.key}` };
    if (f.reject?.below != null && v < f.reject.below) return { ok: false, reason: `extreme_${f.key}` };
    if (f.reject?.above != null && v > f.reject.above) return { ok: false, reason: `extreme_${f.key}` };
  }
  for (const r of RULES) {
    if (r.test(stats)) return { ok: false, reason: `extreme_${r.name}` };
  }
  return { ok: true };
}

// src/random.js
function seedFrom(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
function makeRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// src/codes.js
var ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function isCode(text) {
  return typeof text === "string" && text.length === 8 && [...text].every((c) => ALPHABET.includes(c));
}

// src/worldver.js
function parts(ver) {
  return String(ver ?? "").match(/\d+|[^\d.]+/g) ?? [];
}
function compareWorldVer(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (i >= x.length) return -1;
    if (i >= y.length) return 1;
    const p = x[i];
    const q = y[i];
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      const d = Number(p) - Number(q);
      if (d !== 0) return d;
    } else if (pn !== qn) {
      return pn ? 1 : -1;
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return 0;
}
function atLeastVer(ver, minVer) {
  if (minVer == null || minVer === "") return true;
  return compareWorldVer(ver, minVer) >= 0;
}

// src/aggregate.js
var OUTPUT_FORMAT = 2;
var MAX_DISPLAY_NAME = 32;
var DEFAULT_OPTIONS = {
  targetProfiles: 64,
  // これより少なければ、ずらしで増やす（AI は最大 31 体なので、その倍ほど）
  maxProfiles: 300,
  // これより多ければ、強さの順に間引く（JSON を大きくしすぎない）
  maxCopiesPerSource: 16,
  // 1 人の成績から作る数の上限（元 1 ＋ ずらし 15）
  seedUntil: SEED_UNTIL,
  minWorldVer: ""
  // この版以降に遊んだ試合だけ使う（空なら全部）
};
function clamp(f, v) {
  return Math.min(f.max, Math.max(f.min, v));
}
function combineMatches(matches) {
  const out = {};
  for (const f of FIELDS) {
    const rows = matches.filter((m) => m.stats[f.key] != null);
    if (rows.length === 0) continue;
    if (f.kind === "category") {
      const tally = /* @__PURE__ */ new Map();
      for (const m of rows) {
        const v = m.stats[f.key];
        const t = tally.get(v) ?? { n: 0, minutes: 0 };
        t.n++;
        t.minutes += m.stats.match_minutes ?? 0;
        tally.set(v, t);
      }
      let best = null;
      for (const [v, t] of tally) {
        if (!best || t.n > best.t.n || t.n === best.t.n && (t.minutes > best.t.minutes || t.minutes === best.t.minutes && v < best.v)) {
          best = { v, t };
        }
      }
      out[f.key] = best.v;
    } else if (f.agg === "count") {
      out[f.key] = clamp(f, roundTo(rows.reduce((a, m) => a + m.stats[f.key], 0) / rows.length, stepOf(f)));
    } else {
      let sum = 0;
      let weight = 0;
      for (const m of rows) {
        const w = Math.max(m.stats.match_minutes ?? 0, 0.01);
        sum += m.stats[f.key] * w;
        weight += w;
      }
      out[f.key] = clamp(f, roundTo(sum / weight, stepOf(f)));
    }
  }
  if (out.kills != null && out.deaths != null) {
    const f = FIELDS.find((x) => x.key === "kd");
    out.kd = clamp(f, roundTo(kdOf(out.kills, out.deaths), stepOf(f)));
  }
  return out;
}
function aggregate(records, options = {}) {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const now = opt.now ?? Date.now();
  const minWorldVer = opt.minWorldVer || "";
  const real = records.filter((r) => atLeastVer(r.worldVer ?? "", minWorldVer) && validateStats(r.stats).ok);
  const worldVers = {};
  for (const r of real) worldVers[r.worldVer ?? ""] = (worldVers[r.worldVer ?? ""] ?? 0) + 1;
  const groups = /* @__PURE__ */ new Map();
  for (const r of real) {
    const key = r.code ?? `m${r.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const players = [...groups.entries()].sort(([a], [b]) => cmpId(a, b)).map(([key, rows]) => {
    const latest = [...rows].sort((a, b) => cmpNum(b.id, a.id)).find((r) => typeof r.name === "string" && r.name);
    return {
      key,
      code: isCode(key) ? key : null,
      name: latest ? latest.name.slice(0, MAX_DISPLAY_NAME) : null,
      n: rows.length,
      stats: combineMatches(rows)
    };
  });
  const medianSource = players.length > 0 ? players.map((p) => p.stats) : SEED_PROFILES.map((s) => s.stats);
  const medians = {};
  for (const f of FIELDS) {
    const vals = medianSource.map((s) => s[f.key]).filter((v) => v != null).sort((a, b) => a - b);
    if (vals.length === 0) medians[f.key] = f.kind === "category" ? f.min : SEED_PROFILES[1].stats[f.key];
    else if (f.kind === "category") medians[f.key] = mostFrequent(vals);
    else medians[f.key] = clamp(f, roundTo(median(vals), stepOf(f)));
  }
  const fill = (stats) => {
    const out2 = {};
    for (const f of FIELDS) out2[f.key] = stats[f.key] ?? medians[f.key];
    return out2;
  };
  let bases = players.map((p) => ({ id: p.key, kind: "real", code: p.code, name: p.name, n: p.n, stats: fill(p.stats) }));
  if (bases.length > opt.maxProfiles) {
    bases.sort((a, b) => strengthOf(a.stats) - strengthOf(b.stats) || cmpId(a.id, b.id));
    const picked = [];
    for (let i = 0; i < opt.maxProfiles; i++) {
      picked.push(bases[Math.floor(i * (bases.length - 1) / (opt.maxProfiles - 1))]);
    }
    bases = picked;
  }
  const seedUsed = players.length < opt.seedUntil;
  if (seedUsed) {
    for (const s of SEED_PROFILES) bases.push({ id: s.id, kind: "seed", code: null, name: null, n: 0, stats: fill(s.stats) });
  }
  const profiles = [];
  const copies = Math.min(opt.maxCopiesPerSource, Math.max(1, Math.ceil(opt.targetProfiles / Math.max(bases.length, 1))));
  for (const b of bases) {
    profiles.push({ ...b, src: b.id });
    for (let n = 1; n < copies; n++) {
      profiles.push({ ...b, id: `${b.id}~${n}`, src: b.id, kind: "variant", stats: jitter(b.stats, `${b.id}~${n}`) });
    }
  }
  const out = profiles.map((p) => ({ ...p, strength: strengthOf(p.stats) })).sort((a, b) => a.strength - b.strength || cmpId(a.id, b.id)).map((p) => {
    const o = { id: p.id, src: p.src, kind: p.kind };
    if (p.code) o.code = p.code;
    if (p.name) o.name = p.name;
    o.strength = p.strength;
    o.v = FIELDS.map((f) => p.stats[f.key]);
    return o;
  });
  const weak = SEED_PROFILES.find((s) => s.id === "seed-weak");
  const practice = { id: weak.id, strength: strengthOf(weak.stats), v: FIELDS.map((f) => weak.stats[f.key]) };
  const body = {
    format: OUTPUT_FORMAT,
    schema: SCHEMA_VERSION,
    fields: FIELDS.map((f) => f.key),
    strengthWeights: STRENGTH_WEIGHTS,
    minWorldVer,
    worldVers: Object.fromEntries(Object.entries(worldVers).sort(([a], [b]) => cmpId(a, b))),
    realCount: players.length,
    matchCount: real.length,
    seedUsed,
    profileCount: out.length,
    profiles: out,
    practice
  };
  return {
    format: body.format,
    schema: body.schema,
    generatedAt: new Date(now).toISOString(),
    dataHash: seedFrom(JSON.stringify(body)).toString(16).padStart(8, "0"),
    ...body
  };
}
function jitter(stats, seedText) {
  const rnd = makeRandom(seedFrom(seedText));
  const out = { ...stats };
  for (const f of FIELDS) {
    if (f.kind !== "number" || !f.jitter) continue;
    const step = stepOf(f);
    const delta = (rnd() * 2 - 1) * f.jitter;
    let v = roundTo(stats[f.key] + delta, step);
    let lo = f.min;
    let hi = f.max;
    if (f.reject?.below != null) lo = Math.max(lo, f.reject.below);
    if (f.reject?.above != null) hi = Math.min(hi, f.reject.above);
    if (v < lo) v = lo;
    if (v > hi) v = hi;
    out[f.key] = v;
  }
  return out;
}
function median(sorted) {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}
function mostFrequent(sorted) {
  let best = sorted[0];
  let bestN = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j] === sorted[i]) j++;
    if (j - i > bestN) {
      best = sorted[i];
      bestN = j - i;
    }
    i = j;
  }
  return best;
}
function cmpId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function cmpNum(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  return cmpId(String(a), String(b));
}
function checkOutput(json) {
  const problems = [];
  if (json?.format !== OUTPUT_FORMAT) problems.push("format が違う");
  if (json?.schema !== SCHEMA_VERSION) problems.push("schema が違う");
  if (!Array.isArray(json?.fields) || json.fields.join(",") !== FIELDS.map((f) => f.key).join(",")) problems.push("fields が違う");
  if (!Array.isArray(json?.profiles) || json.profiles.length === 0) problems.push("profiles が空");
  for (const p of json?.profiles ?? []) {
    if (!Array.isArray(p.v) || p.v.length !== FIELDS.length) {
      problems.push(`${p.id}: 値の数が違う`);
      continue;
    }
    FIELDS.forEach((f, i) => {
      const v = p.v[i];
      if (typeof v !== "number" || !Number.isFinite(v)) problems.push(`${p.id}: ${f.key} が数でない`);
      else if (v < f.min || v > f.max) problems.push(`${p.id}: ${f.key}=${v} が範囲の外`);
    });
    if (!["real", "variant", "seed"].includes(p.kind)) problems.push(`${p.id}: kind が違う`);
    if ("code" in p && !isCode(p.code)) problems.push(`${p.id}: 記録コードの形が違う`);
    if (p.kind === "seed" && ("code" in p || "name" in p)) problems.push(`${p.id}: 種の成績に記録コードや名前がある`);
    if ("name" in p && (typeof p.name !== "string" || p.name.length === 0 || p.name.length > MAX_DISPLAY_NAME)) {
      problems.push(`${p.id}: 名前の形が違う`);
    }
  }
  for (let i = 1; i < (json?.profiles?.length ?? 0); i++) {
    if (json.profiles[i - 1].strength > json.profiles[i].strength) problems.push("強さの順になっていない");
  }
  if (!Array.isArray(json?.practice?.v) || json.practice.v.length !== FIELDS.length) problems.push("practice が違う");
  return problems;
}

// tools/pages-entry.mjs
var MAX_BYTES = 512 * 1024;
async function run({ url, token, out, now = Date.now(), minWorldVer = "" }) {
  if (!url || !token) throw new Error("STATS_URL と STATS_EXPORT_TOKEN を設定する");
  const q = minWorldVer ? `?minVer=${encodeURIComponent(minWorldVer)}` : "";
  const res = await fetch(`${url.replace(/\/+$/, "")}/v2/export/matches.json${q}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`取り出せなかった（${res.status}）`);
  const raw = await res.json();
  if (raw?.format !== 2 || !Array.isArray(raw.matches)) throw new Error("取り出した成績の形がおかしい");
  const json = aggregate(raw.matches, { now, minWorldVer });
  const problems = checkOutput(json);
  if (problems.length) throw new Error("作った JSON の形がおかしい: " + problems.slice(0, 5).join("・"));
  const text = JSON.stringify(json) + "\n";
  if (text.length > MAX_BYTES) throw new Error(`大きすぎる（${text.length} 文字）`);
  if (existsSync(out)) {
    try {
      if (JSON.parse(readFileSync(out, "utf8")).dataHash === json.dataHash) return { changed: false, json };
    } catch {
    }
  }
  writeFileSync(out, text);
  return { changed: true, json };
}
async function main() {
  const i = process.argv.indexOf("--out");
  const out = resolve(i >= 0 ? process.argv[i + 1] : "ai-profiles.json");
  const v = process.argv.indexOf("--min-ver");
  const minWorldVer = (v >= 0 ? process.argv[v + 1] : process.env.STATS_MIN_WORLD_VER) ?? "";
  try {
    const r = await run({ url: process.env.STATS_URL, token: process.env.STATS_EXPORT_TOKEN, out, minWorldVer });
    console.log(
      r.changed ? `書き換えた: 本物の成績 ${r.json.realCount} 人（${r.json.matchCount} 試合${minWorldVer ? `・版 ${minWorldVer} 以降` : ""}）・AI の動きのデータ ${r.json.profileCount} 件 → ${out}` : "中身は変わっていないので、書き換えなかった"
    );
  } catch (e) {
    console.error(`失敗: ${e.message}`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
export {
  MAX_BYTES,
  run
};
