import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase Config ──────────────────────────────────────────────────────────
// Ganti dua nilai ini dengan milik kamu dari Supabase dashboard
const SUPABASE_URL  = "https://pymdlenbgoylrvowtolz.supabase.co";
const SUPABASE_ANON = "sb_publishable_ub5QDi6uE7M14g_7ZzjS_A_cdiuo8iD";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ─── Constants ────────────────────────────────────────────────────────────────
const MOODS = [
  { emoji: "😊", label: "Joyful",      color: "#D4922A" },
  { emoji: "😔", label: "Melancholic", color: "#4A6FA5" },
  { emoji: "😴", label: "Tired",       color: "#7A6FA5" },
  { emoji: "😤", label: "Frustrated",  color: "#C0392B" },
  { emoji: "🥰", label: "Loving",      color: "#C0624A" },
  { emoji: "😌", label: "Peaceful",    color: "#4A8C5C" },
  { emoji: "😵‍💫", label: "Confused",   color: "#8E44AD" },
  { emoji: "🤩", label: "Excited",     color: "#B7860B" },
  { emoji: "🤒", label: "Sick",        color: "#5D8A5E" },
];

const DAYS   = ["Su","Mo","Tu","We","Th","Fr","Sa"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const getFirstDay    = (y, m) => new Date(y, m, 1).getDay();
const dateStr = (y, m, d) => `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

// ─── Supabase data helpers ─────────────────────────────────────────────────────
async function dbLoadEntry(userId, y, m, d) {
  const { data } = await supabase
    .from("entries")
    .select("*")
    .eq("user_id", userId)
    .eq("date", dateStr(y, m, d))
    .single();
  return data ? { mood: data.mood, word: data.word, caption: data.caption, photo: data.photo_url } : null;
}

async function dbSaveEntry(userId, y, m, d, entry) {
  const row = {
    user_id:   userId,
    date:      dateStr(y, m, d),
    mood:      entry.mood      || null,
    word:      entry.word      || null,
    caption:   entry.caption   || null,
    photo_url: entry.photo     || null,
  };
  await supabase.from("entries").upsert(row, { onConflict: "user_id,date" });
}

async function dbLoadQuote(userId, y, m) {
  const { data } = await supabase
    .from("quotes")
    .select("text")
    .eq("user_id", userId)
    .eq("month", `${y}-${String(m+1).padStart(2,"0")}`)
    .single();
  return data?.text || "";
}

async function dbSaveQuote(userId, y, m, text) {
  await supabase.from("quotes").upsert(
    { user_id: userId, month: `${y}-${String(m+1).padStart(2,"0")}`, text },
    { onConflict: "user_id,month" }
  );
}

async function dbLoadMonth(userId, y, m) {
  const from = dateStr(y, m, 1);
  const to   = dateStr(y, m, getDaysInMonth(y, m));
  const { data } = await supabase
    .from("entries")
    .select("date,mood,word,caption,photo_url")
    .eq("user_id", userId)
    .gte("date", from)
    .lte("date", to);
  const map = {};
  (data || []).forEach(row => {
    const d = parseInt(row.date.split("-")[2]);
    map[d] = { mood: row.mood, word: row.word, caption: row.caption, photo: row.photo_url };
  });
  return map;
}

// Upload foto ke Supabase Storage, return public URL
async function uploadPhoto(userId, y, m, d, dataUrl) {
  // Kalau bukan data URL baru (sudah berupa https URL), skip upload
  if (!dataUrl || !dataUrl.startsWith("data:")) return dataUrl;
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${userId}/${dateStr(y,m,d)}.${blob.type.split("/")[1] || "jpg"}`;
  const { error } = await supabase.storage.from("photos").upload(path, blob, { upsert: true });
  if (error) return dataUrl; // fallback ke data URL kalau gagal
  const { data } = supabase.storage.from("photos").getPublicUrl(path);
  return data.publicUrl;
}

function getMoodStats(entMap, y, m) {
  const counts = {};
  MOODS.forEach(mo => { counts[mo.emoji] = 0; });
  for (let d = 1; d <= getDaysInMonth(y, m); d++) {
    const e = entMap[d];
    if (e?.mood) counts[e.mood] = (counts[e.mood] || 0) + 1;
  }
  return counts;
}

function getDominant(counts) {
  let max = 0, winner = null;
  MOODS.forEach(mo => { if (counts[mo.emoji] > max) { max = counts[mo.emoji]; winner = mo; } });
  return { mood: winner, count: max };
}

function getStreak(entMap, y, m) {
  const now = new Date();
  if (now.getFullYear() !== y || now.getMonth() !== m) return 0;
  let streak = 0, d = now.getDate();
  while (d >= 1) {
    const e = entMap[d];
    if (e && (e.mood || e.word || e.photo)) { streak++; d--; } else break;
  }
  return streak;
}

