/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: 'rgb(var(--ink-950) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          850: 'rgb(var(--ink-850) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          750: 'rgb(var(--ink-750) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          650: 'rgb(var(--ink-650) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)',
          faint: 'rgb(var(--line-faint) / <alpha-value>)',
        },
        mist: {
          bright: 'rgb(var(--mist-bright) / <alpha-value>)',
          DEFAULT: 'rgb(var(--mist) / <alpha-value>)',
          dim: 'rgb(var(--mist-dim) / <alpha-value>)',
          faint: 'rgb(var(--mist-faint) / <alpha-value>)',
          ghost: 'rgb(var(--mist-ghost) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
          dim: 'rgb(var(--accent-dim) / <alpha-value>)',
          deep: 'rgb(var(--accent-deep) / <alpha-value>)',
        },
        mint: {
          DEFAULT: 'rgb(var(--mint) / <alpha-value>)',
          soft: 'rgb(var(--mint-soft) / <alpha-value>)',
          dim: 'rgb(var(--mint-dim) / <alpha-value>)',
          deep: 'rgb(var(--mint-deep) / <alpha-value>)',
        },
        coral: {
          DEFAULT: 'rgb(var(--coral) / <alpha-value>)',
          soft: 'rgb(var(--coral-soft) / <alpha-value>)',
          dim: 'rgb(var(--coral-dim) / <alpha-value>)',
          deep: 'rgb(var(--coral-deep) / <alpha-value>)',
        },
        sand: {
          DEFAULT: 'rgb(var(--sand) / <alpha-value>)',
          soft: 'rgb(var(--sand-soft) / <alpha-value>)',
          dim: 'rgb(var(--sand-dim) / <alpha-value>)',
          deep: 'rgb(var(--sand-deep) / <alpha-value>)',
        },
        azure: {
          DEFAULT: 'rgb(var(--azure) / <alpha-value>)',
          soft: 'rgb(var(--azure-soft) / <alpha-value>)',
          dim: 'rgb(var(--azure-dim) / <alpha-value>)',
          deep: 'rgb(var(--azure-deep) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'Segoe UI Variable', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono Variable', 'JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
        '3xs': ['9px', { lineHeight: '12px' }],
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--accent) / 0.18), 0 0 32px -10px rgb(var(--accent) / 0.38)',
        panel: 'var(--panel-shadow)',
        inset: 'var(--inset-shadow)',
      },
      animation: {
        'fade-in': 'fadeIn 160ms ease-out both',
        'slide-up': 'slideUp 180ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-down': 'slideDown 180ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-soft': 'pulseSoft 1.8s ease-in-out infinite',
        shimmer: 'shimmer 1.6s linear infinite',
        blink: 'blink 1.1s step-end infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
