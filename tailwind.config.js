/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./client/**/*.html','./client/**/*.js'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'onkoz-bg':         '#080710',
        'onkoz-surface':    '#0D0C18',
        'onkoz-deep':       '#111020',
        'onkoz-elevated':   '#171526',
        'onkoz-hover':      '#1C1A2E',
        'onkoz-active':     '#221F36',
        'onkoz-accent':     '#7B5CE5',
        'onkoz-accent-lt':  '#9B7FE8',
        'onkoz-accent-ll':  '#C4AAFF',
        'onkoz-accent-dk':  '#6A4FCA',
        'onkoz-text':       '#EBE9F5',
        'onkoz-text-md':    '#A89FC8',
        'onkoz-text-muted': '#5A5474',
        'onkoz-text-dim':   '#302D45',
        'onkoz-border':     'rgba(255,255,255,0.06)',
        'onkoz-border-h':   'rgba(155,127,232,0.2)',
        'onkoz-danger':     '#FF5252',
        'onkoz-success':    '#4FD17A',
        'onkoz-admin':      '#FF5252',
        'onkoz-mod':        '#4FD17A',
        'onkoz-user':       '#F5A623',
      },
      fontFamily: {
        sans:  ['DM Sans','Segoe UI','system-ui','sans-serif'],
        title: ['Syne','Segoe UI','system-ui','sans-serif'],
        mono:  ['JetBrains Mono','Consolas','monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem',{ lineHeight:'1rem' }],
        '3xs': ['0.6rem', { lineHeight:'0.9rem' }],
      },
      maxHeight: { 'channel-list':'160px' },
      keyframes: {
        pulse_soft: { '0%,100%':{ transform:'scale(1)' }, '50%':{ transform:'scale(1.05)' } },
        fadeUp:     { from:{ opacity:'0', transform:'translateY(6px)' }, to:{ opacity:'1', transform:'translateY(0)' } },
        blink:      { '0%,100%':{ opacity:'1' }, '50%':{ opacity:'0.35' } },
      },
      animation: {
        speaking: 'pulse_soft 0.6s ease-in-out infinite',
        fadeUp:   'fadeUp 0.3s ease both',
        blink:    'blink 2s ease-in-out infinite',
      },
      boxShadow: {
        card:    '0 24px 64px rgba(0,0,0,0.6)',
        dm:      '0 16px 48px rgba(0,0,0,0.5)',
        sidebar: '4px 0 32px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
  safelist: [
    'av-0','av-1','av-2','av-3','av-4','av-5','av-6','av-7',
    'text-onkoz-admin','text-onkoz-mod','text-onkoz-user',
    'bg-onkoz-admin/15','bg-onkoz-mod/15','bg-onkoz-user/15',
    'border-onkoz-success','animate-speaking',
  ],
};
