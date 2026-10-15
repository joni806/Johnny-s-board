import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Board from './components/Board';
import Toolbar from './components/Toolbar';
import PresentBar from './components/PresentBar';
import DrivePanel from './components/DrivePanel';
import LayoutPanel from './components/LayoutPanel';
import { normalizeLayout } from './utils/pages';
import { backupProject, isConnected as driveConnected } from './utils/drive';
import { loadPenState, savePenState, buildPens, inkColorOn } from './utils/pens';
import {
  PROJECT_PREFIX, FOLDER_PREFIX, listProjects, loadProject, saveProject,
  deleteProject as removeProject, flushWrites,
  listFolders, saveFolder, moveFolder, deleteFolder, setProjectFolder, descendantFolderIds,
} from './utils/storage';
import './App.css'; // מייבא את העיצוב החדש והנקי

const stamped = (project) => ({ ...project, lastModified: Date.now() });

const ERASER_KEY = 'pb_eraser_v1';
const loadEraser = () => {
  try {
    const e = JSON.parse(localStorage.getItem(ERASER_KEY) || 'null');
    if (e && (e.mode === 'pixel' || e.mode === 'stroke')) return { size: 16, highlighterOnly: false, ...e };
  } catch { /* אין אחסון */ }
  return { mode: 'pixel', size: 16, highlighterOnly: false };
};

