tailwind.config = {
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: { sans: ['Inter', 'sans-serif'] },
            colors: {
                dark: { 950: '#09090b', 900: '#121215', 800: '#1c1c21', 700: '#27272e' }
            },
            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'scan': 'scan 2.5s ease-in-out infinite'
            },
            keyframes: {
                scan: {
                    '0%, 100%': { transform: 'translateY(0%)' },
                    '50%': { transform: 'translateY(100%)' }
                }
            }
        }
    }
};
