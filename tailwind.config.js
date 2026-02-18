/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './client/**/*.html',
    './client/**/*.js',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Fonds ──────────────────────────────────────────────────────────
        'onkoz-bg':          '#1e1f22',   // Fond principal
        'onkoz-surface':     '#2b2d31',   // Sidebar, cards
        'onkoz-deep':        '#232428',   // Inputs, zones profondes
        'onkoz-hover':       '#35373c',   // Hover items
        'onkoz-active':      '#404249',   // Item sélectionné
        // ── Accent violet ONKOZ ────────────────────────────────────────────
        'onkoz-accent':      '#7c5cbf',
        'onkoz-accent-lt':   '#9775d4',   // Titres, logos
        'onkoz-accent-dk':   '#6a4faa',   // Hover boutons
        // ── Texte ──────────────────────────────────────────────────────────
        'onkoz-text':        '#dbdee1',
        'onkoz-text-md':     '#949ba4',
        'onkoz-text-muted':  '#6d6f78',
        // ── Bordures & états ───────────────────────────────────────────────
        'onkoz-border':      '#3d3f45',
        'onkoz-danger':      '#ed4245',
        'onkoz-success':     '#3ba55c',
        // ── Rôles ──────────────────────────────────────────────────────────
        'onkoz-admin':       '#ed4245',
        'onkoz-mod':         '#3ba55c',
        'onkoz-user':        '#faa61a',
      },
      fontFamily: {
        sans: ['Segoe UI', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
        '3xs': ['0.6rem',  { lineHeight: '0.9rem' }],
      },
      gridTemplateColumns: {
        'app': '240px 1fr 220px',
      },
      maxHeight: {
        'channel-list': '160px',
      },
      keyframes: {
        pulse_soft: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%':       { transform: 'scale(1.05)' },
        },
      },
      animation: {
        speaking: 'pulse_soft 0.6s ease-in-out infinite',
      },
      boxShadow: {
        'card': '0 24px 64px rgba(0,0,0,0.5)',
        'dm':   '0 16px 48px rgba(0,0,0,0.5)',
      },
    },
  },
  plugins: [],
  // Safelist des classes générées dynamiquement en JS
  safelist: [
    // Avatar colors
    'av-0','av-1','av-2','av-3','av-4','av-5','av-6','av-7',
    // Rôles (ajoutés dynamiquement)
    'text-onkoz-admin','text-onkoz-mod','text-onkoz-user',
    'bg-onkoz-admin/15','bg-onkoz-mod/15','bg-onkoz-user/15',
    'border-onkoz-success',
    // États
    'animate-speaking',
  ],
};