// ─── Natural page-flip sound ──────────────────────────────────────────────────
// Two-layer: crinkle transient (page edge lifting) + whoosh body (page sweeping)
function playFlip() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t0  = ctx.currentTime;
    const sr  = ctx.sampleRate;
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);

    // ── Layer 1: crinkle transient (page edge catching) ──────────────────
    const crinkDur = 0.10;
    const crinkLen = Math.floor(sr * crinkDur);
    const crinkBuf = ctx.createBuffer(2, crinkLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = crinkBuf.getChannelData(ch);
      for (let i = 0; i < crinkLen; i++) {
        const pct = i / crinkLen;
        const env = Math.pow(1 - pct, 3.5);
        d[i] = (Math.random() * 2 - 1) * env * (ch === 0 ? 1 : 0.85);
      }
    }
    const crinkSrc = ctx.createBufferSource();
    crinkSrc.buffer = crinkBuf;
    const crinkBp = ctx.createBiquadFilter();
    crinkBp.type = "bandpass"; crinkBp.frequency.value = 1800; crinkBp.Q.value = 0.8;
    const crinkLp = ctx.createBiquadFilter();
    crinkLp.type = "lowpass"; crinkLp.frequency.value = 3200; crinkLp.Q.value = 0.5;
    const crinkGain = ctx.createGain();
    crinkGain.gain.setValueAtTime(0, t0);
    crinkGain.gain.linearRampToValueAtTime(0.048, t0 + 0.005);
    crinkGain.gain.exponentialRampToValueAtTime(0.001, t0 + crinkDur);
    crinkSrc.connect(crinkBp); crinkBp.connect(crinkLp);
    crinkLp.connect(crinkGain); crinkGain.connect(master);
    crinkSrc.start(t0); crinkSrc.stop(t0 + crinkDur + 0.02);

    // ── Layer 2: whoosh body (page sweeping through air) ─────────────────
    const whooshDur = 0.55;
    const whooshLen = Math.floor(sr * whooshDur);
    const whooshBuf = ctx.createBuffer(2, whooshLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = whooshBuf.getChannelData(ch);
      for (let i = 0; i < whooshLen; i++) {
        const pct = i / whooshLen;
        const env = pct < 0.15
          ? pct / 0.15
          : Math.pow(1 - (pct - 0.15) / 0.85, 2.2);
        d[i] = (Math.random() * 2 - 1) * env;
      }
    }
    const whooshSrc = ctx.createBufferSource();
    whooshSrc.buffer = whooshBuf;
    const whooshLp = ctx.createBiquadFilter();
    whooshLp.type = "lowpass"; whooshLp.Q.value = 0.35;
    whooshLp.frequency.setValueAtTime(520, t0 + 0.02);
    whooshLp.frequency.linearRampToValueAtTime(260, t0 + whooshDur);
    const whooshHp = ctx.createBiquadFilter();
    whooshHp.type = "highpass"; whooshHp.frequency.value = 90; whooshHp.Q.value = 0.3;
    const whooshGain = ctx.createGain();
    whooshGain.gain.setValueAtTime(0, t0);
    whooshGain.gain.linearRampToValueAtTime(0.042, t0 + 0.06);
    whooshGain.gain.linearRampToValueAtTime(0.026, t0 + 0.30);
    whooshGain.gain.linearRampToValueAtTime(0, t0 + whooshDur);
    whooshSrc.connect(whooshHp); whooshHp.connect(whooshLp);
    whooshLp.connect(whooshGain); whooshGain.connect(master);
    whooshSrc.start(t0 + 0.02); whooshSrc.stop(t0 + whooshDur + 0.05);
  } catch {}
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Satisfy&family=Caveat:wght@400;600;700&family=DM+Sans:wght@300;400;500&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'DM Sans', sans-serif;
  background: #EDE0CC;
  min-height: 100vh;
}

/* ── BACKGROUND ─────────────────────────────────── */
.app {
  min-height: 100vh;
  display: flex; flex-direction: column; align-items: center;
  padding-bottom: 60px;
  background:
    radial-gradient(ellipse 70% 50% at 15% 10%, rgba(212,179,140,0.35) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 85% 85%, rgba(42,58,100,0.08) 0%, transparent 55%),
    linear-gradient(160deg, #E8D8BE 0%, #DFD0B4 30%, #E4D5BC 60%, #D9C9A8 100%);
  position: relative;
}

/* subtle linen texture */
.app::before {
  content: '';
  position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background-image:
    repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(180,150,110,0.04) 3px, rgba(180,150,110,0.04) 4px),
    repeating-linear-gradient(90deg, transparent, transparent 3px, rgba(180,150,110,0.03) 3px, rgba(180,150,110,0.03) 4px);
}

/* ── URJOUR LOGO ─────────────────────────────────── */
.logo-wrap {
  width: 100%; max-width: 500px;
  display: flex; flex-direction: column; align-items: center;
  padding: 36px 20px 20px;
  position: relative; z-index: 2;
  user-select: none;
}
.logo-mark {
  display: flex; align-items: center; gap: 9px; margin-bottom: 5px;
}
.logo-icon {
  width: 28px; height: 28px; position: relative; flex-shrink: 0;
}
.logo-icon svg { width: 100%; height: 100%; }
.logo-text {
  font-family: 'Cormorant Garamond', serif;
  font-weight: 300;
  font-size: 36px;
  letter-spacing: 0.22em;
  color: #3B2410;
  text-transform: uppercase;
  line-height: 1;
}
.logo-tagline {
  font-family: 'Cormorant Garamond', serif;
  font-style: italic; font-weight: 300;
  font-size: 13px;
  letter-spacing: 0.18em;
  color: rgba(92,58,28,0.55);
  text-transform: lowercase;
  margin-top: 1px;
}
.logo-line {
  width: 40px; height: 1px;
  background: linear-gradient(to right, transparent, rgba(92,58,28,0.3), transparent);
  margin-top: 12px;
}

/* swipe hint arrows */
.cal-nav {
  position: absolute; top: 22px; right: 14px;
  display: flex; gap: 6px; z-index: 10;
}
.cal-nav-btn {
  width: 28px; height: 28px; border-radius: 50%;
  border: 1px solid rgba(92,58,28,0.2);
  background: rgba(255,255,255,0.55);
  color: #5C3A1C; font-size: 13px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all .18s;
}
.cal-nav-btn:hover { background: rgba(255,255,255,0.9); transform: scale(1.08); }
.cal-nav-btn:active { transform: scale(0.93); }

/* ── BOOK WRAPPER ───────────────────────────────── */
.book-stage {
  width: calc(100% - 24px); max-width: 500px;
  position: relative; z-index: 2;
}

