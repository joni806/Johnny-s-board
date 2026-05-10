import React, { useState, useRef, useEffect } from 'react';
import { get, set, keys, del } from 'idb-keyval';
import { v4 as uuidv4 } from 'uuid';
import Board from './components/Board';
import Toolbar from './components/Toolbar';
import './App.css'; // מייבא את העיצוב החדש והנקי

function App() {
  const [mode, setMode] = useState('draw');
  const [drawColor, setDrawColor] = useState('#f5f5f5');
  const [textColor, setTextColor] = useState('#f5f5f5');
  const [globalFontSize, setGlobalFontSize] = useState(48);
  const boardRef = useRef(null);

  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);
  
  const [newTitle, setNewTitle] = useState('לוח חדש');
  const [newColor, setNewColor] = useState('#1e3d32');
  const [newPattern, setNewPattern] = useState('grid');

  useEffect(() => {
    loadProjectsList();
  }, []);

  const loadProjectsList = async () => {
    const projectKeys = await keys();
    const loadedProjects = [];
    for (const key of projectKeys) {
      if (key.startsWith('jb_project_')) {
        const data = await get(key);
        loadedProjects.push({ 
            id: key, 
            title: data.title, 
            lastModified: data.lastModified, 
            previewColor: data.bg || '#1e3d32', 
            pattern: data.pattern || 'none' 
        });
      }
    }
    loadedProjects.sort((a, b) => b.lastModified - a.lastModified);
    setProjects(loadedProjects);
  };

  const createNewProject = async () => {
    if (!newTitle.trim()) return;
    const newId = `jb_project_${uuidv4()}`;
    const newProjectData = {
      id: newId, title: newTitle, bg: newColor, pattern: newPattern,
      fabric: null, math: [], lastModified: Date.now()
    };
    await set(newId, newProjectData);
    setShowNewModal(false);
    setCurrentProject(newProjectData);
    loadProjectsList();
  };

  const openProject = async (id) => {
    const data = await get(id);
    setCurrentProject(data);
  };

  const deleteProject = async (id, e) => {
    e.stopPropagation();
    if (window.confirm('האם אתה בטוח שברצונך למחוק את הלוח? לא ניתן לשחזר פעולה זו.')) {
      await del(id);
      loadProjectsList();
    }
  };

  const handleAutoSave = async (updatedData) => {
    if (!currentProject) return;
    const projectToSave = { ...currentProject, ...updatedData, lastModified: Date.now() };
    await set(currentProject.id, projectToSave);
    setCurrentProject(projectToSave);
  };

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
        />
        
        <Toolbar 
          mode={mode} setMode={setMode} 
          drawColor={drawColor} setDrawColor={setDrawColor} 
          textColor={textColor} setTextColor={setTextColor}
          globalFontSize={globalFontSize} setGlobalFontSize={setGlobalFontSize}
          boardRef={boardRef}
          onBack={() => { setCurrentProject(null); loadProjectsList(); }} 
        />
      </div>
    );
  }

  // --- תצוגת מסך הפתיחה (Dashboard) ---
  return (
    <div className="dashboard-container">
     <header className="dashboard-header">
        <h1 className="dashboard-title">הלוחות שלי</h1>
        <button className="btn-create-new" title="צור לוח חדש" onClick={() => setShowNewModal(true)}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
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