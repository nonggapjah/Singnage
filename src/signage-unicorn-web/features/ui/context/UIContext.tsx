'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'dark' | 'light';
type FontSize = 'small' | 'medium' | 'large';

interface UIContextType {
    theme: Theme;
    fontSize: FontSize;
    toggleTheme: () => void;
    toggleFontSize: () => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export function UIProvider({ children }: { children: React.ReactNode }) {
    const [theme, setTheme] = useState<Theme>('dark');
    const [fontSize, setFontSize] = useState<FontSize>('small');

    useEffect(() => {
        // Load settings from localStorage
        const savedTheme = localStorage.getItem('theme') as Theme || 'dark';
        const savedFontSize = localStorage.getItem('fontSize') as FontSize || 'small';

        setTheme(savedTheme);
        setFontSize(savedFontSize);

        applyTheme(savedTheme);
        applyFontSize(savedFontSize);
    }, []);

    const applyTheme = (t: Theme) => {
        document.documentElement.setAttribute('data-theme', t);
        if (t === 'light') {
            document.documentElement.style.setProperty('--background', '#ffffff');
            document.documentElement.style.setProperty('--foreground', '#171717');
        } else {
            document.documentElement.style.setProperty('--background', '#050507');
            document.documentElement.style.setProperty('--foreground', '#ffffff');
        }
    };

    const applyFontSize = (size: FontSize) => {
        // ✅ เปลี่ยนมาใช้ Data Attribute เพื่อให้ CSS/Tailwind ใน globals.css ทำงาน
        document.documentElement.setAttribute('data-font-size', size);

        // ❌ ลบการ Hardcode แบบเดิมออก
        // document.documentElement.style.fontSize = sizeVal; 
    };

    const toggleTheme = () => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);
        applyTheme(newTheme);
    };

    const toggleFontSize = () => {
        let newSize: FontSize = 'small';
        if (fontSize === 'small') newSize = 'medium';
        else if (fontSize === 'medium') newSize = 'large';
        else newSize = 'small';

        setFontSize(newSize);
        localStorage.setItem('fontSize', newSize);
        applyFontSize(newSize);
    };

    return (
        <UIContext.Provider value={{ theme, fontSize, toggleTheme, toggleFontSize }}>
            {children}
        </UIContext.Provider>
    );
}

export function useUI() {
    const context = useContext(UIContext);
    if (context === undefined) {
        throw new Error('useUI must be used within a UIProvider');
    }
    return context;
}
