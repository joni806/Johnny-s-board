/**
 * סמן לייזר למצב הצגה.
 *
 * הסימון לא נשמר ולא הופך לאובייקט על הלוח — הוא רק מצויר על קנבס התצוגה
 * החיה ודועך מעצמו. כך מרצה יכול להצביע על נוסחה בלי להשאיר עקבות.
 *
 * הנקודות נשמרות במרחב המסך, כי הלייזר תמיד נראה באותו עובי בלי קשר לזום.
 */

export const LASER_DEFAULTS = {
    life: 700,        // כמה זמן נקודה נשארת על המסך, במילי־שניות
    width: 5,         // עובי הקו בפיקסלים
    color: '#ff2d55',
    glow: 14,
};

export const createLaser = (options = {}) => {
    const cfg = { ...LASER_DEFAULTS, ...options };
    let points = [];

    const add = (x, y, now = Date.now()) => { points.push({ x, y, t: now }); };

    /** משליך נקודות שפג תוקפן. מחזיר true כל עוד נשאר משהו לצייר */
    const prune = (now = Date.now()) => {
        points = points.filter((p) => now - p.t < cfg.life);
        return points.length > 0;
    };

    const clear = () => { points = []; };

    /**
     * מצייר את הזנב. כל מקטע מקבל שקיפות לפי גילו, ולכן הזנב דוהה
     * באופן רציף במקום להיעלם בבת אחת.
     */
    const draw = (ctx, now = Date.now()) => {
        if (points.length < 2) return;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = cfg.color;
        ctx.strokeStyle = cfg.color;
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];
            const age = (now - b.t) / cfg.life;
            if (age >= 1) continue;
            const k = 1 - age;
            ctx.globalAlpha = Math.max(0, k * k);
            ctx.lineWidth = cfg.width * (0.45 + 0.55 * k);
            ctx.shadowBlur = cfg.glow * k;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
        // נקודת החוד עצמה, בהירה יותר
        const head = points[points.length - 1];
        const headAge = (now - head.t) / cfg.life;
        if (headAge < 0.5) {
            ctx.globalAlpha = 1 - headAge * 2;
            ctx.shadowBlur = cfg.glow;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(head.x, head.y, cfg.width * 0.62, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    };

    return { add, prune, draw, clear, get size() { return points.length; } };
};
