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

const nt = document.getElementById('nt'),
      now = document.getElementById('now'),
      list = document.getElementById('list'),
      q = document.getElementById('q'),
      ovl = document.getElementById('ovl'),
      ovlbtn = document.getElementById('ovlbtn'),
      cntn = document.getElementById('cntn');
const BASE = '';
let CURRENT = null, QUEUE = [], qi = 0;

/* ── 双元素引擎（后台/息屏连播的关键）──────────────────────────────
   移动端（尤其 Android / 国产 ROM）在后台或息屏时会节流 timeupdate、
   并拒绝「脚本在后台发起的 play()」，于是旧版「onended 里 play 下一首」
   在后台就静默停住。
   解法：cur 正在响，nxt 在当前曲还在响时就（音量0）预播下一首——
   这一步在前台发起，后台/息屏也安全；曲终 ended 时只改属性
   （nxt.currentTime=0 + nxt.volume=1），绝不重新 play()，
   所以后台/息屏交接稳定不断流，且不剪歌头、不叠音。 */
const A = document.getElementById('au');
const B = document.createElement('audio'); B.preload = 'auto';
document.body.appendChild(B);
let cur = A, nxt = B, nxtPrepared = false, nextMeta = null;
const PRESTART = 2;   // timeupdate 兜底：临近结束也确保预播已就绪

function highlight(s){ [].forEach.call(list.children, li => li.classList.toggle('cur', li && li.dataset && li.dataset.f === (s && s.f))); }
function updateMediaSession(s){
  if(!('mediaSession' in navigator) || !s) return;
  try{
    navigator.mediaSession.metadata = new MediaMetadata({title:s.t, artist:'LingOrm', album:'NFC 音乐盒'});
    navigator.mediaSession.playbackState = 'playing';
  }catch(e){}
}

/* 取下一首：队列/整库播完都自动循环回开头，做到「永不静默停住」 */
function getNext(){
  if(QUEUE.length){
    if(qi < QUEUE.length - 1) return {s:QUEUE[qi + 1], qi:qi + 1};
    if(QUEUE.length > 1) return {s:QUEUE[0], qi:0, looped:true};   // 队列循环
    return null;
  }
  if(CURRENT && CURRENT.f){
    const i = SONGS.findIndex(x => x.f === CURRENT.f);
    if(i >= 0){
      if(i < SONGS.length - 1) return {s:SONGS[i + 1], qi:i + 1};
      if(SONGS.length > 1) return {s:SONGS[0], qi:0, looped:true}; // 整库循环
    }
  }
  return null;
}

/* 在 cur 上播放 s（用户手势 / 前台发起的播放都走这里，后台安全） */
function realPlay(s, auto){
  if(!s || !s.f) return Promise.resolve();
  if(nxt && nxt !== cur){ try{ nxt.pause(); }catch(e){} }
  nxtPrepared = false; nextMeta = null;
  CURRENT = s; ovl.hidden = true;
  cur.src = BASE + encodeURIComponent(s.f);
  try{ cur.load(); }catch(e){}
  nt.textContent = s.t; now.classList.remove('paused'); highlight(s); updateMediaSession(s);
  prepareNext();   // 一开播就立刻预播下一首（音量0，前台发起，后台安全）——必须在 play 之前，否则自动播放路径被 return 跳过
  if(auto !== false){
    const p = cur.play();
    if(p && p.catch) return p.catch(() => { ovlbtn.textContent = '▶ 播放《' + s.t + '》'; ovl.hidden = false; });
  }
  return Promise.resolve();
}

/* 预播下一首：nxt 音量0 播放，ended 交接时再调回音量，绝不剪头 */
function prepareNext(){
  if(nxtPrepared || !CURRENT) return;
  const nx = getNext();
  if(!nx) return;
  try{
    nxt.src = BASE + encodeURIComponent(nx.s.f);
    nxt.load(); nxt.volume = 0;
    const p = nxt.play();
    if(p && p.catch){
      p.then(() => { nxtPrepared = true; nextMeta = nx; })
       .catch(() => { nxtPrepared = false; });
    } else { nxtPrepared = true; nextMeta = nx; }
  }catch(e){ nxtPrepared = false; }
}

