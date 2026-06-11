export const CFG = {
  gridCols  : 40,
  gridRows  : 40,
  buildingW : 300,
  buildingH : 5000,
  spacing   : 560,
  camSpeed  : 1.7,
  fov       : 70,
  near      : 1.0,
  far       : 45 * 560,
  charCols  : 100,
  charRows  : 2000,
  camRadius : 10,
};

export const totalW    = (CFG.gridCols - 1) * CFG.spacing;
export const totalD    = (CFG.gridRows - 1) * CFG.spacing;
export const floorCharW = CFG.buildingW / CFG.charCols;
