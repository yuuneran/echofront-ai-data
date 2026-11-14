// このファイルは Server/tools/build-pages.mjs が作った（もとは Server/tools/pages-entry.mjs と Server/src/）。手で直さない。
// GitHub Pages 用のリポジトリのいちばん上にコピーして使う。使い方は Server/README.md。

// tools/pages-entry.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// src/schema.js
var PROFILE_SCHEMA = 9;
var pct = (key, label, jitter2 = 4) => ({ key, label, unit: "%", kind: "number", scale: 10, min: 0, max: 100, jitter: jitter2 });
var count = (key, label, unit, max) => ({ key, label, unit, kind: "number", scale: 1, min: 0, max, jitter: 0, agg: "count", recordOnly: true });
var veh = (key, label, unit, scale, max, agg) => ({ key, label, unit, kind: "number", scale, min: 0, max, jitter: 0, keepNull: true, ...agg ? { agg } : {} });
var vehCount = (key, label, unit, max) => veh(key, label, unit, 1, max, "count");
var POS_CELLS = 512;
var POS_MAX_SHARE = 100;
var POS_SECTORS = 3;
var POS_PER_SECTOR = 4;
var posKey = (s, n) => `pos_s${s}_${n}`;
function posParts(v) {
  const cell = v % POS_CELLS;
  return { share: Math.floor(v / POS_CELLS), cell, ix: Math.floor(cell / 32), iy: cell % 32 };
}
var posValue = (share2, cell) => share2 * POS_CELLS + cell;
var pos = (s, n) => ({ key: posKey(s, n), label: `セクター ${s} でよくいた升 ${n}（割合×512＋升の番号）`, unit: "割合×512＋升", kind: "position", scale: 1, min: 0, max: posValue(POS_MAX_SHARE, POS_CELLS - 1), sector: s });
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
  { key: "won", label: "勝ち負け", unit: "0 負け 1 勝ち", kind: "category", scale: 1, min: 0, max: 1 },
  // ── MMR の計算のもと ──（36〜39。schema 3 から。SPEC-v2.md の 8 章。近い AI がいない試合は 36・38 が「成績がない」、37・39 が 0）
  { key: "gun_ai_mmr", label: "近い AI の撃ち合い MMR", unit: "MMR", kind: "number", scale: 1, min: 0, max: 9999, jitter: 0 },
  pct("gun_near_pct", "撃ち合いのうち近い AI との割合", 0),
  { key: "act_ai_mmr", label: "近い AI の行動 MMR", unit: "MMR", kind: "number", scale: 1, min: 0, max: 9999, jitter: 0 },
  pct("act_near_pct", "試合の AI のうち行動 MMR が近い割合", 0),
  // ── 回数（分母）──（40〜55。schema 4 から。ここから下は記録だけで、配布のファイルには入れない）
  count("shots_near", "撃った弾・近（20m まで）", "発", 6e4),
  count("shots_mid", "撃った弾・中（20〜60m）", "発", 6e4),
  count("shots_far", "撃った弾・遠（60m より遠く）", "発", 6e4),
  count("hits_near", "当たった弾・近", "発", 6e4),
  count("hits_mid", "当たった弾・中", "発", 6e4),
  count("hits_far", "当たった弾・遠", "発", 6e4),
  count("reaction_count", "反応の時間を測った回数", "回", 5e3),
  count("seen_near", "見かけた回数・近", "回", 5e3),
  count("seen_mid", "見かけた回数・中", "回", 5e3),
  count("seen_far", "見かけた回数・遠", "回", 5e3),
  count("pulls_near", "引き金の回数・近", "回", 3e4),
  count("pulls_mid", "引き金の回数・中", "回", 3e4),
  count("pulls_far", "引き金の回数・遠", "回", 3e4),
  count("hurt_count", "傷ついた回数", "回", 5e3),
  count("revive_chances", "蘇生できた場面の回数", "回", 1e3),
  count("career_matches", "通算の試合数（この試合を含む）", "試合", 6e4),
  // ── 試合の状況 ──（56〜61）
  { key: "map_id", label: "マップの番号", unit: "番号", kind: "category", scale: 1, min: 0, max: 255, recordOnly: true },
  { key: "mode_id", label: "モードの番号", unit: "番号", kind: "category", scale: 1, min: 0, max: 255, recordOnly: true },
  count("humans", "試合の人間の数（いちばん多いとき）", "人", 100),
  count("ais", "試合の AI の数（いちばん多いとき）", "体", 100),
  count("idle_sec", "放置の秒数", "秒", 10800),
  count("self_kills", "自爆の回数", "回", 300),
  // ── 動きが変わる項目 ──（62〜68）
  count("hit_react_ms", "撃たれてから撃ち返すまで", "ミリ秒", 5e3),
  count("hit_react_count", "撃たれてから撃ち返すまでを測った回数", "回", 5e3),
  count("first_hit_ms", "撃ち始めてから初弾が当たるまで", "ミリ秒", 3e3),
  count("first_hit_count", "撃ち始めてから初弾が当たるまでを測った回数", "回", 5e3),
  count("reaction_sd_ms", "見えてから撃ち始めるまでのばらつき", "ミリ秒", 3e3),
  { key: "stop_sd_sec", label: "1 回に止まる時間のばらつき", unit: "秒", kind: "number", scale: 10, min: 0, max: 1800, jitter: 0, recordOnly: true },
  { key: "move_sd_sec", label: "1 回に動く時間のばらつき", unit: "秒", kind: "number", scale: 10, min: 0, max: 1800, jitter: 0, recordOnly: true },
  // ── ガジェット ──（69〜71。schema 5 から。配布のファイルにも入れる。0 は「使っていない」）
  { key: "gadget_1", label: "いちばんよく使ったガジェット", unit: "gadgetId", kind: "category", scale: 1, min: 0, max: 63 },
  { key: "gadget_2", label: "2 番目によく使ったガジェット", unit: "gadgetId", kind: "category", scale: 1, min: 0, max: 63 },
  { key: "gadget_uses", label: "ガジェットを使った回数（全部の合計）", unit: "回", kind: "number", scale: 1, min: 0, max: 500, jitter: 0, agg: "count" },
  // ── 乗り物 ──（72〜82。schema 6 から。72〜74 は schema 9 から配布のファイルにも入れる（v の後ろ）。ほかは記録して成績の表で見るだけ）
  // veh_kills は kills（32 番）に入らない。歩兵の成績が乗り物で歪まないように分ける
  vehCount("veh_drive_sec", "運転・操縦していた秒数", "秒", 3600),
  vehCount("veh_gun_sec", "砲手席の秒数", "秒", 3600),
  vehCount("veh_ride_sec", "そのほかの席の秒数", "秒", 3600),
  { key: "veh_kills", label: "乗り物で倒した数（kills には入らない）", unit: "回", kind: "number", scale: 1, min: 0, max: 500, jitter: 0, recordOnly: true },
  { key: "veh_destroy_car", label: "輸送車を壊した数", unit: "回", kind: "number", scale: 1, min: 0, max: 100, jitter: 0, recordOnly: true },
  { key: "veh_destroy_tank", label: "戦車を壊した数", unit: "回", kind: "number", scale: 1, min: 0, max: 100, jitter: 0, recordOnly: true },
  { key: "veh_destroy_heli", label: "ヘリを壊した数", unit: "回", kind: "number", scale: 1, min: 0, max: 100, jitter: 0, recordOnly: true },
  { key: "veh_repairs", label: "乗り物を直した回数", unit: "回", kind: "number", scale: 1, min: 0, max: 500, jitter: 0, recordOnly: true },
  { key: "veh_deaths", label: "乗っていて死亡した回数", unit: "回", kind: "number", scale: 1, min: 0, max: 200, jitter: 0, recordOnly: true },
  { key: "veh_deploys", label: "乗り物から出撃した回数", unit: "回", kind: "number", scale: 1, min: 0, max: 200, jitter: 0, recordOnly: true },
  { key: "veh_bailouts", label: "パラシュートを開いた回数", unit: "回", kind: "number", scale: 1, min: 0, max: 200, jitter: 0, recordOnly: true },
  // ── ヘリの飛び方と乗り物の武器 ──（83〜91。schema 6 から。有識者の意見。83〜88・91 は schema 9 から配布のファイルにも入れる（v の後ろ）。89・90 は記録だけ）
  veh("heli_alt_m", "ヘリの平均の高さ", "m", 1, 1e3),
  veh("heli_speed", "ヘリの平均の速さ", "m/秒", 10, 200),
  veh("heli_speed_sd", "ヘリの速さのばらつき", "m/秒", 10, 200),
  veh("heli_turn_keep_pct", "旋回中の速度維持（旋回中の速さ ÷ 直進中の速さ）", "%", 1, 1e3),
  veh("heli_reversals_min", "1 分あたりの左右の切り返し", "回/分", 10, 240),
  vehCount("veh_crashes", "敵に撃たれずに壊した回数", "回", 100),
  { key: "veh_shots_main", label: "主砲とロケットを撃った数", unit: "発", kind: "number", scale: 1, min: 0, max: 500, jitter: 0, recordOnly: true },
  { key: "veh_shots_mg", label: "乗り物の機関銃を撃った数", unit: "発", kind: "number", scale: 1, min: 0, max: 5e3, jitter: 0, recordOnly: true },
  veh("veh_hit_pct", "乗り物の武器の命中率", "%", 10, 100),
  // ── 乗り物の装備 ──（92〜97。schema 7 から。配布のファイルにも入れる。AI の運転手が同じ物を使う）
  { key: "gear_tank_main", label: "戦車の主武器（番号＋1。0 は使っていない）", unit: "gearId", kind: "category", scale: 1, min: 0, max: 63, ignoreZero: true },
  { key: "gear_tank_sub", label: "戦車の副武器（番号＋1。0 は使っていない）", unit: "gearId", kind: "category", scale: 1, min: 0, max: 63, ignoreZero: true },
  { key: "gear_tank_cm", label: "戦車の対抗手段（番号＋1。0 は使っていない）", unit: "gearId", kind: "category", scale: 1, min: 0, max: 63, ignoreZero: true },
  { key: "gear_heli_main", label: "ヘリの主武器（番号＋1。0 は使っていない）", unit: "gearId", kind: "category", scale: 1, min: 0, max: 63, ignoreZero: true },
  { key: "gear_heli_sub", label: "ヘリの副武器（番号＋1。0 は使っていない）", unit: "gearId", kind: "category", scale: 1, min: 0, max: 63, ignoreZero: true },
  { key: "gear_heli_cm", label: "ヘリの対抗手段（番号＋1。0 は使っていない）", unit: "gearId", kind: "category", scale: 1, min: 0, max: 63, ignoreZero: true },
  // ── よくいた場所 ──（98〜109。schema 8 から。値 = 割合 × 512 ＋ 升の番号。配布のファイルには v でなく pos に入れる）
  pos(1, 1),
  pos(1, 2),
  pos(1, 3),
  pos(1, 4),
  pos(2, 1),
  pos(2, 2),
  pos(2, 3),
  pos(2, 4),
  pos(3, 1),
  pos(3, 2),
  pos(3, 3),
  pos(3, 4),
  // ── 乗り物の AI 用の記録 ──（110〜127。schema 9 から。SPEC-v2.md の 14 章。配布のファイルにも入れる（v の後ろ））
  vehCount("veh_car_sec", "輸送車に乗っていた秒数（どの席でも）", "秒", 3600),
  vehCount("veh_tank_sec", "戦車に乗っていた秒数（どの席でも）", "秒", 3600),
  vehCount("veh_heli_sec", "ヘリに乗っていた秒数（どの席でも）", "秒", 3600),
  vehCount("heli_pilot_sec", "ヘリを操縦していた秒数", "秒", 3600),
  veh("tank_retreat_rate", "戦車の HP が 4 割を切ったときに下がった割合", "%", 10, 100),
  vehCount("tank_retreat_count", "戦車が下がったかを確かめた回数", "回", 200),
  veh("heli_hover_pct", "ヘリが空中で止まっていた割合（秒速 2m より遅い）", "%", 10, 100),
  veh("heli_alt_sd", "ヘリの高さのばらつき", "m", 10, 1e3),
  veh("heli_flare_ms", "ミサイルの知らせからフレアを撒くまで", "ミリ秒", 1, 1e4),
  vehCount("heli_flare_count", "フレアを撒くまでを測った回数", "回", 500),
  veh("heli_rockets_burst", "ヘリのロケットを 1 回に撃つ数", "発", 10, 100),
  veh("heli_fire_dist_m", "ヘリの武器を撃った距離", "m", 1, 500),
  veh("heli_retreat_rate", "ヘリの HP が 4 割を切ったときに離れた割合", "%", 10, 100),
  vehCount("heli_retreat_count", "ヘリが離れたかを確かめた回数", "回", 200),
  vehCount("heli_death_aa", "操縦しているヘリが対空砲で壊された回数", "回", 100),
  vehCount("heli_death_stinger", "操縦しているヘリがスティンガーで壊された回数", "回", 100),
  vehCount("heli_death_crash", "操縦しているヘリが墜落した回数", "回", 100),
  vehCount("heli_death_other", "操縦しているヘリがそのほかで壊された回数", "回", 100)
];
var POS_FIELDS = FIELDS.filter((f) => f.kind === "position");
var PROFILE_APPENDED_KEYS = [
  "veh_drive_sec",
  "veh_gun_sec",
  "veh_ride_sec",
  "heli_alt_m",
  "heli_speed",
  "heli_speed_sd",
  "heli_turn_keep_pct",
  "heli_reversals_min",
  "veh_crashes",
  "veh_hit_pct",
  "veh_car_sec",
  "veh_tank_sec",
  "veh_heli_sec",
  "heli_pilot_sec",
  "tank_retreat_rate",
  "tank_retreat_count",
  "heli_hover_pct",
  "heli_alt_sd",
  "heli_flare_ms",
  "heli_flare_count",
  "heli_rockets_burst",
  "heli_fire_dist_m",
  "heli_retreat_rate",
  "heli_retreat_count",
  "heli_death_aa",
  "heli_death_stinger",
  "heli_death_crash",
  "heli_death_other"
];
var PROFILE_FIELDS = [
  ...FIELDS.filter((f) => !f.recordOnly && f.kind !== "position" && !PROFILE_APPENDED_KEYS.includes(f.key)),
  ...PROFILE_APPENDED_KEYS.map((key) => FIELDS.find((f) => f.key === key))
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
var SEED_UNTIL = 20;
var SEED_PROFILES = [
  {
    id: "seed-weak",
    mmr: 1e3,
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
      front_pos: 35,
      squad_ratio: 30,
      supplies: 0,
      revive_rate: 10,
      kills: 4,
      deaths: 14,
      kd: 0.29,
      won: 0,
      gun_ai_mmr: 1e3,
      gun_near_pct: 100,
      act_ai_mmr: 1e3,
      act_near_pct: 100,
      gadget_1: 0,
      gadget_2: 0,
      gadget_uses: 3,
      gear_tank_main: 0,
      gear_tank_sub: 0,
      gear_tank_cm: 0,
      gear_heli_main: 0,
      gear_heli_sub: 0,
      gear_heli_cm: 0
    }
  },
  {
    id: "seed-1250",
    mmr: 1250,
    stats: {
      match_minutes: 20,
      side: 0,
      platform: 0,
      class_main: 0,
      weapon_main: 0,
      sight_main: 0,
      accuracy: 17,
      headshot_rate: 9,
      reaction_ms: 700,
      hold_near: 8,
      hold_mid: 25,
      hold_far: 60,
      engage_dist_m: 30,
      burst_near: 7,
      burst_mid: 6,
      burst_far: 4.5,
      move_ratio: 48,
      crouch_per_min: 1,
      move_while_shoot: 28,
      reload_at_pct: 12,
      stop_sec: 5,
      move_sec: 7,
      switch_per_min: 6.5,
      retreat_rate: 20,
      exposed_ratio: 40,
      obj_time_ratio: 35,
      plants: 0,
      defuses: 0,
      front_pos: 44,
      squad_ratio: 38,
      supplies: 1,
      revive_rate: 20,
      kills: 8,
      deaths: 12,
      kd: 0.67,
      won: 0,
      gun_ai_mmr: 1250,
      gun_near_pct: 100,
      act_ai_mmr: 1250,
      act_near_pct: 100,
      gadget_1: 0,
      gadget_2: 0,
      gadget_uses: 5,
      gear_tank_main: 0,
      gear_tank_sub: 0,
      gear_tank_cm: 0,
      gear_heli_main: 0,
      gear_heli_sub: 0,
      gear_heli_cm: 0
    }
  },
  {
    id: "seed-normal",
    mmr: 1500,
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
      won: 0,
      gun_ai_mmr: 1500,
      gun_near_pct: 100,
      act_ai_mmr: 1500,
      act_near_pct: 100,
      gadget_1: 0,
      gadget_2: 0,
      gadget_uses: 6,
      gear_tank_main: 0,
      gear_tank_sub: 0,
      gear_tank_cm: 0,
      gear_heli_main: 0,
      gear_heli_sub: 0,
      gear_heli_cm: 0
    }
  },
  {
    id: "seed-1750",
    mmr: 1750,
    stats: {
      match_minutes: 20,
      side: 0,
      platform: 0,
      class_main: 0,
      weapon_main: 0,
      sight_main: 1,
      accuracy: 27,
      headshot_rate: 16,
      reaction_ms: 400,
      hold_near: 3,
      hold_mid: 15,
      hold_far: 42,
      engage_dist_m: 40,
      burst_near: 5.5,
      burst_mid: 3.5,
      burst_far: 2.5,
      move_ratio: 60,
      crouch_per_min: 3,
      move_while_shoot: 42,
      reload_at_pct: 32,
      stop_sec: 3.5,
      move_sec: 8.5,
      switch_per_min: 9.5,
      retreat_rate: 40,
      exposed_ratio: 31,
      obj_time_ratio: 45,
      plants: 1,
      defuses: 1,
      front_pos: 56,
      squad_ratio: 50,
      supplies: 3,
      revive_rate: 40,
      kills: 18,
      deaths: 8,
      kd: 2.25,
      won: 0,
      gun_ai_mmr: 1750,
      gun_near_pct: 100,
      act_ai_mmr: 1750,
      act_near_pct: 100,
      gadget_1: 0,
      gadget_2: 0,
      gadget_uses: 8,
      gear_tank_main: 0,
      gear_tank_sub: 0,
      gear_tank_cm: 0,
      gear_heli_main: 0,
      gear_heli_sub: 0,
      gear_heli_cm: 0
    }
  },
  {
    id: "seed-strong",
    mmr: 2e3,
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
      front_pos: 62,
      squad_ratio: 55,
      supplies: 4,
      revive_rate: 50,
      kills: 24,
      deaths: 7,
      kd: 3.43,
      won: 0,
      gun_ai_mmr: 2e3,
      gun_near_pct: 100,
      act_ai_mmr: 2e3,
      act_near_pct: 100,
      gadget_1: 0,
      gadget_2: 0,
      gadget_uses: 10,
      gear_tank_main: 0,
      gear_tank_sub: 0,
      gear_tank_cm: 0,
      gear_heli_main: 0,
      gear_heli_sub: 0,
      gear_heli_cm: 0
    }
  }
];
var PRACTICE_PROFILE = {
  id: "practice-750",
  mmr: 750,
  stats: {
    match_minutes: 20,
    side: 0,
    platform: 0,
    class_main: 0,
    weapon_main: 0,
    sight_main: 0,
    accuracy: 8,
    headshot_rate: 3,
    reaction_ms: 1100,
    hold_near: 15,
    hold_mid: 40,
    hold_far: 80,
    engage_dist_m: 20,
    burst_near: 9,
    burst_mid: 9,
    burst_far: 7,
    move_ratio: 35,
    crouch_per_min: 0,
    move_while_shoot: 15,
    reload_at_pct: 0,
    stop_sec: 7,
    move_sec: 5,
    switch_per_min: 4,
    retreat_rate: 5,
    exposed_ratio: 50,
    obj_time_ratio: 25,
    plants: 0,
    defuses: 0,
    front_pos: 30,
    squad_ratio: 25,
    supplies: 0,
    revive_rate: 5,
    kills: 2,
    deaths: 16,
    kd: 0.13,
    won: 0,
    gun_ai_mmr: 750,
    gun_near_pct: 100,
    act_ai_mmr: 750,
    act_near_pct: 100,
    gadget_1: 0,
    gadget_2: 0,
    gadget_uses: 1,
    gear_tank_main: 0,
    gear_tank_sub: 0,
    gear_tank_cm: 0,
    gear_heli_main: 0,
    gear_heli_sub: 0,
    gear_heli_cm: 0
  }
};

