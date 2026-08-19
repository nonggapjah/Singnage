import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
        "./features/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                background: "var(--background)",
                foreground: "var(--foreground)",
                'accent-cyan': 'var(--accent-cyan)',
                'accent-purple': 'var(--accent-purple)',
            },
            fontFamily: {
                sans: ['var(--font-noto-sans-thai)', 'sans-serif'],
            },
            // ✅ เพิ่มตรงนี้ครับ: กำหนดสเกล Font Size เองเพื่อ Override ค่า Default
            fontSize: {
                xs: ['0.75rem', { lineHeight: '1rem' }],     // 12px (at 16px root)
                sm: ['0.875rem', { lineHeight: '1.25rem' }], // 14px (at 16px root)
                base: ['1rem', { lineHeight: '1.5rem' }],    // 16px (at 16px root)
                lg: ['1.125rem', { lineHeight: '1.75rem' }],
                xl: ['1.25rem', { lineHeight: '1.75rem' }],
                '2xl': ['1.5rem', { lineHeight: '2rem' }],
                '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
                '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
                '5xl': ['3rem', { lineHeight: '1' }],
                '6xl': ['3.75rem', { lineHeight: '1' }],
                '7xl': ['4.5rem', { lineHeight: '1' }],
                '8xl': ['6rem', { lineHeight: '1' }],
                '9xl': ['8rem', { lineHeight: '1' }],
            },
        },
    },
    plugins: [],
};

export default config;
