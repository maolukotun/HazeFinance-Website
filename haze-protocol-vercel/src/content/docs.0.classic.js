
// Mobile sidebar
const menuBtn=document.getElementById('menuBtn'),mOv=document.getElementById('mOv'),mSide=document.getElementById('mSide'),mClose=document.getElementById('mClose')
function openNav(){mOv.classList.add('open');mSide.classList.add('open');document.body.style.overflow='hidden'}
function closeNav(){mOv.classList.remove('open');mSide.classList.remove('open');document.body.style.overflow=''}
menuBtn.addEventListener('click',openNav);mOv.addEventListener('click',closeNav);mClose.addEventListener('click',closeNav)
document.querySelectorAll('#mNav .sb-link').forEach(a=>a.addEventListener('click',closeNav))

// Active sidebar link on scroll
const sections=document.querySelectorAll('[id]')
const allLinks=document.querySelectorAll('.sb-link')
function updateActive(){
  let current=''
  sections.forEach(s=>{if(s.getBoundingClientRect().top<=120)current=s.id})
  allLinks.forEach(l=>{l.classList.toggle('active',l.getAttribute('href')==='#'+current)})
}
window.addEventListener('scroll',updateActive,{passive:true})
updateActive()
