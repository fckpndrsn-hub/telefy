/* Nested translucent audio layers. Capture a copy; never replace the player's audio route. */
(()=>{
 const audio=document.getElementById('telefy-audio'),motion=matchMedia('(prefers-reduced-motion: reduce)');
 const specs=[['hero-swipe-zone','btn-hero-play'],[null,'full-cover']];
 let raf=0,last=0,phase=0,sound=!audio.paused&&!audio.ended,colours=['#2aabee','#7c63ff'];const nodes=[];
 let context,analyser,capture,source,mute,bins,sourceURL='';let energy=0,low=0,mid=0,high=0,hasSignal=false;
 function disconnect(){source?.disconnect();capture?.getTracks().forEach(t=>t.stop());source=null;capture=null;sourceURL='';hasSignal=false;}
 function prime(){
  // MediaElementSource can silence non-CORS HLS. Only analyse an independent copy.
  const captureFn=audio.captureStream||audio.mozCaptureStream;if(!captureFn)return;
  const url=audio.currentSrc||audio.src;if(!url)return;
  try{if(!url.startsWith('blob:')&&new URL(url,location.href).origin!==location.origin)return;}catch(_){return;}
  try{
   const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return;
   context??=new AudioCtx();if(context.state==='suspended')context.resume().catch(()=>{});
   if(source&&sourceURL===url&&capture.getAudioTracks().some(t=>t.readyState==='live'))return;
   disconnect();capture=captureFn.call(audio);if(!capture.getAudioTracks().length){disconnect();return;}
   analyser??=context.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.78;
   bins=new Uint8Array(analyser.frequencyBinCount);source=context.createMediaStreamSource(capture);source.connect(analyser);
   if(!mute){mute=context.createGain();mute.gain.value=0;analyser.connect(mute);mute.connect(context.destination);}
   sourceURL=url;
  }catch(_){disconnect();}
 }
 function sample(){
  hasSignal=false;let bass=0,middle=0,treble=0;
  if(source&&context?.state==='running'){
   analyser.getByteFrequencyData(bins);const hz=context.sampleRate/analyser.fftSize;
   const band=(a,b)=>{let sum=0,n=0;for(let i=Math.max(1,Math.floor(a/hz));i<Math.min(bins.length,Math.ceil(b/hz));i++){sum+=bins[i]/255;n++;}return n?sum/n:0;};
   bass=band(40,250);middle=band(250,2000);treble=band(2000,9000);hasSignal=bass+middle+treble>.015;
  }
  low+=(bass-low)*.22;mid+=(middle-mid)*.22;high+=(treble-high)*.22;energy+=(Math.max(bass,middle,treble)-energy)*.22;
 }
 function live(){return sound&&state.isPlaying&&!document.hidden;}
 function visible(n){const full=document.getElementById('full-player-modal');return n.visible&&(n.anchor.id==='full-cover'||full.classList.contains('hidden'));}
 function readColours(){const c=getComputedStyle(document.body);colours=[c.getPropertyValue('--theme-accent').trim()||'#2aabee',c.getPropertyValue('--theme-accent2').trim()||'#7c63ff'];refresh();}
 function measure(n){const a=n.anchor.getBoundingClientRect(),p=n.parent.getBoundingClientRect();if(!a.width||!p.width)return;const size=Math.min(a.width*(n.anchor.id==='btn-hero-play'?1.48:2.1),window.innerWidth-24,480),dpr=Math.min(devicePixelRatio||1,1.5);n.w=size;n.h=size;n.dpr=dpr;n.radius=a.width*.5;n.el.style.width=size+'px';n.el.style.height=size+'px';n.el.style.left=(a.left-p.left+a.width/2)+'px';n.el.style.top=(a.top-p.top+a.height/2)+'px';if(n.el.width!==Math.round(size*dpr)){n.el.width=Math.round(size*dpr);n.el.height=Math.round(size*dpr);}}
 function draw(n,t){
  if(!n.w)return;const{ctx,w,h,dpr}=n;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const light=document.body.classList.contains('theme-light');
  const inner=n.radius*1.035,outer=Math.min(w*.455,inner*1.8),span=Math.max(0,outer-inner);
  ctx.globalCompositeOperation='source-over';
  // Nested filled organic discs, matching the reference: no glow or outlines.
  for(let layer=0;layer<5;layer++){
   const radius=outer-span*layer/5,turn=t*.65+layer*.52;
   const gradient=ctx.createLinearGradient(w*.22,h*.82,w*.78,h*.18);
   gradient.addColorStop(0,colours[1]);gradient.addColorStop(1,colours[0]);
   ctx.beginPath();
   for(let j=0;j<=120;j++){
    const angle=j/120*Math.PI*2;
    const warp=Math.sin(angle*3+turn)*.022+Math.cos(angle*2-turn*.8+layer)*.014;
    const beat=hasSignal?low*.018+mid*.008*Math.sin(angle*3):0;
    const r=radius*(1+warp+beat);
    const x=w/2+Math.cos(angle)*r,y=h/2+Math.sin(angle)*r;
    if(j===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
   }
   ctx.closePath();ctx.fillStyle=gradient;
   ctx.globalAlpha=(light?[.07,.10,.16,.22,.28]:[.045,.085,.15,.23,.32])[layer];ctx.fill();
  }
  ctx.globalAlpha=1;
 }
 function tick(now){raf=0;if(!live()||motion.matches)return;if(now-last>=40){sample();phase+=Math.min(now-last||40,80)/1000*(hasSignal?1+energy:.35);last=now;for(const n of nodes)if(visible(n))draw(n,phase);}if(nodes.some(visible))raf=requestAnimationFrame(tick);}
 function refresh(){const active=live();for(const n of nodes){measure(n);n.el.classList.toggle('is-active',active);if(n.visible)draw(n,phase);}if(!active||motion.matches){if(raf)cancelAnimationFrame(raf);raf=0;last=0;}else if(!raf&&nodes.some(visible)){last=0;raf=requestAnimationFrame(tick);}}
 const observer=new IntersectionObserver(entries=>{for(const e of entries){const n=nodes.find(n=>n.el===e.target);if(n)n.visible=e.isIntersecting;}refresh();}),resize=new ResizeObserver(refresh);
 for(const[parentId,anchorId]of specs){const anchor=document.getElementById(anchorId),parent=parentId?document.getElementById(parentId):anchor?.parentElement;if(!anchor||!parent)continue;const el=document.createElement('canvas');el.className='telefy-wave';el.setAttribute('aria-hidden','true');parent.prepend(el);const ctx=el.getContext('2d');if(!ctx){el.remove();continue;}const n={el,parent,anchor,ctx,visible:false};nodes.push(n);observer.observe(el);resize.observe(parent);resize.observe(anchor);}
 document.addEventListener('pointerdown',prime,{passive:true});document.addEventListener('keydown',prime);
 audio.addEventListener('playing',()=>{sound=true;prime();refresh();});
 for(const event of ['pause','waiting','ended','emptied','error'])audio.addEventListener(event,()=>{sound=false;refresh();});
 audio.addEventListener('emptied',disconnect);audio.addEventListener('seeked',()=>{sound=!audio.paused&&!audio.ended&&audio.readyState>=3;refresh();});
 document.addEventListener('visibilitychange',refresh);motion.addEventListener('change',refresh);new MutationObserver(readColours).observe(document.body,{attributes:true,attributeFilter:['class','data-telefy-theme']});
 const render=renderPlayerUI;renderPlayerUI=function(...args){const result=render(...args);refresh();return result;};
 window.TelefyWaves={refresh,prime,get running(){return Boolean(raf);},get spectrum(){return{ready:hasSignal,low,mid,high,energy};}};readColours();
})();
