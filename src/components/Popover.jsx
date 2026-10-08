import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * חלונית צפה שנצמדת לכפתור שפתח אותה, בצד שפונה אל מרכז המסך.
 * כשסרגל הכלים עגון למעלה היא נפתחת למטה, כשהוא בצד ימין היא נפתחת
 * שמאלה, וכן הלאה — כך שהיא אף פעם לא מכסה את הסרגל ולא בורחת מהמסך.
 */
export default function Popover({ anchor, side = 'top', onClose, children, width = 300, className = '', label }) {
    const ref = useRef(null);
    const [pos, setPos] = useState({ left: -9999, top: -9999 });

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || !anchor) return;
        const r = anchor;
        const w = el.offsetWidth, h = el.offsetHeight;
        const vw = window.innerWidth, vh = window.innerHeight;
        const gap = 10;
        let left, top;
        if (side === 'left') { left = r.right + gap; top = r.top + r.height / 2 - h / 2; }
        else if (side === 'right') { left = r.left - gap - w; top = r.top + r.height / 2 - h / 2; }
        else if (side === 'bottom') { left = r.left + r.width / 2 - w / 2; top = r.top - gap - h; }
        else {
            left = r.left + r.width / 2 - w / 2; top = r.bottom + gap;
            if (top + h > vh - 8 && r.top - gap - h > 8) top = r.top - gap - h;
        }
        left = Math.max(8, Math.min(vw - w - 8, left));
        top = Math.max(8, Math.min(vh - h - 8, top));
        setPos({ left, top });
    }, [anchor, side, children]);

    useEffect(() => {
        const onDown = (e) => {
            if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('[data-popover-anchor]')) onClose?.();
        };
        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        // השהיה קצרה, כדי שהלחיצה שפתחה את החלונית לא תסגור אותה מיד
        const t = setTimeout(() => window.addEventListener('pointerdown', onDown, true), 0);
        window.addEventListener('keydown', onKey);
        return () => { clearTimeout(t); window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey); };
    }, [onClose]);

    return (
        <div ref={ref} data-ui dir="rtl" role="dialog" aria-label={label}
            className={`pb-popover ${className}`}
            style={{ position: 'fixed', left: pos.left, top: pos.top, width, zIndex: 9500 }}>
            {children}
        </div>
    );
}
