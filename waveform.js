/* Nested translucent audio layers. Capture a copy; never replace the player's audio route. */
(()=>{
 const audio=document.getElementById('telefy-audio'),motion=matchMedia('(prefers-reduced-motion: reduce)');
 const specs=[['hero-swipe-zone','btn-hero-play'],[null,'full-cover']];
 let raf=0,last=0;const nodes=[];
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
 function live(){return !audio.paused&&!audio.ended&&!document.hidden;}
 function visible(n){const full=document.getElementById('full-player-modal');return n.visible&&(n.anchor.id==='full-cover'||full.classList.contains('hidden'));}
 function measure(n){
  const a=n.anchor.getBoundingClientRect(),p=n.parent.getBoundingClientRect();if(!a.width||!p.width)return;
  const desktopFull=n.anchor.id==='full-cover'&&(innerWidth>=768||matchMedia('(hover: hover) and (pointer: fine)').matches);
  const factor=n.anchor.id==='btn-hero-play'?1.48:desktopFull?1.35:2.1;
  let size=Math.min(a.width*factor,innerWidth-24,480);
  if(desktopFull){
   const cx=a.left+a.width/2,cy=a.top+a.height/2;
   const room=2*Math.max(0,Math.min(cx-p.left,p.right-cx,cy-p.top,p.bottom-cy)-6);
   size=Math.min(size,Math.max(a.width,room));
  }
  n.el.style.width=size+'px';n.el.style.height=size+'px';n.el.style.left=(a.left-p.left+a.width/2)+'px';n.el.style.top=(a.top-p.top+a.height/2)+'px';
 }
 // The base motion is a native CSS animation, independent of Web Audio and JS frame timing.
 function tick(now){raf=0;if(!live()||motion.matches||!source)return;if(now-last>=50){sample();last=now;for(const n of nodes)if(visible(n))n.el.style.setProperty('--audio-energy',String(energy));}if(nodes.some(visible))raf=requestAnimationFrame(tick);}
 function refresh(){
  const active=live();for(const n of nodes){measure(n);n.el.classList.toggle('is-active',active&&visible(n));}
  if(!active||motion.matches||!source){if(raf)cancelAnimationFrame(raf);raf=0;last=0;}
  else if(!raf&&nodes.some(visible)){last=0;raf=requestAnimationFrame(tick);}
 }
 const observer=new IntersectionObserver(entries=>{for(const e of entries){const n=nodes.find(n=>n.el===e.target);if(n)n.visible=e.isIntersecting;}refresh();}),resize=new ResizeObserver(refresh);
 for(const[parentId,anchorId]of specs){
  const anchor=document.getElementById(anchorId),parent=parentId?document.getElementById(parentId):anchor?.parentElement;if(!anchor||!parent)continue;
  const el=document.createElement('div');el.className='telefy-wave';el.setAttribute('aria-hidden','true');
  for(let i=0;i<5;i++){const layer=document.createElement('span');layer.className='telefy-wave-layer';layer.style.setProperty('--layer-inset',(2+i*3.5)+'%');layer.style.setProperty('--layer-alpha',[.055,.09,.15,.23,.32][i]);layer.style.setProperty('--layer-duration',(5.5+i*1.1)+'s');layer.style.setProperty('--layer-delay',(-i*1.3)+'s');el.append(layer);}
  parent.prepend(el);const n={el,parent,anchor,visible:false};nodes.push(n);observer.observe(el);resize.observe(parent);resize.observe(anchor);
 }
 document.addEventListener('pointerdown',prime,{passive:true});document.addEventListener('keydown',prime);
 audio.addEventListener('playing',()=>{prime();refresh();});
 for(const event of ['play','pause','waiting','ended','emptied','error','canplay','timeupdate','seeked'])audio.addEventListener(event,refresh);
 audio.addEventListener('emptied',disconnect);document.addEventListener('visibilitychange',refresh);motion.addEventListener('change',refresh);
 new MutationObserver(refresh).observe(document.body,{attributes:true,attributeFilter:['class','data-telefy-theme']});
 new MutationObserver(refresh).observe(document.getElementById('full-player-modal'),{attributes:true,attributeFilter:['class','style']});
 const render=renderPlayerUI;renderPlayerUI=function(...args){const result=render(...args);refresh();return result;};
 window.TelefyWaves={refresh,prime,get running(){return !motion.matches&&nodes.some(n=>n.el.classList.contains('is-active'));},get spectrum(){return{ready:hasSignal,low,mid,high,energy};}};refresh();
})();
