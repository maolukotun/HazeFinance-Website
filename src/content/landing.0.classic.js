
// Mobile menu
const mBtn=document.getElementById('menuBtn'),mCl=document.getElementById('mClose'),mOv=document.getElementById('mOv'),mPan=document.getElementById('mPan'),mNav=document.getElementById('mNav'),mCta=document.getElementById('mCta'),mItems=mNav.querySelectorAll('a')
function openM(){mOv.classList.add('open');mPan.classList.add('open');document.body.style.overflow='hidden';mItems.forEach((a,i)=>setTimeout(()=>a.classList.add('show'),(i+1)*60));setTimeout(()=>mCta.classList.add('show'),320)}
function closeM(){mOv.classList.remove('open');mPan.classList.remove('open');document.body.style.overflow='';mItems.forEach(a=>a.classList.remove('show'));mCta.classList.remove('show')}
mBtn.addEventListener('click',openM);mCl.addEventListener('click',closeM);mOv.addEventListener('click',closeM)
mNav.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeM))

// Nav scroll
window.addEventListener('scroll',()=>{document.getElementById('mainNav').classList.toggle('scrolled',window.scrollY>60);const past=window.scrollY>window.innerHeight;const c=document.getElementById('scene'),sp=document.getElementById('scenePoster');if(c)c.classList.toggle('offscreen',past);if(sp)sp.classList.toggle('offscreen',past)},{passive:true})

// Scroll reveal
const observer=new IntersectionObserver((entries)=>{entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target)}})},{threshold:0.1,rootMargin:'0px 0px -40px 0px'})
document.querySelectorAll('.reveal').forEach(el=>observer.observe(el))

// Animate fingerprint bars on scroll
const fpObserver=new IntersectionObserver((entries)=>{entries.forEach(e=>{if(e.isIntersecting){e.target.querySelectorAll('.fp-bar').forEach(bar=>{const w=bar.style.width;bar.style.width='0%';setTimeout(()=>{bar.style.width=w},100)});fpObserver.unobserve(e.target)}})},{threshold:0.3})
document.querySelectorAll('.fp-list').forEach(el=>fpObserver.observe(el))

// Demo counter animation
let demoStarted=false
const demoObs=new IntersectionObserver((entries)=>{entries.forEach(e=>{if(e.isIntersecting&&!demoStarted){demoStarted=true;const el=document.getElementById('demoEarn');let v=0;const target=1.40;const step=target/60;const iv=setInterval(()=>{v+=step;if(v>=target){v=target;clearInterval(iv)};el.textContent='$'+v.toFixed(2)},25)}})},{threshold:0.5})
document.querySelectorAll('.demo-card').forEach(el=>demoObs.observe(el))
