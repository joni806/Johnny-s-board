import Icon from './icons';
import { isHorizontalFlow } from '../utils/pages';

/** פס קטן שמראה באיזה דף נמצאים ומאפשר לעבור ביניהם ולהוסיף דף */
export default function PageNav({ layout, page, onGo, onAdd, onFit, onSettings }) {
    const horizontal = isHorizontalFlow(layout);
    return (
        <div data-ui className="board-chip page-nav" dir="rtl" role="toolbar" aria-label="ניווט בין דפים">
            <button onClick={() => onGo(page - 1)} disabled={page <= 0} aria-label="הדף הקודם" title="הדף הקודם">
                <Icon name={horizontal ? 'arrow-left' : 'arrow-up'} size={15} />
            </button>
            <span className="chip-label page-nav-n">דף {page + 1}</span>
            <button onClick={() => onGo(page + 1)} aria-label="הדף הבא" title="הדף הבא">
                <Icon name={horizontal ? 'arrow-right' : 'arrow-down'} size={15} />
            </button>
            <button onClick={onAdd} title="הוסף דף"><Icon name="plus" size={14} /> דף</button>
            <button onClick={onFit} title="התאם את הדף למסך">התאם</button>
            <button onClick={onSettings} title="פריסת הלוח"><Icon name="background" size={15} /></button>
        </div>
    );
}
