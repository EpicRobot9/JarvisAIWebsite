export type FXCtx = {
  analyser: React.MutableRefObject<AnalyserNode | null>
  freqData: React.MutableRefObject<Uint8Array | null>
  volumeRef: React.MutableRefObject<number>
}
export type FX = (canvas: HTMLCanvasElement, ctx: FXCtx) => () => void

function withLoop(
  canvas: HTMLCanvasElement,
  draw: (
    c: CanvasRenderingContext2D,
    t: number,
    w: number,
    h: number,
    beat: number,
    ts: number
  ) => void,
  clear = "rgba(2,6,23,0.16)"
) {
  const ctx = canvas.getContext("2d")!
  let start = performance.now()
  let raf = 0,
    stop = false

  function loop(now: number) {
    if (stop) return
    const t = (now - start) / 1000
    const w = canvas.clientWidth,
      h = canvas.clientHeight
    const fallbackBeat = ((Math.sin(t * 2) + 1) / 2) * 0.35
    const beat = Math.max(
      fallbackBeat,
      (window as any).__jarvisVolRef?.current ?? 0
    )
    const ts = 0.75 + beat * 1.4
    if (clear) {
      ctx.fillStyle = clear
      ctx.fillRect(0, 0, w, h)
    }
    draw(ctx, t, w, h, beat, ts)
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
  return () => {
    stop = true
    cancelAnimationFrame(raf)
  }
}

const attachVolRef = (vref: React.MutableRefObject<number>) => {
  ;(window as any).__jarvisVolRef = vref
  return vref.current || 0
}

// --- Lotus Bloom ---
const lotusBloom: FX = (canvas, { volumeRef }) =>
  withLoop(
    canvas,
    (ctx, t, w, h, beat, ts) => {
      attachVolRef(volumeRef)
      const cx = w / 2,
        cy = h / 2,
        petals = 12
      const R = Math.min(w, h) * (0.33 + beat * 0.06)
      const halo = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 1.2)
      halo.addColorStop(0, "rgba(140,200,255,0.18)")
      halo.addColorStop(1, "rgba(140,200,255,0)")
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.2, 0, Math.PI * 2)
      ctx.fill()
      for (let k = 0; k < petals; k++) {
        // Keep rotation speed constant (do not scale with ts/beat)
        const ang = (k / petals) * Math.PI * 2 + t * 0.5
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(ang)
        const grd = ctx.createLinearGradient(-R, 0, R, 0)
        grd.addColorStop(0, "rgba(100,180,255,0)")
        grd.addColorStop(0.5, "rgba(130,200,255,0.98)")
        grd.addColorStop(1, "rgba(190,90,255,0)")
        ctx.fillStyle = grd
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.quadraticCurveTo(R * 0.9, -R * 0.55, R, 0)
        ctx.quadraticCurveTo(R * 0.9, R * 0.55, 0, 0)
        ctx.closePath()
        ctx.shadowColor = "rgba(140,200,255,0.98)"
        ctx.shadowBlur = 34 + beat * 26
        ctx.fill()
        ctx.restore()
      }
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.45)
      core.addColorStop(0, `rgba(255,255,255,${0.5 + beat * 0.4})`)
      core.addColorStop(1, "rgba(255,255,255,0)")
      ctx.fillStyle = core
      ctx.beginPath()
      ctx.arc(cx, cy, R * 0.6, 0, Math.PI * 2)
      ctx.fill()
    }
  )

