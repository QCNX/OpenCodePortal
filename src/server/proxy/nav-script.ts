import { safeJson } from '../webui/escape';
import { getClientNavTranslations } from '../i18n';

export interface PortalNavScriptInstance {
  id: string;
  name: string;
  status: string;
}

export interface PortalNavScriptModel {
  baseDomain: string;
  currentSub: string;
  authEnabled: boolean;
  instances: PortalNavScriptInstance[];
}

export function renderPortalNavScript(model: PortalNavScriptModel): string {
  const instancesJson = safeJson(model.instances);
  const translationsJson = safeJson(getClientNavTranslations());
  return `(function(){
  var baseDomain=${safeJson(model.baseDomain)};
  var currentSub=${safeJson(model.currentSub)};
  var authEnabled=${model.authEnabled ? 'true' : 'false'};
  var instances=${instancesJson};
  var T={};
  var portalBtn=null;
  var dropdownEl=null;
  var submenuEl=null;
  var dropdownOpen=false;
  var hideSubTimer=null;
  var PACKS=${translationsJson};
  function isV2(){
    return document.body.hasAttribute('data-new-layout');
  }
  function normalizeLocale(value){
    var lang=(value||'').toLowerCase().replace(/_/g,'-');
    if(lang==='zht'||lang==='zh-tw'||lang==='zh-hk'||lang.indexOf('zh-hant')===0)return 'zh-TW';
    if(lang==='zh'||lang==='zh-cn'||lang==='zh-sg'||lang.indexOf('zh-hans')===0)return 'zh-CN';
    if(lang==='en'||lang.indexOf('en-')===0)return 'en';
    return '';
  }
  function detectLocale(){
    var lang=normalizeLocale(document.documentElement.lang);
    if(lang)return lang;
    try{
      var m=document.cookie.match(/(?:^|;\\s*)language=([^;]+)/);
      if(m){
        var c=normalizeLocale(decodeURIComponent(m[1]));
        if(c)return c;
      }
    }catch(e){}
    return normalizeLocale(navigator.language)||'en';
  }
  function loadT(){T=PACKS[detectLocale()]||PACKS.en;}
  function goDashboard(){
    window.location.assign('//'+baseDomain+'/');
  }
  function doLogout(){
    window.location.assign('//'+baseDomain+'/auth/logout');
  }
  function findVisibleTitlebarRight(){
    var nodes=document.querySelectorAll('#opencode-titlebar-right');
    var visible=null;
    for(var i=0;i<nodes.length;i++){
      var r=nodes[i].getBoundingClientRect();
      if(r.width>0)visible=nodes[i];
    }
    if(visible)return visible;
    return nodes.length?nodes[0]:null;
  }
  function findV2Mount(){
    return document.querySelector('#opencode-titlebar-right');
  }
  function findMountPoint(){
    if(isV2())return findV2Mount();
    return findVisibleTitlebarRight();
  }
  function cancelHideSub(){
    if(hideSubTimer){clearTimeout(hideSubTimer);hideSubTimer=null;}
  }
  function closeSub(){
    cancelHideSub();
    if(submenuEl)submenuEl.style.display='none';
  }
  function scheduleCloseSub(){
    cancelHideSub();
    hideSubTimer=setTimeout(closeSub,80);
  }
  function showSub(){
    cancelHideSub();
    if(!submenuEl)return;
    var trigger=document.getElementById('_ocp_switch');
    if(!trigger)return;
    var r=trigger.getBoundingClientRect();
    // Show temporarily to measure width, then position.
    submenuEl.style.visibility='hidden';
    submenuEl.style.display='flex';
    submenuEl.style.top='-9999px';
    submenuEl.style.left='-9999px';
    submenuEl.style.right='auto';
    var sw=submenuEl.offsetWidth;
    var fitsRight=r.right+4+sw<=window.innerWidth;
    var fitsLeft=r.left-4-sw>=0;
    if(fitsRight){
      submenuEl.style.left=(r.right+4)+'px';
      submenuEl.style.right='auto';
    }else if(fitsLeft){
      submenuEl.style.left=(r.left-4-sw)+'px';
      submenuEl.style.right='auto';
    }else{
      // Neither side fits — pin to right edge of viewport
      submenuEl.style.left='auto';
      submenuEl.style.right='4px';
    }
    submenuEl.style.top=r.top+'px';
    submenuEl.style.visibility='';
  }
  function closeAll(){
    closeSub();
    if(dropdownEl)dropdownEl.style.display='none';
    dropdownOpen=false;
    if(portalBtn)portalBtn.setAttribute('aria-expanded','false');
  }
  function positionDropdown(){
    if(!portalBtn||!dropdownEl)return;
    var r=portalBtn.getBoundingClientRect();
    dropdownEl.style.top=(r.bottom+4)+'px';
    dropdownEl.style.right=(window.innerWidth-r.right)+'px';
    dropdownEl.style.left='auto';
  }
  function openDropdown(){
    if(!dropdownEl)return;
    positionDropdown();
    dropdownEl.style.display='flex';
    dropdownOpen=true;
    if(portalBtn)portalBtn.setAttribute('aria-expanded','true');
  }
  function toggleDropdown(e){
    e.stopPropagation();
    if(dropdownOpen){closeAll();return;}
    openDropdown();
  }
  function makeItem(label,onClick,tag){
    var item=document.createElement('button');
    item.type='button';
    if(isV2()){
      item.setAttribute('data-component','menu-v2-item');
    }else{
      item.setAttribute('data-slot','dropdown-menu-item');
    }
    if(tag)item.setAttribute('data-ocp',tag);
    item.textContent=label;
    item.style.cssText='width:100%;box-sizing:border-box;white-space:nowrap;';
    item.onmouseenter=function(){item.setAttribute('data-highlighted','');closeSub();};
    item.onmouseleave=function(){item.removeAttribute('data-highlighted');};
    item.onclick=function(e){e.stopPropagation();onClick(e);};
    return item;
  }
  function buildSubmenu(){
    var sub=document.createElement('div');
    sub.id='_ocp_submenu';
    if(isV2()){
      sub.setAttribute('data-component','menu-v2-content');
    }else{
      sub.setAttribute('data-component','dropdown-menu-sub-content');
    }
    sub.style.cssText='position:fixed;z-index:100000;display:none;width:max-content;min-width:0;flex-direction:column;align-items:stretch;';
    sub.onmouseenter=function(){cancelHideSub();};
    sub.onmouseleave=function(){scheduleCloseSub();};
    for(var i=0;i<instances.length;i++){
      (function(inst){
        var row=document.createElement('button');
        row.type='button';
        if(isV2()){
          row.setAttribute('data-component','menu-v2-item');
        }else{
          row.setAttribute('data-slot','dropdown-menu-item');
        }
        row.style.cssText='width:100%;box-sizing:border-box;white-space:nowrap;';
        if(inst.status==='offline'){
          row.disabled=true;
          row.setAttribute('data-disabled','');
        }
        var dot=document.createElement('span');
        dot.textContent=inst.id===currentSub?'\\u25cf ':'\\u25cb ';
        row.appendChild(dot);
        var lbl=document.createElement('span');
        lbl.setAttribute('data-ocp-label','1');
        lbl.textContent=inst.name+(inst.status==='offline'?' '+T.offline:'');
        row.appendChild(lbl);
        if(inst.status!=='offline'){
          row.onmouseenter=function(){row.setAttribute('data-highlighted','');};
          row.onmouseleave=function(){row.removeAttribute('data-highlighted');};
          row.onclick=function(e){
            e.stopPropagation();
            if(inst.id&&inst.id!==currentSub){
              location.href='//'+inst.id+'.'+baseDomain+'/';
            }
          };
        }
        sub.appendChild(row);
      })(instances[i]);
    }
    return sub;
  }
  function refreshLabels(){
    loadT();
    if(!dropdownEl)return;
    var el;
    el=dropdownEl.querySelector('[data-ocp=dash]');if(el)el.textContent=T.dash;
    el=dropdownEl.querySelector('[data-ocp-switch-label]');if(el)el.textContent=T.switch;
    el=dropdownEl.querySelector('[data-ocp=refresh]');if(el)el.textContent=T.refresh;
    el=dropdownEl.querySelector('[data-ocp=logout]');if(el)el.textContent=T.logout;
    if(submenuEl){
      var rows=submenuEl.querySelectorAll('[data-ocp-label]');
      for(var i=0;i<rows.length&&i<instances.length;i++){
        rows[i].textContent=instances[i].name+(instances[i].status==='offline'?' '+T.offline:'');
      }
    }
  }
  function buildDropdown(){
    var menu=document.createElement('div');
    menu.id='_ocp_dropdown';
    if(isV2()){
      menu.setAttribute('data-component','menu-v2-content');
    }else{
      menu.setAttribute('data-component','dropdown-menu-content');
    }
    menu.style.cssText='position:fixed;z-index:99999;display:none;width:max-content;min-width:0;flex-direction:column;align-items:stretch;';
    menu.onclick=function(e){e.stopPropagation();};
    menu.appendChild(makeItem(T.dash,function(){closeAll();goDashboard();},'dash'));
    var switchItem=document.createElement('button');
    switchItem.type='button';
    switchItem.id='_ocp_switch';
    if(isV2()){
      switchItem.setAttribute('data-component','menu-v2-item');
    }else{
      switchItem.setAttribute('data-slot','dropdown-menu-sub-trigger');
    }
    switchItem.style.cssText='width:100%;box-sizing:border-box;white-space:nowrap;display:flex;align-items:center;';
    var switchLabel=document.createElement('span');
    switchLabel.setAttribute('data-ocp-switch-label','1');
    if(isV2()){
      switchLabel.setAttribute('data-slot','menu-v2-item-content');
    }
    switchLabel.textContent=T.switch;
    switchItem.appendChild(switchLabel);
    if(isV2()){
      var chevron=document.createElementNS('http://www.w3.org/2000/svg','svg');
      chevron.setAttribute('data-slot','menu-v2-item-chevron');
      chevron.setAttribute('width','16');
      chevron.setAttribute('height','16');
      chevron.setAttribute('viewBox','0 0 16 16');
      chevron.setAttribute('fill','none');
      chevron.setAttribute('aria-hidden','true');
      var chevronPath=document.createElementNS('http://www.w3.org/2000/svg','path');
      chevronPath.setAttribute('d','M6 4L10 8L6 12V4Z');
      chevronPath.setAttribute('fill','currentColor');
      chevron.appendChild(chevronPath);
      switchItem.appendChild(chevron);
    }else{
      var arrow=document.createElement('span');
      arrow.style.cssText='display:inline-block;width:0;height:0;border-top:3px solid transparent;border-bottom:3px solid transparent;border-left:5px solid currentColor;vertical-align:middle;margin-left:4px;flex-shrink:0;';
      switchItem.appendChild(arrow);
    }
    switchItem.onmouseenter=function(){switchItem.setAttribute('data-highlighted','');showSub();};
    switchItem.onmouseleave=function(){switchItem.removeAttribute('data-highlighted');scheduleCloseSub();};
    switchItem.onclick=function(e){
      e.stopPropagation();
      if(submenuEl&&submenuEl.style.display==='flex'){closeSub();}else{showSub();}
    };
    menu.appendChild(switchItem);
    menu.appendChild(makeItem(T.refresh,function(){closeAll();location.reload();},'refresh'));
    if(authEnabled){
      var sep=document.createElement('div');
      if(isV2()){
        sep.setAttribute('data-slot','menu-v2-separator');
      }else{
        sep.setAttribute('data-slot','dropdown-menu-separator');
      }
      menu.appendChild(sep);
      var logoutItem=makeItem(T.logout,function(){closeAll();doLogout();},'logout');
      logoutItem.id='_ocp_logout';
      menu.appendChild(logoutItem);
    }
    return menu;
  }
  function createNav(){
    var nav=document.createElement('div');
    nav.id='_ocp_nav';
    nav.style.cssText='display:flex;align-items:center;flex-shrink:0;margin-left:4px;';
    nav.onclick=function(e){e.stopPropagation();};
    portalBtn=document.createElement('button');
    portalBtn.type='button';
    portalBtn.id='_ocp_portal';
    if(isV2()){
      portalBtn.setAttribute('data-component','button-v2');
      portalBtn.setAttribute('data-variant','ghost-muted');
      portalBtn.setAttribute('data-size','large');
    }else{
      portalBtn.setAttribute('data-component','button');
      portalBtn.setAttribute('data-variant','secondary');
      portalBtn.setAttribute('data-size','small');
    }
    portalBtn.setAttribute('aria-haspopup','menu');
    portalBtn.setAttribute('aria-expanded','false');
    portalBtn.appendChild(document.createTextNode('OC Portal'));
    var caret=document.createElement('span');
    caret.style.cssText='display:inline-block;width:0;height:0;border-left:3px solid transparent;border-right:3px solid transparent;border-top:5px solid currentColor;vertical-align:middle;margin-left:4px;flex-shrink:0;';
    portalBtn.appendChild(caret);
    portalBtn.onclick=toggleDropdown;
    nav.appendChild(portalBtn);
    dropdownEl=document.getElementById('_ocp_dropdown');
    if(!dropdownEl){
      dropdownEl=buildDropdown();
      document.body.appendChild(dropdownEl);
      submenuEl=buildSubmenu();
      document.body.appendChild(submenuEl);
    }else{
      submenuEl=document.getElementById('_ocp_submenu');
    }
    return nav;
  }
  function tryMount(){
    var host=findMountPoint();
    if(!host)return;
    var nav=document.getElementById('_ocp_nav');
    if(!nav){
      nav=createNav();
      host.insertBefore(nav,host.firstChild);
    }else if(nav.parentElement!==host){
      host.insertBefore(nav,host.firstChild);
    }else if(host.firstElementChild!==nav){
      host.insertBefore(nav,host.firstChild);
    }
  }
  var scheduled=false;
  function scheduleTryMount(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(function(){
      scheduled=false;
      tryMount();
    });
  }
  loadT();
  document.addEventListener('click',closeAll);
  scheduleTryMount();
  new MutationObserver(scheduleTryMount).observe(document.documentElement,{childList:true,subtree:true});
  new MutationObserver(function(muts){
    for(var i=0;i<muts.length;i++){
      if(muts[i].type==='attributes'&&(muts[i].attributeName==='lang'||muts[i].attributeName==='data-theme'||muts[i].attributeName==='data-color-scheme')){
        refreshLabels();
        break;
      }
    }
  }).observe(document.documentElement,{attributes:true,attributeFilter:['lang','data-theme','data-color-scheme']});
})();`;
}