// src/mmr.js
var MMR_RULES = {
  start: 1e3,
  // はじめの MMR（全員の平均もここにそろえる）。2026-11-05 のテストで、前の 1300＝今の 1000 がちょうどよいと決まった
  near: 750,
  // 差がこれより大きい AI は数えない（ワールドが数える）
  scale: 1e3,
  // 相手との差がこれだけあると、期待が 10 倍違う（1000〜2000 の幅に合わせた）
  kSteps: [[10, 120], [30, 80]],
  // [n 試合まで, 動く大きさ]
  kLast: 40,
  // それより後の動く大きさ
  base: { kpm: 0.6, acc: 22, obj: 40, bomb: 1, sup: 0.5, dpm: 0.5 },
  // ちょうど平均の人の値（仮）
  fight: { kpm: 0.7, acc: 0.3 },
  goal: { obj: 0.4, bomb: 0.3, won: 0.3 },
  support: { revive: 0.4, supply: 0.4, squad: 0.2 },
  gun: { fight: 0.75, live: 0.25 },
  act: { goal: 40, support: 15 },
  total: { goal: 40, fight: 35, support: 15, live: 10 },
  pick: { offset: -125, spread: 250, gunWeight: 2 }
  // AI の選び方（ワールドが使う）
};
var SHIFT_MIN_MATCHES = 3;
function share(x, b) {
  return x + b === 0 ? 0.5 : x / (x + b);
}
function matchScores(stats, rules = MMR_RULES) {
  const s = stats;
  const n = (v) => v ?? 0;
  const b = rules.base;
  const m = Math.max(n(s.match_minutes), 1);
  const fight = rules.fight.kpm * share(n(s.kills) / m, b.kpm) + rules.fight.acc * share(n(s.accuracy), b.acc);
  const goal = rules.goal.obj * share(n(s.obj_time_ratio), b.obj) + rules.goal.bomb * share((n(s.plants) + n(s.defuses)) * 10 / m, b.bomb) + rules.goal.won * n(s.won);
  const live = b.dpm / (n(s.deaths) / m + b.dpm);
  let sum = 0;
  let weight = 0;
  if (s.revive_rate != null) {
    sum += rules.support.revive * (s.revive_rate / 100);
    weight += rules.support.revive;
  }
  if (n(s.supplies) >= 1) {
    sum += rules.support.supply * share(s.supplies * 10 / m, b.sup);
    weight += rules.support.supply;
  }
  if (s.squad_ratio != null) {
    sum += rules.support.squad * (s.squad_ratio / 100);
    weight += rules.support.squad;
  }
  const support = weight > 0 ? sum / weight : null;
  const gun = rules.gun.fight * fight + rules.gun.live * live;
  const act = support == null ? goal : (rules.act.goal * goal + rules.act.support * support) / (rules.act.goal + rules.act.support);
  const t = rules.total;
  const parts2 = t.goal * goal + t.fight * fight + t.live * live + (support == null ? 0 : t.support * support);
  const partsWeight = t.goal + t.fight + t.live + (support == null ? 0 : t.support);
  return { fight, goal, live, support, gun, act, total: parts2 / partsWeight * 100 };
}
function kOf(n, rules = MMR_RULES) {
  for (const [until, k] of rules.kSteps) {
    if (n < until) return k;
  }
  return rules.kLast;
}
function expectedOf(mine, ai, rules = MMR_RULES) {
  return 1 / (1 + 10 ** ((ai - mine) / rules.scale));
}
function updateMmr(mmr, n, result, aiMmr, nearPct, rules = MMR_RULES) {
  if (aiMmr == null || !(nearPct > 0)) return { mmr, n, moved: false };
  return { mmr: mmr + kOf(n, rules) * (nearPct / 100) * (result - expectedOf(mmr, aiMmr, rules)), n: n + 1, moved: true };
}
function sortMatches(matches) {
  return [...matches].sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0) || (a.id ?? 0) - (b.id ?? 0));
}
function replayPlayer(matches, rules = MMR_RULES) {
  let gun = { mmr: rules.start, n: 0 };
  let act = { mmr: rules.start, n: 0 };
  const steps = [];
  for (const match of sortMatches(matches)) {
    const s = match.stats;
    const r = matchScores(s, rules);
    gun = updateMmr(gun.mmr, gun.n, r.gun, s.gun_ai_mmr, s.gun_near_pct, rules);
    act = updateMmr(act.mmr, act.n, r.act, s.act_ai_mmr, s.act_near_pct, rules);
    steps.push({ match, gun: gun.mmr, act: act.mmr });
  }
  return { gun: gun.mmr, act: act.mmr, gunN: gun.n, actN: act.n, count: steps.length, steps };
}
function mmrShift(players, rules = MMR_RULES) {
  const list = players.filter((p) => p.count >= SHIFT_MIN_MATCHES);
  if (list.length === 0) return { gun: 0, act: 0 };
  const avg = (key) => list.reduce((a, p) => a + p[key], 0) / list.length;
  return { gun: rules.start - avg("gun"), act: rules.start - avg("act") };
}
function replayAll(groups, rules = MMR_RULES) {
  const players = /* @__PURE__ */ new Map();
  for (const [key, matches] of groups) players.set(key, replayPlayer(matches, rules));
  return { players, shift: mmrShift([...players.values()], rules) };
}