// --- Neon Tunnel ---
const neonTunnel: FX = (canvas) =>
  withLoop(canvas, (ctx, t, w, h, beat, ts) => {
    const cx = w / 2,
      cy = h / 2,
      speed = 0.6 + beat * 1.6,
      phase = ((t * speed * ts) % 1),
      layers = 22
    for (let i = 0; i < layers; i++) {
      const p = ((i / layers) + phase) % 1,
        s = 1 - p
      const x1 = cx - s * w * 0.55,
        x2 = cx + s * w * 0.55,
        y1 = cy - s * h * 0.55,
        y2 = cy + s * h * 0.55
      const hue = 200 + (i % 2) * 30
      ctx.strokeStyle = `hsla(${hue},100%,65%,${0.25 + 0.65 * (1 - p)})`
      ctx.lineWidth = 1 + (1 - p) * 5 + beat * 2.2
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)
      for (let r = 0; r < 6; r++) {
        const f = (r / 6) * (x2 - x1)
        ctx.beginPath()
        ctx.moveTo(x1 + f, y1)
        ctx.lineTo(x1 + f, y2)
        ctx.strokeStyle = `rgba(255,130,60,${0.12 + 0.25 * (1 - p)})`
        ctx.lineWidth = 0.8 + (1 - p) * 1.2
        ctx.stroke()
      }
    }
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.22)
    g.addColorStop(0, `rgba(120,200,255,${0.5 + beat * 0.4})`)
    g.addColorStop(1, "rgba(120,200,255,0)")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, Math.min(w, h) * 0.22, 0, Math.PI * 2)
    ctx.fill()
  })

// --- Radial Spectrum (Mic) ---
const radialSpectrumMic: FX = (canvas, { freqData }) =>
  withLoop(canvas, (ctx, t, w, h, beat, ts) => {
    const cx = w / 2,
      cy = h / 2,
      inner = Math.min(w, h) * 0.16,
      outer = Math.min(w, h) * 0.48,
      bars = 160,
      a = freqData.current
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(t * 0.2 * ts)
    for (let i = 0; i < bars; i++) {
      let mag = 0.5
      if (a && a.length) {
        const bin = Math.floor((i / bars) * (a.length - 1))
        mag = a[bin] / 255
      }
      const ang = (i / bars) * Math.PI * 2,
        len = inner + (outer - inner) * (mag * 0.98)
      const x1 = Math.cos(ang) * inner,
        y1 = Math.sin(ang) * inner,
        x2 = Math.cos(ang) * len,
        y2 = Math.sin(ang) * len
      const hue = 195 + Math.sin(i * 0.07 + t) * 35
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.strokeStyle = `hsla(${hue},100%,65%,${0.55 + mag * 0.45})`
      ctx.lineWidth = 1.2 + mag * 3.2
      ctx.shadowColor = `hsla(${hue},100%,60%,0.7)`
      ctx.shadowBlur = 12 + mag * 16
      ctx.stroke()
    }
    ctx.restore()
  })

