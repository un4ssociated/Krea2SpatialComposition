import { app } from "../../scripts/app.js";

const KEYS = ["top_left", "top_center", "top_right", "middle_left", "center", "middle_right", "bottom_left", "bottom_center", "bottom_right"];
const LABELS = ["TOP LEFT", "TOP CENTER", "TOP RIGHT", "MIDDLE LEFT", "CENTER", "MIDDLE RIGHT", "BOTTOM LEFT", "BOTTOM CENTER", "BOTTOM RIGHT"];
const DEFAULT_LAYOUT = () => ({ x: [1/3, 2/3], y: [1/3, 2/3], anchors: Array.from({length:9}, (_,i) => [(i%3+.5)/3, (Math.floor(i/3)+.5)/3]) });

function readWidget(node, name) { return node.widgets?.find(w => w.name === name); }
function readLayout(node) {
  try {
    const value = readWidget(node, "layout_json")?.value;
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (parsed?.x?.length === 2 && parsed?.y?.length === 2 && parsed?.anchors?.length === 9) return parsed;
  } catch (_) {}
  return DEFAULT_LAYOUT();
}
function writeLayout(node, layout) {
  const widget = readWidget(node, "layout_json");
  if (widget) widget.value = JSON.stringify(layout);
  node.setDirtyCanvas?.(true, true);
}

