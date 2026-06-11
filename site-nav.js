// site-nav.js — shared responsive navigation bar for the B&P Workflows site.
// Include with: <script src="site-nav.js" defer></script>
// Set <body data-nav="chart|intake|matrix"> to highlight the active page.
(function(){
  var ITEMS = [
    { key:'chart',  label:'Workflow Chart',          href:'index.html' },
    { key:'intake', label:'Intake & Case Creation',  href:'Intake and Case Creation Playbook.html' },
    { key:'gonogo', label:'Go / No-Go Scorecard',    href:'Go No-Go Scorecard.html' },
    { key:'workbook', label:'RFP Workbook Creator',  href:'RFP Workbook Creator.html' },
    { key:'matrix', label:'Responsibility Matrix',   href:'Responsibility Matrix.html' }
  ];

  var css = ''
  + '.site-nav{position:sticky;top:0;z-index:60;display:flex;align-items:center;gap:10px;'
  +   'padding:0 18px;height:54px;'
  +   'background:color-mix(in oklab,var(--bg2,#fff) 88%,transparent);backdrop-filter:blur(12px);'
  +   'border-bottom:1px solid var(--line,#e3e6ef);font-family:var(--font-label,system-ui),system-ui,sans-serif}'
  + '.sn-brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none;'
  +   'font-family:var(--font-display,system-ui),system-ui,sans-serif;font-size:14.5px;font-weight:700;'
  +   'letter-spacing:-.01em;color:var(--ink,#2b3040);white-space:nowrap;padding:6px 4px;margin-right:6px}'
  + '.sn-mark{flex:none;width:21px;height:22px;'
  +   'background:url("nav-mark.png") center/contain no-repeat}'
  + '.sn-links{display:flex;align-items:center;gap:4px;min-width:0;overflow-x:auto;scrollbar-width:none}'
  + '.sn-links::-webkit-scrollbar{display:none}'
  + '.sn-link{text-decoration:none;font-size:13px;font-weight:600;color:var(--ink-dim,#5a6175);'
  +   'padding:7px 13px;border-radius:999px;border:1px solid transparent;white-space:nowrap;transition:all .14s ease}'
  + '.sn-link:hover{color:var(--ink,#2b3040);background:color-mix(in oklab,var(--ink,#2b3040) 6%,transparent)}'
  + '.sn-link.on{color:color-mix(in oklab,var(--sales,#5b82c0) 42%,var(--ink,#2b3040));'
  +   'background:color-mix(in oklab,var(--sales,#7b9fd4) 14%,transparent);'
  +   'border-color:color-mix(in oklab,var(--sales,#7b9fd4) 32%,transparent)}'
  + '.sn-burger{display:none;margin-left:auto;flex:none;width:38px;height:38px;border-radius:10px;'
  +   'border:1px solid var(--line,#e3e6ef);background:var(--panel,#fff);cursor:pointer;'
  +   'flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:0}'
  + '.sn-burger span{display:block;width:16px;height:2px;border-radius:2px;background:var(--ink-dim,#5a6175);transition:all .2s ease}'
  + '.site-nav.open .sn-burger span:nth-child(1){transform:translateY(6px) rotate(45deg)}'
  + '.site-nav.open .sn-burger span:nth-child(2){opacity:0}'
  + '.site-nav.open .sn-burger span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}'
  + '@media (max-width:860px){'
  +   '.sn-burger{display:flex}'
  +   '.sn-links{display:none;position:absolute;left:0;right:0;top:54px;flex-direction:column;align-items:stretch;'
  +     'gap:2px;padding:10px 14px 14px;background:var(--bg2,#fff);border-bottom:1px solid var(--line,#e3e6ef);'
  +     'box-shadow:0 18px 30px -18px rgba(30,35,60,.25)}'
  +   '.site-nav.open .sn-links{display:flex}'
  +   '.sn-link{padding:12px 14px;border-radius:12px;font-size:14px}'
  + '}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var active = (document.body && document.body.dataset.nav) || '';
  var nav = document.createElement('nav');
  nav.className = 'site-nav';
  var linksHtml = ITEMS.map(function(i){
    return '<a class="sn-link' + (i.key===active ? ' on' : '') + '" href="' + i.href.replace(/&/g,'&amp;') + '">' + i.label.replace(/&/g,'&amp;') + '</a>';
  }).join('');
  nav.innerHTML =
    '<a class="sn-brand" href="index.html"><span class="sn-mark"></span><span>B&amp;P Workflows</span></a>'
    + '<button class="sn-burger" aria-label="Menu" aria-expanded="false"><span></span><span></span><span></span></button>'
    + '<div class="sn-links">' + linksHtml + '</div>';
  document.body.prepend(nav);

  var burger = nav.querySelector('.sn-burger');
  burger.addEventListener('click', function(){
    var open = nav.classList.toggle('open');
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.querySelectorAll('.sn-link').forEach(function(a){
    a.addEventListener('click', function(){ nav.classList.remove('open'); });
  });

  function setH(){ document.documentElement.style.setProperty('--sn-h', nav.offsetHeight + 'px'); }
  setH();
  window.addEventListener('resize', setH);
})();