/* ── BOOK CARD ──────────────────────────────────── */
.card {
  width: 100%;
  background: #FAF5EC;
  border-radius: 2px 14px 14px 2px;
  position: relative;
  overflow: hidden;
  transform-origin: center center;
  will-change: transform, opacity;
  box-shadow:
    -6px 0 0 0 #8B6040,
    -9px 0 0 0 #6B4828,
    -11px 2px 8px rgba(0,0,0,0.18),
    0 8px 32px rgba(92,58,28,0.18),
    0 2px 8px rgba(92,58,28,0.10),
    inset 6px 0 16px rgba(92,58,28,0.04);
}
/* Allow 3D children to escape the card bounds during flip */
.card.is-flipping { overflow: visible; }

/* spine */
.card::before {
  content: '';
  position: absolute; left: 0; top: 0; bottom: 0; width: 7px; z-index: 20;
  background: linear-gradient(to right, #4A2810, #7A5030 45%, #9A6A40 60%, #6A3E20);
  pointer-events: none;
}

/* ruled lines — very subtle */
.card::after {
  content: '';
  position: absolute; inset: 0; pointer-events: none; z-index: 1;
  background-image: repeating-linear-gradient(
    transparent, transparent 29px,
    rgba(180,148,100,0.1) 29px, rgba(180,148,100,0.1) 30px
  );
  background-position: 0 52px;
}

/* ── PAGE TURN OVERLAY ───────────────────────────────────────────────────────

  Kedua arah pakai konsep yang sama: halaman baru DATANG dari sisi hinge,
  landing di atas konten yang sudah diganti.

  PREV: hinge KIRI  — halaman masuk dari balik spine kiri  (-180° → 0°)
  NEXT: hinge KANAN — halaman masuk dari balik sisi kanan  (180° → 0°)

  Keduanya identik secara fisika, cuma cerminan horizontal.

  ──────────────────────────────────────────────────────────────────────────── */

.card { overflow: hidden; }
.card.is-flipping { overflow: visible; }

.page-turn-stage {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 50;
  perspective: 2400px;
  overflow: visible;
  border-radius: 2px 14px 14px 2px;
}

/* Perspective origin SAMA untuk kedua arah */
.page-turn-stage.turning-prev { perspective-origin: 18% 36%; }
.page-turn-stage.turning-next { perspective-origin: 18% 36%; }

.page-flap {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  will-change: transform;
}

/* Kedua arah hinge kiri */
.page-turn-stage.turning-prev .page-flap {
  transform-origin: left center;
  /* ease-out murni: mulai lambat keluar dari spine, makin cepat, landing smooth */
  animation: flipPrev 1.1s cubic-bezier(0.22, 0.0, 0.08, 1.0) forwards;
}
.page-turn-stage.turning-next .page-flap {
  transform-origin: left center;
  animation: flipNext 1.0s cubic-bezier(0.55, 0.0, 0.1, 1.0) forwards;
}

/* ── Face textures ── */
.page-flap-front,
.page-flap-back {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}
.page-flap-front {
  background: #FAF5EC;
  background-image: repeating-linear-gradient(
    transparent, transparent 29px,
    rgba(180,148,100,0.09) 29px, rgba(180,148,100,0.09) 30px
  );
  background-position: 0 52px;
}
.page-flap-back {
  background: #ECE2CC;
  background-image: repeating-linear-gradient(
    transparent, transparent 29px,
    rgba(140,108,65,0.07) 29px, rgba(140,108,65,0.07) 30px
  );
  background-position: 0 52px;
  transform: rotateY(180deg);
}

/* ── Shadows ── */
.page-flap-front::after,
.page-flap-back::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
}

/* PREV — back face: shadow kanan, pelan muncul lalu hilang di tengah */
.page-turn-stage.turning-prev .page-flap-back::after {
  background: linear-gradient(to left, rgba(20,8,2,0.22) 0%, rgba(20,8,2,0.06) 30%, transparent 60%);
  animation: shadowBackPrev 1.1s ease-in-out forwards;
}
/* PREV — front face: shadow kiri, muncul mulus saat landing */
.page-turn-stage.turning-prev .page-flap-front::after {
  background: linear-gradient(to right, rgba(20,8,2,0.18) 0%, rgba(20,8,2,0.04) 32%, transparent 60%);
  animation: shadowFrontPrev 1.1s ease-in-out forwards;
}

/* NEXT — halaman pergi ke kiri, shadow cerminan dari prev */
.page-turn-stage.turning-next .page-flap-front::after {
  background: linear-gradient(to left, rgba(20,8,2,0.28) 0%, rgba(20,8,2,0.08) 25%, transparent 55%);
  animation: shadowBack 1.0s ease-in-out forwards;
}
.page-turn-stage.turning-next .page-flap-back::after {
  background: linear-gradient(to right, rgba(20,8,2,0.22) 0%, rgba(20,8,2,0.06) 28%, transparent 55%);
  animation: shadowFront 1.0s ease-in-out forwards;
}

/* ── Keyframes ── */

/* PREV: -180° → 0°, pelan di awal (halaman baru keluar dari spine), landing lembut */
@keyframes flipPrev {
  0%   { transform: rotateY(-180deg); }
  100% { transform: rotateY(0deg);    }
}
/* NEXT: 0° → -180° */
@keyframes flipNext {
  0%   { transform: rotateY(0deg);    }
  100% { transform: rotateY(-180deg); }
}

/* PREV back shadow: muncul pelan, hilang smooth sebelum 50% */
@keyframes shadowBackPrev {
  0%   { opacity: 0;    }
  10%  { opacity: 0.50; }
  35%  { opacity: 0.30; }
  55%  { opacity: 0;    }
  100% { opacity: 0;    }
}
/* PREV front shadow: muncul halus saat front face landing */
@keyframes shadowFrontPrev {
  0%   { opacity: 0;    }
  50%  { opacity: 0;    }
  72%  { opacity: 0.55; }
  90%  { opacity: 0.20; }
  100% { opacity: 0;    }
}

