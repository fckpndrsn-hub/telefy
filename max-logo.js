/* Extruded original outline and through-cuts, reflective silver on every surface. */
(async()=>{
 const mainCard=document.getElementById('max-hero-card'),modalCard=document.getElementById('modal-max-hero-card');
 if(mainCard&&modalCard){modalCard.querySelectorAll(':scope > .max-star').forEach(star=>star.remove());const stars=document.createDocumentFragment();mainCard.querySelectorAll(':scope > .max-star').forEach(star=>stars.append(star.cloneNode(true)));modalCard.prepend(stars);}
 const T=await import('./three.module.js');const {SVGLoader}=await import('./SVGLoader.js');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),entries=[];
 const studio=document.createElement('canvas');studio.width=1024;studio.height=512;const ctx=studio.getContext('2d');
 const gradient=ctx.createLinearGradient(0,0,0,512);[[0,'#e5e5e5'],[.2,'#f5f5f5'],[.34,'#fff'],[.45,'#aaa'],[.55,'#ddd'],[.7,'#909090'],[.86,'#f5f5f5'],[1,'#ddd']].forEach(([p,c])=>gradient.addColorStop(p,c));ctx.fillStyle=gradient;ctx.fillRect(0,0,1024,512);
 for(const [x,width] of [[90,75],[410,100],[820,65]]){const glow=ctx.createLinearGradient(x-width,0,x+width,0);glow.addColorStop(0,'rgba(255,255,255,0)');glow.addColorStop(.5,'#fff');glow.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=glow;ctx.fillRect(x-width,0,width*2,512);}
 // Soft neutral studio reflections keep the metal light silver on both sides.
 const pixels=ctx.getImageData(0,0,1024,512).data,lighting=new Float32Array(1024*512*4);
 for(let i=0;i<pixels.length;i+=4){const value=(pixels[i]/255)**2.2;const boost=1+Math.max(0,(value-.85)/.15)*.35;lighting[i]=lighting[i+1]=lighting[i+2]=value*boost;lighting[i+3]=1;}
 for(const id of ['max-3d-logo','modal-max-3d-logo']){
  const element=document.getElementById(id),svg=element?.querySelector('svg');if(!svg)continue;
  try{
   const renderer=new T.WebGLRenderer({alpha:true,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(112,112,false);renderer.setClearColor(0,0);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
   renderer.domElement.className='max-metal-canvas';renderer.domElement.setAttribute('aria-label','Серебряный логотип. Вращайте пальцем или мышью.');element.append(renderer.domElement);
   const scene=new T.Scene(),camera=new T.PerspectiveCamera(34,1,.1,30);camera.position.z=3.9;
   const texture=new T.DataTexture(lighting,1024,512,T.RGBAFormat,T.FloatType);texture.mapping=T.EquirectangularReflectionMapping;texture.needsUpdate=true;const pmrem=new T.PMREMGenerator(renderer);scene.environment=pmrem.fromEquirectangular(texture).texture;pmrem.dispose();texture.dispose();
   scene.add(new T.HemisphereLight(0xffffff,0x8c96a8,1.15));for(const z of [4,-4]){const light=new T.DirectionalLight(0xffffff,1.2);light.position.set(2,3,z);scene.add(light);}
   const input=svg.cloneNode(true);input.querySelectorAll('path').forEach(path=>path.setAttribute('fill','#fff'));input.querySelector('defs')?.remove();
   const shapes=new SVGLoader().parse(new XMLSerializer().serializeToString(input)).paths.flatMap(path=>SVGLoader.createShapes(path));
   if(!shapes.length)throw new Error('Missing outline');
   const group=new T.Group();scene.add(group);const metal=new T.MeshPhysicalMaterial({color:0xf1f3f6,metalness:.95,roughness:.16,clearcoat:.65,clearcoatRoughness:.1,envMapIntensity:1.35});
   // Slightly crowned optical normals let broad studio reflections cross the face.
   // A perfectly flat face has one reflected color everywhere and reads as gray paint.
   metal.onBeforeCompile=shader=>{
     shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
       float silverFace = smoothstep(0.65, 0.95, abs(normal.z));
       normal.xy -= vViewPosition.xy * 0.38 * silverFace;
       normal = normalize(normal);
     `);
   };
   metal.customProgramCacheKey=()=> 'telefy-polished-silver-v2';
   const edge=new T.MeshPhysicalMaterial({color:0xc5cbd5,metalness:1,roughness:.15,clearcoat:.55,clearcoatRoughness:.1,envMapIntensity:1.3});
   const body=new T.ExtrudeGeometry(shapes,{depth:70,steps:1,bevelEnabled:true,bevelSegments:5,bevelSize:3,bevelThickness:4,curveSegments:40});body.scale(1/300,1/300,1/300);body.rotateX(Math.PI);body.computeBoundingBox();const center=body.boundingBox.getCenter(new T.Vector3());body.translate(-center.x,-center.y,-center.z);body.computeVertexNormals();group.add(new T.Mesh(body,[metal,edge]));
   // A continuous metallic rim follows the original silhouette on both faces.
   const rim=new T.MeshStandardMaterial({color:0xd4d9e2,metalness:.65,roughness:.24});
   let rimCount=0;
   for(const shape of shapes){
    const contour=shape.getPoints(160);
    for(const z of [-.126,.126]){
     const points=contour.map(p=>new T.Vector3(p.x/300-center.x,-p.y/300-center.y,z));
     const curve=new T.CatmullRomCurve3(points,true,'centripetal');
     const tube=new T.TubeGeometry(curve,Math.max(160,points.length),.018,8,true);group.add(new T.Mesh(tube,rim));rimCount++;
    }
   }
   renderer.domElement.dataset.silverRim=String(rimCount);
   renderer.domElement.dataset.holes=String(shapes.reduce((sum,shape)=>sum+shape.holes.length,0));
   group.rotation.set(-.16,-.45,-.04);const entry={element,renderer,scene,camera,group,visible:false,drag:false,vx:0,vy:0,release:0};entries.push(entry);element.classList.remove('is-idle');element.classList.add('max-metal-ready');
   new IntersectionObserver(([record])=>entry.visible=record.isIntersecting,{threshold:.05}).observe(element);
   let px=0,py=0;element.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();element.setPointerCapture(e.pointerId);entry.drag=true;entry.vx=entry.vy=0;px=e.clientX;py=e.clientY;});
   element.addEventListener('pointermove',e=>{if(!entry.drag)return;e.preventDefault();e.stopPropagation();entry.vy=(e.clientX-px)*.015;entry.vx=(e.clientY-py)*.012;group.rotation.y+=entry.vy;group.rotation.x+=entry.vx;entry.vy=Math.max(-.08,Math.min(.08,entry.vy));entry.vx=Math.max(-.08,Math.min(.08,entry.vx));px=e.clientX;py=e.clientY;});
   const release=e=>{if(!entry.drag)return;e.stopPropagation();entry.drag=false;entry.release=performance.now();if(element.hasPointerCapture(e.pointerId))element.releasePointerCapture(e.pointerId);};element.addEventListener('pointerup',release);element.addEventListener('pointercancel',release);element.addEventListener('lostpointercapture',()=>entry.drag=false);
   new ResizeObserver(()=>{const size=element.clientWidth||112;renderer.setSize(size,size,false);}).observe(element);
  }catch(error){console.warn('3D logo fallback:',error.message);}
 }
 let previous=performance.now();function frame(now){const dt=Math.min((now-previous)/1000,.04);previous=now;for(const e of entries){if(!e.visible||document.hidden)continue;if(!e.drag&&!reduced.matches){e.group.rotation.x+=e.vx*dt*40;e.group.rotation.y+=e.vy*dt*40;const damping=Math.exp(-dt*4);e.vx*=damping;e.vy*=damping;e.group.rotation.y+=dt*.35*Math.min(1,(now-e.release)/1500);e.group.rotation.x+=(-.14-e.group.rotation.x)*dt*.3;}e.renderer.domElement.dataset.rotation=e.group.rotation.y.toFixed(3);e.scene.environmentRotation.y=reduced.matches?0:now*.00012;e.renderer.render(e.scene,e.camera);}requestAnimationFrame(frame);}requestAnimationFrame(frame);
})();
