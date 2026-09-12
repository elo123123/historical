(function() {
    'use strict';

    // ==========================================
    // 1. DOM 요소 참조 정의
    // ==========================================
    const canvas = document.getElementById('mapCanvas');
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('canvas-container');

    // 타일 일반 정보 패널 엘리먼트
    const elName = document.getElementById('info-name');
    const elMapPos = document.getElementById('info-map-pos');
    const elLatLon = document.getElementById('info-latlon');
    const elElevation = document.getElementById('info-elevation');
    const elClimate = document.getElementById('info-climate');
    const elRiver = document.getElementById('info-river');

    // 프로빈스(행정구역) 정보 패널 엘리먼트
    const elProvName = document.getElementById('info-prov-name');
    const elProvMapPos = document.getElementById('info-prov-map-pos');
    const elProvLatLon = document.getElementById('info-prov-latlon');
    const elProvPopulation = document.getElementById('info-prov-population');
    const elProvResource = document.getElementById('info-prov-resource');
    const elProvBuildings = document.getElementById('info-prov-buildings');

    // 패널 UI 콘테이너 및 메시지 창
    const panelNormal = document.getElementById('panel-normal');
    const panelProvince = document.getElementById('panel-province');
    const messagePanel = document.getElementById('message-panel');

    // ==========================================
    // 2. 맵 격자(Grid) 규격 및 캔버스 설정
    // ==========================================
    const GRID_COLS = 800; // 가로 타일 수
    const GRID_ROWS = 400; // 세로 타일 수
    const CELL_SIZE = 2;   // 타일 1개의 픽셀 크기
    const MAP_HEIGHT = GRID_ROWS * CELL_SIZE;

    // 성능 최적화를 위한 오프스크린 캔버스 생성 (사전 렌더링용)
    const offCanvas = document.createElement('canvas');
    offCanvas.width = GRID_COLS * CELL_SIZE;
    offCanvas.height = MAP_HEIGHT;
    const offCtx = offCanvas.getContext('2d');

    // 도트 픽셀 그래픽 유지 (이미지 안티앨리어싱 비활성화)
    [ctx, offCtx].forEach(c => { c.imageSmoothingEnabled = false; });

    // 프로빈스 구분 시 사용할 파스텔톤 팔레트 (4색 정리 알고리즘용)
    const PROVINCE_PALETTE = [
        '#C6E2E9',
        '#F1E3D3',
        '#D8E2DC',
        '#FFCAD4'
    ];

    // 프로빈스 ID별 계산된 색상 저장 맵
    const provinceColorMap = {};

    // 애플리케이션 글로벌 맵 상태 객체
    const mapState = {
        gridMap: null,          // 2차원 타일 격자 데이터
        cityList: [],          // 도시 목록
        capitals: [],          // 수도 정보
        cityData: null,          // 도시 raw 데이터
        provinceData: null,      // 프로빈스 raw 데이터
        isDataLoaded: false,     // 데이터 로드 여부
        renderMode: 'PROVINCE', // 렌더링 모드 ('PROVINCE', 'LEVEL', 'CLIMATE')
        scale: 1,              // 현재 줌 확대 비율
        offsetX: 0,            // 캔버스 X축 이동 오프셋
        offsetY: 0,            // 캔버스 Y축 이동 오프셋
        isSpacePressed: false, // 스페이스바 클릭 여부
        isDragging: false,     // 마우스 드래그 상태 여부
        dragStartX: 0,         // 드래그 시작 X 좌표
        dragStartY: 0          // 드래그 시작 Y 좌표
    };

    /**
     * 타일 데이터 객체에서 유효한 REGION_ID(프로빈스/행정구역 식별자)를 추출하고 문자열로 정규화합니다.
     * @param {Object} cell - 특정 위치의 타일 데이터
     * @returns {string|null} 정규화된 Region ID
     */
    function getRegionId(cell) {
        if (!cell) return null;
        const id = cell.REGION_ID ?? cell.region_id ?? cell.PROVINCE_ID ?? cell.province_id ?? cell.provinceData?.ID;
        if (id === undefined || id === null || id === 0 || id === '0') return null;
        return String(id);
    }

    /**
     * 화면 높이에 맞춘 최소 확대(Zoom) 비율을 구합니다.
     * @returns {number} 최소 스케일 비율
     */
    function getMinScale() { return canvas.height / MAP_HEIGHT; }

    /**
     * 캔버스 이동(Pan) 시 Y축이 화면 영역 밖으로 넘어가지 않도록 위치를 제어합니다.
     */
    function clampOffset() {
        const currentMapHeight = MAP_HEIGHT * mapState.scale;
        const maxOffsetY = 0; 
        const minOffsetY = Math.min(0, canvas.height - currentMapHeight); 
        mapState.offsetY = Math.max(minOffsetY, Math.min(maxOffsetY, mapState.offsetY));
    }

    /**
     * 브라우저 창 크기 변경 이벤트 대응: 캔버스 크기를 재설정하고 화면을 다시 그려줍니다.
     */
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

    // ==========================================
    // 3. 지형 및 기후 색상 매핑 정의
    // ==========================================
    const DEPTH_COLORS = { 1: '#4a90e2', 2: '#2a75d3', 3: '#155bb5', 4: '#0d3d82', 5: '#06204a' }; // 해저 수심별 색상
    const LEVEL_COLORS = { 1: '#7bc950', 2: '#4c9a2a', 3: '#c8a846', 4: '#965a27', 5: '#5e3816' }; // 육지 고도별 색상

    /**
     * 기후 텍스트 명칭에 해당하는 시각화 색상을 반환합니다.
     * @param {string} climate - 기후명
     * @returns {string} Hex 색상 코드
     */
    function getClimateColor(climate) {
        if (!climate || climate === 'Unknown') return '#111111';
        //if (climate.includes('바다')) return '#0000FF';
        if (climate.includes('냉대'))  return '#820082';
        if (climate.includes('열대')) return '#960000';
        if (climate.includes('사막')) return '#FFCD00';
        if (climate.includes('온대')) return '#96FF00';
        if (climate.includes('건조')) return '#CDAA54';
        if (climate.includes('고산')) return '#6E6E6E';
        if (climate.includes('툰트라')) return '#B2B2B2';
        if (climate.includes('극지방')) return '#64FFFF';
        return '#333333';
    }

    /**
     * 4색 정리(4-color theorem) 기반 탐욕 알고리즘(Greedy algorithm)을 사용하여
     * 맞닿아 있는 인접 프로빈스가 서로 같은 색상을 갖지 않도록 4가지 색상을 자동으로 배정합니다.
     * @param {Array<Array<Object>>} gridMap - 2차원 격자 데이터
     */
    function compute4ColorMap(gridMap) {
        for (let key in provinceColorMap) delete provinceColorMap[key];

        const adj = {};
        const regionIds = new Set();

        // 1. 전역 격자를 탐색하여 각 프로빈스간 인접 그래프(Adjacency List) 구축
        for (let y = 0; y < GRID_ROWS; y++) {
            for (let x = 0; x < GRID_COLS; x++) {
                const cell = gridMap[y][x];
                if (!cell) continue;

                const rId = getRegionId(cell);
                if (!rId) continue;

                regionIds.add(rId);
                if (!adj[rId]) adj[rId] = new Set();

                const rightCell = x + 1 < GRID_COLS ? gridMap[y][x + 1] : null;
                const bottomCell = y + 1 < GRID_ROWS ? gridMap[y + 1][x] : null;

                [rightCell, bottomCell].forEach(neighbor => {
                    if (!neighbor) return;
                    const nRId = getRegionId(neighbor);
                    if (nRId && nRId !== rId) {
                        if (!adj[nRId]) adj[nRId] = new Set();
                        adj[rId].add(nRId);
                        adj[nRId].add(rId);
                    }
                });
            }
        }

        // 2. 연결성이 높은(이웃이 많은) 프로빈스부터 우선순위 배정
        const colorAssignments = {};
        const sortedRegions = Array.from(regionIds).sort((a, b) => (adj[b]?.size || 0) - (adj[a]?.size || 0));

        // 3. 이웃과 중복되지 않는 색상 번호 할당
        sortedRegions.forEach(rId => {
            const usedColors = new Set();
            if (adj[rId]) {
                adj[rId].forEach(neighborId => {
                    if (colorAssignments[neighborId] !== undefined) {
                        usedColors.add(colorAssignments[neighborId]);
                    }
                });
            }

            let assignedIdx = 0;
            for (let i = 0; i < PROVINCE_PALETTE.length; i++) {
                if (!usedColors.has(i)) {
                    assignedIdx = i;
                    break;
                }
            }
            colorAssignments[rId] = assignedIdx;
            provinceColorMap[rId] = PROVINCE_PALETTE[assignedIdx];
        });
    }

    /**
     * 프로빈스 ID에 해당되는 색상을 가져옵니다.
     * @param {string} rId - Region ID
     * @returns {string} Hex 색상 코드
     */
    function getProvinceColor(rId) {
        if (rId && provinceColorMap[rId]) {
            return provinceColorMap[rId];
        }
        return '#E2E8F0';
    }

    /**
     * 현재 선택된 렌더링 모드('PROVINCE' 모드 여부)에 따라 사이드바 정보 패널 UI 전환
     */
    function updateInfoPanelVisibility() {
        if (!panelNormal || !panelProvince) return;

        if (mapState.renderMode === 'PROVINCE') {
            panelNormal.style.display = 'none';
            panelProvince.style.display = 'block';
        } else {
            panelNormal.style.display = 'block';
            panelProvince.style.display = 'none';
        }
    }

    /**
     * 메모리 상의 오프스크린 캔버스에 전체 세계 지도를 1차적으로 고속 pre-rendering합니다.
     * (프로빈스, 고도, 기후 등 렌더 모드에 따른 색상 채우기 및 영역 경계선 그리기 포함)
     */
    function buildOffscreenMap() {
        if (!mapState.isDataLoaded) return;
        offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);

        for (let y = 0; y < GRID_ROWS; y++) {
            for (let x = 0; x < GRID_COLS; x++) {
                const cell = mapState.gridMap[y][x];
                if (!cell) continue;

                let fillColor = '#000';
                const rId = getRegionId(cell);

                // 렌더링 모드에 따른 타일 색 결정
                if (mapState.renderMode === 'PROVINCE') {
                    if (rId) {
                        fillColor = getProvinceColor(rId);
                    } else if (cell.DEPTH !== undefined) {
                        fillColor = DEPTH_COLORS[cell.LEVEL] || DEPTH_COLORS[2];
                    } else {
                        fillColor = '#D1D5DB';
                    }
                } else if (mapState.renderMode === 'LEVEL') {
                    if (cell.DEPTH !== undefined) {
                        fillColor = DEPTH_COLORS[cell.LEVEL] || DEPTH_COLORS[2];
                    } else {
                        fillColor = LEVEL_COLORS[cell.LEVEL] || LEVEL_COLORS[1];
                    }
                } else if (mapState.renderMode === 'CLIMATE') {
                    fillColor = getClimateColor(cell.CLIMATE_LEVEL_1);
                }

                offCtx.fillStyle = fillColor;
                offCtx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                
                // 프로빈스 모드 시 행정 구역 외곽 경계선 렌더링
                if (mapState.renderMode === 'PROVINCE' && rId) {
                    offCtx.lineWidth = 0.3;
                    offCtx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
                    offCtx.beginPath();
                    
                    const rightCell = (x + 1 < GRID_COLS) ? mapState.gridMap[y][x+1] : null;
                    const rightRId = getRegionId(rightCell);
                    if (!rightCell || rightRId !== rId) {
                        offCtx.moveTo((x + 1) * CELL_SIZE, y * CELL_SIZE);
                        offCtx.lineTo((x + 1) * CELL_SIZE, (y + 1) * CELL_SIZE);
                    }
                    
                    const bottomCell = (y + 1 < GRID_ROWS) ? mapState.gridMap[y+1][x] : null;
                    const bottomRId = getRegionId(bottomCell);
                    if (!bottomCell || bottomRId !== rId) {
                        offCtx.moveTo(x * CELL_SIZE, (y + 1) * CELL_SIZE);
                        offCtx.lineTo((x + 1) * CELL_SIZE, (y + 1) * CELL_SIZE);
                    }
                    offCtx.stroke();
                }
            }
        }
    }

    /**
     * 메인 캔버스에 지도를 출력하는 메인 프레임 렌더링 함수.
     * (무한 좌우 스크롤 루프 지원 및 수도 아이콘 표시 처리)
     */
    function render() {
        if (!mapState.isDataLoaded) return;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(mapState.offsetX, mapState.offsetY);
        ctx.scale(mapState.scale, mapState.scale);

        const mapWidth = GRID_COLS * CELL_SIZE;
        // 좌우 무한 반복 스크롤을 위한 타일 반복 영역 연산
        const startTile = Math.floor(-mapState.offsetX / mapState.scale / mapWidth) - 1;
        const endTile = Math.ceil((canvas.width - mapState.offsetX) / mapState.scale / mapWidth) + 1;

        // 사전 생성된 오프스크린 캔버스 복사 렌더링
        for (let i = startTile; i <= endTile; i++) {
            ctx.drawImage(offCanvas, i * mapWidth, 0);
        }

        // 수도 위치 표식(별 모양) 그리기
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

        ctx.restore();
    }

    /**
     * 도시 위치 좌표의 유효성을 검증하고, 오차가 있을 경우 인근(반경 5셀) 내 가장 가까운 유효 타일 좌표로 보정합니다.
     * @param {Object} city - 도시 데이터
     * @param {Object} landData - 육지 원본 데이터
     * @param {Array<Array<Object>>} gridMap - 2차원 타일 격자
     * @returns {{x: number, y: number}|null} 보정된 좌표
     */
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

        // 원본 좌표 주변 5x5 범위 내에서 유효 타일 재탐색
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

    // 외부 모듈 및 이벤트 핸들러 참조용 객체 구성
    const domElements = {
        elName, elMapPos, elLatLon, elElevation, elClimate, elRiver,
        elProvName, elProvMapPos, elProvLatLon, elProvPopulation, elProvResource, elProvBuildings,
        messagePanel
    };

    // 전역 객체(window.MapApp)로 공개하여 다른 스크립트에서 모듈 기능 접근 허용
    window.MapApp = {
        canvas, container, mapState, GRID_COLS, GRID_ROWS, CELL_SIZE,
        domElements, updateInfoPanelVisibility, buildOffscreenMap, render,
        clampOffset, getMinScale, getRegionId
    };

    /**
     * 시스템 초기화 메인 함수:
     * 로딩 화면 표시 -> 백엔드 API 및 JSON 데이터 파싱 -> 맵 매트릭스 구성 -> 색상 계산 -> 최종 렌더링
     */
    async function init() {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 로딩 화면 이미지 및 텍스트 표시
        await new Promise((resolve) => {
            const img = new Image();
            img.src = 'image.png';
            
            img.onload = () => {
                const x = (canvas.width - img.width) / 2;
                const y = (canvas.height - img.height) / 2;
                ctx.drawImage(img, x, y);
                ctx.fillStyle = '#fff';
                ctx.font = '20px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('데이터 로딩 중...', canvas.width / 2, y + img.height + 40);
                resolve();
            };

            img.onerror = () => {
                ctx.fillStyle = '#fff';
                ctx.font = '20px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('데이터 로딩 중...', canvas.width / 2, canvas.height / 2);
                resolve();
            };
        });

        try {
            // 지형 및 행정구역, 도시 관련 JSON 데이터 병렬 로드
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

            mapState.cityData = cityData;
            mapState.provinceData = provinceData;

            // 2차원 배열 격자 맵 초기화
            mapState.gridMap = new Array(GRID_ROWS).fill(null).map(() => new Array(GRID_COLS).fill(null));
            
            // 육지 데이터 매핑
            for (let key in landData) {
                const cell = landData[key];
                const pos = cell.MAP_POSITION;
                if (pos && Array.isArray(pos)) {
                    const x = pos[0];
                    const y = pos[1];
                    if (y >= 0 && y < GRID_ROWS && x >= 0 && x < GRID_COLS) {
                        cell.landId = key;
                        mapState.gridMap[y][x] = cell;

                        const regionId = getRegionId(cell);
                        if (regionId && provinceData[regionId]) {
                            cell.provinceData = provinceData[regionId];
                            cell.provinceData.ID = cell.provinceData.ID || regionId;
                        }
                    }
                }
            }

            // 바다 데이터 매핑
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

            // 프로빈스 구분 색상 자동 연산 실행
            compute4ColorMap(mapState.gridMap);

            // 수도/도시 위치 보정 및 리스트 생성
            const cityArray = Object.values(cityData);
            mapState.capitals = [];

            cityArray.forEach(city => {
                const pos = getCorrectedPosition(city, landData, mapState.gridMap);
                if (pos) {
                    const cell = mapState.gridMap[pos.y][pos.x];
                    mapState.capitals.push({
                        x: pos.x,
                        y: pos.y,
                        cityData: city,
                        provinceData: cell ? cell.provinceData : null
                    });
                }
            });

            // 데이터 준비 완료 후 초기화 렌더링 진행
            mapState.isDataLoaded = true;
            resizeCanvas();
            
            mapState.scale = getMinScale();
            mapState.offsetY = 0;

            updateInfoPanelVisibility(); 
            buildOffscreenMap(); 
            render(); 

            // 마우스/키보드 이벤트 바인딩 스크립트 연결
            if (window.initMapEvents) {
                window.initMapEvents();
            }
        } catch (err) {
            console.error('데이터 로드 및 렌더링 실패:', err);
        }
    }

    // 시스템 실행
    init();
})();