// src/validate.js
var ENOUGH_KILLS = 5;
var VEH_SEC_SLACK = 60;
var HELI_SEC_SLACK = 5;
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
  },
  // ── 乗り物の秒数（schema 9。SPEC-v2.md の 14 章）。1 秒ごとに数えるので、数え方のずれの分だけゆるくする ──
  {
    name: "veh_sec_over",
    label: `乗り物に乗っていた秒数（輸送車・戦車・ヘリの合計）が、試合に出ていた時間より ${VEH_SEC_SLACK} 秒より長い`,
    test: (s) => s.match_minutes != null && (s.veh_car_sec ?? 0) + (s.veh_tank_sec ?? 0) + (s.veh_heli_sec ?? 0) > s.match_minutes * 60 + VEH_SEC_SLACK
  },
  {
    name: "heli_pilot_over",
    label: `ヘリを操縦していた秒数が、ヘリに乗っていた秒数より ${HELI_SEC_SLACK} 秒より長い`,
    test: (s) => s.heli_pilot_sec != null && s.veh_heli_sec != null && s.heli_pilot_sec > s.veh_heli_sec + HELI_SEC_SLACK
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
    if (f.kind === "position" && (!Number.isInteger(v) || posParts(v).share > POS_MAX_SHARE)) return { ok: false, reason: `extreme_${f.key}` };
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
var OUTPUT_FORMAT = 3;
var MAX_DISPLAY_NAME = 32;
var MMR_JITTER = 25;
var DEFAULT_OPTIONS = {
  targetProfiles: 64,
  // これより少なければ、ずらしで増やす（AI は最大 31 体なので、その倍ほど）
  maxProfiles: 300,
  // これより多ければ、強さの順に間引く（JSON を大きくしすぎない）
  maxCopiesPerSource: 16,
  // 1 人の成績から作る数の上限（元 1 ＋ ずらし 15）
  seedUntil: SEED_UNTIL,
  minWorldVer: "",
  // この版以降に遊んだ試合だけ使う（空なら全部）
  aiStats: []
  // 「あなたの AI」の戦績（取り出しの [["記録コード", 出現した回数, 倒した数], …]）
};
function clamp(f, v) {
  return Math.min(f.max, Math.max(f.min, v));
}
function combineMatches(matches) {
  const out = {};
  for (const f of FIELDS) {
    if (f.kind === "position") continue;
    const rows = matches.filter((m) => m.stats[f.key] != null && !(f.ignoreZero && m.stats[f.key] === 0));
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
function combinePositions(matches) {
  const maps = /* @__PURE__ */ new Map();
  const emptySide = () => Array.from({ length: POS_SECTORS }, () => /* @__PURE__ */ new Map());
  for (const m of matches) {
    const s = m.stats;
    if (s.map_id == null || s.side !== 0 && s.side !== 1) continue;
    for (const f of POS_FIELDS) {
      const v = s[f.key];
      if (v == null) continue;
      if (!maps.has(s.map_id)) maps.set(s.map_id, { a: emptySide(), d: emptySide() });
      const { share: share2, cell } = posParts(v);
      const tally = maps.get(s.map_id)[s.side === 0 ? "a" : "d"][f.sector - 1];
      tally.set(cell, (tally.get(cell) ?? 0) + share2);
    }
  }
  if (maps.size === 0) return null;
  const out = {};
  for (const id of [...maps.keys()].sort((x, y) => x - y)) {
    const sides = maps.get(id);
    out[String(id)] = { a: sides.a.map(topCells), d: sides.d.map(topCells) };
  }
  return out;
}
function topCells(tally) {
  const top = [...tally].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, POS_PER_SECTOR);
  const total = top.reduce((a, [, share2]) => a + share2, 0);
  return top.map(([cell, share2]) => posValue(total > 0 ? Math.round(share2 * POS_MAX_SHARE / total) : 0, cell));
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
  const mmr = replayAll(groups, MMR_RULES);
  const mmrShift2 = { gun: roundMmr(mmr.shift.gun), act: roundMmr(mmr.shift.act) };
  const players = [...groups.entries()].sort(([a], [b]) => cmpId(a, b)).map(([key, rows]) => {
    const latest = [...rows].sort((a, b) => cmpNum(b.id, a.id)).find((r) => typeof r.name === "string" && r.name);
    return {
      key,
      code: isCode(key) ? key : null,
      name: latest ? latest.name.slice(0, MAX_DISPLAY_NAME) : null,
      n: rows.length,
      gun: roundMmr(mmr.players.get(key).gun + mmr.shift.gun),
      act: roundMmr(mmr.players.get(key).act + mmr.shift.act),
      stats: combineMatches(rows),
      pos: combinePositions(rows)
    };
  });
  const medianSource = players.length > 0 ? players.map((p) => p.stats) : SEED_PROFILES.map((s) => s.stats);
  const medians = {};
  for (const f of PROFILE_FIELDS) {
    if (f.keepNull) continue;
    const vals = medianSource.map((s) => s[f.key]).filter((v) => v != null).sort((a, b) => a - b);
    if (vals.length === 0) medians[f.key] = f.kind === "category" ? f.min : SEED_PROFILES.find((s) => s.id === "seed-normal").stats[f.key];
    else if (f.kind === "category") medians[f.key] = mostFrequent(vals);
    else medians[f.key] = clamp(f, roundTo(median(vals), stepOf(f)));
  }
  const fill = (stats) => {
    const out2 = {};
    for (const f of PROFILE_FIELDS) out2[f.key] = stats[f.key] ?? (f.keepNull ? null : medians[f.key]);
    return out2;
  };
  let bases = players.map((p) => ({ id: p.key, kind: "real", code: p.code, name: p.name, n: p.n, gun: p.gun, act: p.act, stats: fill(p.stats), pos: p.pos }));
  if (bases.length > opt.maxProfiles) {
    bases.sort((a, b) => a.gun - b.gun || cmpId(a.id, b.id));
    const picked = [];
    for (let i = 0; i < opt.maxProfiles; i++) {
      picked.push(bases[Math.floor(i * (bases.length - 1) / (opt.maxProfiles - 1))]);
    }
    bases = picked;
  }
  const seedUsed = players.length < opt.seedUntil;
  if (seedUsed) {
    for (const s of SEED_PROFILES) bases.push({ id: s.id, kind: "seed", code: null, name: null, n: 0, gun: s.mmr, act: s.mmr, stats: fill(s.stats), pos: null });
  }
  const profiles = [];
  const copies = Math.min(opt.maxCopiesPerSource, Math.max(1, Math.ceil(opt.targetProfiles / Math.max(bases.length, 1))));
  for (const b of bases) {
    profiles.push({ ...b, src: b.id });
    for (let n = 1; n < copies; n++) {
      const id = `${b.id}~${n}`;
      profiles.push({ ...b, id, src: b.id, kind: "variant", ...jitterMmr(b, id), stats: jitter(b.stats, id) });
    }
  }
  const out = profiles.sort((a, b) => a.gun - b.gun || cmpId(a.id, b.id)).map((p) => {
    const o = { id: p.id, src: p.src, kind: p.kind };
    if (p.code) o.code = p.code;
    if (p.name) o.name = p.name;
    o.gun = p.gun;
    o.act = p.act;
    o.strength = p.gun;
    o.v = PROFILE_FIELDS.map((f) => p.stats[f.key]);
    if (p.pos) o.pos = p.pos;
    return o;
  });
  const weak = PRACTICE_PROFILE;
  const practice = { id: weak.id, gun: weak.mmr, act: weak.mmr, strength: weak.mmr, v: PROFILE_FIELDS.map((f) => weak.stats[f.key] ?? null) };
  const body = {
    format: OUTPUT_FORMAT,
    schema: PROFILE_SCHEMA,
    fields: PROFILE_FIELDS.map((f) => f.key),
    strengthWeights: STRENGTH_WEIGHTS,
    mmr: MMR_RULES,
    mmrShift: mmrShift2,
    minWorldVer,
    worldVers: Object.fromEntries(Object.entries(worldVers).sort(([a], [b]) => cmpId(a, b))),
    realCount: players.length,
    matchCount: real.length,
    seedUsed,
    profileCount: out.length,
    profiles: out,
    practice,
    aiStats: aiStatsObject(opt.aiStats)
  };
  return {
    format: body.format,
    schema: body.schema,
    generatedAt: new Date(now).toISOString(),
    dataHash: seedFrom(JSON.stringify(body)).toString(16).padStart(8, "0"),
    ...body
  };
}
function aiStatsObject(list) {
  const out = {};
  if (!Array.isArray(list)) return out;
  const isCount = (n) => Number.isInteger(n) && n >= 0;
  const rows = list.filter((r) => Array.isArray(r) && isCode(r[0]) && isCount(r[1]) && isCount(r[2]));
  rows.sort((a, b) => cmpId(a[0], b[0]));
  for (const [code, seen, kills] of rows) out[code] = [seen, kills];
  return out;
}
function jitter(stats, seedText) {
  const rnd = makeRandom(seedFrom(seedText));
  const out = { ...stats };
  for (const f of PROFILE_FIELDS) {
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
function roundMmr(v) {
  return Math.round(v * 10) / 10;
}
function jitterMmr(base, seedText) {
  const rnd = makeRandom(seedFrom(`${seedText}|mmr`));
  const move = () => (rnd() * 2 - 1) * MMR_JITTER;
  return { gun: roundMmr(base.gun + move()), act: roundMmr(base.act + move()) };
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
  if (json?.schema !== PROFILE_SCHEMA) problems.push("schema が違う");
  if (!Array.isArray(json?.fields) || json.fields.join(",") !== PROFILE_FIELDS.map((f) => f.key).join(",")) problems.push("fields が違う");
  if (!Array.isArray(json?.profiles) || json.profiles.length === 0) problems.push("profiles が空");
  if (typeof json?.mmr?.start !== "number") problems.push("mmr（重み）がない");
  if (!Number.isFinite(json?.mmrShift?.gun) || !Number.isFinite(json?.mmrShift?.act)) problems.push("mmrShift がない");
  for (const p of json?.profiles ?? []) {
    if (!Array.isArray(p.v) || p.v.length !== PROFILE_FIELDS.length) {
      problems.push(`${p.id}: 値の数が違う`);
      continue;
    }
    PROFILE_FIELDS.forEach((f, i) => {
      const v = p.v[i];
      if (v === null && f.keepNull) return;
      if (typeof v !== "number" || !Number.isFinite(v)) problems.push(`${p.id}: ${f.key} が数でない`);
      else if (v < f.min || v > f.max) problems.push(`${p.id}: ${f.key}=${v} が範囲の外`);
    });
    if (!Number.isFinite(p.gun) || !Number.isFinite(p.act)) problems.push(`${p.id}: gun か act が数でない`);
    if (p.strength !== p.gun) problems.push(`${p.id}: strength が gun と違う`);
    if (!["real", "variant", "seed"].includes(p.kind)) problems.push(`${p.id}: kind が違う`);
    if ("code" in p && !isCode(p.code)) problems.push(`${p.id}: 記録コードの形が違う`);
    if (p.kind === "seed" && ("code" in p || "name" in p)) problems.push(`${p.id}: 種の成績に記録コードや名前がある`);
    if ("pos" in p) problems.push(...checkPos(p));
    if ("name" in p && (typeof p.name !== "string" || p.name.length === 0 || p.name.length > MAX_DISPLAY_NAME)) {
      problems.push(`${p.id}: 名前の形が違う`);
    }
  }
  for (let i = 1; i < (json?.profiles?.length ?? 0); i++) {
    if (json.profiles[i - 1].strength > json.profiles[i].strength) problems.push("強さの順になっていない");
  }
  const pr = json?.practice;
  if (!Array.isArray(pr?.v) || pr.v.length !== PROFILE_FIELDS.length || !Number.isFinite(pr.gun) || !Number.isFinite(pr.act)) problems.push("practice が違う");
  else if (PROFILE_FIELDS.some((f, i) => !(pr.v[i] === null && f.keepNull) && (typeof pr.v[i] !== "number" || pr.v[i] < f.min || pr.v[i] > f.max))) problems.push("practice の値が違う");
  if (pr && "pos" in pr) problems.push("practice に pos がある");
  const ai = json?.aiStats;
  if (ai == null || typeof ai !== "object" || Array.isArray(ai)) problems.push("aiStats の形が違う");
  else {
    for (const [code, v] of Object.entries(ai)) {
      if (!isCode(code)) problems.push(`aiStats: 記録コード ${code} の形が違う`);
      if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => Number.isInteger(n) && n >= 0)) problems.push(`aiStats: ${code} の数の形が違う`);
    }
  }
  return problems;
}
function checkPos(p) {
  const problems = [];
  if (p.kind === "seed") problems.push(`${p.id}: 種の成績に pos がある`);
  if (p.pos == null || typeof p.pos !== "object" || Array.isArray(p.pos) || Object.keys(p.pos).length === 0) return [...problems, `${p.id}: pos の形が違う`];
  for (const [mapId, sides] of Object.entries(p.pos)) {
    if (!/^(0|[1-9][0-9]*)$/.test(mapId)) problems.push(`${p.id}: pos のマップの番号 ${mapId} が数でない`);
    for (const side of ["a", "d"]) {
      const sectors = sides?.[side];
      if (!Array.isArray(sectors) || sectors.length !== POS_SECTORS) {
        problems.push(`${p.id}: pos の ${mapId}.${side} の形が違う`);
        continue;
      }
      for (const list of sectors) {
        if (!Array.isArray(list) || list.length > POS_PER_SECTOR) {
          problems.push(`${p.id}: pos の ${mapId}.${side} の升の数が違う`);
          continue;
        }
        for (const v of list) {
          if (!Number.isInteger(v) || v < 0 || posParts(v).share > POS_MAX_SHARE) problems.push(`${p.id}: pos の値 ${v} が範囲の外`);
        }
      }
    }
    if (Object.keys(sides ?? {}).some((k) => k !== "a" && k !== "d")) problems.push(`${p.id}: pos の ${mapId} に知らないキーがある`);
  }
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
  const json = aggregate(raw.matches, { now, minWorldVer, aiStats: raw.aiStats ?? [] });
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
