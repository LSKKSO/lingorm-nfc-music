/* ===== 播放器主逻辑（由 build_deploy.py 注入 index.html 第二段 script） ===== */

/* 歌单来源（双重保险）：
   ① 页面里的 <script type="application/json" id="songs-data"> 惰性数据块
      —— 它不参与 JS 解析，即使内容坏了也绝不会让页面白屏；
   ② 后台静默拉 songs.js 覆盖刷新，所以页面被缓存成旧版也不怕。
   两者都拿不到时，列表区显示可读提示，而不是一片空白。 */
let SONGS = [];
try{
  const el = document.getElementById('songs-data');
  if(el){
    const arr = JSON.parse(el.textContent);
    if(Array.isArray(arr)) SONGS = arr;
  }
}catch(e){ SONGS = []; }

const au = document.getElementById('au'),
      nt = document.getElementById('nt'),
      now = document.getElementById('now'),
      list = document.getElementById('list'),
      q = document.getElementById('q'),
      ovl = document.getElementById('ovl'),
      ovlbtn = document.getElementById('ovlbtn');
const BASE = '';
let CURRENT = null, QUEUE = [], qi = 0;
const pre = document.createElement('audio'); pre.preload = 'auto';

function nextOf(s){
  if(!s) return null;
  if(QUEUE.length){
    const idx = QUEUE.indexOf(s);
    if(idx >= 0 && idx < QUEUE.length - 1) return QUEUE[idx + 1];
    return null;
  }
  const i = SONGS.findIndex(x => x.f === s.f);
  if(i >= 0 && i < SONGS.length - 1) return SONGS[i + 1];
  return null;
}

/* 预加载下一首：只做下载缓存，不把它的 src 喂给主播放器（iOS 上那样不可靠） */
function preloadNext(){
  try{
    const n = nextOf(CURRENT);
    if(n){ const u = BASE + encodeURIComponent(n.f); if(pre.src !== u){ pre.src = u; pre.load(); } }
    else { pre.removeAttribute('src'); }
  }catch(e){}
}

function updateMediaSession(s){
  if(!('mediaSession' in navigator)) return;
  try{
    navigator.mediaSession.metadata = new MediaMetadata({title:s.t, artist:'LingOrm', album:'NFC 音乐盒'});
    navigator.mediaSession.playbackState = 'playing';
  }catch(e){}
}

function getNext(){
  if(QUEUE.length){
    if(qi < QUEUE.length - 1) return {s:QUEUE[qi + 1], qi:qi + 1};
    return null;
  }
  const i = SONGS.findIndex(x => x.f === CURRENT.f);
  if(i >= 0 && i < SONGS.length - 1) return {s:SONGS[i + 1], qi:i + 1};
  return null;
}

function play(s, auto){
  if(!s || !s.f) return;
  CURRENT = s; ovl.hidden = true;
  au.src = BASE + encodeURIComponent(s.f);
  nt.textContent = s.t; now.classList.remove('paused');
  [].forEach.call(list.children, li => li.classList.toggle('cur', li.dataset.f === s.f));
  updateMediaSession(s); preloadNext();
  if(auto !== false){
    const p = au.play();
    if(p && p.catch) p.catch(() => { ovlbtn.textContent = '▶ 播放《' + s.t + '》'; ovl.hidden = false; });
  }
}