/* NEXT shadows (tidak diubah) */
@keyframes shadowBack {
  0%   { opacity: 0.65; }
  30%  { opacity: 0.40; }
  52%  { opacity: 0;    }
  100% { opacity: 0;    }
}
@keyframes shadowFront {
  0%   { opacity: 0;   }
  48%  { opacity: 0;   }
  68%  { opacity: 0.6; }
  86%  { opacity: 0.25;}
  100% { opacity: 0;   }
}

/* Card content crossfade */
.card-content {
  width: 100%;
  transition: opacity 0.10s ease-in-out;
}
.card-content.fading { opacity: 0; }

/* ── CALENDAR ───────────────────────────────────── */
.cal-wrap { padding: 26px 16px 14px 22px; position: relative; z-index: 2; }
.cal-big {
  font-family: 'Satisfy', cursive;
  font-size: 40px; color: #3B2410; line-height: 1;
}
.cal-yr {
  font-family: 'DM Sans', sans-serif; font-weight: 400;
  font-size: 13px; color: #8C6840; margin-top: 4px; margin-bottom: 18px; letter-spacing: .06em;
}
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.cal-dh {
  text-align: center; font-family: 'DM Sans', sans-serif; font-weight: 500;
  font-size: 10px; color: #2A3860; letter-spacing: .1em;
  padding: 2px 0 8px; text-transform: uppercase;
}
.cal-cell {
  display: flex; flex-direction: column; align-items: center;
  padding: 3px 2px 4px; cursor: pointer; border-radius: 6px;
  min-height: 54px; overflow: hidden; transition: background .15s;
}
.cal-cell:hover { background: rgba(92,58,28,0.06); }
.cal-cell.empty  { pointer-events: none; }
.cal-cell.has-e  { background: rgba(210,130,120,0.07); }
.cal-cell.has-e:hover { background: rgba(92,58,28,0.08); }
.cal-cell.future { opacity: 0.3; cursor: not-allowed; pointer-events: none; }

.cal-num {
  font-family: 'DM Sans', sans-serif; font-weight: 400;
  font-size: 13px; color: #3B2410; line-height: 1;
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  border-radius: 50%; flex-shrink: 0; transition: all .15s;
}
.cal-cell.today .cal-num {
  background: #2A3860; color: #FAF5EC; font-weight: 500;
  box-shadow: 0 2px 8px rgba(42,56,96,0.3);
}
.cal-cell.sel .cal-num {
  background: #C97070; color: #FAF5EC;
  box-shadow: 0 2px 8px rgba(201,112,112,0.35);
}
.cal-thumb {
  width: 100%; flex: 1; position: relative;
  border-radius: 4px; overflow: hidden; margin-top: 3px; min-height: 20px;
}
.cal-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cal-moji-over {
  position: absolute; bottom: 1px; right: 1px; font-size: 9px;
  background: rgba(250,245,236,0.92); border-radius: 50%;
  width: 15px; height: 15px; display: flex; align-items: center; justify-content: center;
}
.cal-moji-only { font-size: 14px; margin-top: 3px; line-height: 1; }

.legend {
  display: flex; gap: 12px; padding: 8px 16px 4px 22px; flex-wrap: wrap;
}
.leg-item {
  display: flex; align-items: center; gap: 5px;
  font-family: 'DM Sans', sans-serif; font-size: 11px; color: #8C6840; font-weight: 400;
}
.leg-dot { width: 8px; height: 8px; border-radius: 50%; }

/* ── DIVIDER ────────────────────────────────────── */
.divdr {
  height: 1px; margin: 6px 20px 0 22px;
  background: linear-gradient(to right, transparent, rgba(92,58,28,0.18), rgba(92,58,28,0.18), transparent);
}