// --- Dual Energy Ribbon ---
const dualEnergyRibbon: FX = (canvas, { volumeRef }) =>
  withLoop(canvas, (ctx, t, w, h, beat, ts) => {
    attachVolRef(volumeRef)
    const cx = w / 2,
      cy = h / 2
    const amp = (Math.min(w, h) * 0.18) * (0.6 + beat * 0.8)
    const len = Math.min(w, h) * 0.8
    const points = 80
    const drawRibbon = (phase: number, hueBase: number) => {
      ctx.beginPath()
      for (let i = 0; i <= points; i++) {
        const p = i / points
        const x = cx + (p - 0.5) * len
        const y =
          cy +
          Math.sin(p * Math.PI * 2 + t * 1.4 * ts + phase) * amp * (0.4 + 0.6 * p)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      const grd = ctx.createLinearGradient(cx - len / 2, cy, cx + len / 2, cy)
      grd.addColorStop(0, `hsla(${hueBase},100%,60%,0.0)`)
      grd.addColorStop(0.5, `hsla(${hueBase + 20},100%,65%,0.9)`)
      grd.addColorStop(1, `hsla(${hueBase + 60},100%,60%,0.0)`)
      ctx.strokeStyle = grd
      ctx.lineWidth = 4 + beat * 6
      ctx.shadowColor = `hsla(${hueBase + 20},100%,60%,0.6)`
      ctx.shadowBlur = 18 + beat * 18
      ctx.stroke()
    }
    drawRibbon(0, 195)
    drawRibbon(Math.PI, 260)
  })

// (EFFECTS map defined at bottom of file with all effects)

// --- Neon Pulses (concentric rings, breath on beat) ---
export const neonPulses: FX = (canvas) => withLoop(canvas, (ctx, t, w, h, beat, ts) => {
  const cx=w/2, cy=h/2, base=Math.min(w,h)*0.25*(1+beat*0.2), rings=11;
  for(let i=0;i<rings;i++){
    const p=i/rings, r=base + p*base*1.1 + Math.sin(t*2*ts+p*6.283)*base*(0.1+beat*0.2);
    const hue=195+Math.sin(t*0.8+i)*35;
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.strokeStyle=`hsla(${hue},100%,${65-p*35}%,${0.7-p*0.5})`;
    ctx.lineWidth=2+(1-p)*4+beat*3; ctx.shadowColor=`hsla(${hue},100%,60%,0.9)`;
    ctx.shadowBlur=20+(1-p)*22+beat*20; ctx.stroke();
  }
  // rotating tick ring
  ctx.save(); ctx.translate(cx,cy); ctx.rotate(t*0.8*ts);
  for(let i=0;i<72;i++){ const a=(i/72)*Math.PI*2, r1=base*0.7, r2=r1+10+Math.sin(t*3+i)*8*(1+beat);
    ctx.beginPath(); ctx.moveTo(Math.cos(a)*r1,Math.sin(a)*r1); ctx.lineTo(Math.cos(a)*r2,Math.sin(a)*r2);
    ctx.strokeStyle="rgba(56,189,248,0.8)"; ctx.lineWidth=1.2; ctx.stroke();
  } ctx.restore();
});

// --- Particle Orbitals (swarming dots) ---
export const particleOrbitals: FX = (canvas) => {
  const W=()=>canvas.clientWidth, H=()=>canvas.clientHeight;
  const count=Math.floor((W()*H())/9000)+120;
  const P=new Array(count).fill(0).map(()=>({a:Math.random()*Math.PI*2,r:Math.random()*Math.min(W(),H())*0.48+20,s:(Math.random()*0.9+0.2)*(Math.random()<.5?-1:1),size:Math.random()*1.8+0.8,h:185+Math.random()*40}));
  return withLoop(canvas,(ctx,t,w,h,beat,ts)=>{ const cx=w/2,cy=h/2; ctx.fillStyle="rgba(2,6,23,0.22)"; ctx.fillRect(0,0,w,h);
    P.forEach(p=>{ p.a += p.s*(0.006*ts + beat*0.01); const x=cx+Math.cos(p.a)*p.r, y=cy+Math.sin(p.a)*p.r, s=p.size*(1+beat*0.9);
      const g=ctx.createRadialGradient(x,y,0,x,y,s*12); g.addColorStop(0,`hsla(${p.h},100%,70%,.8)`); g.addColorStop(1,`hsla(${p.h},100%,50%,0)`);
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,s*3.2,0,Math.PI*2); ctx.fill();
    });
  });
};

