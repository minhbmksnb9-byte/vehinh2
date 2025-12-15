const C = {
  a: 10,
  b: 20,
  smooth: 0.8,
  sampleMs: 50,
  idleMs: 200,
  grid: 20,
  showGrid: true,
  snap: true,
  longPressMs: 500 // Thời gian nhấn giữ để chọn
};

const S = {
  drawing: false,
  recog: false,
  rDrag: false,
  selMove: false,
  selResize: false,
  pts: [],
  lastT: 0,
  timer: null,
  shape: null,
  hist: [],
  redo: [],
  sel: null,
  selStart: null,
  selEnd: null,
  manip: null,
  manipData: null,
  scale: 1,
  off: {x:0, y:0},
  col: '#000000',
  wid: 2,
  isDashed: false, // Trạng thái nét đứt
  
  // Biến cho touch logic
  touchMode: null, // 'draw', 'pan_zoom', 'select_wait', 'select_drag'
  touchStartData: null,
  longPressTimer: null
};

const cvs = document.getElementById('c');
const ctx = cvs.getContext('2d');
const stTxt = document.getElementById('stTxt');
const stDot = document.getElementById('stDot');

function sz(){
  cvs.width = window.innerWidth;
  cvs.height = window.innerHeight - 50; 
  draw();
}
window.addEventListener('resize', sz);

// --- Các hàm tính toán hình học (Giữ nguyên) ---
function dist(p1, p2){ return Math.sqrt((p1.x-p2.x)**2 + (p1.y-p2.y)**2); }
function ptLine(p, v, w){
  const l2 = dist(v, w)**2;
  if(l2 === 0) return dist(p, v);
  let t = ((p.x - v.x)*(w.x - v.x) + (p.y - v.y)*(w.y - v.y))/l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, {x: v.x + t*(w.x - v.x), y: v.y + t*(w.y - v.y)});
}
function spl(d){
  if(d.length < 3) return d;
  let path = [];
  for(let i=0; i<d.length-1; i++){
    const p0 = i===0 ? d[0] : d[i-1];
    const p1 = d[i];
    const p2 = d[i+1];
    const p3 = i===d.length-2 ? p2 : d[i+2];
    for(let t=0; t<1; t+=0.1){
      const t2 = t*t, t3 = t2*t;
      const x = 0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3);
      const y = 0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3);
      path.push({x,y});
    }
  }
  path.push(d[d.length-1]);
  return path;
}
function detect(){
  if(S.pts.length < 5) return null;
  const p0 = S.pts[0], pN = S.pts[S.pts.length-1];
  let cL = 0;
  for(let p of S.pts) if(ptLine(p, p0, pN) <= C.a) cL++;
  if(cL/S.pts.length >= 0.95){
    return {type:'line', p1:{x:p0.x, y:p0.y}, p2:{x:pN.x, y:pN.y}, c:S.col, w:S.wid, d:S.isDashed};
  }
  let mx = Infinity, Mx = -Infinity, my = Infinity, My = -Infinity;
  for(let p of S.pts){
    mx = Math.min(mx,p.x); Mx = Math.max(Mx,p.x);
    my = Math.min(my,p.y); My = Math.max(My,p.y);
  }
  const cen = {x:(mx+Mx)/2, y:(my+My)/2};
  let rs = S.pts.map(p => dist(p, cen));
  let avR = rs.reduce((a,b)=>a+b,0)/rs.length;
  let dia = avR*2;
  let okC = rs.every(r => Math.abs(r*2 - dia) <= C.b*2);
  if(!okC && rs.filter(r => Math.abs(r*2 - dia) <= C.b*2).length/rs.length > 0.8) okC = true;
  if(okC) return {type:'circle', cx:cen.x, cy:cen.y, r:avR, c:S.col, w:S.wid, d:S.isDashed};
  return null;
}
function setSt(s){
  if(s==='d'){ stTxt.innerText='Đang nhận dạng...'; stDot.style.background='#FFCC00'; }
  else if(s==='ok'){ stTxt.innerText='Thành công'; stDot.style.background='#28A745'; }
  else if(s==='no'){ stTxt.innerText='Không nhận dạng được'; stDot.style.background='#DC3545'; }
  else { stTxt.innerText='Sẵn sàng'; stDot.style.background='#ccc'; }
}
function idle(){
  if(!S.drawing || S.recog || S.rDrag) return;
  setSt('d');
  const res = detect();
  if(res){
    S.recog = true;
    S.shape = res;
    setSt('ok');
    const lp = S.pts[S.pts.length-1];
    if(res.type==='line'){
      const d1 = dist(lp, res.p1), d2 = dist(lp, res.p2);
      S.manip = 'piv';
      S.manipData = {fix: d1<d2?res.p2:res.p1, mov: d1<d2?res.p1:res.p2};
    } else {
      S.manip = 'mov';
      S.manipData = {dx: res.cx-lp.x, dy: res.cy-lp.y};
    }
  } else setSt('no');
  draw();
}
function pushH(o){ S.hist.push(o); if(S.hist.length>50) S.hist.shift(); S.redo=[]; }
function inRect(p, r){ return p.x>=r.x && p.x<=r.x+r.w && p.y>=r.y && p.y<=r.y+r.h; }
function movShp(s, dx, dy){
  if(s.type==='line'){ s.p1.x+=dx; s.p1.y+=dy; s.p2.x+=dx; s.p2.y+=dy; }
  else if(s.type==='circle'){ s.cx+=dx; s.cy+=dy; }
  else if(s.type==='path') s.pts.forEach(p=>{ p.x+=dx; p.y+=dy; });
}
function sclPt(p,cx,cy,f,k=''){
  const kx=k+'x', ky=k+'y';
  p[kx] = cx+(p[kx]-cx)*f; p[ky] = cy+(p[ky]-cy)*f;
}
function scaleSel(f, r){
  const cx = r.x+r.w/2, cy = r.y+r.h/2;
  if(!S.selResize) { r.w*=f; r.h*=f; r.x=cx-r.w/2; r.y=cy-r.h/2; }
  S.hist.forEach(s=>{
    if(s.sel){
      if(s.type==='line'){ sclPt(s.p1,cx,cy,f); sclPt(s.p2,cx,cy,f); }
      else if(s.type==='circle'){ sclPt(s,cx,cy,f,'c'); s.r*=f; }
      else if(s.type==='path') s.pts.forEach(p=>sclPt(p,cx,cy,f));
    }
  });
}

