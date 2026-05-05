import * as fabricPkg from 'fabric';
const fabric = fabricPkg.fabric || fabricPkg;

export const createGridGroup = (cols, rows, color) => {
    const cellSize = 40;
    const width = cols * cellSize;
    const height = rows * cellSize;
    const objects = [];

    for (let i = 0; i <= cols; i++) objects.push(new fabric.Line([i * cellSize, 0, i * cellSize, height], { stroke: 'rgba(255,255,255,0.1)', selectable: false }));
    for (let i = 0; i <= rows; i++) objects.push(new fabric.Line([0, i * cellSize, width, i * cellSize], { stroke: 'rgba(255,255,255,0.1)', selectable: false }));

    const centerX = Math.floor(cols / 2) * cellSize;
    const centerY = Math.floor(rows / 2) * cellSize;

    const xAxis = new fabric.Line([0, centerY, width, centerY], { stroke: color, strokeWidth: 2, selectable: false });
    const yAxis = new fabric.Line([centerX, 0, centerX, height], { stroke: color, strokeWidth: 2, selectable: false });
    objects.push(xAxis, yAxis);

    const arrowSize = 10;
    const xArrow = new fabric.Path(`M ${width} ${centerY} L ${width-arrowSize} ${centerY-arrowSize} M ${width} ${centerY} L ${width-arrowSize} ${centerY+arrowSize}`, { stroke: color, strokeWidth: 2, fill: '', selectable: false });
    const yArrow = new fabric.Path(`M ${centerX} 0 L ${centerX-arrowSize} ${arrowSize} M ${centerX} 0 L ${centerX+arrowSize} ${arrowSize}`, { stroke: color, strokeWidth: 2, fill: '', selectable: false });
    
    objects.push(xArrow, yArrow);
    return new fabric.Group(objects, { selectable: true });
};

// יצירת מצולעים אוטומטית לפי מספר צלעות
const createRegularPolygon = (sides, radius) => {
    const points = [];
    for (let i = 0; i < sides; i++) {
        const angle = (i * 2 * Math.PI / sides) - (Math.PI / 2);
        points.push({ x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) });
    }
    return points;
};

// יצירת כוכבים אוטומטית
const createStarPolygon = (pointsNum, outerRadius, innerRadius) => {
    const points = [];
    for (let i = 0; i < pointsNum * 2; i++) {
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        const angle = (i * Math.PI / pointsNum) - (Math.PI / 2);
        points.push({ x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) });
    }
    return points;
};

