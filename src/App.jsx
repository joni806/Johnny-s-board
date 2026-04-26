import React, { useState, useRef } from 'react';
import Board from './components/Board';
import Toolbar from './components/Toolbar';
import './index.css';

function App() {
  const [mode, setMode] = useState('draw');
  const [drawColor, setDrawColor] = useState('#f5f5f5'); // צבע לציור
  const [textColor, setTextColor] = useState('#f5f5f5'); // צבע נפרד לטקסט
  const [globalFontSize, setGlobalFontSize] = useState(48);
  const boardRef = useRef(null);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Board 
        ref={boardRef} 
        mode={mode} setMode={setMode}
        drawColor={drawColor} 
        textColor={textColor} 
        globalFontSize={globalFontSize} 
      />
      <Toolbar 
        mode={mode} setMode={setMode} 
        drawColor={drawColor} setDrawColor={setDrawColor} 
        textColor={textColor} setTextColor={setTextColor}
        globalFontSize={globalFontSize} setGlobalFontSize={setGlobalFontSize}
        boardRef={boardRef} 
      />
    </div>
  );
}

export default App;