/* 交接：cur 播完 → 把已预播的 nxt 转正。只改属性、不重新 play，后台安全 */
function handoff(){
  if(!nxtPrepared || !nextMeta){            // 没准备好，退化续播（极少走）
    const nx = getNext();
    if(nx){ qi = nx.qi; realPlay(nx.s, true); }
    else { now.classList.add('paused'); if('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; }
    return;
  }
  try{ cur.pause(); }catch(e){}
  try{ nxt.currentTime = 0; }catch(e){}      // 回拨到开头 → 不剪歌头
  nxt.volume = 1;
  CURRENT = nextMeta.s; qi = nextMeta.qi;
  nt.textContent = CURRENT.t; now.classList.remove('paused'); highlight(CURRENT); updateMediaSession(CURRENT);
  const t = cur; cur = nxt; nxt = t;        // 交换角色，原 nxt 成为新的 cur（正响着）
  nxtPrepared = false; nextMeta = null;
  prepareNext();                            // 为新的下一首预播
}

function onEnded(){ if(this === cur) handoff(); }
function onTime(){
  if(this !== cur) return;
  if(cur.duration && isFinite(cur.duration)){
    const r = cur.duration - cur.currentTime;
    if(r <= PRESTART) prepareNext();
  }
}
A.onended = onEnded; B.onended = onEnded;
A.ontimeupdate = onTime; B.ontimeupdate = onTime;
A.onplay = () => { now.classList.remove('paused'); if('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; };
B.onplay = () => { now.classList.remove('paused'); if('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; };
A.onpause = () => { if(cur === A && !cur.ended) now.classList.add('paused'); };
B.onpause = () => { if(cur === B && !cur.ended) now.classList.add('paused'); };

function nextTrack(){
  const nx = getNext();
  if(nx){ qi = nx.qi; realPlay(nx.s, true); }
}
function prevTrack(){
  let pv = null;
  if(QUEUE.length){
    if(qi > 0) pv = {s:QUEUE[qi - 1], qi:qi - 1};
    else if(QUEUE.length > 1) pv = {s:QUEUE[QUEUE.length - 1], qi:QUEUE.length - 1};
  } else {
    const i = SONGS.findIndex(x => x.f === (CURRENT && CURRENT.f));
    if(i > 0) pv = {s:SONGS[i - 1], qi:i - 1};
    else if(SONGS.length > 1) pv = {s:SONGS[SONGS.length - 1], qi:SONGS.length - 1};
  }
  if(pv){ qi = pv.qi; realPlay(pv.s, true); }
}

function startFromGate(){ if(CURRENT) realPlay(CURRENT); }
ovlbtn.onclick = e => { e.stopPropagation(); startFromGate(); };
ovl.onclick = startFromGate;

/* 洗牌：Math.random() 必须带括号 */
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
  if(QUEUE.length) realPlay(QUEUE[0], true);
}
function render(arr){
  list.innerHTML = '';
  (arr || []).forEach((s, i) => {
    if(!s || !s.f) return;
    const li = document.createElement('li');
    li.dataset.f = s.f;
    li.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="ti"></span>';
    li.querySelector('.ti').textContent = s.t || s.f;
    li.onclick = () => { QUEUE = []; realPlay(s); };
    list.appendChild(li);
  });
}

const pm = new URLSearchParams(location.search);
function syncCount(){ if(cntn) cntn.textContent = SONGS.length; }
function showErr(msg){ list.innerHTML = '<li style="color:#ff9b9b;cursor:default">' + msg + '</li>'; }

function boot(){
  if(!Array.isArray(SONGS) || !SONGS.length) return false;
  syncCount();
  const f = pm.get('f');
  if(f){
    const name = decodeURIComponent(f);
    const s = SONGS.find(x => x.f === name) || {f:name, t:name};
    render(SONGS); QUEUE = []; realPlay(s, true);
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

if('mediaSession' in navigator){
  try{
    navigator.mediaSession.setActionHandler('play', () => realPlay(CURRENT, true));
    navigator.mediaSession.setActionHandler('pause', () => cur.pause());
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
        if(arr.length === SONGS.length && JSON.stringify(arr.map(x=>x.f)) === JSON.stringify(SONGS.map(x=>x.f))) return;
        if(QUEUE.length && CURRENT){
          const map = {}; arr.forEach(x => map[x.f] = x);
          const newQ = QUEUE.map(x => map[x.f]).filter(Boolean);
          QUEUE = newQ.length ? newQ : arr;
        }
        SONGS = arr;
        syncCount();
        if(!CURRENT) render(SONGS);
      })
      .catch(() => {});
  }catch(e){}
})();
