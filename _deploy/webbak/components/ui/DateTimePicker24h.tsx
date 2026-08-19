'use client';

import React, { useEffect, useState, useRef } from 'react';

interface DateTimePicker24hProps {
    value: string; // YYYY-MM-DDTHH:mm
    onChange: (val: string) => void;
    placeholderDate?: string;
    isLarge?: boolean;
}

export const DateTimePicker24h: React.FC<DateTimePicker24hProps> = ({ 
    value, 
    onChange, 
    placeholderDate = 'dd/mm/yyyy', 
    isLarge = false 
}) => {
    const [datePart, setDatePart] = useState('');
    const [hourPart, setHourPart] = useState('00');
    const [minutePart, setMinutePart] = useState('00');
    
    const [dateInputText, setDateInputText] = useState('');
    const [timeInputText, setTimeInputText] = useState('00:00');
    
    const inputRef = useRef<HTMLInputElement>(null);

    // Sync state with incoming value
    useEffect(() => {
        if (value) {
            const parts = value.split('T');
            const dateStr = parts[0];
            const timeStr = parts[1] || '00:00';

            setDatePart(dateStr);
            const dParts = dateStr.split('-');
            if (dParts.length === 3) {
                setDateInputText(`${dParts[2]}/${dParts[1]}/${dParts[0]}`);
            }

            const timeParts = timeStr.split(':');
            if (timeParts.length >= 2) {
                setHourPart(timeParts[0]);
                setMinutePart(timeParts[1]);
                setTimeInputText(`${timeParts[0]}:${timeParts[1]}`);
                return;
            }
        }
        setDatePart('');
        setDateInputText('');
        setHourPart('00');
        setMinutePart('00');
        setTimeInputText('00:00');
    }, [value]);

    const getTodayDateString = () => {
        const today = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    };

    const triggerChange = (date: string, hour: string, minute: string) => {
        if (!date) {
            onChange('');
        } else {
            onChange(`${date}T${hour}:${minute}`);
        }
    };

    const handleDateChange = (dateVal: string) => {
        setDatePart(dateVal);
        triggerChange(dateVal, hourPart, minutePart);
    };

    const formatTypedDate = (val: string) => {
        const digits = val.replace(/\D/g, '').slice(0, 8);
        let formatted = '';
        if (digits.length > 0) {
            formatted += digits.slice(0, 2);
        }
        if (digits.length > 2) {
            formatted += '/' + digits.slice(2, 4);
        }
        if (digits.length > 4) {
            formatted += '/' + digits.slice(4, 8);
        }
        return formatted;
    };

    const handleDateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputVal = e.target.value;
        const formatted = formatTypedDate(inputVal);
        setDateInputText(formatted);

        const parts = formatted.split('/');
        const digits = formatted.replace(/\D/g, '');

        // Only commit the date when user has typed ALL 8 digits (ddmmyyyy)
        // AND the year part is already 4 digits — do NOT auto-expand 2-digit year while typing
        if (parts.length === 3 && parts[1].length === 2 && parts[0].length === 2 && digits.length === 8) {
            const yyyy = parts[2]; // Must be exactly 4 digits at this point
            if (yyyy.length === 4) {
                const mm = parts[1];
                const dd = parts[0];
                const dateStr = `${yyyy}-${mm}-${dd}`;
                
                const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
                if (!isNaN(d.getTime())) {
                    setDatePart(dateStr);
                    triggerChange(dateStr, hourPart, minutePart);
                }
            }
        } else if (formatted === '') {
            setDatePart('');
            triggerChange('', hourPart, minutePart);
        }
    };

    const handleDateBlur = () => {
        if (datePart) {
            const parts = datePart.split('-');
            setDateInputText(`${parts[2]}/${parts[1]}/${parts[0]}`);
        } else {
            const parts = dateInputText.split('/');
            if (parts.length === 3 && parts[1].length === 2 && parts[0].length === 2) {
                let yyyy = parts[2];
                if (yyyy.length === 2) {
                    yyyy = '20' + yyyy;
                    const dateStr = `${yyyy}-${parts[1]}-${parts[0]}`;
                    setDatePart(dateStr);
                    setDateInputText(`${parts[0]}/${parts[1]}/${yyyy}`);
                    triggerChange(dateStr, hourPart, minutePart);
                    return;
                }
            }
            setDateInputText('');
        }
    };

    const formatTypedTime = (val: string) => {
        const digits = val.replace(/\D/g, '').slice(0, 4);
        let formatted = '';
        if (digits.length > 0) {
            formatted += digits.slice(0, 2);
        }
        if (digits.length > 2) {
            formatted += ':' + digits.slice(2, 4);
        }
        return formatted;
    };

    const handleTimeInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputVal = e.target.value;
        const formatted = formatTypedTime(inputVal);
        setTimeInputText(formatted);

        const parts = formatted.split(':');
        if (parts.length === 2 && parts[0].length === 2 && parts[1].length === 2) {
            const hh = parts[0];
            const mm = parts[1];
            const hNum = parseInt(hh, 10);
            const mNum = parseInt(mm, 10);
            
            if (hNum >= 0 && hNum <= 23 && mNum >= 0 && mNum <= 59) {
                setHourPart(hh);
                setMinutePart(mm);
                const date = datePart || getTodayDateString();
                if (!datePart) setDatePart(date);
                triggerChange(date, hh, mm);
            }
        }
    };

    const handleTimeBlur = () => {
        setTimeInputText(`${hourPart}:${minutePart}`);
    };

    const handleContainerClick = () => {
        if (inputRef.current) {
            try {
                if (typeof inputRef.current.showPicker === 'function') {
                    inputRef.current.showPicker();
                } else {
                    inputRef.current.focus();
                }
            } catch (e) {
                inputRef.current.focus();
            }
        }
    };

    const containerHeight = isLarge ? 'h-[46px]' : 'h-[38px]';
    const textStyle = isLarge ? 'text-sm' : 'text-xs md:text-sm';
    const paddingX = isLarge ? 'px-4' : 'px-3';

    return (
        <div className={`flex items-center bg-black/40 border border-white/10 rounded-xl ${paddingX} ${containerHeight} ${textStyle} font-mono text-white transition-all focus-within:border-accent-cyan focus-within:shadow-[0_0_15px_rgba(34,211,238,0.15)] focus-within:bg-black/60 w-full`}>
            {/* Date Section */}
            <div className="flex items-center gap-2 flex-1 min-w-0 h-full relative">
                {/* Clickable icon to open date picker */}
                <button
                    type="button"
                    onClick={handleContainerClick}
                    className="text-gray-400 hover:text-white transition-colors cursor-pointer select-none text-xs md:text-sm flex items-center justify-center"
                    title="Open Calendar"
                >
                    📅
                </button>
                
                {/* Date text input */}
                <input
                    type="text"
                    value={dateInputText}
                    onChange={handleDateInputChange}
                    onBlur={handleDateBlur}
                    onFocus={(e) => e.target.select()}
                    placeholder={placeholderDate}
                    className="bg-transparent text-white outline-none w-full font-mono placeholder-gray-500 text-xs md:text-sm"
                />

                {/* Hidden native input for calendar picker */}
                <input
                    ref={inputRef}
                    type="date"
                    value={datePart}
                    onChange={(e) => {
                        handleDateChange(e.target.value);
                        if (e.target.value) {
                            const parts = e.target.value.split('-');
                            setDateInputText(`${parts[2]}/${parts[1]}/${parts[0]}`);
                        } else {
                            setDateInputText('');
                        }
                    }}
                    className="absolute w-0 h-0 opacity-0 pointer-events-none"
                    style={{ colorScheme: 'dark' }}
                />
            </div>
            
            {/* Divider */}
            <div className="h-4 w-[1px] bg-white/10 mx-2 shrink-0" />

            {/* Time Section */}
            <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-gray-400 select-none text-xs md:text-sm">🕒</span>
                <input
                    type="text"
                    value={timeInputText}
                    onChange={handleTimeInputChange}
                    onBlur={handleTimeBlur}
                    onFocus={(e) => e.target.select()}
                    placeholder="HH:mm"
                    className="bg-transparent text-white outline-none w-[46px] md:w-[54px] font-mono placeholder-gray-500 text-xs md:text-sm text-center font-bold"
                />
                <span className="text-[9px] text-accent-cyan font-bold uppercase select-none font-sans opacity-80">24h</span>
            </div>
        </div>
    );
};