function App() {
  const [mode, setMode] = useState('draw');
  // העטים: עט, לורד ומדגיש תמיד, ועטים נוספים לפי בחירה. ההגדרות שמורות במכשיר
  const [penState, setPenState] = useState(loadPenState);
  useEffect(() => { savePenState(penState); }, [penState]);
  const pens = useMemo(() => buildPens(penState), [penState]);
  // לכל עט צבע, עובי ושקיפות משלו, והם נשמרים לעט עצמו. צורות, רכיבים, טקסט
  // ונוסחאות נוצרים בצבע של העט שפעיל כרגע
  const pen = pens.find((p) => p.id === penState.active) || pens[0];
  const drawColor = pen.color;
  const setActivePenId = useCallback((id) => setPenState((s) => ({ ...s, active: id })), []);
  const updatePen = useCallback((kind, patch) => setPenState((s) => ({ ...s, settings: { ...s.settings, [kind]: { ...(s.settings[kind] || {}), ...patch } } })), []);
  const addExtraPen = useCallback((kind) => setPenState((s) => ({ ...s, extras: [kind], active: kind })), []);
  const removeExtraPen = useCallback((kind) => setPenState((s) => ({ ...s, extras: s.extras.filter((k) => k !== kind), active: s.active === kind ? 'pen' : s.active })), []);
  const setDrawColor = useCallback((c) => setPenState((s) => {
    const kind = buildPens(s).some((p) => p.id === s.active) ? s.active : 'pen';
    return { ...s, settings: { ...s.settings, [kind]: { ...(s.settings[kind] || {}), color: c } } };
  }), []);
  const [eraser, setEraser] = useState(loadEraser);
  useEffect(() => { try { localStorage.setItem(ERASER_KEY, JSON.stringify(eraser)); } catch { /* מצב פרטי */ } }, [eraser]);
  const [selectionType, setSelectionType] = useState('freehand');
  const [boardColor, setBoardColor] = useState('#1e3d32');
  const [pattern, setPattern] = useState('grid');
  const [globalFontSize, setGlobalFontSize] = useState(48);
  /** הצבע שבו הדיו מוצג על הלוח הנוכחי — לבן הופך לשחור על לוח בהיר */
  const shownColor = inkColorOn(drawColor, boardColor);
  const textColor = shownColor;
  const handleBoardColor = setBoardColor;
  // מצב הצגה: מסך מלא, ממשק מוסתר וסמן לייזר במקום סרגל הכלים המלא
  const [presenting, setPresenting] = useState(false);
  const [showDrive, setShowDrive] = useState(false);
  // מזהי הגיבויים בדרייב לכל לוח, כדי לעדכן קובץ קיים ולא ליצור עותקים
  const driveFileIds = useRef({});
  const boardRef = useRef(null);
  const currentProjectRef = useRef(null);

  const [projects, setProjects] = useState([]);
  // תיקיות: folderId הוא התיקייה הפתוחה (null = הראשית)
  const [folders, setFolders] = useState([]);
  const [openFolderId, setFolderId] = useState(null);
  const [folderModal, setFolderModal] = useState(null);   // { id|null, name }
  const [moveModal, setMoveModal] = useState(null);       // { kind: 'project'|'folder', id }
  const [currentProject, setCurrentProject] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);
  
  const [newTitle, setNewTitle] = useState('לוח חדש');
  const [newColor, setNewColor] = useState('#1e3d32');
  const [newPattern, setNewPattern] = useState('grid');
  const [newLayout, setNewLayout] = useState(() => normalizeLayout(null));

  // נקודות גישה לבדיקות הקצה־לקצה ולניפוי באגים מהקונסולה
  useEffect(() => {
    Object.defineProperty(window, '__pbBoard', { get: () => boardRef.current, configurable: true });
    window.__pbSetMode = setMode;
  }, []);

  const loadProjectsList = useCallback(async () => {
    const [list, fl] = await Promise.all([listProjects(), listFolders()]);
    setProjects(list);
    setFolders(fl);
  }, []);

  useEffect(() => {
    // הדגל מונע עדכון מצב אחרי שהרכיב כבר ירד מהמסך
    let cancelled = false;
    Promise.all([listProjects(), listFolders()]).then(([list, fl]) => {
      if (!cancelled) { setProjects(list); setFolders(fl); }
    });
    return () => { cancelled = true; };
  }, []);

  const createNewProject = async () => {
    if (!newTitle.trim()) return;
    const newId = `${PROJECT_PREFIX}${uuidv4()}`;
    const newProjectData = stamped({
      id: newId, title: newTitle, bg: newColor, pattern: newPattern,
      fabric: null, math: [], autoSnap: true, folderId, layout: newLayout,
    });
    await saveProject(newId, newProjectData);
    setShowNewModal(false);
    currentProjectRef.current = newProjectData;
    setCurrentProject(newProjectData);
    loadProjectsList();
  };

  const openProject = async (id) => {
    const data = await loadProject(id);
    if (!data) return;
    currentProjectRef.current = data;
    setCurrentProject(data);
  };

  const deleteProject = async (id, e) => {
    e.stopPropagation();
    if (window.confirm('האם אתה בטוח שברצונך למחוק את הלוח? לא ניתן לשחזר פעולה זו.')) {
      await removeProject(id);
      loadProjectsList();
    }
  };

  // ── תיקיות ──
  // תיקייה שנמחקה מתחת לרגלינו מחזירה לראשית
  const folderId = folders.some((f) => f.id === openFolderId) ? openFolderId : null;
  const folderPath = (() => {
    const path = [];
    for (let id = folderId, guard = 0; id && guard < 50; guard++) {
      const f = folders.find((x) => x.id === id);
      if (!f) break;
      path.unshift(f);
      id = f.parentId;
    }
    return path;
  })();
  const subFolders = folders.filter((f) => (f.parentId || null) === folderId);
  const shownProjects = projects.filter((p) => (p.folderId || null) === folderId);
  /** כמה פריטים יש בתיקייה, כולל בתתי־התיקיות שלה */
  const countIn = (id) => {
    const ids = descendantFolderIds(folders, id); ids.add(id);
    return projects.filter((p) => ids.has(p.folderId)).length;
  };

  const submitFolder = async () => {
    const name = folderModal?.name.trim();
    if (!name) return;
    if (folderModal.id) {
      const f = folders.find((x) => x.id === folderModal.id);
      if (f) await saveFolder({ ...f, title: name });
    } else {
      await saveFolder({ id: `${FOLDER_PREFIX}${uuidv4()}`, title: name, parentId: folderId });
    }
    setFolderModal(null);
    loadProjectsList();
  };
  const removeFolder = async (f, e) => {
    e.stopPropagation();
    if (!window.confirm(`למחוק את התיקייה ״${f.title}״? הלוחות והתיקיות שבתוכה לא יימחקו, והם יעברו למעלה.`)) return;
    await deleteFolder(folders, projects, f.id);
    loadProjectsList();
  };
  const doMove = async (target) => {
    const m = moveModal;
    setMoveModal(null);
    if (!m) return;
    if (m.kind === 'project') await setProjectFolder(m.id, target);
    else await moveFolder(folders, m.id, target);
    loadProjectsList();
  };
  /** גרירת כרטיס על תיקייה (בעכבר). במגע משתמשים בכפתור ״העבר״ */
  const dropOn = (e, target) => {
    e.preventDefault(); e.stopPropagation();
    const raw = e.dataTransfer.getData('text/pb-item');
    if (!raw) return;
    const [kind, id] = raw.split('|');
    (kind === 'project' ? setProjectFolder(id, target) : moveFolder(folders, id, target)).then(loadProjectsList);
  };

  /** גיבוי הלוח הפתוח לדרייב. מחזיר { ok } לחלונית שהפעילה אותו */
  const backupCurrentToDrive = useCallback(async () => {
    const project = currentProjectRef.current;
    if (!project) return { ok: false };
    try {
      const file = await backupProject(project, driveFileIds.current[project.id] || null);
      driveFileIds.current[project.id] = file.id;
      return { ok: true };
    } catch {
      // מזהה ישן שנמחק בדרייב גורם לשגיאה, ולכן ננסה שוב כקובץ חדש
      if (driveFileIds.current[project.id]) {
        driveFileIds.current[project.id] = null;
        try {
          const file = await backupProject(project, null);
          driveFileIds.current[project.id] = file.id;
          return { ok: true };
        } catch { return { ok: false }; }
      }
      return { ok: false };
    }
  }, []);

  const enterPresenting = async () => {
    setPresenting(true);
    setMode('laser');
    // מסך מלא הוא בקשה שהדפדפן רשאי לדחות, והמצב עובד גם בלעדיו
    try { await document.documentElement.requestFullscreen?.(); } catch { /* נדחה */ }
  };

  const exitPresenting = useCallback(() => {
    setPresenting(false);
    setMode('draw');
    try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch { /* נדחה */ }
  }, []);

  // יציאה ממסך מלא באמצעות Esc מסנכרנת גם את מצב ההצגה
  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setPresenting((was) => {
          if (was) setMode('draw');
          return false;
        });
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // בסיס המיזוג מוחזק ב-ref ולא ב-state. קודם כל שמירה אוטומטית קראה
  // ל-setCurrentProject, וכל 1.5 שניות של ציור גררו רינדור מחדש של כל הלוח.
  const handleAutoSave = useCallback(async (updatedData) => {
    const base = currentProjectRef.current;
    if (!base) return null;
    const projectToSave = stamped({ ...base, ...updatedData });
    currentProjectRef.current = projectToSave;
    return saveProject(base.id, projectToSave);
  }, []);

  // סגירת לוח ממתינה לסיום הכתיבות, כדי שחזרה למסך הפתיחה לא תקטע שמירה
  const closeProject = useCallback(async () => {
    const id = currentProjectRef.current?.id;
    currentProjectRef.current = null;
    setCurrentProject(null);
    if (id) await flushWrites(id);
    loadProjectsList();
  }, [loadProjectsList]);

  // סגירת לוח מגבה אותו לדרייב כשיש חיבור פעיל. הכישלון שקט בכוונה —
  // גיבוי הוא תוספת, ואסור לו לחסום יציאה מלוח.
  const closeAndBackup = useCallback(async () => {
    if (driveConnected()) { try { await backupCurrentToDrive(); } catch { /* ננסה בפעם הבאה */ } }
    await closeProject();
  }, [closeProject, backupCurrentToDrive]);

  // --- תצוגת אזור העבודה (הלוח וסרגל הכלים) ---
  if (currentProject) {
    return (
      // dvh ולא vh: בכרום באנדרואיד 100vh גבוה מהחלק הגלוי, והתחתית של הלוח נחתכה
      <div style={{ width: '100vw', height: '100dvh', overflow: 'hidden', position: 'relative' }}>


        <Board 
          ref={boardRef} 
          mode={mode} setMode={setMode}
          pen={pen}
          eraser={eraser}
          selectionType={selectionType}
          textColor={textColor} 
          globalFontSize={globalFontSize} 
          projectId={currentProject.id}
          initialData={currentProject}
          onAutoSave={handleAutoSave}
          onBoardColorChange={handleBoardColor}
          onPatternChange={setPattern}
          onOpenDrive={() => setShowDrive(true)}
        />
        
        {presenting ? (
          <PresentBar
            mode={mode}
            setMode={setMode}
            onUndo={() => boardRef.current?.undo?.()}
            onExit={exitPresenting}
          />
        ) : (
          <Toolbar
            mode={mode} setMode={setMode}
            pens={pens} activePenId={pen.id} setActivePenId={setActivePenId}
            updatePen={updatePen} addExtraPen={addExtraPen} removeExtraPen={removeExtraPen}
            color={drawColor} setColor={setDrawColor} shownColor={shownColor}
            eraser={eraser} setEraser={setEraser}
            selectionType={selectionType} setSelectionType={setSelectionType}
            setGlobalFontSize={setGlobalFontSize}
            boardRef={boardRef}
            pattern={pattern}
            onPresent={enterPresenting}
            onDrive={() => setShowDrive(true)}
            onBack={closeAndBackup}
          />
        )}

        {showDrive && (
          <DrivePanel onClose={() => setShowDrive(false)} onBackup={backupCurrentToDrive} />
        )}
      </div>
    );
  }

  // --- תצוגת מסך הפתיחה (Dashboard) ---
  return (
    <div className="dashboard-container">
     <header className="dashboard-header">
        <h1 className="dashboard-title">הלוחות שלי</h1>
        <div style={{ display: 'flex', alignItems: 'center' }}>
        <button className="btn-header-action" title="תיקייה חדשה" aria-label="תיקייה חדשה" onClick={() => setFolderModal({ id: null, name: '' })}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M12 11v5M9.5 13.5h5" />
          </svg>
        </button>
        <button className="btn-header-action" title="גוגל דרייב" onClick={() => setShowDrive(true)}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.3 9.2 4.5 4.5 0 0 0 6.5 19z" />
            <path d="M12 12v6M9.5 15.5 12 18l2.5-2.5" />
          </svg>
        </button>
        <button className="btn-create-new" title="צור לוח חדש" onClick={() => setShowNewModal(true)}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
        </div>
      </header>

      {(folderId || folders.length > 0) && (
        <nav className="crumbs" aria-label="נתיב התיקייה">
          <button className={`crumb ${folderId ? '' : 'on'}`} onClick={() => setFolderId(null)}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => dropOn(e, null)}>הראשית</button>
          {folderPath.map((f, i) => (
            <span key={f.id} className="crumb-wrap">
              <span className="crumb-sep">›</span>
              <button className={`crumb ${i === folderPath.length - 1 ? 'on' : ''}`} onClick={() => setFolderId(f.id)}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => dropOn(e, f.id)}>{f.title}</button>
            </span>
          ))}
        </nav>
      )}

      <div className="projects-grid">
        {subFolders.map((f) => (
          <div key={f.id} className="project-card folder-card" onClick={() => setFolderId(f.id)}
            draggable onDragStart={(e) => e.dataTransfer.setData('text/pb-item', `folder|${f.id}`)}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => dropOn(e, f.id)}>
            <div className="folder-art" aria-hidden="true">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            </div>
            <div className="project-info">
              <div>
                <h3 className="project-title">{f.title}</h3>
                <p className="project-date">{countIn(f.id)} לוחות</p>
              </div>
              <div className="card-actions">
                <button className="btn-delete" title="שנה שם" onClick={(e) => { e.stopPropagation(); setFolderModal({ id: f.id, name: f.title }); }}>✎</button>
                <button className="btn-delete" title="העבר לתיקייה אחרת" onClick={(e) => { e.stopPropagation(); setMoveModal({ kind: 'folder', id: f.id }); }}>⇄</button>
                <button className="btn-delete" title="מחק תיקייה" onClick={(e) => removeFolder(f, e)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              </div>
            </div>
          </div>
        ))}
        {shownProjects.map(p => (
          <div key={p.id} className="project-card" onClick={() => openProject(p.id)}
            draggable onDragStart={(e) => e.dataTransfer.setData('text/pb-item', `project|${p.id}`)}>
            <div className="project-bg-preview" style={{ 
                backgroundColor: p.previewColor, 
                backgroundImage: p.pattern === 'grid' ? 'linear-gradient(rgba(255,255,255,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.2) 1px, transparent 1px)' : p.pattern === 'lines' ? 'linear-gradient(rgba(255,255,255,0.2) 1px, transparent 1px)' : p.pattern === 'dots' ? 'radial-gradient(circle, rgba(255,255,255,0.5) 1.5px, transparent 1.5px)' : 'none', 
                backgroundSize: '24px 24px' 
            }}></div>
            <div className="project-info">
              <div>
                <h3 className="project-title">{p.title}</h3>
                <p className="project-date">
                  {new Date(p.lastModified).toLocaleDateString('he-IL')} • {new Date(p.lastModified).toLocaleTimeString('he-IL', {hour: '2-digit', minute:'2-digit'})}
                </p>
              </div>
              <div className="card-actions">
              <button className="btn-delete" title="העבר לתיקייה" onClick={(e) => { e.stopPropagation(); setMoveModal({ kind: 'project', id: p.id }); }}>⇄</button>
              <button className="btn-delete" title="מחק פרויקט" onClick={(e) => deleteProject(p.id, e)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {shownProjects.length === 0 && subFolders.length === 0 && (
        <div style={{ textAlign: 'center', color: '#71717a', marginTop: '6rem', fontSize: '1.2rem', fontWeight: '500' }}>
          {folderId ? 'התיקייה ריקה. לחץ על הכפתור הירוק כדי ליצור כאן לוח, או העבר אליה לוחות.' : 'עדיין אין לך לוחות. לחץ על הכפתור הירוק כדי להתחיל!'}
        </div>
      )}

      {folderModal && (
        <div className="modal-overlay" onClick={() => setFolderModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">{folderModal.id ? 'שינוי שם תיקייה' : 'תיקייה חדשה'}</h2>
            <div className="form-group">
              <label className="form-label">שם התיקייה</label>
              <input type="text" className="form-input" value={folderModal.name} autoFocus
                onChange={(e) => setFolderModal({ ...folderModal, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') submitFolder(); }} />
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setFolderModal(null)}>ביטול</button>
              <button className="btn-create-new" onClick={submitFolder}>{folderModal.id ? 'שמור' : 'צור תיקייה'}</button>
            </div>
          </div>
        </div>
      )}

      {moveModal && (() => {
        const blocked = moveModal.kind === 'folder' ? descendantFolderIds(folders, moveModal.id) : new Set();
        if (moveModal.kind === 'folder') blocked.add(moveModal.id);
        const current = moveModal.kind === 'folder'
          ? (folders.find((f) => f.id === moveModal.id)?.parentId || null)
          : (projects.find((p) => p.id === moveModal.id)?.folderId || null);
        // עץ התיקיות כרשימה מוזחת
        const rows = [];
        const walk = (parent, depth) => folders.filter((f) => (f.parentId || null) === parent).forEach((f) => {
          rows.push({ f, depth }); walk(f.id, depth + 1);
        });
        walk(null, 0);
        return (
          <div className="modal-overlay" onClick={() => setMoveModal(null)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2 className="modal-title">העבר אל…</h2>
              <div className="move-list">
                <button disabled={current === null} onClick={() => doMove(null)}>הראשית</button>
                {rows.map(({ f, depth }) => (
                  <button key={f.id} style={{ paddingInlineStart: 14 + depth * 18 }}
                    disabled={blocked.has(f.id) || current === f.id} onClick={() => doMove(f.id)}>📁 {f.title}</button>
                ))}
                {rows.length === 0 && <div className="move-empty">אין עדיין תיקיות. צור תיקייה בכפתור שבראש המסך.</div>}
              </div>
              <div className="modal-actions"><button className="btn-cancel" onClick={() => setMoveModal(null)}>סגור</button></div>
            </div>
          </div>
        );
      })()}

      {showDrive && <DrivePanel onClose={() => setShowDrive(false)} />}

      {showNewModal && (
        <div className="modal-overlay" onClick={() => setShowNewModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">הגדרות לוח חדש</h2>
            
            <div className="form-group">
              <label className="form-label">שם הפרויקט</label>
              <input type="text" className="form-input" value={newTitle} onChange={e => setNewTitle(e.target.value)} autoFocus />
            </div>

            <div className="form-group">
              <label className="form-label">תבנית רקע</label>
              <div className="pattern-grid">
                {[{id: 'none', label: 'חלק'}, {id: 'grid', label: 'משובץ'}, {id: 'engineering', label: 'הנדסי'}, {id: 'lines', label: 'שורות'}, {id: 'dots', label: 'נקודות'}, {id: 'isometric', label: 'איזומטרי'}].map(pt => (
                  <button key={pt.id} className={`pattern-btn ${newPattern === pt.id ? 'active' : ''}`} onClick={() => setNewPattern(pt.id)}>
                    {pt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">צבע בסיס</label>
              <div className="color-picker-group">
                {['#1e3d32', '#0f172a', '#1a1a1a', '#431407'].map(c => (
                  <button key={c} className={`color-circle ${newColor === c ? 'active' : ''}`} style={{ backgroundColor: c }} onClick={() => setNewColor(c)}></button>
                ))}
                <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} style={{ width: '42px', height: '42px', borderRadius: '50%', cursor: 'pointer', padding: 0, border: 'none', background: 'transparent' }} title="בחר צבע מותאם אישית" />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">סוג הלוח</label>
              <LayoutPanel inline layout={newLayout} pageCount={newLayout.pages} onChange={setNewLayout} />
            </div>

            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowNewModal(false)}>ביטול</button>
              <button className="btn-create-new" onClick={createNewProject}>צור והיכנס</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;