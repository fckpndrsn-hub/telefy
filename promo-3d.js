/* Original SVG ticket, opaque white faces and reflective gold depth. Max motion model. */
(()=>{
 let dependencies;
 async function mount(element){
  if(!element||element._promoMounting)return;element._promoMounting=true;let disposed=false,renderer,environment,raf=0,observer;
  element._promoDispose=()=>{disposed=true;cancelAnimationFrame(raf);observer?.disconnect();document.removeEventListener('visibilitychange',visibility);renderer?.dispose();environment?.dispose();};
  let visible=false,entry;
  function visibility(){if(!disposed&&visible&&!document.hidden&&!raf){previous=performance.now();raf=requestAnimationFrame(frame);}}
  let previous=performance.now();
  function frame(now){
   raf=0;if(disposed||!entry||!visible||document.hidden)return;
   const dt=Math.min((now-previous)/1000,.04);previous=now;const e=entry;
   if(!e.drag&&!e.reduced.matches){e.group.rotation.x+=e.vx*dt*40;e.group.rotation.y+=e.vy*dt*40;const damping=Math.exp(-dt*4);e.vx*=damping;e.vy*=damping;e.group.rotation.y+=dt*.35*Math.min(1,(now-e.release)/1500);e.group.rotation.x+=(-.14-e.group.rotation.x)*dt*.3;}
   e.scene.environmentRotation.y=e.reduced.matches?0:now*.00012;renderer.render(e.scene,e.camera);
   if(!e.reduced.matches||e.drag)raf=requestAnimationFrame(frame);
  }
  try{
   dependencies||=Promise.all([import('./three.module.js'),import('./SVGLoader.js'),fetch('assets/promo-icon.svg').then(r=>{if(!r.ok)throw Error('promo_svg');return r.text();})]);
   const [T,{SVGLoader},source]=await dependencies;if(disposed||!element.isConnected)return;
   const svg=new DOMParser().parseFromString(source,'image/svg+xml'),paths=[...svg.querySelectorAll('path')],outer=paths.at(-1).getAttribute('d').split('Z')[0]+'Z';
   const shapes=new SVGLoader().parse(source).paths.flatMap(p=>SVGLoader.createShapes(p));
   const baseSource='<svg xmlns="http://www.w3.org/2000/svg"><path d="'+outer+'" fill="white"/></svg>',baseShapes=new SVGLoader().parse(baseSource).paths.flatMap(p=>SVGLoader.createShapes(p));
   renderer=new T.WebGLRenderer({alpha:true,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);renderer.setSize(174,147,false);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;renderer.domElement.className='promo-three-canvas';element.append(renderer.domElement);
   const scene=new T.Scene(),camera=new T.PerspectiveCamera(34,174/147,.1,30);camera.position.z=3.4;
   const studio=document.createElement('canvas');studio.width=512;studio.height=256;const ctx=studio.getContext('2d'),gradient=ctx.createLinearGradient(0,0,0,256);
   [[0,'#fff3d5'],[.2,'#ffffff'],[.34,'#fff8de'],[.45,'#ab6715'],[.55,'#ffe5a0'],[.7,'#9b570e'],[.86,'#ffffff'],[1,'#fff1c8']].forEach(([p,c])=>gradient.addColorStop(p,c));ctx.fillStyle=gradient;ctx.fillRect(0,0,512,256);
   for(const x of [50,210,410]){const glow=ctx.createLinearGradient(x-35,0,x+35,0);glow.addColorStop(0,'#fff0');glow.addColorStop(.5,'#fff');glow.addColorStop(1,'#fff0');ctx.fillStyle=glow;ctx.fillRect(x-35,0,70,256);}
   const texture=new T.CanvasTexture(studio);texture.mapping=T.EquirectangularReflectionMapping;const pmrem=new T.PMREMGenerator(renderer);environment=pmrem.fromEquirectangular(texture).texture;scene.environment=environment;pmrem.dispose();texture.dispose();
   scene.add(new T.HemisphereLight(0xffffff,0xc77a16,1.25));for(const z of [4,-4]){const light=new T.DirectionalLight(0xffffff,1.4);light.position.set(2,3,z);scene.add(light);}
   const white=new T.MeshPhysicalMaterial({color:0xfffdf7,metalness:.22,roughness:.2,clearcoat:.8,envMapIntensity:.8});
   const gold=new T.MeshPhysicalMaterial({color:0xffbf23,metalness:1,roughness:.13,clearcoat:.7,envMapIntensity:1.45});
   const body=new T.ExtrudeGeometry(shapes,{depth:12,bevelEnabled:true,bevelSize:.8,bevelThickness:.8,bevelSegments:5,curveSegments:32});
   const back=new T.ExtrudeGeometry(baseShapes,{depth:2,bevelEnabled:true,bevelSize:.5,bevelThickness:.5,bevelSegments:4,curveSegments:32});back.translate(0,0,13);
   const object=new T.Group();object.add(new T.Mesh(body,[white,gold]),new T.Mesh(back,gold));object.scale.setScalar(1.8/169);object.rotation.x=Math.PI;
   const bounds=new T.Box3().setFromObject(object),center=bounds.getCenter(new T.Vector3());object.position.sub(center);const group=new T.Group();group.add(object);scene.add(group);group.rotation.set(-.16,-.45,-.04);
   entry={scene,camera,group,reduced:matchMedia('(prefers-reduced-motion: reduce)'),drag:false,vx:0,vy:0,release:0};element.classList.add('promo-three-ready');let px=0,py=0;
   element.addEventListener('pointerdown',e=>{if(!e.isPrimary||e.button!==0)return;e.preventDefault();e.stopPropagation();element.setPointerCapture(e.pointerId);entry.drag=true;entry.vx=entry.vy=0;px=e.clientX;py=e.clientY;visibility();});
   element.addEventListener('pointermove',e=>{if(!entry.drag)return;e.preventDefault();entry.vy=(e.clientX-px)*.015;entry.vx=(e.clientY-py)*.012;group.rotation.y+=entry.vy;group.rotation.x+=entry.vx;entry.vy=Math.max(-.08,Math.min(.08,entry.vy));entry.vx=Math.max(-.08,Math.min(.08,entry.vx));px=e.clientX;py=e.clientY;});
   const release=e=>{if(!entry.drag)return;entry.drag=false;entry.release=performance.now();if(element.hasPointerCapture(e.pointerId))element.releasePointerCapture(e.pointerId);};element.addEventListener('pointerup',release);element.addEventListener('pointercancel',release);element.addEventListener('lostpointercapture',()=>entry.drag=false);
   element.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft')group.rotation.y-=.25;if(e.key==='ArrowRight')group.rotation.y+=.25;if(e.key==='ArrowUp')group.rotation.x-=.2;if(e.key==='ArrowDown')group.rotation.x+=.2;visibility();});
   observer=new IntersectionObserver(([record])=>{visible=record.isIntersecting;visibility();},{threshold:.05});observer.observe(element);document.addEventListener('visibilitychange',visibility);
   const resize=new ResizeObserver(()=>{if(disposed)return;const w=element.clientWidth||174,h=element.clientHeight||147;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();visibility();});resize.observe(element);
   const cleanup=element._promoDispose;element._promoDispose=()=>{cleanup();resize.disconnect();body.dispose();back.dispose();white.dispose();gold.dispose();};
  }catch(_){dependencies=null;renderer?.dispose();environment?.dispose();/* The supplied SVG remains visible without WebGL. */}
 }
 window.TelefyPromo3D={mount};
})();
