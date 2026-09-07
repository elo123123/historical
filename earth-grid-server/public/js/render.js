(function() {
    'use strict';

    const canvas = document.getElementById('mapCanvas');
    const ctx = canvas.getContext('2d');
    
    const container = document.getElementById('canvas-container');

    ctx.imageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    ctx.msImageSmoothingEnabled = false;

    const elName = document.getElementById('info-name');
    const elMapPos = document.getElementById('info-map-pos');
    const elLatLon = document.getElementById('info-latlon');
    const elElevation = document.getElementById('info-elevation');
    const elClimate = document.getElementById('info-climate');
    const elRiver = document.getElementById('info-river');

    const elProvName = document.getElementById('info-prov-name');
    const elProvMapPos = document.getElementById('info-prov-map-pos');
    const elProvLatLon = document.getElementById('info-prov-latlon');
    const elProvPopulation = document.getElementById('info-prov-population');
    const elProvResource = document.getElementById('info-prov-resource');
    const elProvBuildings = document.getElementById('info-prov-buildings');

    const panelNormal = document.getElementById('panel-normal');
    const panelProvince = document.getElementById('panel-province');

    const GRID_COLS = 800;
    const GRID_ROWS = 400;
    const CELL_SIZE = 2;
    const MAP_HEIGHT = GRID_ROWS * CELL_SIZE;

    const offCanvas = document.createElement('canvas');
    offCanvas.width = GRID_COLS * CELL_SIZE;
    offCanvas.height = MAP_HEIGHT;
    const offCtx = offCanvas.getContext('2d');

    ctx.imageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    ctx.msImageSmoothingEnabled = false;
    ctx.imageSmoothingEnabled = false;

    offCtx.imageSmoothingEnabled = false;
    offCtx.webkitImageSmoothingEnabled = false;
    offCtx.msImageSmoothingEnabled = false;
    offCtx.imageSmoothingEnabled = false;

    const mapState = {
        gridMap: null,
        cityList: [],
        capitals: [], // ⭐ 수도 및 도시 정보 저장 배열 (프로빈스당 1개)
        isDataLoaded: false,
        renderMode: 'LEVEL', 
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        isSpacePressed: false,
        isDragging: false,
        dragStartX: 0,
        dragStartY: 0
    };

    function getMinScale() { return canvas.height / MAP_HEIGHT; }

    function clampOffset() {
        const currentMapHeight = MAP_HEIGHT * mapState.scale;
        const maxOffsetY = 0; 
        const minOffsetY = Math.min(0, canvas.height - currentMapHeight); 
        mapState.offsetY = Math.max(minOffsetY, Math.min(maxOffsetY, mapState.offsetY));
    }

    function resizeCanvas() {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        ctx.imageSmoothingEnabled = false;

        const minScale = getMinScale();
        if (mapState.scale < minScale) {
            mapState.scale = minScale;
        }
        clampOffset();
        render();
    }

    window.addEventListener('resize', resizeCanvas);

    const DEPTH_COLORS = {
        1: '#4a90e2', 2: '#2a75d3', 3: '#155bb5', 4: '#0d3d82', 5: '#06204a'
    };

    const LEVEL_COLORS = {
        1: '#7bc950', 2: '#4c9a2a', 3: '#c8a846', 4: '#965a27', 5: '#5e3816'
    };

    function getClimateColor(climate) {
        if (!climate || climate === 'Unknown') return '#111111';
        if (climate.includes('바다')) return '#0000FF';
        if (climate.includes('극지방') || climate.includes('툰트라')) return '#E0FFFF';
        if (climate.includes('냉대') || climate.includes('북해')) return '#4682B4';
        if (climate.includes('사막') || climate.includes('건조')) return '#DEB887';
        if (climate.includes('온대')) return '#228B22';
        if (climate.includes('아열대')) return '#9ACD32';
        if (climate.includes('열대')) return '#FF8C00';
        return '#333333';
    }

    // 프로빈스 고유 색상 생성기
    function getProvinceColor(idStr) {
        let hash = 0;
        for (let i = 0; i < idStr.length; i++) {
            hash = idStr.charCodeAt(i) + ((hash << 5) - hash);
        }
        return `hsl(${Math.abs(hash) % 360}, 65%, 60%)`;
    }

    function updateInfoPanelVisibility() {
        if (mapState.renderMode === 'PROVINCE') {
            panelNormal.style.display = 'none';
            panelProvince.style.display = 'block';
        } else {
            panelNormal.style.display = 'block';
            panelProvince.style.display = 'none';
        }
    }

    function buildOffscreenMap() {
        if (!mapState.isDataLoaded) return;
        offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);

        for (let y = 0; y < GRID_ROWS; y++) {
            for (let x = 0; x < GRID_COLS; x++) {
                const cell = mapState.gridMap[y][x];
                if (!cell) continue;

                let fillColor = '#000';

                if (mapState.renderMode === 'PROVINCE') {
                    if (cell.provinceData) {
                        fillColor = getProvinceColor(cell.provinceData.NAME || cell.provinceData.ID || 'Unknown');
                    } else if (cell.DEPTH !== undefined) {
                        fillColor = DEPTH_COLORS[cell.LEVEL] || DEPTH_COLORS[2];
                    } else {
                        fillColor = LEVEL_COLORS[1];
                    }
                } else if (mapState.renderMode === 'LEVEL') {
                    if (cell.DEPTH !== undefined) {
                        fillColor = DEPTH_COLORS[cell.LEVEL] || DEPTH_COLORS[2];
                    } else {
                        fillColor = LEVEL_COLORS[cell.LEVEL] || LEVEL_COLORS[1];
                    }
                } else if (mapState.renderMode === 'CLIMATE') {
                    fillColor = getClimateColor(cell.CLIMATE);
                }

                offCtx.fillStyle = fillColor;
                offCtx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);

                // 프로빈스 경계선 그리기 (1px 선명한 픽셀 표현)
                if (mapState.renderMode === 'PROVINCE' && cell.provinceData) {
                    offCtx.lineWidth = 0.1;
                    offCtx.strokeStyle = '#000';
                    offCtx.beginPath();
                    
                    const rightCell = (x + 1 < GRID_COLS) ? mapState.gridMap[y][x+1] : null;
                    if (!rightCell || rightCell.provinceData !== cell.provinceData) {
                        offCtx.moveTo((x + 1) * CELL_SIZE, y * CELL_SIZE);
                        offCtx.lineTo((x + 1) * CELL_SIZE, (y + 1) * CELL_SIZE);
                    }
                    
                    const bottomCell = (y + 1 < GRID_ROWS) ? mapState.gridMap[y+1][x] : null;
                    if (!bottomCell || bottomCell.provinceData !== cell.provinceData) {
                        offCtx.moveTo(x * CELL_SIZE, (y + 1) * CELL_SIZE);
                        offCtx.lineTo((x + 1) * CELL_SIZE, (y + 1) * CELL_SIZE);
                    }
                    offCtx.stroke();
                }
            }
        }
    }

    function render() {
        if (!mapState.isDataLoaded) return;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(mapState.offsetX, mapState.offsetY);
        ctx.scale(mapState.scale, mapState.scale);

        const mapWidth = GRID_COLS * CELL_SIZE;
        const startTile = Math.floor(-mapState.offsetX / mapState.scale / mapWidth) - 1;
        const endTile = Math.ceil((canvas.width - mapState.offsetX) / mapState.scale / mapWidth) + 1;

        for (let i = startTile; i <= endTile; i++) {
            ctx.drawImage(offCanvas, i * mapWidth, 0);
        }

        if (mapState.renderMode === 'PROVINCE') {
            ctx.font = '2px sans-serif'; 
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (let i = startTile; i <= endTile; i++) {
                const tileOffsetX = i * mapWidth;
                for (let cap of mapState.capitals) {
                    const cx = tileOffsetX + cap.x * CELL_SIZE + CELL_SIZE / 2;
                    const cy = cap.y * CELL_SIZE + CELL_SIZE / 2;
                    ctx.fillText('⭐', cx, cy);
                }
            }
        }

        ctx.restore();
    }

    // ⭐ land.json 및 gridMap을 기반으로 도시 위치를 정확한 지형 좌표로 보정/스냅하는 함수
    function getCorrectedPosition(city, landData, gridMap) {
        let gx = null;
        let gy = null;

        const landIdKey = city.LAND_ID || city.land_id || city.landId;
        if (landIdKey !== undefined && landData[String(landIdKey)] && landData[String(landIdKey)].MAP_POSITION) {
            const pos = landData[String(landIdKey)].MAP_POSITION;
            gx = pos[0];
            gy = pos[1];
        } else if (city.MAP_POSITION && Array.isArray(city.MAP_POSITION)) {
            gx = city.MAP_POSITION[0];
            gy = city.MAP_POSITION[1];
        }

        if (gx === null || gy === null) return null;

        if (gy >= 0 && gy < GRID_ROWS && gx >= 0 && gx < GRID_COLS && gridMap[gy][gx]) {
            return { x: gx, y: gy };
        }

        let bestX = gx;
        let bestY = gy;
        let minCost = Infinity;
        const searchRadius = 5;

        for (let dy = -searchRadius; dy <= searchRadius; dy++) {
            for (let dx = -searchRadius; dx <= searchRadius; dx++) {
                const ny = gy + dy;
                const nx = gx + dx;
                if (ny >= 0 && ny < GRID_ROWS && nx >= 0 && nx < GRID_COLS) {
                    if (gridMap[ny][nx]) {
                        const cost = dx * dx + dy * dy;
                        if (cost < minCost) {
                            minCost = cost;
                            bestX = nx;
                            bestY = ny;
                        }
                    }
                }
            }
        }

        return { x: bestX, y: bestY };
    }

    const domElements = {
        elName, elMapPos, elLatLon, elElevation, elClimate, elRiver,
        elProvName, elProvMapPos, elProvLatLon, elProvPopulation, elProvResource, elProvBuildings
    };

    window.MapApp = {
        canvas, container, mapState, GRID_COLS, GRID_ROWS, CELL_SIZE,
        domElements, updateInfoPanelVisibility, buildOffscreenMap, render,
        clampOffset, getMinScale
    };

    async function init() {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = '20px Arial';
        ctx.fillText('데이터 로딩 중...', 50, 50);

        try {
            // ⭐ province-specifications 요청 제거 완료
            const [landRes, seaRes, provRes, cityRes] = await Promise.all([
                fetch('/api/land-data'),
                fetch('/api/sea-data'),
                fetch('province.json'),
                fetch('city.json')
            ]);
            
            const landData = await landRes.json();
            const seaData = await seaRes.json();
            const provinceData = await provRes.json();
            const cityData = await cityRes.json();
            
            mapState.gridMap = new Array(GRID_ROWS).fill(null).map(() => new Array(GRID_COLS).fill(null));
            
            // 1. land.json 데이터 바인딩
            for (let key in landData) {
                const cell = landData[key];
                const pos = cell.MAP_POSITION;
                if (pos && Array.isArray(pos)) {
                    const x = pos[0];
                    const y = pos[1];
                    if (y >= 0 && y < GRID_ROWS && x >= 0 && x < GRID_COLS) {
                        cell.landId = key;
                        mapState.gridMap[y][x] = cell;
                    }
                }
            }

            // 2. sea.json 데이터 바인딩
            for (let key in seaData) {
                const cell = seaData[key];
                const pos = cell.MAP_POSITION;
                if (pos && Array.isArray(pos)) {
                    const x = pos[0];
                    const y = pos[1];
                    if (y >= 0 && y < GRID_ROWS && x >= 0 && x < GRID_COLS) {
                        mapState.gridMap[y][x] = cell;
                    }
                }
            }

            const provArray = Object.values(provinceData);
            const cityArray = Object.values(cityData);
            mapState.capitals = [];

            // 3. 프로빈스 영역 구성 및 그리드에 프로빈스 데이터 바인딩
            provArray.forEach(prov => {
                if (prov.LAND_ARR && Array.isArray(prov.LAND_ARR)) {
                    prov.LAND_ARR.forEach(landIdNum => {
                        const landKey = String(landIdNum);
                        const targetLand = landData[landKey];
                        
                        if (targetLand && targetLand.MAP_POSITION) {
                            const gx = targetLand.MAP_POSITION[0];
                            const gy = targetLand.MAP_POSITION[1];
                            
                            if (gy >= 0 && gy < GRID_ROWS && gx >= 0 && gx < GRID_COLS) {
                                if (mapState.gridMap[gy][gx]) {
                                    mapState.gridMap[gy][gx].provinceData = prov;
                                }
                            }
                        }
                    });
                }
            });

            // 4. ⭐ 각 프로빈스당 도시를 선택하고, 인구수 비교 및 최소 거리(2칸 이상) 유지 규칙 적용
            const processedProvinces = new Set();

            provArray.forEach(prov => {
                const provKey = prov.ID || prov.PROVINCE_NAME;
                if (processedProvinces.has(provKey)) return;

                let selectedCity = null;

                // A. province.json의 CAPITAL_CITY와 city.json의 CITY_NAME을 비교하여 수도 찾기
                if (prov.CAPITAL_CITY) {
                    const capitalNameStr = String(prov.CAPITAL_CITY).trim();
                    selectedCity = cityArray.find(c => {
                        const cName = c.CITY_NAME ? String(c.CITY_NAME).trim() : '';
                        return cName === capitalNameStr;
                    });
                }

                // B. CAPITAL_CITY가 없거나 못 찾은 경우, 해당 프로빈스 영역(LAND_ARR) 내에 속한 도시 중 첫 번째 도시 선택
                if (!selectedCity && prov.LAND_ARR && Array.isArray(prov.LAND_ARR)) {
                    for (let landIdNum of prov.LAND_ARR) {
                        const landKey = String(landIdNum);
                        const targetLand = landData[landKey];
                        if (targetLand && targetLand.MAP_POSITION) {
                            const lx = targetLand.MAP_POSITION[0];
                            const ly = targetLand.MAP_POSITION[1];
                            selectedCity = cityArray.find(c => {
                                const pos = getCorrectedPosition(c, landData, mapState.gridMap);
                                return pos && pos.x === lx && pos.y === ly;
                            });
                            if (selectedCity) break;
                        }
                    }
                }

                // C. 여전히 못 찾았다면, 이 프로빈스 셀 위에 위치한 도시 중 첫 번째 도시 탐색
                if (!selectedCity) {
                    selectedCity = cityArray.find(c => {
                        const pos = getCorrectedPosition(c, landData, mapState.gridMap);
                        if (!pos) return false;
                        const cell = mapState.gridMap[pos.y][pos.x];
                        return cell && cell.provinceData === prov;
                    });
                }

                // 조건에 맞는 도시가 확정되면 좌표를 구한 뒤 거리 및 인구수 비교 로직 수행
                if (selectedCity) {
                    const correctedPos = getCorrectedPosition(selectedCity, landData, mapState.gridMap);
                    if (correctedPos) {
                        const newPop = Number(selectedCity.CITY_POPULATION) || 0;
                        let conflictIndex = -1;

                        // 이미 등록된 capitals 목록과 거리 비교 (2칸 미만으로 인접해 있는지 검사)
                        for (let i = 0; i < mapState.capitals.length; i++) {
                            const existingCap = mapState.capitals[i];
                            const dx = Math.abs(existingCap.x - correctedPos.x);
                            const dy = Math.abs(existingCap.y - correctedPos.y);
                            
                            // 가로/세로/대각선 거리가 1칸 이하인 경우(즉, 2칸 이상 떨어지지 않은 경우) 충돌로 간주
                            if (dx <= 1 && dy <= 1) {
                                conflictIndex = i;
                                break;
                            }
                        }

                        if (conflictIndex !== -1) {
                            // 충돌하는 기존 도시가 존재할 경우 인구수 비교
                            const existingCap = mapState.capitals[conflictIndex];
                            const existingPop = Number(existingCap.cityData.CITY_POPULATION) || 0;

                            if (newPop > existingPop) {
                                // 새로운 도시의 인구가 더 많다면 기존 도시를 대체함
                                mapState.capitals[conflictIndex] = {
                                    x: correctedPos.x,
                                    y: correctedPos.y,
                                    cityData: selectedCity,
                                    provinceData: prov
                                };
                                processedProvinces.add(provKey);
                            }
                            // 기존 도시 인구가 더 많거나 같으면 현재 도시는 무시(추가 안 함)
                        } else {
                            // 충돌하는 도시가 없다면 정상적으로 capitals에 추가
                            processedProvinces.add(provKey);
                            mapState.capitals.push({
                                x: correctedPos.x,
                                y: correctedPos.y,
                                cityData: selectedCity,
                                provinceData: prov
                            });
                        }
                    }
                }
            });;

            mapState.isDataLoaded = true;
            resizeCanvas();
            
            mapState.scale = getMinScale();
            mapState.offsetY = 0;

            updateInfoPanelVisibility(); 
            buildOffscreenMap(); 
            render(); 

            if (window.initMapEvents) {
                window.initMapEvents();
            }
        } catch (err) {
            console.error('데이터 로드 실패:', err);
        }
    }

    init();
})();