export const createShape = (type, color, center) => {
    let obj = null;
    const commonProps = { fill: 'rgba(255, 255, 255, 0.01)', stroke: color, strokeWidth: getStrokeWidth(), originX: 'center', originY: 'center', left: center.x, top: center.y };
    const pathProps = { ...commonProps, fill: 'transparent' };

    switch(type) {
        // צורות בסיסיות מעוגלות
        case 'rect': obj = new fabric.Rect({ ...commonProps, width: 100, height: 100 }); break;
        case 'circle': obj = new fabric.Circle({ ...commonProps, radius: 50 }); break;
        case 'ellipse': obj = new fabric.Ellipse({ ...commonProps, rx: 70, ry: 40 }); break;
        case 'half-circle': obj = new fabric.Path("M 0 50 A 50 50 0 0 1 100 50 Z", commonProps); break;
        
        // מצולעים (Polygons)
        case 'triangle': obj = new fabric.Triangle({ ...commonProps, width: 100, height: 100 }); break;
        case 'right-triangle': obj = new fabric.Polygon([{x:0,y:0},{x:0,y:100},{x:100,y:100}], commonProps); break;
        case 'diamond': obj = new fabric.Polygon([{x:50,y:0},{x:100,y:50},{x:50,y:100},{x:0,y:50}], commonProps); break;
        case 'pentagon': obj = new fabric.Polygon(createRegularPolygon(5, 50), commonProps); break;
        case 'hexagon': obj = new fabric.Polygon(createRegularPolygon(6, 50), commonProps); break;
        case 'heptagon': obj = new fabric.Polygon(createRegularPolygon(7, 50), commonProps); break;
        case 'octagon': obj = new fabric.Polygon(createRegularPolygon(8, 50), commonProps); break;
        case 'decagon': obj = new fabric.Polygon(createRegularPolygon(10, 50), commonProps); break;
        case 'parallelogram': obj = new fabric.Polygon([{x:25,y:0},{x:100,y:0},{x:75,y:100},{x:0,y:100}], commonProps); break;
        case 'trapezoid': obj = new fabric.Polygon([{x:25,y:0},{x:75,y:0},{x:100,y:100},{x:0,y:100}], commonProps); break;
        
        // כוכבים
        case 'star-4': obj = new fabric.Polygon(createStarPolygon(4, 50, 20), commonProps); break;
        case 'star-5': obj = new fabric.Polygon(createStarPolygon(5, 50, 20), commonProps); break;
        case 'star-6': obj = new fabric.Polygon(createStarPolygon(6, 50, 25), commonProps); break;

        // חצים מלאים (Block Arrows)
        case 'arrow-right': obj = new fabric.Polygon([{x:0,y:33},{x:50,y:33},{x:50,y:0},{x:100,y:50},{x:50,y:100},{x:50,y:66},{x:0,y:66}], commonProps); break;
        case 'arrow-left': obj = new fabric.Polygon([{x:100,y:33},{x:50,y:33},{x:50,y:0},{x:0,y:50},{x:50,y:100},{x:50,y:66},{x:100,y:66}], commonProps); break;
        case 'arrow-up': obj = new fabric.Polygon([{x:33,y:100},{x:33,y:50},{x:0,y:50},{x:50,y:0},{x:100,y:50},{x:66,y:50},{x:66,y:100}], commonProps); break;
        case 'arrow-down': obj = new fabric.Polygon([{x:33,y:0},{x:33,y:50},{x:0,y:50},{x:50,y:100},{x:100,y:50},{x:66,y:50},{x:66,y:0}], commonProps); break;
        
        // סימוני מתמטיקה
        case 'math-plus': obj = new fabric.Polygon([{x:35,y:0},{x:65,y:0},{x:65,y:35},{x:100,y:35},{x:100,y:65},{x:65,y:65},{x:65,y:100},{x:35,y:100},{x:35,y:65},{x:0,y:65},{x:0,y:35},{x:35,y:35}], commonProps); break;
        case 'math-minus': obj = new fabric.Rect({ ...commonProps, width: 100, height: 30 }); break;
        case 'math-multiply': obj = new fabric.Polygon([{x:20,y:0},{x:50,y:30},{x:80,y:0},{x:100,y:20},{x:70,y:50},{x:100,y:80},{x:80,y:100},{x:50,y:70},{x:20,y:100},{x:0,y:80},{x:30,y:50},{x:0,y:20}], commonProps); break;

        // צורות זרימה (Flowchart) ושונות
        case 'heart': obj = new fabric.Path("M 50 30 A 20 20 0 0 1 90 30 Q 90 60 50 90 Q 10 60 10 30 A 20 20 0 0 1 50 30 z", commonProps); break;
        case 'cylinder': obj = new fabric.Path("M 0 20 A 50 20 0 0 0 100 20 A 50 20 0 0 0 0 20 M 0 20 L 0 80 A 50 20 0 0 0 100 80 L 100 20", pathProps); break;
        case 'cube': obj = new fabric.Path("M 0 30 L 70 30 L 100 0 L 30 0 Z M 70 30 L 70 100 L 100 70 L 100 0 Z M 0 30 L 0 100 L 70 100 L 70 30 Z", pathProps); break;
        case 'lightning': obj = new fabric.Polygon([{x:60,y:0},{x:10,y:60},{x:50,y:60},{x:30,y:100},{x:90,y:40},{x:50,y:40}], commonProps); break;
        case 'moon': obj = new fabric.Path("M 50 0 A 50 50 0 1 0 100 50 A 40 40 0 1 1 50 0 Z", commonProps); break;
        case 'cloud': obj = new fabric.Path("M 25 60 A 20 20 0 0 1 25 20 A 25 25 0 0 1 75 20 A 20 20 0 0 1 75 60 Z", commonProps); break;
        case 'speech-bubble': obj = new fabric.Polygon([{x:0,y:0},{x:100,y:0},{x:100,y:70},{x:70,y:70},{x:30,y:100},{x:30,y:70},{x:0,y:70}], commonProps); break;

        default: break;
    }

    if (obj) obj.scale(1.5);
    return obj;
};