function openEditor(node) {
  if (document.getElementById("krea2-spatial-modal")) return;
  const layout = readLayout(node);
  let selected = 4;
  let drag = null;
  const overlay = document.createElement("div");
  overlay.id = "krea2-spatial-modal";
  Object.assign(overlay.style, { position:"fixed", inset:"0", zIndex:"100000", background:"rgba(0,0,0,.78)", display:"flex", alignItems:"center", justifyContent:"center", padding:"18px", fontFamily:"sans-serif", color:"#eee" });
  const panel = document.createElement("div");
  Object.assign(panel.style, { width:"min(980px, 96vw)", maxHeight:"94vh", overflow:"auto", background:"#20242b", border:"1px solid #505965", borderRadius:"12px", padding:"18px", boxShadow:"0 18px 70px #000" });
  overlay.append(panel);
  const header = document.createElement("div");
  Object.assign(header.style, { display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px", marginBottom:"12px" });
  const heading = document.createElement("div");
  heading.innerHTML = '<div style="font-size:18px;font-weight:700">Krea 2 · Spatial Composition</div><div style="font-size:12px;color:#aeb8c5;margin-top:4px">Drag amber markers to place focal points. Drag grid lines to resize regions. Select a region to edit its prompt.</div>';
  const close = document.createElement("button");
  close.textContent = "Close";
  Object.assign(close.style, buttonStyle());
  close.onclick = () => closeEditor();
  header.append(heading, close); panel.append(header);
  const body = document.createElement("div");
  Object.assign(body.style, { display:"grid", gridTemplateColumns:"minmax(240px, 1fr) minmax(260px, .9fr)", gap:"16px" });
  panel.append(body);
  const canvasWrap = document.createElement("div");
  Object.assign(canvasWrap.style, { background:"#11151a", borderRadius:"8px", padding:"10px", display:"flex", justifyContent:"center", alignItems:"flex-start", minHeight:"350px" });
  const canvas = document.createElement("canvas");
  canvas.width = 540; canvas.height = 960;
  Object.assign(canvas.style, { width:"100%", maxWidth:"390px", height:"auto", maxHeight:"72vh", objectFit:"contain", touchAction:"none", cursor:"crosshair" });
  canvasWrap.append(canvas); body.append(canvasWrap);
  const side = document.createElement("div");
  Object.assign(side.style, { display:"flex", flexDirection:"column", gap:"10px", minWidth:"0" }); body.append(side);
  const selectedTitle = document.createElement("div");
  selectedTitle.style.cssText = "font-size:13px;font-weight:700;color:#f0bd69"; side.append(selectedTitle);
  const prompt = document.createElement("textarea");
  prompt.rows = 7; prompt.placeholder = "Describe the subject or visual content for this region…";
  Object.assign(prompt.style, { width:"100%", boxSizing:"border-box", resize:"vertical", background:"#11151a", color:"#eee", border:"1px solid #505965", borderRadius:"7px", padding:"10px", font:"13px/1.45 sans-serif" }); side.append(prompt);
  const note = document.createElement("div");
  note.textContent = "The marker is a prompt-level focal placement hint, not a pixel-accurate mask or latent constraint.";
  note.style.cssText = "font-size:11px;line-height:1.4;color:#aeb8c5"; side.append(note);
  const row = document.createElement("div"); Object.assign(row.style,{display:"flex",gap:"8px",flexWrap:"wrap"}); side.append(row);
  const reset = document.createElement("button"); reset.textContent = "Reset layout"; Object.assign(reset.style,buttonStyle());
  reset.onclick = () => { const fresh=DEFAULT_LAYOUT(); layout.x=fresh.x; layout.y=fresh.y; layout.anchors=fresh.anchors; writeLayout(node,layout); draw(); };
  const clear = document.createElement("button"); clear.textContent = "Clear region"; Object.assign(clear.style,buttonStyle());
  clear.onclick = () => { const w=readWidget(node,KEYS[selected]); if(w) w.value=""; prompt.value=""; draw(); node.setDirtyCanvas?.(true,true); };
  row.append(reset,clear);
  const done = document.createElement("button"); done.textContent = "Save and close"; Object.assign(done.style,{...buttonStyle(),background:"#a66a27",borderColor:"#c78a43",marginTop:"auto"});
  done.onclick = () => { savePrompt(); writeLayout(node,layout); closeEditor(); };
  side.append(done);
  const footer = document.createElement("div"); footer.textContent = "Layout and region text are stored in the workflow. The final generated image does not include this editor grid.";
  footer.style.cssText = "font-size:11px;color:#9da8b5;margin-top:14px"; panel.append(footer);
  document.body.append(overlay);

  function buttonStyle(){ return { background:"#343b45", color:"#eee", border:"1px solid #5b6674", borderRadius:"6px", padding:"8px 11px", cursor:"pointer", fontSize:"12px" }; }
  function bounds(){ return [0,...layout.x,1]; }
  function ybounds(){ return [0,...layout.y,1]; }
  function cellAt(nx,ny){ const xs=bounds(),ys=ybounds(); let c=0,r=0; while(c<2 && nx>xs[c+1])c++; while(r<2 && ny>ys[r+1])r++; return r*3+c; }
  function savePrompt(){ const w=readWidget(node,KEYS[selected]); if(w) w.value=prompt.value; }
  function selectCell(idx){ savePrompt(); selected=idx; const w=readWidget(node,KEYS[selected]); prompt.value=w?.value ?? ""; selectedTitle.textContent=LABELS[selected]+" REGION PROMPT"; draw(); }
  prompt.addEventListener("input",()=>{ const w=readWidget(node,KEYS[selected]); if(w) w.value=prompt.value; node.setDirtyCanvas?.(true,true); });
  function draw(){
    const ctx=canvas.getContext("2d"), W=canvas.width,H=canvas.height, xs=bounds(),ys=ybounds();
    ctx.clearRect(0,0,W,H); ctx.fillStyle="#171c22";ctx.fillRect(0,0,W,H);
    for(let r=0;r<3;r++)for(let c=0;c<3;c++){
      const i=r*3+c,x0=xs[c]*W,y0=ys[r]*H,x1=xs[c+1]*W,y1=ys[r+1]*H;
      ctx.fillStyle=i===selected?"rgba(193,132,54,.18)":"rgba(80,100,120,.07)";ctx.fillRect(x0,y0,x1-x0,y1-y0);
      ctx.strokeStyle=i===selected?"#e3a44f":"#8b99a8";ctx.lineWidth=i===selected?4:2;ctx.strokeRect(x0,y0,x1-x0,y1-y0);
      ctx.fillStyle="#b8c3cf";ctx.font="bold 16px sans-serif";ctx.fillText(LABELS[i],x0+12,y0+25);
      const txt=(readWidget(node,KEYS[i])?.value||"").trim(); if(txt){ctx.fillStyle="#e4e8ed";ctx.font="14px sans-serif";const words=txt.split(/\s+/);let line="",yy=y0+50;for(const word of words){const test=line?line+" "+word:word;if(ctx.measureText(test).width>x1-x0-24){if(line){ctx.fillText(line,x0+12,yy);yy+=18;}line=word;}else line=test;if(yy>y1-12)break;}if(line&&yy<=y1-12)ctx.fillText(line,x0+12,yy);}
    }
    for(let i=0;i<9;i++){const [ax,ay]=layout.anchors[i],x=ax*W,y=ay*H;ctx.beginPath();ctx.arc(x,y,i===selected?13:10,0,Math.PI*2);ctx.fillStyle="#f1b65e";ctx.fill();ctx.lineWidth=3;ctx.strokeStyle="#20242b";ctx.stroke();ctx.fillStyle="#20242b";ctx.font="bold 11px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(String(i+1),x,y);}
    ctx.textAlign="start";ctx.textBaseline="alphabetic";
  }
  function point(e){const rect=canvas.getBoundingClientRect();return {x:(e.clientX-rect.left)/rect.width,y:(e.clientY-rect.top)/rect.height};}
  function nearest(p){let best=null,dist=.025;for(let i=0;i<9;i++){const a=layout.anchors[i],d=Math.hypot(a[0]-p.x,a[1]-p.y);if(d<dist){dist=d;best={kind:"anchor",index:i};}}for(let i=0;i<2;i++){const d=Math.abs(layout.x[i]-p.x);if(d<dist){dist=d;best={kind:"x",index:i};}}for(let i=0;i<2;i++){const d=Math.abs(layout.y[i]-p.y);if(d<dist){dist=d;best={kind:"y",index:i};}}return best;}
  canvas.addEventListener("pointerdown",e=>{const p=point(e);drag=nearest(p);if(!drag){selectCell(cellAt(p.x,p.y));}else if(drag.kind==="anchor")selectCell(drag.index);canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener("pointermove",e=>{if(!drag)return;const p=point(e);if(drag.kind==="anchor"){const i=drag.index,r=Math.floor(i/3),c=i%3,xs=bounds(),ys=ybounds();layout.anchors[i]=[Math.max(xs[c]+.015,Math.min(xs[c+1]-.015,p.x)),Math.max(ys[r]+.015,Math.min(ys[r+1]-.015,p.y))];}else if(drag.kind==="x"){const i=drag.index,lo=i===0?.08:layout.x[0]+.08,hi=i===0?layout.x[1]-.08:.92;layout.x[i]=Math.max(lo,Math.min(hi,p.x));}else{const i=drag.index,lo=i===0?.08:layout.y[0]+.08,hi=i===0?layout.y[1]-.08:.92;layout.y[i]=Math.max(lo,Math.min(hi,p.y));}writeLayout(node,layout);draw();});
  canvas.addEventListener("pointerup",()=>{drag=null;writeLayout(node,layout);});
  canvas.addEventListener("pointercancel",()=>{drag=null;});
  function closeEditor(){ document.removeEventListener("keydown", onKey, true); overlay.remove(); }
  function onKey(e){
    if (e.key !== "Escape") return;
    if (document.activeElement === prompt) { prompt.blur(); return; }
    e.stopPropagation();
    closeEditor();
  }
  document.addEventListener("keydown", onKey, true);

  overlay.addEventListener("click",e=>{if(e.target===overlay)closeEditor();});
  // Populate the panel without going through savePrompt(): on first load the
  // textarea is still empty, and saving it first would blank the selected region.
  prompt.value = readWidget(node, KEYS[selected])?.value ?? "";
  selectedTitle.textContent = LABELS[selected] + " REGION PROMPT";
  draw();
}

app.registerExtension({
  name: "Krea2.SpatialComposition.VisualEditor",
  async nodeCreated(node) {
    if (node.comfyClass !== "Krea2SpatialComposition3x3") return;
    // Keep all nine prompt widgets in the serialized workflow, but edit them in the canvas panel.
    for (const key of KEYS) {
      const widget = readWidget(node, key);
      if (widget) { widget.computeSize = () => [0, -4]; widget.draw = () => {}; }
    }
    let layoutWidget = readWidget(node, "layout_json");
    if (!layoutWidget) {
      layoutWidget = node.addWidget("text", "layout_json", JSON.stringify(DEFAULT_LAYOUT()), v => { layoutWidget.value = v; });
      layoutWidget.computeSize = () => [0, -4]; layoutWidget.draw = () => {};
    }
    const button = node.addWidget("button", "Open 3×3 Visual Editor", null, () => openEditor(node));
    button.serialize = false;
    node.setSize?.([Math.max(node.size[0], 390), Math.max(230, node.size[1])]);
  }
});
