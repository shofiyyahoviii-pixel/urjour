import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase Config ──────────────────────────────────────────────────────────
// Ganti dua nilai ini dengan milik kamu dari Supabase dashboard
const SUPABASE_URL  = "https://pymdlenbgoylrvowtolz.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5bWRsZW5iZ295bHJ2b3d0b2x6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NDkxMjcsImV4cCI6MjA4OTQyNTEyN30.-VNyzSPc4W6-hYXioR8FL7xcsfZgzq9mKldsqHS64qo";
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

// ─── Page flip sound (real paper sound) ──────────────────────────────────────
const FLIP_SOUND = "data:audio/mp3;base64,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";

function playFlip() {
  try {
    const audio = new Audio(FLIP_SOUND);
    audio.volume = 0.85; // volume kencang
    audio.play().catch(() => {});
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

  Konsep baru yang bersih — KEDUA arah identik:
  - Overlay halaman muncul di atas konten (flat, terlihat)
  - Berputar ke edge-on (90°) di titik tengah — konten ganti di sini
  - Landing flat di sisi lain

  NEXT: hinge kiri, 0° → -180°  (halaman pergi ke kiri)
  PREV: hinge kiri, 0° → +180°  (halaman pergi ke kanan — mirror)

  Konten selalu ganti saat halaman edge-on (tidak terlihat) = zero jump.

  ──────────────────────────────────────────────────────────────────────────── */

.card { overflow: hidden; }
.card.is-flipping { overflow: visible; }

.page-turn-stage {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 50;
  perspective: 2400px;
  perspective-origin: 50% 36%;
  overflow: visible;
  border-radius: 2px 14px 14px 2px;
}

.page-flap {
  position: absolute;
  inset: 0;
  transform-origin: left center;
  transform-style: preserve-3d;
  will-change: transform;
}

/* NEXT: pergi ke kiri */
.page-turn-stage.turning-next .page-flap {
  animation: flipNext 0.85s cubic-bezier(0.4, 0.0, 0.2, 1.0) forwards;
}
/* PREV: pergi ke kanan (mirror) */
.page-turn-stage.turning-prev .page-flap {
  animation: flipPrev 0.85s cubic-bezier(0.4, 0.0, 0.2, 1.0) forwards;
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

/* NEXT front: shadow di kiri saat halaman pergi ke kiri */
.page-turn-stage.turning-next .page-flap-front::after {
  background: linear-gradient(to left, rgba(20,8,2,0.22) 0%, rgba(20,8,2,0.06) 30%, transparent 60%);
  animation: shadowLift 0.85s ease-in-out forwards;
}
/* NEXT back: shadow saat landing */
.page-turn-stage.turning-next .page-flap-back::after {
  background: linear-gradient(to right, rgba(20,8,2,0.16) 0%, rgba(20,8,2,0.04) 35%, transparent 65%);
  animation: shadowLand 0.85s ease-in-out forwards;
}

/* PREV front: shadow di kanan saat halaman pergi ke kanan */
.page-turn-stage.turning-prev .page-flap-front::after {
  background: linear-gradient(to right, rgba(20,8,2,0.22) 0%, rgba(20,8,2,0.06) 30%, transparent 60%);
  animation: shadowLift 0.85s ease-in-out forwards;
}
/* PREV back: shadow saat landing */
.page-turn-stage.turning-prev .page-flap-back::after {
  background: linear-gradient(to left, rgba(20,8,2,0.16) 0%, rgba(20,8,2,0.04) 35%, transparent 65%);
  animation: shadowLand 0.85s ease-in-out forwards;
}

/* ── Keyframes ── */

/* NEXT: 0° → -180° */
@keyframes flipNext {
  0%   { transform: rotateY(0deg);    }
  100% { transform: rotateY(-180deg); }
}

/* PREV: 0° → +180° (mirror dari next) */
@keyframes flipPrev {
  0%   { transform: rotateY(0deg);   }
  100% { transform: rotateY(180deg); }
}

/* Shadow naik saat halaman terangkat, hilang di 90° */
@keyframes shadowLift {
  0%   { opacity: 0;    }
  20%  { opacity: 0.80; }
  45%  { opacity: 0.50; }
  55%  { opacity: 0;    }
  100% { opacity: 0;    }
}

/* Shadow landing: muncul setelah 90°, hilang saat flat */
@keyframes shadowLand {
  0%   { opacity: 0;    }
  50%  { opacity: 0;    }
  70%  { opacity: 0.55; }
  88%  { opacity: 0.20; }
  100% { opacity: 0;    }
}

/* Card content crossfade — ganti saat halaman edge-on */
.card-content {
  width: 100%;
  transition: opacity 0.08s ease-in-out;
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
    setTurning(dir);
    if (cardRef.current) cardRef.current.classList.add("is-flipping");

    // Halaman edge-on (tidak terlihat) di ~42% dari 850ms ≈ 355ms
    // Swap konten tepat di situ — tidak ada jump karena halaman sedang tegak
    setTimeout(() => setFading(true), 330);
    setTimeout(() => {
      if (dir === "next") {
        if (month === 11) { setYear(y => y + 1); setMonth(0); }
        else setMonth(m => m + 1);
      } else {
        if (month === 0) { setYear(y => y - 1); setMonth(11); }
        else setMonth(m => m - 1);
      }
      setSelDay(null);
      setSheetOpen(false);
      setFading(false);
    }, 380);

    setTimeout(() => {
      setTurning("");
      if (cardRef.current) cardRef.current.classList.remove("is-flipping");
    }, 900);
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
                      onBlur={() => dbSaveQuote(user.id, year, month, quote)}
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
