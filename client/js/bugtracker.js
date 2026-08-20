/* ── Bug Tracker natif ONKOZ ──────────────────────────────────────────────── */
const BugTracker = (() => {
  let meta = null;
  let currentProject = 'TomoMod';
  let currentBugId = null;
  let listState = { status: 'active', severity: 'all', category: 'all', search: '', sort: 'recent' };

  const STATUS_LABEL = {
    Open: 'Ouvert', Confirmed: 'Confirmé', InProgress: 'En cours', NeedsInfo: "Besoin d'infos",
    Resolved: 'Résolu', Closed: 'Fermé', Duplicate: 'Doublon', Rejected: 'Rejeté',
  };
  const SEV_LABEL = { Critical: 'Critique', High: 'Élevée', Medium: 'Moyenne', Low: 'Faible' };
  const SEV_COLOR = { Critical: '#FF5252', High: '#FF9F43', Medium: '#FFD93D', Low: '#6ECFFF' };
  const STATUS_COLOR = {
    Open: '#6ECFFF', Confirmed: '#C4AAFF', InProgress: '#FFD93D', NeedsInfo: '#FF9F43',
    Resolved: '#4FD17A', Closed: '#5A5474', Duplicate: '#A89FC8', Rejected: '#FF5252',
  };

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts) * 1000);
    return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function toast(msg) {
    if (typeof AudioSettings !== 'undefined' && AudioSettings.showToast) return AudioSettings.showToast(msg);
    alert(msg);
  }

  function setHeader(icon, name, category = '') {
    const values = [
      ['channel-icon', icon], ['channel-name', name], ['channel-category', category ? `— ${category}` : ''],
      ['mobile-ch-icon', icon], ['mobile-ch-name', name],
    ];
    values.forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });
  }

  function prepareView(project) {
    currentProject = project;
    currentBugId = null;
    Chat.leaveTextChannelView?.();
    document.getElementById('message-input-area').style.display = 'none';
    document.getElementById('pinned-panel')?.classList.add('hidden');
    document.getElementById('btn-pinned')?.classList.add('hidden');
    document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('bg-onkoz-active', 'text-onkoz-text'));
    document.getElementById(`bug-project-${project}`)?.classList.add('bg-onkoz-active', 'text-onkoz-text');
    setHeader('🐞', `Bug Tracker · ${project}`, '');
    if (window.innerWidth <= 640) App.closeSidebar?.();
  }

  async function ensureMeta() {
    if (!meta) meta = await API.getBugMeta();
    return meta;
  }

  function createSidebarSection() {
    const section = document.createElement('div');
    section.id = 'bugtracker-section';
    section.className = 'mt-1 border-t border-onkoz-border pt-1';

    const header = document.createElement('div');
    header.className = 'flex items-center gap-1 px-2 py-1';
    header.innerHTML = '<span class="flex-1 text-[0.72rem] font-bold tracking-wider uppercase text-onkoz-text-muted">Bug Tracker</span>';

    const list = document.createElement('ul');
    list.className = 'flex flex-col';

    const li = document.createElement('li');
    li.id = 'bug-project-TomoMod';
    li.className = 'channel-item flex items-center gap-1.5 px-3 py-1 mx-1 rounded-md cursor-pointer transition-colors group text-onkoz-text-md hover:bg-onkoz-hover hover:text-onkoz-text';
    li.innerHTML = `
      <span class="shrink-0 text-sm">🐞</span>
      <span class="flex-1 truncate text-[0.88rem]">TomoMod</span>
      <span id="bugtracker-open-count" class="hidden min-w-5 h-5 px-1 rounded-full bg-onkoz-danger/15 text-onkoz-danger text-[0.65rem] font-bold items-center justify-center"></span>`;
    li.addEventListener('click', () => openProject('TomoMod'));

    list.appendChild(li);
    section.append(header, list);
    queueMicrotask(refreshSidebarBadge);
    return section;
  }

  async function refreshSidebarBadge() {
    try {
      const data = await API.getBugSidebar('TomoMod');
      const badge = document.getElementById('bugtracker-open-count');
      if (!badge) return;
      if (data.active > 0) {
        badge.textContent = data.active > 99 ? '99+' : String(data.active);
        badge.classList.remove('hidden');
        badge.classList.add('flex');
        badge.title = `${data.active} bug(s) actif(s)${data.critical ? ` · ${data.critical} critique(s)` : ''}`;
      } else {
        badge.classList.add('hidden');
        badge.classList.remove('flex');
      }
    } catch { /* badge non bloquant */ }
  }

  async function openProject(project = 'TomoMod') {
    prepareView(project);
    await ensureMeta();
    await renderList();
  }

  function areaLoading(label = 'Chargement du Bug Tracker...') {
    const area = document.getElementById('content-area');
    area.innerHTML = `<div class="flex-1 flex items-center justify-center text-onkoz-text-muted text-sm">${esc(label)}</div>`;
    return area;
  }

  function makeStat(label, value, accent = '', onClick = null, active = false) {
    const el = document.createElement(onClick ? 'button' : 'div');
    if (onClick) el.type = 'button';
    el.className = `bg-onkoz-surface border rounded-xl px-4 py-3 min-w-0 text-left transition-colors ${
      active ? 'border-onkoz-accent ring-1 ring-onkoz-accent/30' : 'border-onkoz-border'
    } ${onClick ? 'cursor-pointer hover:bg-onkoz-hover hover:border-onkoz-border-h' : ''}`;
    if (accent) el.style.borderLeft = `3px solid ${accent}`;
    el.innerHTML = `<div class="text-[0.68rem] uppercase tracking-wider text-onkoz-text-muted font-bold">${esc(label)}</div>
      <div class="font-title font-bold text-xl mt-1" style="color:${accent || '#EBE9F5'}">${Number(value || 0)}</div>`;
    if (onClick) el.addEventListener('click', onClick);
    return el;
  }

  function makeSelect(options, value, onChange, extraClass = '') {
    const sel = document.createElement('select');
    sel.className = `bg-onkoz-elevated border border-onkoz-border rounded-lg px-2.5 py-2 text-xs text-onkoz-text outline-none focus:border-onkoz-accent ${extraClass}`;
    options.forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      o.selected = v === value;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  async function renderList() {
    const area = areaLoading();
    try {
      const params = new URLSearchParams({ project: currentProject, ...listState });
      const data = await API.getBugs(params.toString());
      area.innerHTML = '';
      area.className = 'flex-1 overflow-y-auto p-4';

      const wrap = document.createElement('div');
      wrap.className = 'w-full max-w-6xl mx-auto pb-8';

      const hero = document.createElement('div');
      hero.className = 'flex items-start justify-between gap-4 mb-4';
      hero.innerHTML = `
        <div>
          <div class="text-[0.7rem] uppercase tracking-[0.16em] text-onkoz-accent font-bold mb-1">Tracker officiel · Suite Tomo</div>
          <h2 class="font-title font-bold text-2xl text-onkoz-text">${esc(currentProject)} · Bug Tracker</h2>
          <p class="text-sm text-onkoz-text-muted mt-1">Signale un problème, joins ton diagnostic et suis sa correction sans quitter ONKOZ.</p>
        </div>`;
      const submit = document.createElement('button');
      submit.className = 'shrink-0 px-4 py-2.5 rounded-lg bg-onkoz-accent hover:bg-onkoz-accent-dk text-white text-sm font-semibold transition-colors';
      submit.textContent = '+ Signaler un bug';
      submit.addEventListener('click', () => renderSubmit());
      hero.appendChild(submit);

      const stats = document.createElement('div');
      stats.className = 'grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5 mb-4';
      const setStatusFilter = (status) => {
        listState.status = status;
        renderList();
      };
      stats.append(
        makeStat('Total', data.stats.total, '#9B7FE8', () => setStatusFilter('all'), listState.status === 'all'),
        makeStat('Ouverts', data.stats.open, '#6ECFFF', () => setStatusFilter('Open'), listState.status === 'Open'),
        makeStat('En cours', data.stats.in_progress, '#FFD93D', () => setStatusFilter('InProgress'), listState.status === 'InProgress'),
        makeStat('Résolus', data.stats.resolved, '#4FD17A', () => setStatusFilter('Resolved'), listState.status === 'Resolved'),
        makeStat('Fermés', data.stats.closed, '#5A5474', () => setStatusFilter('Closed'), listState.status === 'Closed'),
        makeStat('Critiques actifs', data.stats.critical_active, '#FF5252', () => {
          listState.status = 'active';
          listState.severity = 'Critical';
          renderList();
        }, listState.status === 'active' && listState.severity === 'Critical'),
      );

      const filters = document.createElement('div');
      filters.className = 'bg-onkoz-surface border border-onkoz-border rounded-xl p-3 mb-4 flex flex-wrap items-center gap-2';

      const search = document.createElement('input');
      search.type = 'search';
      search.placeholder = 'Chercher un bug, un #id, un log...';
      search.value = listState.search;
      search.className = 'flex-1 min-w-[220px] bg-onkoz-elevated border border-onkoz-border rounded-lg px-3 py-2 text-sm text-onkoz-text placeholder:text-onkoz-text-muted outline-none focus:border-onkoz-accent';
      let timer;
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => { listState.search = search.value.trim(); renderList(); }, 300);
      });

      const statusOptions = [['active', 'Non résolus'], ['all', 'Tous les statuts'], ...meta.statuses.map(s => [s, STATUS_LABEL[s] || s])];
      const sevOptions = [['all', 'Toutes sévérités'], ...meta.severities.map(s => [s, SEV_LABEL[s] || s])];
      const modules = meta.projects[currentProject]?.modules || [];
      const moduleOptions = [['all', 'Tous les modules'], ...modules.map(m => [m, m])];
      const sortOptions = [['recent', 'Récents'], ['oldest', 'Plus anciens'], ['popular', 'Plus votés']];

      filters.append(
        search,
        makeSelect(statusOptions, listState.status, v => { listState.status = v; renderList(); }),
        makeSelect(sevOptions, listState.severity, v => { listState.severity = v; renderList(); }),
        makeSelect(moduleOptions, listState.category, v => { listState.category = v; renderList(); }),
        makeSelect(sortOptions, listState.sort, v => { listState.sort = v; renderList(); }),
      );

      const list = document.createElement('div');
      list.className = 'flex flex-col gap-2';
      if (!data.items.length) {
        list.innerHTML = `<div class="bg-onkoz-surface border border-dashed border-onkoz-border rounded-xl py-14 text-center text-onkoz-text-muted">
          <div class="text-3xl mb-2">🐞</div><div class="font-semibold text-onkoz-text-md">Aucun bug avec ces filtres.</div>
        </div>`;
      }

      data.items.forEach(bug => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'w-full text-left bg-onkoz-surface border border-onkoz-border rounded-xl px-4 py-3 hover:bg-onkoz-hover hover:border-onkoz-border-h transition-colors flex items-center gap-3';
        card.style.borderLeft = `3px solid ${SEV_COLOR[bug.severity] || '#5A5474'}`;
        card.innerHTML = `
          <span class="font-mono text-xs text-onkoz-text-muted shrink-0">#${String(bug.id).padStart(4, '0')}</span>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-sm text-onkoz-text truncate">${esc(bug.title)}</div>
            <div class="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[0.72rem] text-onkoz-text-muted">
              <span>${esc(bug.reporter_name || 'Utilisateur')}</span>
              ${bug.category ? `<span>${esc(bug.category)}</span>` : ''}
              ${bug.addon_version ? `<span>v${esc(bug.addon_version)}</span>` : ''}
              <span>${formatDate(bug.updated_at)}</span>
              <span>💬 ${bug.comments}</span><span>▲ ${bug.votes}</span>
            </div>
          </div>
          <div class="hidden sm:flex items-center gap-1.5 shrink-0">
            <span class="px-2 py-1 rounded-full text-[0.68rem] font-bold border" style="color:${STATUS_COLOR[bug.status]};border-color:${STATUS_COLOR[bug.status]}44;background:${STATUS_COLOR[bug.status]}16">${esc(STATUS_LABEL[bug.status] || bug.status)}</span>
            <span class="px-2 py-1 rounded-full text-[0.68rem] font-bold border" style="color:${SEV_COLOR[bug.severity]};border-color:${SEV_COLOR[bug.severity]}44;background:${SEV_COLOR[bug.severity]}16">${esc(SEV_LABEL[bug.severity] || bug.severity)}</span>
          </div>`;
        card.addEventListener('click', () => renderBug(bug.id));
        list.appendChild(card);
      });

      wrap.append(hero, stats, filters, list);
      area.appendChild(wrap);
    } catch (err) {
      area.innerHTML = `<div class="text-center text-onkoz-danger py-12">Impossible de charger le Bug Tracker : ${esc(err.message)}</div>`;
    }
  }

  function field(label, control, help = '') {
    const wrap = document.createElement('label');
    wrap.className = 'flex flex-col gap-1.5';
    const title = document.createElement('span');
    title.className = 'text-xs font-semibold text-onkoz-text-md';
    title.textContent = label;
    wrap.append(title, control);
    if (help) {
      const h = document.createElement('span');
      h.className = 'text-[0.7rem] text-onkoz-text-muted';
      h.textContent = help;
      wrap.appendChild(h);
    }
    return wrap;
  }

  function input(type = 'text', placeholder = '') {
    const el = document.createElement('input');
    el.type = type;
    el.placeholder = placeholder;
    el.className = 'w-full bg-onkoz-elevated border border-onkoz-border rounded-lg px-3 py-2.5 text-sm text-onkoz-text placeholder:text-onkoz-text-muted outline-none focus:border-onkoz-accent';
    return el;
  }

  function textarea(placeholder = '', mono = false) {
    const el = document.createElement('textarea');
    el.placeholder = placeholder;
    el.rows = 4;
    el.className = `w-full bg-onkoz-elevated border border-onkoz-border rounded-lg px-3 py-2.5 text-sm text-onkoz-text placeholder:text-onkoz-text-muted outline-none focus:border-onkoz-accent resize-y leading-relaxed ${mono ? 'font-mono text-xs' : ''}`;
    return el;
  }

  async function renderSubmit() {
    await ensureMeta();
    const area = document.getElementById('content-area');
    area.innerHTML = '';
    area.className = 'flex-1 overflow-y-auto p-4';
    setHeader('🐞', `Signaler un bug · ${currentProject}`, 'Bug Tracker');

    const wrap = document.createElement('div');
    wrap.className = 'w-full max-w-3xl mx-auto pb-10';
    const top = document.createElement('div');
    top.className = 'flex items-center gap-3 mb-4';
    const back = document.createElement('button');
    back.className = 'text-sm text-onkoz-text-muted hover:text-onkoz-text';
    back.textContent = '← Retour';
    back.addEventListener('click', renderList);
    top.appendChild(back);

    const form = document.createElement('form');
    form.className = 'bg-onkoz-surface border border-onkoz-border rounded-xl p-5 flex flex-col gap-4';
    form.innerHTML = `<div><h2 class="font-title font-bold text-xl text-onkoz-text">Signaler un bug</h2><p class="text-sm text-onkoz-text-muted mt-1">Ton compte ONKOZ est automatiquement utilisé comme auteur du rapport.</p></div>`;

    const title = input('text', 'Ex : Les nameplates disparaissent après un /reload');
    title.maxLength = 200;
    const modules = makeSelect([['', '— Sélectionner —'], ...(meta.projects[currentProject]?.modules || []).map(m => [m, m])], '', () => {}, 'w-full');
    const severity = makeSelect(meta.severities.map(s => [s, SEV_LABEL[s] || s]), 'Medium', () => {}, 'w-full');
    const description = textarea("Décris ce qui se passe, ce que tu attendais, et ce qui s'est passé à la place...");
    description.maxLength = 50000;
    const repro = textarea('1. Se connecter avec TomoMod\n2. Reproduire le problème\n3. Observer...', true);
    repro.maxLength = 20000;
    const wow = input('text', 'ex : 12.1.0 / build 69382'); wow.maxLength = 50;
    const addon = input('text', 'ex : 3.5.9'); addon.maxLength = 50;
    const logs = textarea('Colle ici un diagnostic TomoMod, une erreur BugSack / BugGrabber, ou un log complet...', true);
    logs.rows = 10; logs.maxLength = 1000000;
    const screenshot = input('file'); screenshot.accept = 'image/jpeg,image/png,image/gif,image/webp';

    const two = document.createElement('div'); two.className = 'grid grid-cols-1 md:grid-cols-2 gap-3';
    two.append(field('Module concerné', modules), field('Sévérité', severity, "Critique = l'addon casse l'UI ou bloque le jeu."));
    const versions = document.createElement('div'); versions.className = 'grid grid-cols-1 md:grid-cols-2 gap-3';
    versions.append(field('Version WoW', wow), field("Version de l'addon", addon));

    const actions = document.createElement('div'); actions.className = 'flex justify-end gap-2 pt-1';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'px-4 py-2 rounded-lg border border-onkoz-border text-sm text-onkoz-text-md hover:bg-onkoz-hover'; cancel.textContent = 'Annuler'; cancel.addEventListener('click', renderList);
    const send = document.createElement('button'); send.type = 'submit'; send.className = 'px-4 py-2 rounded-lg bg-onkoz-accent hover:bg-onkoz-accent-dk text-white text-sm font-semibold'; send.textContent = 'Envoyer le bug';
    actions.append(cancel, send);

    form.append(field('Titre', title), two, field('Description', description), field('Étapes de reproduction', repro), versions,
      field('Logs / diagnostic TomoMod', logs, "Jusqu'à 1 000 000 caractères pour cette première version ; les Long Reports prendront ensuite le relais."),
      field("Capture d'écran", screenshot, 'JPG, PNG, GIF ou WEBP · 10 Mo max.'), actions);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (title.value.trim().length < 6) return toast('❌ Titre trop court');
      if (description.value.trim().length < 15) return toast('❌ Description trop courte');
      send.disabled = true; send.textContent = 'Envoi...';
      try {
        let screenshotUrl = null;
        if (screenshot.files[0]) screenshotUrl = await uploadScreenshot(screenshot.files[0]);
        const bug = await API.createBug({
          project: currentProject,
          title: title.value,
          category: modules.value || null,
          severity: severity.value,
          description: description.value,
          reproduction_steps: repro.value,
          wow_version: wow.value,
          addon_version: addon.value,
          logs: logs.value,
          screenshot_url: screenshotUrl,
        });
        toast(`✅ Bug #${String(bug.id).padStart(4, '0')} créé`);
        await refreshSidebarBadge();
        renderBug(bug.id);
      } catch (err) {
        toast(`❌ ${err.message}`);
      } finally {
        send.disabled = false; send.textContent = 'Envoyer le bug';
      }
    });

    wrap.append(top, form);
    area.appendChild(wrap);
  }

  async function uploadScreenshot(file) {
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${API.getToken()}` }, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erreur upload');
    return data.url;
  }

  function panel(title, body) {
    const p = document.createElement('section');
    p.className = 'bg-onkoz-surface border border-onkoz-border rounded-xl p-4';
    const h = document.createElement('h3');
    h.className = 'text-[0.72rem] uppercase tracking-wider font-bold text-onkoz-accent mb-2';
    h.textContent = title;
    p.append(h, body);
    return p;
  }

  function preText(text, mono = false) {
    const el = document.createElement('div');
    el.className = `${mono ? 'font-mono text-xs' : 'text-sm'} text-onkoz-text leading-relaxed whitespace-pre-wrap break-words`;
    el.textContent = text || '—';
    return el;
  }

  async function renderBug(id) {
    currentBugId = id;
    const area = areaLoading('Chargement du bug...');
    try {
      const bug = await API.getBug(id);
      const canModerate = Auth.isAdmin() || Auth.isMod();
      currentProject = bug.project;
      setHeader('🐞', `#${String(bug.id).padStart(4, '0')} · ${bug.title}`, bug.project);
      area.innerHTML = '';
      area.className = 'flex-1 overflow-y-auto p-4';

      const wrap = document.createElement('div');
      wrap.className = 'w-full max-w-5xl mx-auto pb-10';
      const back = document.createElement('button');
      back.className = 'text-sm text-onkoz-text-muted hover:text-onkoz-text mb-3';
      back.textContent = '← Retour à la liste';
      back.addEventListener('click', renderList);
      wrap.appendChild(back);

      const head = document.createElement('div');
      head.className = 'mb-4';
      head.innerHTML = `
        <div class="font-mono text-xs text-onkoz-text-muted mb-1">#${String(bug.id).padStart(4, '0')}</div>
        <h2 class="font-title font-bold text-2xl text-onkoz-text leading-tight">${esc(bug.title)}</h2>
        <div class="flex flex-wrap gap-2 mt-2 items-center text-xs text-onkoz-text-muted">
          <span class="px-2 py-1 rounded-full border font-bold" style="color:${STATUS_COLOR[bug.status]};border-color:${STATUS_COLOR[bug.status]}44;background:${STATUS_COLOR[bug.status]}16">${esc(STATUS_LABEL[bug.status] || bug.status)}</span>
          <span class="px-2 py-1 rounded-full border font-bold" style="color:${SEV_COLOR[bug.severity]};border-color:${SEV_COLOR[bug.severity]}44;background:${SEV_COLOR[bug.severity]}16">${esc(SEV_LABEL[bug.severity] || bug.severity)}</span>
          ${bug.category ? `<span>${esc(bug.category)}</span>` : ''}
          <span>par <strong class="text-onkoz-text-md">${esc(bug.reporter_name)}</strong>${bug.reporter_is_temporary ? ' · compte temporaire' : ''}</span>
          <span>${formatDate(bug.created_at)}</span>
        </div>`;
      wrap.appendChild(head);

      const layout = document.createElement('div');
      layout.className = 'grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4';
      const main = document.createElement('div'); main.className = 'flex flex-col gap-3 min-w-0';
      const side = document.createElement('div'); side.className = 'flex flex-col gap-3';

      main.appendChild(panel('Description', preText(bug.description)));
      if (bug.reproduction_steps) main.appendChild(panel('Étapes de reproduction', preText(bug.reproduction_steps, true)));

      if (bug.logs) {
        const block = document.createElement('div');
        const toolbar = document.createElement('div'); toolbar.className = 'flex items-center justify-between gap-2 mb-2';
        const info = document.createElement('span'); info.className = 'text-[0.72rem] text-onkoz-text-muted';
        const lineCount = String(bug.logs).split('\n').length;
        info.textContent = `${lineCount.toLocaleString('fr-FR')} lignes · ${String(bug.logs).length.toLocaleString('fr-FR')} caractères`;
        const copy = document.createElement('button'); copy.className = 'px-2.5 py-1 rounded border border-onkoz-border text-xs text-onkoz-text-md hover:bg-onkoz-hover'; copy.textContent = '📋 Copier';
        copy.addEventListener('click', async () => { await navigator.clipboard.writeText(bug.logs); toast('📋 Diagnostic copié'); });
        toolbar.append(info, copy);
        const details = document.createElement('details');
        details.className = 'bg-onkoz-elevated border border-onkoz-border rounded-lg overflow-hidden';
        details.innerHTML = '<summary class="cursor-pointer px-3 py-2 text-sm font-semibold text-onkoz-text-md hover:bg-onkoz-hover">Afficher le diagnostic / les logs</summary>';
        const pre = document.createElement('pre'); pre.className = 'm-0 border-t border-onkoz-border p-3 max-h-[520px] overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-onkoz-text-md bg-onkoz-deep'; pre.textContent = bug.logs;
        details.appendChild(pre);
        block.append(toolbar, details);
        main.appendChild(panel('Diagnostic / Logs', block));
      }

      if (bug.screenshot_url) {
        const img = document.createElement('img'); img.src = bug.screenshot_url; img.alt = 'Capture du bug'; img.className = 'max-w-full rounded-lg border border-onkoz-border cursor-zoom-in';
        img.addEventListener('click', () => window.open(bug.screenshot_url, '_blank', 'noopener'));
        main.appendChild(panel("Capture d'écran", img));
      }

      const commentsWrap = document.createElement('div');
      commentsWrap.className = 'flex flex-col gap-2';
      if (!bug.comments.length) commentsWrap.innerHTML = '<div class="text-sm text-onkoz-text-muted">Aucune réponse pour le moment.</div>';
      bug.comments.forEach(c => {
        const el = document.createElement('div');
        const staff = c.author_role === 'admin' || c.author_role === 'moderator';
        el.className = `rounded-lg border p-3 ${staff ? 'border-onkoz-accent/30 bg-onkoz-accent/5' : 'border-onkoz-border bg-onkoz-elevated'}`;
        
        const commentHead = document.createElement('div');
        commentHead.className = 'flex items-center gap-2 mb-1';
        commentHead.innerHTML = `<strong class="text-sm ${staff ? 'text-onkoz-accent-lt' : 'text-onkoz-text'}">${esc(c.author_name)}</strong>${staff ? '<span class="text-[0.62rem] px-1.5 py-px rounded bg-onkoz-accent/15 text-onkoz-accent-lt font-bold">DEV</span>' : ''}<span class="text-[0.68rem] text-onkoz-text-muted ml-auto">${formatDate(c.created_at)}</span>`;
        
        if (canModerate) {
          const removeComment = document.createElement('button');
          removeComment.type = 'button';
          removeComment.className = 'ml-1 px-1.5 py-0.5 rounded text-[0.68rem] text-onkoz-danger hover:bg-onkoz-danger/10';
          removeComment.title = 'Supprimer ce commentaire';
          removeComment.textContent = '🗑';
          removeComment.addEventListener('click', async () => {
            if (!confirm(`Supprimer définitivement le commentaire de ${c.author_name} ?`)) return;
            removeComment.disabled = true;
            try {
              await API.deleteBugComment(bug.id, c.id);
              toast('🗑 Commentaire supprimé');
              await renderBug(bug.id);
            } catch (err) {
              toast(`❌ ${err.message}`);
              removeComment.disabled = false;
            }
          });
          commentHead.appendChild(removeComment);
        }

        el.append(commentHead, preText(c.content));
        commentsWrap.appendChild(el);
      });

      const reply = document.createElement('div'); reply.className = 'mt-2 flex gap-2';
      const replyInput = textarea('Écrire une réponse...'); replyInput.rows = 3; replyInput.maxLength = 20000;
      const replyBtn = document.createElement('button'); replyBtn.className = 'self-end px-3 py-2 rounded-lg bg-onkoz-accent hover:bg-onkoz-accent-dk text-white text-sm font-semibold'; replyBtn.textContent = 'Répondre';
      replyBtn.addEventListener('click', async () => {
        if (replyInput.value.trim().length < 2) return;
        replyBtn.disabled = true;
        try { await API.commentBug(bug.id, replyInput.value); await renderBug(bug.id); }
        catch (err) { toast(`❌ ${err.message}`); }
        finally { replyBtn.disabled = false; }
      });
      reply.append(replyInput, replyBtn);
      commentsWrap.appendChild(reply);
      main.appendChild(panel(`Discussion (${bug.comments.length})`, commentsWrap));

      const infoList = document.createElement('div');
      infoList.className = 'text-sm flex flex-col gap-2';
      const rows = [
        ['Projet', bug.project], ['Module', bug.category || '—'], ['WoW', bug.wow_version || '—'],
        ['Addon', bug.addon_version || '—'], ['Corrigé dans', bug.resolved_version || '—'], ['Assigné à', bug.assignee_name || '—'],
      ];
      rows.forEach(([k, v]) => {
        const r = document.createElement('div'); r.className = 'flex justify-between gap-3 border-b border-onkoz-border pb-2 last:border-0 last:pb-0';
        r.innerHTML = `<span class="text-onkoz-text-muted">${esc(k)}</span><strong class="text-onkoz-text-md text-right">${esc(v)}</strong>`;
        infoList.appendChild(r);
      });
      side.appendChild(panel('Informations', infoList));

      const vote = document.createElement('button');
      vote.className = `w-full px-3 py-2.5 rounded-lg border text-sm font-semibold transition-colors ${bug.voted ? 'border-onkoz-accent bg-onkoz-accent/10 text-onkoz-accent-lt' : 'border-onkoz-border text-onkoz-text-md hover:bg-onkoz-hover'}`;
      vote.textContent = `▲ Moi aussi · ${bug.votes}`;
      vote.addEventListener('click', async () => { const v = await API.voteBug(bug.id); bug.votes = v.votes; bug.voted = v.voted; renderBug(bug.id); });
      side.appendChild(vote);

      if (Auth.isAdmin() || Auth.isMod()) side.appendChild(adminPanel(bug));

      layout.append(main, side);
      wrap.appendChild(layout);
      area.appendChild(wrap);
    } catch (err) {
      area.innerHTML = `<div class="text-center text-onkoz-danger py-12">Impossible de charger le bug : ${esc(err.message)}</div>`;
    }
  }

  function adminPanel(bug) {
    const box = document.createElement('div'); box.className = 'flex flex-col gap-3';
    const status = makeSelect(meta.statuses.map(s => [s, STATUS_LABEL[s] || s]), bug.status, () => {}, 'w-full');
    const severity = makeSelect(meta.severities.map(s => [s, SEV_LABEL[s] || s]), bug.severity, () => {}, 'w-full');
    const resolved = input('text', 'ex : 3.6.0'); resolved.value = bug.resolved_version || '';
    const pinned = document.createElement('label'); pinned.className = 'flex items-center gap-2 text-xs text-onkoz-text-md';
    const pin = document.createElement('input'); pin.type = 'checkbox'; pin.checked = Boolean(bug.pinned); pin.className = 'accent-onkoz-accent'; pinned.append(pin, document.createTextNode('Épingler ce bug'));
    const save = document.createElement('button'); save.className = 'w-full px-3 py-2 rounded-lg bg-onkoz-accent hover:bg-onkoz-accent-dk text-white text-sm font-semibold'; save.textContent = 'Enregistrer';
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await API.updateBug(bug.id, { status: status.value, severity: severity.value, resolved_version: resolved.value, pinned: pin.checked });
        toast('✅ Bug mis à jour'); await refreshSidebarBadge(); await renderBug(bug.id);
      } catch (err) { toast(`❌ ${err.message}`); }
      finally { save.disabled = false; }
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'w-full px-3 py-2 rounded-lg border border-onkoz-danger/40 text-onkoz-danger hover:bg-onkoz-danger/10 text-sm font-semibold transition-colors';
    remove.textContent = '🗑 Supprimer ce bug';
    remove.addEventListener('click', async () => {
      const bugLabel = `#${String(bug.id).padStart(4, '0')} · ${bug.title}`;
      if (!confirm(`Supprimer définitivement ${bugLabel} ?\n\nLes commentaires et les votes associés seront également supprimés. Cette action est irréversible.`)) return;
      remove.disabled = true;
      remove.textContent = 'Suppression...';
      try {
        await API.deleteBug(bug.id);
        toast(`🗑 Bug #${String(bug.id).padStart(4, '0')} supprimé`);
        currentBugId = null;
        await refreshSidebarBadge();
        await renderList();
      } catch (err) {
        toast(`❌ ${err.message}`);
        remove.disabled = false;
        remove.textContent = '🗑 Supprimer ce bug';
      }
    });

    const dangerZone = document.createElement('div');
    dangerZone.className = 'pt-3 mt-1 border-t border-onkoz-danger/20';
    dangerZone.appendChild(remove);

    box.append(field('Statut', status), field('Sévérité', severity), field('Version corrigée', resolved), pinned, save, dangerZone);
    return panel('Administration', box);
  }

  return { createSidebarSection, refreshSidebarBadge, openProject, renderList, renderBug };
})();
