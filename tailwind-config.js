// Load this AFTER the Tailwind CDN script on every page.
tailwind.config = {
  theme: {
    extend: {
      colors: {
        'tiktok-red': '#FE2C55',
        'tiktok-cyan': '#25F4EE',
        'tiktok-dark': '#121212',
        'tiktok-card': '#1E1E1E',
      },
      animation: {
        'spin-slow': 'spin 5s linear infinite',
        'heart-bounce': 'heartBounce 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        'marquee': 'marquee 8s linear infinite',
      },
      keyframes: {
        heartBounce: {
          '0%': { transform: 'scale(0.3)', opacity: '0' },
          '50%': { transform: 'scale(1.2)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        marquee: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(-100%)' },
        },
      },
    },
  },
};