function advance(){
  const nx = getNext();
  if(!nx){ now.classList.add('paused'); if('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; return; }
  qi = nx.qi; play(nx.s, true);
}
function nextTrack(){
  let nx = null;
  if(QUEUE.length){ if(qi < QUEUE.length - 1) nx = {s:QUEUE[qi + 1], qi:qi + 1}; }
  else { const i = SONGS.findIndex(x => x.f === CURRENT.f); if(i >= 0 && i < SONGS.length - 1) nx = {s:SONGS[i + 1], qi:i + 1}; }
  if(nx){ qi = nx.qi; play(nx.s, true); }
}
function prevTrack(){
  let pv = null;
  if(QUEUE.length){ if(qi > 0) pv = {s:QUEUE[qi - 1], qi:qi - 1}; }
  else { const i = SONGS.findIndex(x => x.f === CURRENT.f); if(i > 0) pv = {s:SONGS[i - 1], qi:i - 1}; }
  if(pv){ qi = pv.qi; play(pv.s, true); }
}

function startFromGate(){ if(CURRENT) play(CURRENT); }
ovlbtn.onclick = e => { e.stopPropagation(); startFromGate(); };
ovl.onclick = startFromGate;

/* 洗牌：Math.random() 必须带括号——旧写法漏了括号，会产生 undefined 项把整个列表渲染搞崩 */
function shuffle(a){
  const b = a.slice();
  for(let i = b.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    const t = b[i]; b[i] = b[j]; b[j] = t;
  }
  return b;
}
function startQueue(arr){
  QUEUE = arr.filter(Boolean);
  qi = 0;
  if(QUEUE.length) play(QUEUE[0]);
}
function render(arr){
  list.innerHTML = '';
  (arr || []).forEach((s, i) => {
    if(!s || !s.f) return;
    const li = document.createElement('li');
    li.dataset.f = s.f;
    li.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="ti"></span>';
    li.querySelector('.ti').textContent = s.t || s.f;
    li.onclick = () => { QUEUE = []; play(s); };
    list.appendChild(li);
  });
}

const pm = new URLSearchParams(location.search);
function syncCount(){ const el = document.getElementById('cntn'); if(el) el.textContent = SONGS.length; }
function showErr(msg){ list.innerHTML = '<li style="color:#ff9b9b;cursor:default">' + msg + '</li>'; }

function boot(){
  if(!Array.isArray(SONGS) || !SONGS.length) return false;
  syncCount();
  const f = pm.get('f');
  if(f){
    const name = decodeURIComponent(f);
    const s = SONGS.find(x => x.f === name) || {f:name, t:name};
    render(SONGS); QUEUE = []; play(s);
  } else if(pm.get('shuffle')){
    render(SONGS); startQueue(shuffle(SONGS));
  } else if(pm.get('all')){
    render(SONGS); startQueue(SONGS);
  } else {
    render(SONGS);
  }
  return true;
}
if(!boot()) showErr('歌单加载中… 若一直空白请下拉刷新');

q.oninput = () => {
  const k = q.value.trim().toLowerCase();
  render(SONGS.filter(s => (s.t || '').toLowerCase().indexOf(k) >= 0));
};
au.onplay = () => { now.classList.remove('paused'); if('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; };
au.onpause = () => { now.classList.add('paused'); if('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; };
au.onended = advance;
if('mediaSession' in navigator){
  try{
    navigator.mediaSession.setActionHandler('play', () => au.play());
    navigator.mediaSession.setActionHandler('pause', () => au.pause());
    navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
    navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
  }catch(e){}
}

/* ===== 后台静默刷新歌单 =====
   页面 HTML 被手机/CDN 缓存成旧版、或内联数据为空时，这里会拉到最新 songs.js
   并自动重渲染，用户无需清缓存。songs.js 取不到就静默忽略，不影响已渲染内容。 */
(function refreshSongs(){
  try{
    if(typeof fetch !== 'function') return;
    fetch('songs.js?t=' + Date.now(), {cache:'no-store'})
      .then(r => r.ok ? r.text() : '')
      .then(t => {
        if(!t) return;
        const m = t.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if(!m) return;
        let arr;
        try{ arr = JSON.parse(m[0]); }catch(e){ return; }
        if(!Array.isArray(arr) || !arr.length) return;
        if(arr.length === SONGS.length) return;
        SONGS = arr;
        syncCount();
        if(!CURRENT) render(SONGS);
      })
      .catch(() => {});
  }catch(e){}
})();