/* ── INSIGHTS ───────────────────────────────────── */
.ins-wrap { padding: 16px 16px 26px 22px; position: relative; z-index: 2; }
.ins-title {
  font-family: 'Satisfy', cursive; font-size: 22px; color: #3B2410;
}
.ins-sub   { font-family: 'DM Sans', sans-serif; font-size: 12px; color: #8C6840; margin-top: 2px; margin-bottom: 14px; font-weight: 300; }
.slabel    {
  font-family: 'DM Sans', sans-serif; font-weight: 500; font-size: 10px;
  letter-spacing: .14em; text-transform: uppercase; color: #2A3860; margin-bottom: 9px;
}
.mood-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 2px; }
.mood-chip {
  display: flex; align-items: center; gap: 4px;
  background: rgba(92,58,28,0.07); border: 1px solid rgba(92,58,28,0.14);
  border-radius: 99px; padding: 4px 11px 4px 7px; font-size: 14px;
}
.mood-chip-count { font-family: 'DM Sans', sans-serif; font-size: 12px; color: #3B2410; font-weight: 500; }
.no-e { font-family: 'DM Sans', sans-serif; font-size: 13px; color: #A88860; text-align: center; padding: 8px 0; font-style: italic; }

.dom-card {
  background: rgba(92,58,28,0.05);
  border: 1px solid rgba(92,58,28,0.12);
  border-radius: 12px; padding: 16px; text-align: center; margin-top: 12px;
}
.dom-em  { font-size: 42px; line-height: 1; margin-bottom: 6px; }
.dom-lbl { font-family: 'Satisfy', cursive; font-size: 19px; color: #3B2410; }
.dom-sub { font-family: 'DM Sans', sans-serif; font-size: 12px; color: #8C6840; margin-top: 3px; font-weight: 300; }
.streak  { font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 400; color: #5C3A1C; text-align: center; margin-top: 12px; }

.qcard-ins {
  background: rgba(42,56,96,0.05); border-radius: 10px;
  border-left: 3px solid #C97070; padding: 12px 14px;
}
.qta-ins {
  width: 100%; border: none; outline: none; background: transparent;
  font-family: 'Caveat', cursive; font-size: 17px; color: #3B2410;
  resize: none; min-height: 62px; line-height: 1.6;
}
.qta-ins::placeholder { color: #A89070; }

/* ── BACKDROP ───────────────────────────────────── */
.backdrop {
  position: fixed; inset: 0; background: rgba(59,36,16,.35);
  z-index: 100; opacity: 0; pointer-events: none; transition: opacity .3s;
}
.backdrop.open { opacity: 1; pointer-events: all; }

/* ── BOTTOM SHEET ───────────────────────────────── */
.bsheet {
  position: fixed; bottom: 0; left: 50%;
  transform: translateX(-50%) translateY(100%);
  width: 100%; max-width: 500px;
  background: #FAF5EC; border-radius: 22px 22px 0 0;
  max-height: 90vh; overflow-y: auto; z-index: 101;
  transition: transform .38s cubic-bezier(.22,.68,0,1.2);
  box-shadow: 0 -4px 24px rgba(92,58,28,0.14);
}
.bsheet.open { transform: translateX(-50%) translateY(0); }
.handle { width: 40px; height: 4px; background: rgba(92,58,28,0.18); border-radius: 99px; margin: 12px auto 0; }
.shinner { padding: 20px 20px 50px; }

/* ── ENTRY PANEL ────────────────────────────────── */
.ep-date {
  font-family: 'Satisfy', cursive; font-size: 28px;
  color: #3B2410; line-height: 1.2;
}
.ep-sub { font-family: 'DM Sans', sans-serif; font-size: 12px; color: #8C6840; margin-top: 3px; margin-bottom: 20px; font-weight: 300; }
.elabel {
  font-family: 'DM Sans', sans-serif; font-weight: 500;
  font-size: 10px; letter-spacing: .14em; text-transform: uppercase;
  color: #2A3860; margin-bottom: 9px;
}

.pol-wrap { display: flex; justify-content: center; margin-bottom: 22px; }
.pol {
  background: #fff; padding: 9px 9px 38px;
  box-shadow: 2px 4px 18px rgba(92,58,28,0.14), 0 1px 4px rgba(92,58,28,0.08);
  transform: rotate(-1.5deg); max-width: 220px; width: 100%;
  cursor: pointer; transition: transform .2s;
  border: 1px solid rgba(92,58,28,0.08);
}
.pol:hover { transform: rotate(-.5deg) scale(1.02); }
.pol img { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; }
.up-area {
  width: 100%; aspect-ratio: 4/3; background: rgba(92,58,28,0.04);
  border: 1.5px dashed rgba(92,58,28,0.2); border-radius: 4px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; cursor: pointer;
}
.up-icon  { font-size: 28px; opacity: .4; }
.up-title { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: #5C3A1C; }
.up-sub   { font-family: 'DM Sans', sans-serif; font-size: 11px; color: #8C6840; }
.pol-cap  {
  width: 100%; border: none; outline: none;
  font-family: 'Caveat', cursive; font-size: 14px; color: #7A5030;
  text-align: center; background: transparent; margin-top: 4px; resize: none;
}

.mood-row { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 22px; scrollbar-width: none; }
.mood-row::-webkit-scrollbar { display: none; }
.mbtn {
  flex-shrink: 0; width: 48px; height: 48px; border-radius: 50%;
  border: 1.5px solid transparent;
  background: rgba(92,58,28,0.07); cursor: pointer; font-size: 22px;
  display: flex; align-items: center; justify-content: center; transition: all .2s;
}
.mbtn:hover { transform: scale(1.12); background: rgba(92,58,28,0.12); }
.mbtn.sel {
  background: rgba(201,112,112,0.12); border-color: #C97070;
  transform: scale(1.18);
  box-shadow: 0 3px 10px rgba(201,112,112,0.28);
}

.word-wrap { margin-bottom: 22px; }
.word-in {
  width: 100%; border: none; outline: none;
  border-bottom: 1.5px solid rgba(92,58,28,0.2);
  background: transparent;
  font-family: 'DM Sans', sans-serif; font-size: 16px; color: #3B2410;
  padding: 6px 0; transition: border-color .2s;
}
.word-in:focus { border-bottom-color: #2A3860; }
.word-in::placeholder { color: #A89070; font-size: 14px; }

.sbtn {
  width: 100%; height: 50px; border: none; border-radius: 10px;
  background: #3B2410; color: #FAF5EC;
  font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all .25s;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 14px rgba(59,36,16,0.25);
  letter-spacing: .1em; text-transform: uppercase;
}
.sbtn.ok  { background: #C97070; box-shadow: 0 4px 14px rgba(201,112,112,0.3); }
.sbtn:hover { opacity: .9; transform: translateY(-2px); }

/* ── AUTH ───────────────────────────────────────── */
.auth-wrap {
  min-height: 100vh; width: 100%;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.auth-card {
  width: 100%; max-width: 380px;
  background: #FAF5EC;
  border-radius: 14px; padding: 36px 28px 32px;
  box-shadow: 0 8px 32px rgba(92,58,28,0.14), 0 2px 8px rgba(92,58,28,0.08);
}
.auth-tabs {
  display: flex; gap: 0; margin-bottom: 22px;
  border-bottom: 1.5px solid rgba(92,58,28,0.14);
}
.auth-tab {
  flex: 1; background: none; border: none; cursor: pointer;
  font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 400;
  color: #A89070; padding: 8px 0 10px; letter-spacing: .04em;
  border-bottom: 2px solid transparent; margin-bottom: -1.5px;
  transition: all .18s;
}
.auth-tab.active { color: #3B2410; border-bottom-color: #3B2410; font-weight: 500; }
.auth-field { margin-bottom: 16px; }
.auth-err {
  font-family: 'DM Sans', sans-serif; font-size: 12px;
  color: #C97070; margin-bottom: 10px; line-height: 1.5;
}
.logout-btn {
  margin-top: 8px; background: none; border: none; cursor: pointer;
  font-family: 'DM Sans', sans-serif; font-size: 11px;
  color: rgba(92,58,28,0.4); letter-spacing: .04em;
  transition: color .18s;
}
.logout-btn:hover { color: rgba(92,58,28,0.75); }
.db-loading {
  font-family: 'DM Sans', sans-serif; font-size: 11px;
  color: rgba(92,58,28,0.4); letter-spacing: .08em;
  text-align: center; margin-top: -8px; margin-bottom: 6px;
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:.9} }
@media (min-width: 768px) {
  .logo-wrap  { max-width: 960px; padding: 40px 0 22px; }
  .logo-text  { font-size: 42px; }
  .book-stage { max-width: 960px; }
  .card {
    display: grid; grid-template-columns: 440px 1fr;
    border-radius: 2px 18px 18px 2px;
  }
  .card-content {
    display: grid; grid-template-columns: 440px 1fr;
    grid-column: 1 / -1;
  }
  .right-col {
    overflow-y: auto; max-height: 88vh;
    border-left: 1px solid rgba(92,58,28,0.12);
    background: linear-gradient(to bottom, #FAF5EC 0%, #F2EAD8 100%);
    position: relative; z-index: 2;
  }
  .bsheet {
    position: static !important; transform: none !important;
    max-height: none; border-radius: 0; box-shadow: none;
    transition: none; overflow-y: visible; background: transparent;
  }
  .backdrop  { display: none; }
  .handle    { display: none; }
  .mob-sheet { display: none !important; }
  .ph {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100%; min-height: 320px; text-align: center; padding: 40px; gap: 14px;
  }
  .ph-icon { font-size: 44px; opacity: .2; }
  .ph-txt  { font-family: 'DM Sans', sans-serif; font-size: 14px; color: #9A7050; line-height: 1.8; font-style: italic; }
}
@media (max-width: 767px) {
  .right-col { display: none; }
}
`;

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode,  setMode]  = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [pass,  setPass]  = useState("");
  const [err,   setErr]   = useState("");
  const [busy,  setBusy]  = useState(false);

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      let res;
      if (mode === "register") {
        res = await supabase.auth.signUp({ email, password: pass });
        if (res.error) throw res.error;
        setErr("Check your email to confirm your account, then log in.");
        setBusy(false); return;
      } else {
        res = await supabase.auth.signInWithPassword({ email, password: pass });
        if (res.error) throw res.error;
        onAuth(res.data.user);
      }
    } catch (e) {
      setErr(e.message || "Something went wrong");
    }
    setBusy(false);
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="logo-mark" style={{justifyContent:"center", marginBottom:6}}>
          <div className="logo-icon">
            <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 22 C9 16, 16 10, 23 5" stroke="rgba(92,58,28,0.5)" strokeWidth="1" strokeLinecap="round"/>
              <path d="M7 22 C10 18, 14 15, 23 5 C20 8, 17 13, 14 18 C12 21, 9 22, 7 22Z" fill="rgba(92,58,28,0.1)" stroke="rgba(92,58,28,0.4)" strokeWidth="0.8"/>
              <path d="M7 22 L11 17" stroke="rgba(92,58,28,0.35)" strokeWidth="0.8" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="logo-text">Urjour</div>
        </div>
        <div className="logo-tagline" style={{textAlign:"center", marginBottom:28}}>your everyday journal</div>

        <div className="auth-tabs">
          <button className={"auth-tab"+(mode==="login"?" active":"")} onClick={() => { setMode("login"); setErr(""); }}>Log In</button>
          <button className={"auth-tab"+(mode==="register"?" active":"")} onClick={() => { setMode("register"); setErr(""); }}>Register</button>
        </div>

        <div className="auth-field">
          <div className="elabel">Email</div>
          <input className="word-in" type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="your@email.com" onKeyDown={e => e.key === "Enter" && submit()} />
        </div>
        <div className="auth-field">
          <div className="elabel">Password</div>
          <input className="word-in" type="password" value={pass} onChange={e => setPass(e.target.value)}
            placeholder="••••••••" onKeyDown={e => e.key === "Enter" && submit()} />
        </div>

        {err && <div className="auth-err">{err}</div>}

        <button className="sbtn" style={{marginTop:8}} onClick={submit} disabled={busy}>
          {busy ? "..." : mode === "login" ? "Log In" : "Create Account"}
        </button>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function CozyJournal() {
  const today = new Date();
  const [user,      setUser]      = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [year,      setYear]      = useState(today.getFullYear());
  const [month,     setMonth]     = useState(today.getMonth());
  const [selDay,    setSelDay]    = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [entry,     setEntry]     = useState({ photo: null, mood: null, word: "", caption: "" });
  const [quote,     setQuote]     = useState("");
  const [entMap,    setEntMap]    = useState({});
  const [saved,     setSaved]     = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [turning,   setTurning]   = useState("");
  const [fading,    setFading]    = useState(false);

  // Listen to auth state on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const map = await dbLoadMonth(user.id, year, month);
    setEntMap(map);
    const q = await dbLoadQuote(user.id, year, month);
    setQuote(q);
    setLoading(false);
  }, [user, year, month]);

  useEffect(() => { if (user) refresh(); }, [user, year, month, refresh]);

  const openDay = async (d) => {
    const clicked  = new Date(year, month, d);
    const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (clicked > todayMid) return;
    setSelDay(d);
    const e = await dbLoadEntry(user.id, year, month, d);
    setEntry(e || { photo: null, mood: null, word: "", caption: "" });
    setSheetOpen(true);
  };

  const handleSave = async () => {
    let finalEntry = { ...entry };
    // Upload foto ke Storage kalau ada data URL baru
    if (entry.photo && entry.photo.startsWith("data:")) {
      finalEntry.photo = await uploadPhoto(user.id, year, month, selDay, entry.photo);
      setEntry(finalEntry);
    }
    await dbSaveEntry(user.id, year, month, selDay, finalEntry);
    await dbSaveQuote(user.id, year, month, quote);
    await refresh();
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      if (window.innerWidth < 768) setSheetOpen(false);
    }, 900);
  };

  const handleLogout = () => supabase.auth.signOut();

  const cardRef = useRef(null);

  const flipNav = (dir) => {
    if (turning) return;
    playFlip();

    if (cardRef.current) cardRef.current.classList.add("is-flipping");

    if (dir === "next") {
      // Next: ganti bulan langsung, animasi kertas pergi di atasnya
      if (month === 11) { setYear(y => y + 1); setMonth(0); }
      else setMonth(m => m + 1);
      setSelDay(null);
      setSheetOpen(false);
      setTurning("next");
      setTimeout(() => {
        setTurning("");
        if (cardRef.current) cardRef.current.classList.remove("is-flipping");
      }, 1060);
    } else {
      // Prev: swap bulan di ~65% animasi (715ms dari 1100ms) saat kertas hampir landing
      setTurning("prev");
      setTimeout(() => setFading(true), 680);
      setTimeout(() => {
        if (month === 0) { setYear(y => y - 1); setMonth(11); }
        else setMonth(m => m - 1);
        setSelDay(null);
        setSheetOpen(false);
        setFading(false);
        setTurning("");
        if (cardRef.current) cardRef.current.classList.remove("is-flipping");
      }, 760);
    }
  };

  const swipeRef = useRef({ x: 0, t: 0 });

  const onTouchStart = (e) => {
    swipeRef.current = { x: e.touches[0].clientX, t: Date.now() };
  };
  const onTouchEnd = (e) => {
    if (turning) return;
    const dx = e.changedTouches[0].clientX - swipeRef.current.x;
    const dt = Date.now() - swipeRef.current.t;
    if (Math.abs(dx) > 50 && dt < 400) {
      flipNav(dx < 0 ? "next" : "prev");
    }
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay    = getFirstDay(year, month);
  const moodStats   = getMoodStats(entMap, year, month);
  const totalMoods  = Object.values(moodStats).reduce((a,b) => a+b, 0);
  const { mood: domMood, count: domCt } = getDominant(moodStats);
  const streak      = getStreak(entMap, year, month);

  const selDate = selDay ? new Date(year, month, selDay) : null;
  const dayName = selDate ? ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][selDate.getDay()] : "";

  const ep = { dayName, selDay, month, year, entry, setEntry, saved, handleSave };

  // Belum tahu status auth
  if (!authReady) return (
    <>
      <style>{CSS}</style>
      <div className="app" style={{alignItems:"center", justifyContent:"center"}}>
        <div style={{fontFamily:"DM Sans,sans-serif", color:"#8C6840", fontSize:14}}>Loading…</div>
      </div>
    </>
  );

  // Belum login → tampilkan auth screen
  if (!user) return (
    <>
      <style>{CSS}</style>
      <div className="app"><AuthScreen onAuth={setUser} /></div>
    </>
  );

  return (
    <>
      <style>{CSS}</style>
      <div className="app">

        {/* URJOUR LOGO */}
        <div className="logo-wrap">
          <div className="logo-mark">
            <div className="logo-icon">
              <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 22 C9 16, 16 10, 23 5" stroke="rgba(92,58,28,0.5)" strokeWidth="1" strokeLinecap="round"/>
                <path d="M7 22 C10 18, 14 15, 23 5 C20 8, 17 13, 14 18 C12 21, 9 22, 7 22Z" fill="rgba(92,58,28,0.1)" stroke="rgba(92,58,28,0.4)" strokeWidth="0.8"/>
                <path d="M7 22 L11 17" stroke="rgba(92,58,28,0.35)" strokeWidth="0.8" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="logo-text">Urjour</div>
          </div>
          <div className="logo-tagline">your everyday journal</div>
          <div className="logo-line" />
          <button className="logout-btn" onClick={handleLogout} title="Log out">↩ {user.email}</button>
        </div>

        {/* Loading overlay */}
        {loading && <div className="db-loading">syncing…</div>}

        {/* BOOK */}
        <div
          className="book-stage"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div className="card" ref={cardRef}>
            {/* PAGE TURN OVERLAY — sits on top, animates, card content stays still */}
            {turning && (
              <div className={"page-turn-stage turning-" + turning}>
                <div className="page-flap">
                  <div className="page-flap-front" />
                  <div className="page-flap-back" />
                </div>
              </div>
            )}

            {/* CARD CONTENT — fades at midpoint to swap months */}
            <div className={"card-content" + (fading ? " fading" : "")}>

            {/* LEFT: calendar + insights */}
            <div style={{position:"relative", zIndex:2}}>
              <div className="cal-wrap">
                <div style={{display:"flex", alignItems:"flex-start", justifyContent:"space-between"}}>
                  <div>
                    <div className="cal-big">{MONTHS[month]}</div>
                    <div className="cal-yr">{year}</div>
                  </div>
                  <div className="cal-nav">
                    <button className="cal-nav-btn" onClick={() => flipNav("prev")}>‹</button>
                    <button className="cal-nav-btn" onClick={() => flipNav("next")}>›</button>
                  </div>
                </div>
                <div className="cal-grid">
                  {DAYS.map(d => <div key={d} className="cal-dh">{d}</div>)}
                  {Array.from({ length: firstDay }).map((_,i) => <div key={"e"+i} className="cal-cell empty" />)}
                  {Array.from({ length: daysInMonth }).map((_,i) => {
                    const d = i + 1;
                    const isToday  = today.getFullYear()===year && today.getMonth()===month && today.getDate()===d;
                    const isFuture = new Date(year,month,d) > new Date(today.getFullYear(),today.getMonth(),today.getDate());
                    const edata = entMap[d];
                    const isSel = selDay === d;
                    return (
                      <div
                        key={d}
                        className={"cal-cell"+(isToday?" today":"")+(isSel?" sel":"")+(edata?" has-e":"")+(isFuture?" future":"")}
                        onClick={() => openDay(d)}
                      >
                        <div className="cal-num">{d}</div>
                        {edata?.photo ? (
                          <div className="cal-thumb">
                            <img src={edata.photo} alt="" />
                            {edata.mood && <div className="cal-moji-over">{edata.mood}</div>}
                          </div>
                        ) : edata?.mood ? (
                          <div className="cal-moji-only">{edata.mood}</div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="legend">
                  <div className="leg-item"><div className="leg-dot" style={{background:"#2A3860"}} />Today</div>
                  <div className="leg-item"><div className="leg-dot" style={{background:"#C97070"}} />Selected</div>
                  <div className="leg-item">📷 Memory</div>
                </div>
              </div>

              <div className="divdr" />

              {/* INSIGHTS */}
              <div className="ins-wrap">
                <div className="ins-title">This Month's Feelings</div>
                <div className="ins-sub">based on your entries</div>
                <div className="slabel">Mood Overview</div>

                {totalMoods === 0 ? (
                  <div className="no-e">Start logging your days to see patterns ✨</div>
                ) : (
                  <div className="mood-chips">
                    {MOODS.filter(mo => moodStats[mo.emoji] > 0).map(mo => (
                      <div className="mood-chip" key={mo.emoji}>
                        <span>{mo.emoji}</span>
                        <span className="mood-chip-count">×{moodStats[mo.emoji]}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="dom-card">
                  {domMood ? (
                    <>
                      <div className="dom-em">{domMood.emoji}</div>
                      <div className="dom-lbl">{domMood.label}</div>
                      <div className="dom-sub">appeared {domCt} day{domCt!==1?"s":""} this month</div>
                    </>
                  ) : (
                    <>
                      <div style={{fontSize:28,opacity:.3,marginBottom:6}}>—</div>
                      <div className="dom-sub">no entries yet</div>
                    </>
                  )}
                </div>

                <div className="streak">
                  {streak > 0 ? `🔥 ${streak} day streak` : "Start your streak today 🌱"}
                </div>

                <div style={{marginTop:16}}>
                  <div className="slabel">Quote of the Month</div>
                  <div className="qcard-ins">
                    <textarea
                      className="qta-ins"
                      value={quote}
                      onChange={e => setQuote(e.target.value)}
                      onBlur={() => saveQuote(year, month, quote)}
                      placeholder="something that moved you this month..."
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT: desktop entry */}
            <div className="right-col">
              {selDay ? (
                <div style={{padding:"28px 24px 44px"}}>
                  <EntryPanel {...ep} />
                </div>
              ) : (
                <div className="ph">
                  <div className="ph-icon">📖</div>
                  <div className="ph-txt">Tap a date<br />to write your memory</div>
                </div>
              )}
            </div>

          </div> {/* end card-content */}
          </div> {/* end card */}
        </div>
      </div>

      {/* MOBILE BOTTOM SHEET */}
      <div className={"backdrop"+(sheetOpen?" open":"")} onClick={() => setSheetOpen(false)} />
      <div className={"bsheet mob-sheet"+(sheetOpen?" open":"")}>
        <div className="handle" />
        <div className="shinner">
          {selDay && <EntryPanel {...ep} />}
        </div>
      </div>
    </>
  );
}

// ─── Entry Panel ──────────────────────────────────────────────────────────────
function EntryPanel({ dayName, selDay, month, year, entry, setEntry, saved, handleSave }) {
  const fileRef = useRef(null);

  const onFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setEntry(p => ({ ...p, photo: ev.target.result }));
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const pad = n => String(n).padStart(2,"0");

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={onFile} />

      <div className="ep-date">{dayName}, {MONTHS[month]} {selDay}</div>
      <div className="ep-sub">{year}-{pad(month+1)}-{pad(selDay)}</div>

      <div className="elabel">Memory</div>
      <div className="pol-wrap">
        <div className="pol" onClick={() => fileRef.current?.click()}>
          {entry.photo ? (
            <>
              <img src={entry.photo} alt="memory" />
              <textarea
                className="pol-cap" value={entry.caption} rows={1}
                onChange={e => setEntry(p => ({...p, caption: e.target.value}))}
                placeholder="add a caption..."
                onClick={e => e.stopPropagation()}
              />
            </>
          ) : (
            <div className="up-area">
              <div className="up-icon">📷</div>
              <div className="up-title">Add a memory</div>
              <div className="up-sub">tap to upload a photo</div>
            </div>
          )}
        </div>
      </div>

      <div className="elabel">How are you feeling?</div>
      <div className="mood-row">
        {MOODS.map(mo => (
          <button
            key={mo.emoji}
            className={"mbtn"+(entry.mood===mo.emoji?" sel":"")}
            onClick={() => setEntry(p => ({...p, mood: p.mood===mo.emoji ? null : mo.emoji}))}
          >{mo.emoji}</button>
        ))}
      </div>

      <div className="elabel">Word of the Day</div>
      <div className="word-wrap">
        <input
          className="word-in" type="text"
          value={entry.word}
          onChange={e => setEntry(p => ({...p, word: e.target.value}))}
          placeholder="one word for today..."
        />
      </div>

      <button className={"sbtn"+(saved?" ok":"")} onClick={handleSave}>
        {saved ? "✓ Saved!" : "Save Entry"}
      </button>
    </>
  );
}
