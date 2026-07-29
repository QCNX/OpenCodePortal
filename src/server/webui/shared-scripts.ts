import { escapeAttr, escapeHtml, safeJson } from './escape';
import { LOCALE_META, SUPPORTED_LOCALES, type PortalLocale } from '../i18n';
import { renderPortalIcon } from './icons';

export interface ThemeTexts {
  themeLight: string;
  themeDark: string;
  themeSystem: string;
}

/** Theme toggle inline script (shared by login and dashboard). */
export function renderThemeToggleScript(themeI18n: ThemeTexts): string {
  const icons = {
    light: renderPortalIcon('sun'),
    dark: renderPortalIcon('moon'),
    system: renderPortalIcon('system'),
  };
  return `<script>
(function(){
  var KEY='opencode-color-scheme';
  var modes=['light','dark','system'];
  var icons=${safeJson(icons)};
  var titles={light:${safeJson(themeI18n.themeLight)},dark:${safeJson(themeI18n.themeDark)},system:${safeJson(themeI18n.themeSystem)}};
  var btn=document.getElementById('theme-toggle');
  function apply(theme){
    var resolved=theme==='system'?(window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):theme;
    document.documentElement.setAttribute('data-color-scheme',resolved);
    btn.innerHTML=icons[theme];
    btn.title=titles[theme];
    btn.setAttribute('aria-label',titles[theme]);
  }
  function next(){
    var cur=localStorage.getItem(KEY)||'system';
    var i=modes.indexOf(cur);
    var next=modes[(i+1)%modes.length];
    localStorage.setItem(KEY,next);
    apply(next);
  }
  var saved=localStorage.getItem(KEY)||'system';
  apply(saved);
  btn.addEventListener('click',next);
  window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change',function(){
    if((localStorage.getItem(KEY)||'system')==='system') apply('system');
  });
})();
</script>`;
}

export function renderLanguageOptions(locale: PortalLocale): string {
  return SUPPORTED_LOCALES.map((candidate) => (
    `<button type="button" class="${candidate === locale ? 'active' : ''}" onclick="setLang('${escapeAttr(candidate)}')">${escapeHtml(LOCALE_META[candidate].label)}</button>`
  )).join('');
}

/** Language switcher inline script (shared by login and dashboard). */
export function renderLanguageSwitcherScript(baseDomain: string): string {
  return `<script>
function setLang(lang){
  var base=${safeJson(baseDomain)}.toLowerCase();
  var host=location.hostname.toLowerCase();
  var matches=host===base||host.endsWith('.'+base);
  var isIp=/^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(base)||base.indexOf(':')>=0;
  var domain=matches&&base!=='localhost'&&!isIp?';Domain=.'+base:'';
  document.cookie='language='+encodeURIComponent(lang)+';Path=/;SameSite=Lax'+domain;
  location.reload();
}
(function(){
  var btn=document.getElementById('lang-btn');
  var dd=document.getElementById('lang-dropdown');
  if(!btn||!dd)return;
  btn.addEventListener('click',function(e){e.stopPropagation();dd.classList.toggle('visible');});
  document.addEventListener('click',function(e){if(!btn.contains(e.target))dd.classList.remove('visible');});
})();
</script>`;
}
