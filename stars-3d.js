/* Extrude the supplied gold SVG, including its darker outline. */
window.TelefyStars3D={async mount(element){
 if(!element)return;let disposed=false,renderer=null,frame=0,scene=null,environment=null;
 const materials=[],geometries=[],textures=[];let observer=null;
 const dispose=()=>{if(disposed)return;disposed=true;cancelAnimationFrame(frame);observer?.disconnect();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());environment?.dispose();renderer?.dispose();renderer?.domElement.remove();element.classList.remove('stars-three-ready');};
 element._starsDispose=dispose;
 try{
  const [T,{SVGLoader},response]=await Promise.all([import('./vendor/three.module.js'),import('./vendor/SVGLoader.js'),fetch('assets/star.svg')]);
  if(!response.ok)throw Error('star_asset');const source=await response.text();if(disposed||!element.isConnected)return;
  const doc=new DOMParser().parseFromString(source,'image/svg+xml');doc.querySelector('defs')?.remove();doc.querySelectorAll('path').forEach((p,i)=>p.setAttribute('fill',i?'#d17200':'#ffd45d'));
  const paths=new SVGLoader().parse(new XMLSerializer().serializeToString(doc)).paths;
  renderer=new T.WebGLRenderer({alpha:true,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;
  renderer.domElement.className='stars-three-canvas';element.append(renderer.domElement);
  scene=new T.Scene();const camera=new T.PerspectiveCamera(38,1,.1,30);camera.position.z=4.5;const group=new T.Group();scene.add(group);
  const studio=document.createElement('canvas');studio.width=256;studio.height=128;const ctx=studio.getContext('2d'),gradient=ctx.createLinearGradient(0,0,0,128);[[0,'#fff'],[.3,'#fff8d4'],[.5,'#b18e41'],[.65,'#fff'],[1,'#ead5a0']].forEach(([p,c])=>gradient.addColorStop(p,c));ctx.fillStyle=gradient;ctx.fillRect(0,0,256,128);
  const texture=new T.CanvasTexture(studio);texture.mapping=T.EquirectangularReflectionMapping;const pmrem=new T.PMREMGenerator(renderer);environment=pmrem.fromEquirectangular(texture).texture;scene.environment=environment;pmrem.dispose();texture.dispose();
  scene.add(new T.HemisphereLight(0xffffff,0xa57422,.8));const light=new T.DirectionalLight(0xffffff,1.5);light.position.set(-2,3,5);scene.add(light);
  const gold=document.createElement('canvas');gold.width=gold.height=128;const gctx=gold.getContext('2d'),goldGradient=gctx.createLinearGradient(110,10,15,110);goldGradient.addColorStop(0,'#fff15c');goldGradient.addColorStop(.31,'#ffd085');goldGradient.addColorStop(.89,'#f5e533');gctx.fillStyle=goldGradient;gctx.fillRect(0,0,128,128);const goldTexture=new T.CanvasTexture(gold);goldTexture.colorSpace=T.SRGBColorSpace;textures.push(goldTexture);
  // A solid silhouette keeps the body closed. Rotate instead of mirroring
  // the geometry so cap winding and surface normals stay consistent.
  const outer=new T.Shape(paths[1].subPaths[0].getPoints(48));
  const body=new T.ExtrudeGeometry(outer,{depth:5,steps:1,bevelEnabled:true,bevelSegments:4,bevelThickness:.4,bevelSize:.3,curveSegments:32});
  body.scale(.04,.04,.04);body.rotateX(Math.PI);body.translate(-1.04,1,.1);geometries.push(body);
  const rim=new T.MeshBasicMaterial({color:0xd17200,toneMapped:false});
  const edge=new T.MeshPhysicalMaterial({color:0xd38b16,metalness:.55,roughness:.32});materials.push(rim,edge);group.add(new T.Mesh(body,[rim,edge]));
  const face=new T.MeshBasicMaterial({color:0xffffff,map:goldTexture,side:T.DoubleSide,transparent:false,opacity:1,depthWrite:true,toneMapped:false});materials.push(face);
  for(const z of [.119,-.119]){
   const cap=new T.ShapeGeometry(SVGLoader.createShapes(paths[0]),32);
   const uv=cap.getAttribute('uv'),positions=cap.getAttribute('position');
   for(let j=0;j<uv.count;j++)uv.setXY(j,positions.getX(j)/52,1-positions.getY(j)/50);
   cap.scale(.04,.04,.04);cap.rotateX(Math.PI);cap.translate(-1.04,1,z);geometries.push(cap);group.add(new T.Mesh(cap,face));
  }
  group.rotation.set(-.14,-.3,.025);element.classList.add('stars-three-ready');element.dataset.ready='true';
  const resize=()=>{const size=element.clientWidth||144;renderer.setSize(size,size,false);};observer=new ResizeObserver(resize);observer.observe(element);resize();
  let drag=null,velocity=0,last=performance.now();const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  element.addEventListener('pointerdown',e=>{if(!e.isPrimary)return;e.preventDefault();e.stopPropagation();drag={x:e.clientX,y:e.clientY};velocity=0;element.setPointerCapture(e.pointerId);});
  element.addEventListener('pointermove',e=>{if(!drag)return;e.preventDefault();e.stopPropagation();velocity=Math.max(-.08,Math.min(.08,(e.clientX-drag.x)*.012));group.rotation.y+=(e.clientX-drag.x)*.012;group.rotation.x+=(e.clientY-drag.y)*.01;drag={x:e.clientX,y:e.clientY};});
  const release=e=>{drag=null;if(element.hasPointerCapture?.(e.pointerId))element.releasePointerCapture(e.pointerId);};element.addEventListener('pointerup',release);element.addEventListener('pointercancel',release);
  element.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();group.rotation.y+=e.key==='ArrowLeft'?-.2:e.key==='ArrowRight'?.2:0;group.rotation.x+=e.key==='ArrowUp'?-.2:e.key==='ArrowDown'?.2:0;});
  const tick=now=>{if(disposed)return;if(!element.isConnected){dispose();return;}const dt=Math.min(.04,(now-last)/1000);last=now;if(!document.hidden){if(!drag&&!reduced.matches){group.rotation.y+=velocity*dt*60;velocity*=Math.exp(-dt*5);}element.dataset.rotation=group.rotation.y.toFixed(3);renderer.render(scene,camera);}frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
 }catch(_){dispose();element.dataset.fallback='true';}
}};
