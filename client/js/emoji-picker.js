/* ── EmojiPicker ─────────────────────────────────────────────────────────────
   Sélecteur d'emojis léger, organisé par catégories.
   Appel : EmojiPicker.open(anchorEl, onPick)
   ─────────────────────────────────────────────────────────────────────────── */
const EmojiPicker = (() => {

  const CATEGORIES = [
    {
      label: '😀 Visages',
      emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿'],
    },
    {
      label: '👋 Gestes',
      emojis: ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🦾','🖕','🫵','🫶','🫂'],
    },
    {
      label: '❤️ Cœurs',
      emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','❤️‍🔥','❤️‍🩹','💔','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☯️','🕊️','💯','💢','💥','💫','💦','💨','🕳️','💬','💭','💤'],
    },
    {
      label: '🐶 Animaux',
      emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🦋','🐛','🐌','🐞','🐜','🪲','🦗','🕷','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃'],
    },
    {
      label: '🍕 Nourriture',
      emojis: ['🍏','🍎','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🫒','🥑','🍆','🥔','🥕','🌽','🌶','🫑','🥦','🧄','🧅','🍄','🥜','🌰','🍞','🥐','🥖','🫓','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌮','🌯','🫔','🥙','🧆','🥚','🍲','🥘','🫕','🍜','🍝','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍘','🍥','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🧃','🥤','🧋','🍵','☕','🍺','🍻','🥂','🍷','🥃','🍸','🍹'],
    },
    {
      label: '⚽ Sports',
      emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🎱','🏓','🏸','🏒','🥍','🏑','🏏','🥏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸','🥌','🎿','⛷','🏂','🪂','🏋️','🤼','🤸','🤺','🤾','⛹','🤻','🧘','🏇','🧗','🚵','🚴','🏊','🏄','🚣','🧜','🧗'],
    },
    {
      label: '🎮 Activités',
      emojis: ['🎮','🕹','🎲','🧩','🃏','🀄','🎴','🎭','🎨','🖼','🎰','🚂','🚃','🚄','🚅','✈️','🚀','🛸','🏆','🥇','🥈','🥉','🏅','🎖','🎗','🎫','🎟','🎪','🤹','🎬','🎥','🎞','📽','🎦','🔊','📢','🔔','🎵','🎶','🎼','🎹','🥁','🪘','🎷','🎺','🪗','🎸','🪕'],
    },
    {
      label: '🌍 Lieux',
      emojis: ['🌍','🌎','🌏','🌐','🗺','🧭','🌋','🏔','⛰','🗻','🏕','🏖','🏜','🏝','🏞','🏟','🏛','🏗','🏘','🏙','🏚','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','🌅','🌄','🌠','🎆','🎇','🗿','🌌','🌉','🌃'],
    },
    {
      label: '💡 Objets',
      emojis: ['💡','🔦','🕯','🪔','💰','💵','💴','💶','💷','💸','💳','🪙','💹','📈','📉','📊','📦','📫','📬','📭','📮','📝','📄','📃','📑','🗒','🗓','📅','📆','🗑','📁','📂','🗂','🗃','🗄','📌','📍','✂️','🗃','🗄','🔑','🗝','🔒','🔓','🔨','⚒','🛠','⛏','🔧','🔩','⚙️','🗜','🔗','⛓','🪝','🧲','🔬','🔭','📡','💊','💉','🩸','🩹','🩺','🌡','🧬','🧪','🧫','🧯','🛡','🔥','💧','🌊'],
    },
    {
      label: '✅ Symboles',
      emojis: ['✅','❌','⭕','🚫','💯','❓','❗','‼️','⁉️','🔅','🔆','📶','🔱','⚜','🔰','♻️','✔️','🔛','🔜','🔝','🆒','🆓','🆕','🆖','🆗','🆙','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','⛔','📵','🚳','🚭','🚯','🚱','🚷','🔞','📳','📴','🔕','🔇'],
    },
  ];

  let currentPicker = null;

  function open(anchorEl, onPick) {
    close();

    const picker = document.createElement('div');
    picker.id = 'emoji-picker';
    picker.className = 'fixed z-[500] bg-onkoz-surface border border-onkoz-border rounded-xl shadow-dm flex flex-col overflow-hidden';
    picker.style.width  = '320px';
    picker.style.height = '360px';

    // Positionner au-dessus de l'ancre
    const rect = anchorEl.getBoundingClientRect();
    let top  = rect.top - 370;
    let left = rect.left;
    if (top < 8) top = rect.bottom + 4;
    if (left + 320 > window.innerWidth) left = window.innerWidth - 328;
    picker.style.top  = `${top}px`;
    picker.style.left = `${left}px`;

    // ── Header avec recherche ──
    const header = document.createElement('div');
    header.className = 'px-3 pt-3 pb-2 border-b border-onkoz-border shrink-0';
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = '🔍 Rechercher un emoji...';
    search.className = 'w-full bg-onkoz-deep border border-onkoz-border rounded-md px-3 py-1.5 text-sm outline-none focus:border-onkoz-accent transition-colors';
    header.appendChild(search);
    picker.appendChild(header);

    // ── Onglets catégories ──
    const tabBar = document.createElement('div');
    tabBar.className = 'flex overflow-x-auto shrink-0 px-1 pt-1 gap-0.5 border-b border-onkoz-border';
    tabBar.style.scrollbarWidth = 'none';

    // ── Corps ──
    const body = document.createElement('div');
    body.className = 'flex-1 overflow-y-auto p-2';

    function renderCategory(cat, filterText = '') {
      body.innerHTML = '';
      const emojis = filterText
        ? CATEGORIES.flatMap(c => c.emojis).filter(e => e.includes(filterText))
        : cat.emojis;

      if (!emojis.length) {
        body.innerHTML = '<p class="text-center text-onkoz-text-muted text-sm py-8">Aucun résultat</p>';
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'grid gap-0.5';
      grid.style.gridTemplateColumns = 'repeat(8, 1fr)';

      emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'flex items-center justify-center text-xl rounded-md hover:bg-onkoz-hover transition-colors';
        btn.style.height = '36px';
        btn.textContent = emoji;
        btn.title = emoji;
        btn.addEventListener('click', () => { onPick(emoji); close(); });
        grid.appendChild(btn);
      });

      body.appendChild(grid);
    }

    CATEGORIES.forEach((cat, i) => {
      const tab = document.createElement('button');
      tab.className = `shrink-0 text-lg px-2 py-1 rounded-md transition-colors hover:bg-onkoz-hover ${i === 0 ? 'bg-onkoz-hover' : ''}`;
      tab.textContent = cat.emojis[0];
      tab.title = cat.label;
      tab.addEventListener('click', () => {
        tabBar.querySelectorAll('button').forEach(b => b.classList.remove('bg-onkoz-hover'));
        tab.classList.add('bg-onkoz-hover');
        search.value = '';
        renderCategory(cat);
      });
      tabBar.appendChild(tab);
    });

    // Recherche
    search.addEventListener('input', () => {
      const q = search.value.trim();
      if (q) {
        renderCategory(null, q);
      } else {
        renderCategory(CATEGORIES[0]);
      }
    });

    picker.append(tabBar, body);
    document.body.appendChild(picker);
    currentPicker = picker;
    renderCategory(CATEGORIES[0]);

    // Focus sur recherche
    setTimeout(() => search.focus(), 50);

    // Fermer au clic extérieur
    setTimeout(() => {
      document.addEventListener('click', outsideHandler);
    }, 50);
  }

  function outsideHandler(e) {
    const picker = document.getElementById('emoji-picker');
    if (picker && !picker.contains(e.target)) {
      close();
      document.removeEventListener('click', outsideHandler);
    }
  }

  function close() {
    document.getElementById('emoji-picker')?.remove();
    currentPicker = null;
  }

  return { open, close };
})();