// --- Hex Grid Glow (lattice flow) ---
export const hexGridGlow: FX = (canvas) => {
  const size=28, hexH=Math.sin(Math.PI/3)*size;
  const cols=Math.ceil(canvas.clientWidth/(size*1.5))+2, rows=Math.ceil(canvas.clientHeight/(hexH*2))+2;
  const cells: {x:number;y:number;ph:number}[]=[]; for(let r=-1;r<rows;r++){for(let c=-1;c<cols;c++){cells.push({x:c*size*1.5+((r%2)*size*0.75),y:r*hexH*2,ph:Math.random()*Math.PI*2});}}
  const hex=(ctx:CanvasRenderingContext2D,x:number,y:number,s:number)=>{ctx.beginPath();for(let i=0;i<6;i++){const a=(Math.PI/3)*i;const px=x+Math.cos(a)*s,py=y+Math.sin(a)*s;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();};
  return withLoop(canvas,(ctx,t,w,h,beat,ts)=>{ ctx.fillStyle="rgba(2,6,23,0.22)"; ctx.fillRect(0,0,w,h); ctx.save(); ctx.translate((w-cols*size*1.5)/2+size,(h-rows*hexH*2)/2+size);
    cells.forEach(c=>{ const pulse=(Math.sin(t*2*ts+c.ph+(c.x+c.y)*0.01)+1)/2, hue=190+pulse*30, a=0.08+pulse*0.5+beat*0.25;
      ctx.lineWidth=1.2+pulse*2+beat*1.4; ctx.strokeStyle=`hsla(${hue},100%,65%,${a})`; ctx.shadowColor=`hsla(${hue},100%,60%,${a})`; ctx.shadowBlur=16+pulse*20+beat*18;
      hex(ctx,c.x,c.y,size); ctx.stroke();
    }); ctx.restore();
  });
};

// --- Circuit Rain (vertical streams + splashes) ---
export const circuitRain: FX = (canvas) => {
  const cols=Math.ceil(canvas.clientWidth/14);
  const drops=new Array(cols).fill(0).map((_,i)=>({x:i*14+Math.random()*8,y:Math.random()*-canvas.clientHeight,s:2+Math.random()*4}));
  return withLoop(canvas,(ctx,t,w,h,beat,ts)=>{ ctx.fillStyle="rgba(2,6,23,0.18)"; ctx.fillRect(0,0,w,h);
    drops.forEach((d,i)=>{ d.y += d.s*4.2*(1+beat*1.1)*ts; if(d.y>h+40){ d.y=-Math.random()*200; d.x=(i*14)%w; d.s=2+Math.random()*4; }
      const hue=190+((d.x/w)*40); ctx.strokeStyle=`hsla(${hue},100%,65%,.85)`; ctx.lineWidth=2.2; ctx.beginPath(); ctx.moveTo(d.x,d.y-26); ctx.lineTo(d.x,d.y); ctx.stroke();
      ctx.fillStyle=`hsla(${hue},100%,70%,.75)`; ctx.beginPath(); ctx.arc(d.x,d.y,3.1,0,Math.PI*2); ctx.fill();
      if(d.y>h-6){ ctx.fillStyle=`hsla(${hue},100%,70%,.45)`; ctx.beginPath(); ctx.arc(d.x,h-4,5+beat*8,0,Math.PI*2); ctx.fill(); }
    });
  });
};

// --- Aurora Waves (silky wisps) ---
export const auroraWaves: FX = (canvas) => {
  const seeds=new Array(6).fill(0).map(()=>({h:200+Math.random()*30}));
  const noise=(x:number,y:number,t:number)=>Math.sin(x*0.002+t*0.7)+Math.cos(y*0.0025+t*0.35);
  return withLoop(canvas,(ctx,t,w,h,beat,ts)=>{ ctx.fillStyle="rgba(3,7,18,0.18)"; ctx.fillRect(0,0,w,h);
    seeds.forEach((s,idx)=>{ const rows=10; ctx.beginPath(); for(let y=0;y<=rows;y++){ const yy=(y/rows)*h;
      for(let x=0;x<=w;x+=6){ const n=noise(x,yy,t*ts+idx*0.4), dy=Math.sin(x*0.012+t*1.1*ts+n)*18*(1+beat*1.6); x?ctx.lineTo(x,yy+dy):ctx.moveTo(x,yy+dy); } }
      const g=ctx.createLinearGradient(0,0,w,h); g.addColorStop(0,`hsla(${s.h},100%,75%,.3)`); g.addColorStop(1,`hsla(${s.h+10},100%,55%,.08)`);
      ctx.strokeStyle=g; ctx.lineWidth=1.2+idx*0.35; ctx.shadowColor=`hsla(${s.h},100%,70%,.35)`; ctx.shadowBlur=22; ctx.stroke();
    });
  });
};

// --- Swirl Sprites (curved energy strokes) ---
export const swirlSprites: FX = (canvas) => withLoop(canvas,(ctx,t,w,h,beat,ts)=>{ 
  ctx.fillStyle="rgba(2,6,23,0.2)"; ctx.fillRect(0,0,w,h);
  for(let i=0;i<10;i++){ const bx=w/2+Math.sin(t*0.9*ts+i)*w*0.26, by=h/2+Math.cos(t*1.0*ts+i)*h*0.2, r=34+(i%3)*28+beat*50;
    ctx.beginPath(); for(let a=0;a<Math.PI*2;a+=0.16){ const x=bx+Math.cos(a)*(r+Math.sin(t*2.6*ts+a*3+i)*10*(1+beat));
      const y=by+Math.sin(a)*(r+Math.cos(t*2.0*ts+a*2+i)*10*(1+beat)); a?ctx.lineTo(x,y):ctx.moveTo(x,y); }
    const hue=200+(i*20)%120; ctx.strokeStyle=`hsla(${hue},100%,70%,${0.4+beat*0.5})`; ctx.lineWidth=2.5+beat*2.2; ctx.shadowColor=`hsla(${hue},100%,60%,.95)`; ctx.shadowBlur=22+beat*18; ctx.stroke();
  }
});

// --- Photon Streaks (hyper-speed beams) ---
export const photonStreaks: FX = (canvas) => withLoop(canvas,(ctx,t,w,h,beat,ts)=>{ 
  ctx.fillStyle="rgba(7,6,26,0.28)"; ctx.fillRect(0,0,w,h);
  const ox=w*0.12, oy=h*0.5, layers=8;
  for(let i=0;i<layers;i++){ const y=oy+(i-layers/2)*(14+beat*12), len=w*0.9, thick=2.2+i*0.6+beat*2.6, hue=260+i*10;
    const g=ctx.createLinearGradient(ox,y,ox+len,y); g.addColorStop(0,`hsla(${hue},100%,70%,0)`); g.addColorStop(0.12,`hsla(${hue},100%,70%,.9)`); g.addColorStop(0.6,`hsla(${hue-40},100%,60%,.7)`); g.addColorStop(1,`hsla(${hue},100%,50%,0)`);
    ctx.strokeStyle=g; ctx.lineWidth=thick; ctx.beginPath(); ctx.moveTo(ox,y); ctx.lineTo(ox+len,y+Math.sin(t*3*ts+i)*10*(1+beat)); ctx.stroke();
  }
});

// --- Halo Portal (gold ring + sparks) ---
export const haloPortal: FX = (canvas) => { 
  const sparks=new Array(140).fill(0).map(()=>({x:0,y:0,v:0}));
  return withLoop(canvas,(ctx,t,w,h,beat,ts)=>{ ctx.fillStyle="rgba(12,10,6,0.35)"; ctx.fillRect(0,0,w,h);
    const cx=w/2, cy=h*0.62, R=Math.min(w,h)*0.24*(1+beat*0.15);
    const rg=ctx.createRadialGradient(cx,cy,R*0.85,cx,cy,R*1.4); rg.addColorStop(0,"rgba(255,200,80,0.45)"); rg.addColorStop(1,"rgba(255,200,80,0)");
    ctx.fillStyle=rg; ctx.beginPath(); ctx.arc(cx,cy,R*1.5,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle="rgba(255,198,88,0.92)"; ctx.lineWidth=5+beat*3.5; ctx.shadowColor="rgba(255,190,80,0.95)"; ctx.shadowBlur=28+beat*20;
    ctx.beginPath(); ctx.arc(cx,cy,R+Math.sin(t*4*ts)*4*beat,0,Math.PI*2); ctx.stroke();
    sparks.forEach(s=>{ if(s.y>h+20||s.y===0){ const a=Math.random()*Math.PI*2; s.x=cx+Math.cos(a)*R; s.y=cy+Math.sin(a)*R; s.v=1+Math.random()*4+beat*4; }
      s.y += s.v*ts; ctx.fillStyle="rgba(255,210,120,0.75)"; ctx.beginPath(); ctx.arc(s.x,s.y,1.6,0,Math.PI*2); ctx.fill();
    });
  });
};

// Export a single EFFECTS map including built-ins and added effects
export const EFFECTS = {
  // already shipped
  "Lotus Bloom": lotusBloom,
  "Neon Tunnel": neonTunnel,
  "Radial Spectrum (Mic)": radialSpectrumMic,
  "Dual Energy Ribbon": dualEnergyRibbon,
  // new additions
  "Neon Pulses": neonPulses,
  "Particle Orbitals": particleOrbitals,
  "Hex Grid Glow": hexGridGlow,
  "Circuit Rain": circuitRain,
  "Aurora Waves": auroraWaves,
  "Swirl Sprites": swirlSprites,
  "Photon Streaks": photonStreaks,
  "Halo Portal": haloPortal,
} as const
