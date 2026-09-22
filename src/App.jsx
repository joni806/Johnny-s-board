import { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Board from './components/Board';
import Toolbar from './components/Toolbar';
import PresentBar from './components/PresentBar';
import DrivePanel from './components/DrivePanel';
import { backupProject, isConnected as driveConnected } from './utils/drive';
import {
  PROJECT_PREFIX, listProjects, loadProject, saveProject,
  deleteProject as removeProject, flushWrites,
} from './utils/storage';
import './App.css'; // מייבא את העיצוב החדש והנקי

const stamped = (project) => ({ ...project, lastModified: Date.now() });

function App() {
  const [mode, setMode] = useState('draw');
  const [drawColor, setDrawColor] = useState('#f5f5f5');
  const [textColor, setTextColor] = useState('#f5f5f5');
  const [globalFontSize, setGlobalFontSize] = useState(48);
  const [eraserSize, setEraserSize] = useState(20);
  // מצב הצגה: מסך מלא, ממשק מוסתר וסמן לייזר במקום סרגל הכלים המלא
  const [presenting, setPresenting] = useState(false);
  const [showDrive, setShowDrive] = useState(false);
  // מזהי הגיבויים בדרייב לכל לוח, כדי לעדכן קובץ קיים ולא ליצור עותקים
  const driveFileIds = useRef({});
  const boardRef = useRef(null);
  const currentProjectRef = useRef(null);

  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);
  
  const [newTitle, setNewTitle] = useState('לוח חדש');
  const [newColor, setNewColor] = useState('#1e3d32');
  const [newPattern, setNewPattern] = useState('grid');

  const loadProjectsList = useCallback(async () => {
    setProjects(await listProjects());
  }, []);

  useEffect(() => {
    // הדגל מונע עדכון מצב אחרי שהרכיב כבר ירד מהמסך
    let cancelled = false;
    listProjects().then((list) => { if (!cancelled) setProjects(list); });
    return () => { cancelled = true; };
  }, []);

  const createNewProject = async () => {
    if (!newTitle.trim()) return;
    const newId = `${PROJECT_PREFIX}${uuidv4()}`;
    const newProjectData = stamped({
      id: newId, title: newTitle, bg: newColor, pattern: newPattern,
      fabric: null, math: [], autoSnap: true,
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
      <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>


        <Board 
          ref={boardRef} 
          mode={mode} setMode={setMode}
          drawColor={drawColor} 
          textColor={textColor} 
          globalFontSize={globalFontSize} 
          projectId={currentProject.id}
          initialData={currentProject}
          onAutoSave={handleAutoSave}
          eraserSize={eraserSize}
          onBoardColorChange={(color) => { setDrawColor(color); setTextColor(color); }}
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
            drawColor={drawColor} setDrawColor={setDrawColor}
            textColor={textColor} setTextColor={setTextColor}
            globalFontSize={globalFontSize} setGlobalFontSize={setGlobalFontSize}
            boardRef={boardRef}
            eraserSize={eraserSize} setEraserSize={setEraserSize}
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

      <div className="projects-grid">
        {projects.map(p => (
          <div key={p.id} className="project-card" onClick={() => openProject(p.id)}>
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
              <button className="btn-delete" title="מחק פרויקט" onClick={(e) => deleteProject(p.id, e)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      {projects.length === 0 && (
        <div style={{ textAlign: 'center', color: '#71717a', marginTop: '6rem', fontSize: '1.2rem', fontWeight: '500' }}>
          עדיין אין לך לוחות. לחץ על הכפתור הירוק כדי להתחיל!
        </div>
      )}

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
                {[{id: 'none', label: 'חלק'}, {id: 'grid', label: 'משובץ'}, {id: 'lines', label: 'שורות'}, {id: 'dots', label: 'נקודות'}].map(pt => (
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