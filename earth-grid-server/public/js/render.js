(function() {
    'use strict';

    const canvas = document.getElementById('mapCanvas');
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('canvas-container');

    // 메인 캔버스 픽셀 보간 완전 차단
    ctx.imageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    ctx.msImageSmoothingEnabled = false;

    // 우측 패널 DOM 요소들 (기본 모드)
    const elName = document.getElementById('info-name');
    const elMapPos = document.getElementById('info-map-pos');
    const elLatLon = document.getElementById('info-latlon');
    const elElevation = document.getElementById('info-elevation');
    const elClimate = document.getElementById('info-climate');
    const elRiver = document.getElementById('info-river');

    // 우측 패널 DOM 요소들 (프로빈스 'W' 모드)
    const elProvName = document.getElementById('info-prov-name');
    const elProvMapPos = document.getElementById('info-prov-map-pos');
    const elProvLatLon = document.getElementById('info-prov-latlon');
    const elProvPopulation = document.getElementById('info-prov-population');
    const elProvResource = document.getElementById('info-prov-resource');
    const elProvBuildings = document.getElementById('info-prov-buildings');

    // 패널 섹션 컨테이너
    const panelNormal = document.getElementById('panel-normal');
    const panelProvince = document.getElementById('panel-province');

    const GRID_COLS = 800;
    const GRID_ROWS = 400;
    const CELL_SIZE = 2;
    const MAP_HEIGHT = GRID_ROWS * CELL_SIZE; // 전체 맵 세로 크기 (800px)

    // 오프스크린 캔버스 생성 및 보간 차단 설정
    const offCanvas = document.createElement('canvas');
    offCanvas.width = GRID_COLS * CELL_SIZE;
    offCanvas.height = MAP_HEIGHT;
    const offCtx = offCanvas.getContext('2d');

    offCtx.imageSmoothingEnabled = false;
    offCtx.mozImageSmoothingEnabled = false;
    offCtx.webkitImageSmoothingEnabled = false;
    offCtx.msImageSmoothingEnabled = false;

    // 공유 상태 객체 (이벤트 스크립트와 동기화)
    const mapState = {
        gridMap: null,
        provinceSpecs: null,
        cityList: [],
        isDataLoaded: false,
        renderMode: 'LEVEL', // 'LEVEL', 'PROVINCE', 'CLIMATE'
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        isSpacePressed: false,
        isDragging: false,
        dragStartX: 0,
        dragStartY: 0
    };

    // 화면 세로 크기 대비 최소 줌 배율 계산
    function getMinScale() {
        return canvas.height / MAP_HEIGHT;
    }

    // 세로 방향 오프셋 제한
    function clampOffset() {
        const currentMapHeight = MAP_HEIGHT * mapState.scale;
        const maxOffsetY = 0; 
        const minOffsetY = Math.min(0, canvas.height - currentMapHeight); 
        
        mapState.offsetY = Math.max(minOffsetY, Math.min(maxOffsetY, mapState.offsetY));
    }

    // 캔버스 크기 동적 조절
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

    // 💡 바다 레벨별 색상 팔레트 (시인성을 높인 선명한 블루 그라데이션)
    const DEPTH_COLORS = {
        1: '#4a90e2', // 표해 (밝고 선명한 연안 블루)
        2: '#2a75d3', // 중해 (대륙붕 블루)
        3: '#155bb5', // 반심해 (뚜렷한 심해 블루)
        4: '#0d3d82', // 심해 (짙고 어두운 네이비)
        5: '#06204a'  // 초심해 (해구 및 극심연)
    };

    // 💡 육지 레벨별 색상 팔레트 (경계 구분이 명확한 선명한 어스톤/그린 계열)
    const LEVEL_COLORS = {
        1: '#7bc950', // 평야 (선명한 연두색)
        2: '#4c9a2a', // 구릉 (진한 초록색)
        3: '#c8a846', // 저산 (뚜렷한 황토/골드 톤)
        4: '#965a27', // 고산 (선명한 갈색)
        5: '#5e3816'  // 산악 (진하고 어두운 암갈색)
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

    // 패널 가시성 전환 함수
    function updateInfoPanelVisibility() {
        if (mapState.renderMode === 'PROVINCE') {
            panelNormal.style.display = 'none';
            panelProvince.style.display = 'block';
        } else {
            panelNormal.style.display = 'block';
            panelProvince.style.display = 'none';
        }
    }

    // 맵 백그라운드 캐싱 렌더링
    function buildOffscreenMap() {
        if (!mapState.isDataLoaded) return;
        offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);

        for (let y = 0; y < GRID_ROWS; y++) {
            for (let x = 0; x < GRID_COLS; x++) {
                const cell = mapState.gridMap[y][x];
                if (!cell) continue;

                let fillColor = '#000';

                if (mapState.renderMode === 'LEVEL' || mapState.renderMode === 'PROVINCE') {
                    if (cell.DEPTH !== undefined) {
                        fillColor = DEPTH_COLORS[cell.LEVEL] || DEPTH_COLORS[2];
                    } else {
                        switch (cell.LEVEL) {
                            case 1:
                                fillColor = LEVEL_COLORS[1];
                                break;
                            case 2:
                                fillColor = LEVEL_COLORS[2];
                                break;
                            case 3:
                                fillColor = LEVEL_COLORS[3];
                                break;
                            case 4:
                                fillColor = LEVEL_COLORS[4];
                                break;
                            case 5:
                                fillColor = LEVEL_COLORS[5];
                                break;
                            default:
                                fillColor = LEVEL_COLORS[1];
                        }
                    }
                } else if (mapState.renderMode === 'CLIMATE') {
                    fillColor = getClimateColor(cell.CLIMATE);
                }

                offCtx.fillStyle = fillColor;
                offCtx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
        }
    }

    // 메인 화면 렌더링
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
                for (let city of mapState.cityList) {
                    const cx = tileOffsetX + city.x * CELL_SIZE + CELL_SIZE / 2;
                    const cy = city.y * CELL_SIZE + CELL_SIZE / 2;
                    
                    // 💡 도시 아이콘 가느다란 검은 테두리 적용
                    ctx.lineWidth = 0.3;
                    ctx.strokeStyle = '#000';
                    ctx.strokeText('🏙️', cx, cy);
                    ctx.fillText('🏙️', cx, cy);
                }
            }
        }

        ctx.restore();
    }

    // UI 엘리먼트 참조 묶음
    const domElements = {
        elName, elMapPos, elLatLon, elElevation, elClimate, elRiver,
        elProvName, elProvMapPos, elProvLatLon, elProvPopulation, elProvResource, elProvBuildings
    };

    // 전역 환경에 설정값 공유
    window.MapApp = {
        canvas,
        container,
        mapState,
        GRID_COLS,
        GRID_ROWS,
        CELL_SIZE,
        domElements,
        updateInfoPanelVisibility,
        buildOffscreenMap,
        render,
        clampOffset,
        getMinScale
    };

    // 초기화 함수
    async function init() {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = '20px Arial';
        ctx.fillText('데이터 로딩 중...', 50, 50);

        try {
            const [landRes, seaRes, provRes] = await Promise.all([
                fetch('/api/land-data'),
                fetch('/api/sea-data'),
                fetch('/api/province-specifications')
            ]);
            
            const landData = await landRes.json();
            const seaData = await seaRes.json();
            mapState.provinceSpecs = await provRes.json();
            
            mapState.gridMap = new Array(GRID_ROWS).fill(null).map(() => new Array(GRID_COLS).fill(null));
            
            // 육지 데이터 매핑
            for (let key in landData) {
                const cell = landData[key];
                const x = cell.MAP_POSITION[0];
                const y = cell.MAP_POSITION[1];
                if (y >= 0 && y < GRID_ROWS && x >= 0 && x < GRID_COLS) {
                    mapState.gridMap[y][x] = cell;
                }
            }

            // 바다 데이터 매핑
            for (let key in seaData) {
                const cell = seaData[key];
                const x = cell.MAP_POSITION[0];
                const y = cell.MAP_POSITION[1];
                if (y >= 0 && y < GRID_ROWS && x >= 0 && x < GRID_COLS) {
                    mapState.gridMap[y][x] = cell;
                }
            }

            mapState.cityList = [];

            for (let id in mapState.provinceSpecs) {
                const spec = mapState.provinceSpecs[id];
                const lat = spec.POSITION[0];
                const lon = spec.POSITION[1];

                const gx = Math.floor(((lon + 180) % 360) / 360 * GRID_COLS);
                const gy = Math.floor((90 - lat) / 180 * GRID_ROWS);

                if (gy >= 0 && gy < GRID_ROWS && gx >= 0 && gx < GRID_COLS) {
                    if (mapState.gridMap[gy][gx]) {
                        mapState.gridMap[gy][gx].PROVINCE_SPEC = spec;
                        mapState.cityList.path?.push ? null : mapState.cityList.push({ x: gx, y: gy, spec: spec });
                    }
                }
            }

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