// --- HÀM HỖ TRỢ TOUCH/MOUSE UNIFIED ---

// Lấy tọa độ Client (màn hình) từ event
function getClientPos(e) {
  if(e.touches && e.touches.length > 0) {
    if(e.touches.length === 2) {
        // Trung điểm của 2 ngón tay
        return {
            x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
            y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
            dist: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
        };
    }
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

// Chuyển đổi sang tọa độ Canvas ảo
function getWorldPos(clientPos){
  let cy = clientPos.y - 50; // Trừ thanh toolbar
  return {
    x: (clientPos.x - S.off.x)/S.scale,
    y: (cy - S.off.y)/S.scale
  };
}

// Rung phản hồi (nếu thiết bị hỗ trợ)
function vibrate(){
  if(navigator.vibrate) navigator.vibrate(50);
}

// --- XỬ LÝ SỰ KIỆN CHÍNH ---

function handleStart(e) {
  e.preventDefault(); // Chặn cuộn trang
  const isTouch = e.type.startsWith('touch');
  
  // Xử lý 2 ngón tay: Pan & Zoom
  if (isTouch && e.touches.length === 2) {
    S.touchMode = 'pan_zoom';
    const pos = getClientPos(e);
    S.touchStartData = {
        cx: pos.x, cy: pos.y, dist: pos.dist,
        offX: S.off.x, offY: S.off.y, scale: S.scale
    };
    clearTimeout(S.longPressTimer);
    return;
  }

  // Chuột phải hoặc Ctrl+Click: Chế độ chọn vùng
  if ((!isTouch && e.button === 2) || (e.ctrlKey)) {
    startSelection(e);
    return;
  }
  
  // Chuột giữa: Pan (nhưng 2 ngón tay ưu tiên hơn trên mobile)
  if (!isTouch && e.button === 1) {
    S.touchMode = 'pan_zoom';
    const pos = getClientPos(e);
    S.touchStartData = { cx: pos.x, cy: pos.y, offX: S.off.x, offY: S.off.y };
    cvs.style.cursor = 'grabbing';
    return;
  }

  // 1 Ngón / Chuột trái
  const cPos = getClientPos(e);
  const wPos = getWorldPos(cPos);

  // Check resize handle
  if(S.sel){
    const handleSz = 15 / S.scale; // To hơn chút cho dễ bấm
    const hx = S.sel.x + S.sel.w;
    const hy = S.sel.y + S.sel.h;
    if(wPos.x >= hx - handleSz && wPos.x <= hx + handleSz && 
       wPos.y >= hy - handleSz && wPos.y <= hy + handleSz) {
       S.selResize = true;
       S.manipData = { lp: wPos, startW: S.sel.w };
       return;
    }
  }

  // Check move selection
  if(S.sel && inRect(wPos, S.sel)){
    S.selMove = true; 
    S.manipData = { lp: wPos };
    return;
  }

  // Mặc định: Vẽ hoặc chờ Long Press (để chọn)
  S.touchMode = 'draw';
  
  if (isTouch) {
      // Logic Long Press trên mobile để chọn
      S.touchMode = 'select_wait';
      S.touchStartData = { x: cPos.x, y: cPos.y };
      S.longPressTimer = setTimeout(() => {
          S.touchMode = 'select_drag';
          S.rDrag = true;
          S.selStart = wPos;
          S.selEnd = wPos;
          vibrate(); // Rung báo hiệu đã vào chế độ chọn
          draw();
      }, C.longPressMs);
  } else {
      // Trên PC vẽ luôn
      startDrawing(wPos);
  }
}

function startSelection(e) {
    S.rDrag = true;
    S.selStart = getWorldPos(getClientPos(e));
    S.selEnd = S.selStart;
}

function startDrawing(p) {
    S.sel = null; 
    S.drawing = true; 
    S.recog = false; 
    S.shape = null; 
    S.pts = [p]; 
    S.lastT = Date.now();
    clearTimeout(S.timer); 
    S.timer = setTimeout(idle, C.idleMs);
    draw();
}

function handleMove(e) {
    e.preventDefault();
    const isTouch = e.type.startsWith('touch');
    const cPos = getClientPos(e);
    
    // 1. Xử lý Pan / Zoom
    if (S.touchMode === 'pan_zoom') {
        if(isTouch && e.touches.length === 2 && S.touchStartData.dist) {
            // Tính toán Zoom
            const newScale = S.touchStartData.scale * (cPos.dist / S.touchStartData.dist);
            S.scale = newScale;
            // Tính toán Pan (dịch chuyển theo tâm 2 ngón tay)
            // (Đơn giản hóa: chỉ pan theo độ lệch, zoom tại tâm màn hình để tránh phức tạp)
            S.off.x = S.touchStartData.offX + (cPos.x - S.touchStartData.cx);
            S.off.y = S.touchStartData.offY + (cPos.y - S.touchStartData.cy);
        } else if (!isTouch || (isTouch && !S.touchStartData.dist)) {
            // Chỉ Pan
            S.off.x = S.touchStartData.offX + (cPos.x - S.touchStartData.cx);
            S.off.y = S.touchStartData.offY + (cPos.y - S.touchStartData.cy);
        }
        draw();
        return;
    }

    const wPos = getWorldPos(cPos);

    // 2. Logic Long Press Check (Mobile)
    if (S.touchMode === 'select_wait') {
        // Nếu ngón tay di chuyển quá 5px thì hủy chế độ chờ chọn -> chuyển sang vẽ
        if (Math.hypot(cPos.x - S.touchStartData.x, cPos.y - S.touchStartData.y) > 10) {
            clearTimeout(S.longPressTimer);
            S.touchMode = 'draw';
            startDrawing(wPos); // Bắt đầu vẽ từ vị trí hiện tại
        }
        return;
    }

    // 3. Logic chọn vùng (đang kéo)
    if (S.rDrag || S.touchMode === 'select_drag') {
        S.selEnd = wPos;
        draw();
        return;
    }

    // 4. Resize Selection
    if (S.selResize && S.sel) {
        const dx = wPos.x - S.manipData.lp.x;
        let newW = S.sel.w + dx;
        if(newW < 10) newW = 10;
        const factor = newW / S.sel.w;
        scaleSel(factor, S.sel);
        S.sel.w = newW;
        S.sel.h *= factor;
        S.manipData.lp = wPos;
        draw();
        return;
    }

    // 5. Move Selection
    if (S.selMove && S.sel) {
        const dx = wPos.x - S.manipData.lp.x, dy = wPos.y - S.manipData.lp.y;
        S.sel.x += dx; S.sel.y += dy;
        S.hist.forEach(s => { if(s.sel) movShp(s, dx, dy); });
        S.manipData.lp = wPos;
        draw();
        return;
    }

    // 6. Vẽ hình (Drawing)
    if (!S.drawing) return;
    
    if (S.recog && S.shape) {
        // Đang manipulate hình đã nhận diện
        if(S.manip==='piv'){
          if(C.snap){ S.manipData.mov.x=Math.round(wPos.x/C.grid)*C.grid; S.manipData.mov.y=Math.round(wPos.y/C.grid)*C.grid; }
          else { S.manipData.mov.x=wPos.x; S.manipData.mov.y=wPos.y; }
        } else if(S.manip==='mov'){
          S.shape.cx = wPos.x + S.manipData.dx; S.shape.cy = wPos.y + S.manipData.dy;
          if(C.snap){ S.shape.cx=Math.round(S.shape.cx/C.grid)*C.grid; S.shape.cy=Math.round(S.shape.cy/C.grid)*C.grid; }
        }
    } else {
        // Vẽ nét thường
        if(Date.now()-S.lastT > C.sampleMs){ S.pts.push(wPos); S.lastT=Date.now(); }
        clearTimeout(S.timer); S.timer=setTimeout(idle, C.idleMs);
    }
    draw();
}

function handleEnd(e) {
    clearTimeout(S.longPressTimer);
    const isTouch = e.type.startsWith('touch');

    if (S.touchMode === 'pan_zoom') {
        S.touchMode = null;
        cvs.style.cursor = 'crosshair';
        return;
    }
    
    if (S.selMove) { S.selMove = false; return; }
    if (S.selResize) { S.selResize = false; return; }

    // Kết thúc chọn vùng
    if (S.rDrag || S.touchMode === 'select_drag') {
        S.rDrag = false;
        S.touchMode = null;
        const r = {
            x: Math.min(S.selStart.x, S.selEnd.x), 
            y: Math.min(S.selStart.y, S.selEnd.y), 
            w: Math.abs(S.selStart.x - S.selEnd.x), 
            h: Math.abs(S.selStart.y - S.selEnd.y)
        };
        if(r.w > 0 && r.h > 0){
            S.sel = r;
            S.hist.forEach(s => {
                s.sel = false;
                if(s.type==='line' && inRect(s.p1,r) && inRect(s.p2,r)) s.sel=true;
                else if(s.type==='circle' && inRect({x:s.cx-s.r, y:s.cy-s.r},r) && inRect({x:s.cx+s.r, y:s.cy+s.r},r)) s.sel=true;
                else if(s.type==='path' && s.pts.every(k=>inRect(k,r))) s.sel=true;
            });
        } else S.sel = null;
        draw();
        return;
    }

    if (!S.drawing) return;
    
    // Kết thúc vẽ
    clearTimeout(S.timer); S.drawing=false;
    if(S.recog && S.shape) pushH(S.shape);
    else if(S.pts.length>2) pushH({type:'path', pts:[...S.pts], c:S.col, w:S.wid, d:S.isDashed});
    S.shape=null; S.pts=[]; S.recog=false; setSt(''); 
    draw();
}

// Gán sự kiện (Hỗ trợ cả Mouse và Touch)
cvs.addEventListener('mousedown', handleStart);
cvs.addEventListener('touchstart', handleStart, {passive: false});

cvs.addEventListener('mousemove', handleMove);
cvs.addEventListener('touchmove', handleMove, {passive: false});

window.addEventListener('mouseup', handleEnd);
window.addEventListener('touchend', handleEnd);
window.addEventListener('touchcancel', handleEnd);

cvs.addEventListener('contextmenu', e => e.preventDefault());

// Zoom bằng lăn chuột (chỉ PC)
cvs.addEventListener('wheel', e => {
  e.preventDefault();
  const p = getWorldPos(getClientPos(e));
  if(S.sel && inRect(p, S.sel)){
    const f = e.deltaY<0 ? 1.05 : 0.95;
    scaleSel(f, S.sel);
  } else if(!S.drawing){
    const z = e.deltaY<0 ? 1.1 : 0.9;
    S.scale *= z;
    S.off.x -= (e.clientX - S.off.x)*(z-1);
    S.off.y -= (e.clientY - 50 - S.off.y)*(z-1);
  }
  draw();
}, {passive:false});

// --- RENDER ---
function draw(){
  ctx.save();
  ctx.fillStyle = '#f4f4f4'; ctx.fillRect(0,0,cvs.width,cvs.height);
  ctx.translate(S.off.x, S.off.y); ctx.scale(S.scale, S.scale);
  
  if(C.showGrid) drawGrid();
  S.hist.forEach(s => drawItem(s));
  
  if(S.drawing){
    if(S.recog && S.shape) drawItem(S.shape);
    else drawStroke(S.pts, S.col, S.wid, S.isDashed);
  }
  
  // Vẽ vùng chọn
  if(S.rDrag){
    ctx.strokeStyle='#007bff'; ctx.lineWidth=1/S.scale; ctx.setLineDash([5/S.scale, 3/S.scale]);
    ctx.strokeRect(S.selStart.x, S.selStart.y, S.selEnd.x-S.selStart.x, S.selEnd.y-S.selStart.y);
    ctx.setLineDash([]);
  } else if(S.sel){
    ctx.strokeStyle='#28a745'; ctx.lineWidth=1/S.scale; ctx.setLineDash([4/S.scale, 4/S.scale]);
    ctx.strokeRect(S.sel.x, S.sel.y, S.sel.w, S.sel.h);
    ctx.setLineDash([]);
    const hs = 10/S.scale; 
    ctx.fillStyle = '#007bff';
    ctx.fillRect(S.sel.x + S.sel.w - hs/2, S.sel.y + S.sel.h - hs/2, hs, hs);
  }
  ctx.restore();
}

function drawGrid(){
  ctx.beginPath(); ctx.strokeStyle='#e0e0e0'; ctx.lineWidth=1/S.scale;
  const sx = -S.off.x/S.scale, sy = -S.off.y/S.scale;
  const ex = sx+cvs.width/S.scale, ey = sy+cvs.height/S.scale;
  for(let x=Math.floor(sx/C.grid)*C.grid; x<ex; x+=C.grid){ ctx.moveTo(x,sy); ctx.lineTo(x,ey); }
  for(let y=Math.floor(sy/C.grid)*C.grid; y<ey; y+=C.grid){ ctx.moveTo(sx,y); ctx.lineTo(ex,y); }
  ctx.stroke();
}

function drawItem(s){
  ctx.beginPath();
  ctx.strokeStyle = s.sel ? '#007bff' : s.c;
  ctx.lineWidth = s.w;
  ctx.setLineDash(s.d ? [15,15] : []);
  if(s.type==='line'){ ctx.moveTo(s.p1.x, s.p1.y); ctx.lineTo(s.p2.x, s.p2.y); ctx.stroke(); }
  else if(s.type==='circle'){ ctx.arc(s.cx, s.cy, s.r, 0, Math.PI*2); ctx.stroke(); }
  else drawStroke(s.pts, s.sel?'#007bff':s.c, s.w, s.d);
  if(s.sel) ctx.setLineDash([]);
}

function drawStroke(pts, c, w, d){
  if(pts.length<2) return;
  ctx.beginPath(); ctx.strokeStyle=c; ctx.lineWidth=w; ctx.lineCap='round'; ctx.lineJoin='round';
  if(d) ctx.setLineDash([15,15]);
  if(C.smooth>0){
    const sp = spl(pts);
    ctx.moveTo(sp[0].x, sp[0].y);
    for(let i=1; i<sp.length; i++) ctx.lineTo(sp[i].x, sp[i].y);
  } else {
    ctx.moveTo(pts[0].x, pts[0].y);
    for(let i=1; i<pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

// UI EVENTS
document.getElementById('inpColor').oninput=e=>S.col=e.target.value;
document.getElementById('inpSize').oninput=e=>S.wid=parseInt(e.target.value);
document.getElementById('inpSmooth').oninput=e=>C.smooth=parseFloat(e.target.value);
document.getElementById('inpA').onchange=e=>C.a=parseInt(e.target.value);
document.getElementById('inpB').onchange=e=>C.b=parseInt(e.target.value);
document.getElementById('btnGrid').onclick=e=>{ C.showGrid=!C.showGrid; e.target.classList.toggle('active'); draw(); };
document.getElementById('btnSnap').onclick=e=>{ C.snap=!C.snap; e.target.classList.toggle('active'); };
document.getElementById('btnClear').onclick=()=>{ S.hist=[]; S.sel=null; draw(); };
document.getElementById('btnUndo').onclick=()=>{ if(S.hist.length){ S.redo.push(S.hist.pop()); S.sel=null; draw(); } };
document.getElementById('btnRedo').onclick=()=>{ if(S.redo.length){ S.hist.push(S.redo.pop()); draw(); } };

// Nút xóa chọn (Thay phím Delete)
document.getElementById('btnDelSel').onclick = () => {
    if(S.sel){
        S.hist = S.hist.filter(s => !s.sel);
        S.sel = null;
        draw();
    }
};

// Nút Nét đứt (Thay Ctrl+Click)
document.getElementById('btnDash').onclick = (e) => {
    S.isDashed = !S.isDashed;
    e.target.classList.toggle('active');
    // Nếu đang có hình được chọn, toggle luôn hình đó
    if(S.sel) {
        S.hist.forEach(s => { if(s.sel) s.d = !s.d; });
        draw();
    }
};

document.getElementById('btnSvg').onclick=()=>{
  let s=`<svg xmlns="http://www.w3.org/2000/svg" width="${cvs.width}" height="${cvs.height}">`;
  S.hist.forEach(o=>{
    let d=o.d?'stroke-dasharray="15,15"':'';
    if(o.type==='line') s+=`<line x1="${o.p1.x}" y1="${o.p1.y}" x2="${o.p2.x}" y2="${o.p2.y}" stroke="${o.c}" stroke-width="${o.w}" ${d}/>`;
    else if(o.type==='circle') s+=`<circle cx="${o.cx}" cy="${o.cy}" r="${o.r}" stroke="${o.c}" stroke-width="${o.w}" fill="none" ${d}/>`;
    else { let p=`M ${o.pts[0].x} ${o.pts[0].y}`; for(let i=1;i<o.pts.length;i++)p+=` L ${o.pts[i].x} ${o.pts[i].y}`; s+=`<path d="${p}" stroke="${o.c}" stroke-width="${o.w}" fill="none" ${d}/>`; }
  });
  s+=`</svg>`;
  const u=URL.createObjectURL(new Blob([s],{type:'image/svg+xml'}));
  const a=document.createElement('a'); a.href=u; a.download='draw.svg'; a.click();
};

document.onkeydown=e=>{ 
    if(e.key==='Delete' && S.sel){ S.hist=S.hist.filter(s=>!s.sel); S.sel=null; draw(); }
    if(e.key==='Control') { /* Có thể thêm logic nếu cần */ }
};

sz();
