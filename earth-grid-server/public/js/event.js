(function() {
    'use strict';

    // 이벤트 모듈 중복 초기화 방지 플래그
    let isInitialized = false;

    /**
     * [유틸리티 함수] 키-값 형태의 데이터(객체, 배열, 문자열)를 읽기 쉬운 텍스트로 포맷팅
     */
    function formatKeyValueList(data) {
        if (!data) return '-';
        if (typeof data === 'string') return data;
        
        if (Array.isArray(data)) {
            if (data.length === 0) return '-';
            return data.map(item => {
                if (typeof item === 'object' && item !== null) {
                    return Object.entries(item).map(([k, v]) => `${k} Lv.${v}`).join(', ');
                }
                return String(item);
            }).join(', ');
        }

        if (typeof data === 'object') {
            const entries = Object.entries(data);
            if (entries.length === 0) return '-';
            return entries.map(([k, v]) => `${k}: Lv.${v}`).join(', ');
        }

        return String(data);
    }

    /**
     * [메인 초기화 함수] 지도 관련 이벤트(마우스 클릭/드래그/휠, 키보드 단축키)를 등록
     */
    function initMapEvents() {
        if (isInitialized) return;

        const mapApp = window.MapApp;
        if (!mapApp) {
            console.error('MapApp 인스턴스를 찾을 수 없습니다.');
            return;
        }

        const {
            canvas, container, mapState, GRID_COLS, GRID_ROWS, CELL_SIZE,
            domElements, updateInfoPanelVisibility, buildOffscreenMap, render, clampOffset, getMinScale, getRegionId
        } = mapApp;

        if (!canvas || !container || !mapState) return;
        isInitialized = true;

        /**
         * [헬퍼 함수] 셀 객체에서 프로빈스/지역 ID를 안전하게 조회
         */
        const safeGetRegionId = getRegionId || function(cell) {
            if (!cell) return null;
            const id = cell.REGION_ID ?? cell.region_id ?? cell.PROVINCE_ID ?? cell.province_id ?? cell.provinceData?.ID;
            if (id === undefined || id === null || id === 0 || id === '0') return null;
            return String(id);
        };

        const {
            elName, elMapPos, elLatLon,
            elElevation, elClimate, elRiver,
            elProvName, elProvMapPos, elProvLatLon, elProvPopulation, elProvResource, elProvBuildings
        } = domElements || {};

        const boxLatLon = document.getElementById('info-latlon') || elLatLon;
        const boxMapPos = document.getElementById('info-map-pos') || elMapPos;
        const boxName = document.getElementById('info-name') || elName;

        const setText = (element, value) => {
            if (element) element.innerText = value;
        };

        /**
         * [헬퍼 함수] 하단 목재 패널 정보 박스 3개 출력 갱신
         */
        const updateBottomPanel = (name, latLon, mapPos) => {
            setText(boxName, `${name || '-'}`);
            setText(boxLatLon, `🌐 ${latLon || '-'}`);
            setText(boxMapPos, `📌 ${mapPos || '-'}`);
        };

        const hideCustomPopup = () => {
            if (typeof mapApp.hideCustomPopup === 'function') {
                mapApp.hideCustomPopup();
            }
        };

        const DRAG_THRESHOLD = 5;

        let renderPending = false;
        const requestRender = () => {
            if (!renderPending) {
                renderPending = true;
                requestAnimationFrame(() => {
                    render();
                    renderPending = false;
                });
            }
        };

        let isMouseDown = false;
        let hasDragged = false;
        let startX = 0;
        let startY = 0;

        if (typeof window.initContextMenu === 'function') {
            window.initContextMenu();
        }

        window.addEventListener('click', (e) => {
            const popup = mapApp.customPopup;
            if (popup && !popup.contains(e.target)) {
                hideCustomPopup();
            }
        });

        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            let modeChanged = false;

            if (key === 'q') {
                mapState.renderMode = 'LEVEL';
                modeChanged = true;
            } else if (key === 'w') {
                mapState.renderMode = 'PROVINCE';
                modeChanged = true;
            } else if (key === 'e') {
                mapState.renderMode = 'CLIMATE';
                modeChanged = true;
            }

            if (modeChanged) {
                hideCustomPopup();
                if (typeof updateInfoPanelVisibility === 'function') updateInfoPanelVisibility();
                if (typeof buildOffscreenMap === 'function') buildOffscreenMap();
                requestRender();
            }
        });

        canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;

            hideCustomPopup();
            isMouseDown = true;
            hasDragged = false;
            startX = e.clientX;
            startY = e.clientY;

            mapState.dragStartX = e.clientX - mapState.offsetX;
            mapState.dragStartY = e.clientY - mapState.offsetY;

            container.style.cursor = 'grab';
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!mapState.isDataLoaded || !isMouseDown) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (!hasDragged && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
                hasDragged = true;
                mapState.isDragging = true;
                container.style.cursor = 'grabbing';
            }

            if (hasDragged) {
                mapState.offsetX = e.clientX - mapState.dragStartX;
                mapState.offsetY = e.clientY - mapState.dragStartY;
                clampOffset();
                requestRender();
            }
        });

        const handleMouseUp = () => {
            if (isMouseDown) {
                isMouseDown = false;
                mapState.isDragging = false;
                container.style.cursor = 'crosshair';
            }
        };

        window.addEventListener('mouseup', handleMouseUp);

        /**
         * [마우스 이벤트] 캔버스 클릭 시 선택 영역 정보 출력
         */
        canvas.addEventListener('click', (e) => {
            if (!mapState.isDataLoaded || e.button !== 0 || hasDragged) return;

            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const mapX = (mouseX - mapState.offsetX) / mapState.scale;
            const mapY = (mouseY - mapState.offsetY) / mapState.scale;

            const gridY = Math.floor(mapY / CELL_SIZE);
            if (gridY < 0 || gridY >= GRID_ROWS) return;

            let gridX = Math.floor(mapX / CELL_SIZE);
            gridX = ((gridX % GRID_COLS) + GRID_COLS) % GRID_COLS;

            const cell = mapState.gridMap?.[gridY]?.[gridX];
            if (!cell) return;

            let calcLat, calcLon;
            if (cell.POSITION && Array.isArray(cell.POSITION)) {
                calcLat = cell.POSITION[0];
                calcLon = cell.POSITION[1];
            } else {
                calcLat = 90 - (gridY / GRID_ROWS) * 180;
                calcLon = (gridX / GRID_COLS) * 360 - 180;
            }

            const formattedLatLon = `${calcLat.toFixed(2)}, ${calcLon.toFixed(2)}`;
            const formattedMapPos = `${gridX}, ${gridY}`;

            const landName = cell.NAME || '알 수 없음';

            // '⭐' 도시 존재 여부 검사
            let clickedCapital = null;
            if (Array.isArray(mapState.capitals)) {
                for (let i = 0; i < mapState.capitals.length; i++) {
                    const cap = mapState.capitals[i];
                    if (cap.x === gridX && cap.y === gridY) {
                        clickedCapital = cap;
                        break;
                    }
                }
            }

            // A. '⭐' 도시를 클릭한 경우
            if (clickedCapital) {
                const cData = clickedCapital.cityData || {};
                const cityName = cData.CITY_NAME || cData.name || '알 수 없음';
                const fullCityName = `${cityName}, 🌏${landName}`;
                const cityPop = cData.CITY_POPULATION ? `${Number(cData.CITY_POPULATION).toLocaleString()}명` : '-';
                
                let capLatLon = formattedLatLon;
                if (cData.POSITION && Array.isArray(cData.POSITION)) {
                    capLatLon = `${cData.POSITION[0].toFixed(2)}, ${cData.POSITION[1].toFixed(2)}`;
                }
                const capPos = `${clickedCapital.x}, ${clickedCapital.y}`;

                updateBottomPanel(`⭐${fullCityName}`, capLatLon, capPos);

                setText(elProvName, `⭐${fullCityName}`);
                setText(elProvMapPos, capPos);
                setText(elProvLatLon, capLatLon);
                setText(elProvPopulation, cityPop);
                setText(elProvResource, '-');
                setText(elProvBuildings, formatKeyValueList(cData.BUILDINGS || cData.BUILDING_LIST));

                setText(elName, `⭐${fullCityName}`);
                setText(elMapPos, '🌐'+capPos);
                setText(elLatLon, '📌'+capLatLon);
                if (cell.DEPTH !== undefined) {
                    setText(elElevation, `수심 ${Number(cell.DEPTH).toLocaleString()}m (인구: ${cityPop})`);
                } else {
                    setText(elElevation, `${Number(cell.ELEVATION || 0).toLocaleString()}m (인구: ${cityPop})`);
                }
                setText(elClimate, cell.CLIMATE || '-');
                setText(elRiver, cell.RIVER ? '있음 (True)' : '없음 (False)');

            // B. PROVINCE 모드 ('w')에서 셀 클릭 시
            } else if (mapState.renderMode === 'PROVINCE') {
                const regionId = safeGetRegionId(cell);
                const pData = cell.provinceData || (regionId ? mapState.provinceData?.[regionId] : null);
                const spec = cell.PROVINCE_SPEC;

                // province.json / spec 대신 land.json 데이터의 NAME(landName)을 직접 사용
                const provName = landName;

                if (pData || spec) {
                    const rawPop = pData?.REGION_POPULATION ?? pData?.PROV_POPULATION ?? spec?.POPULATION ?? spec?.REGION_POPULATION;
                    const provPop = rawPop !== undefined ? `${Number(rawPop).toLocaleString()}명` : '-';

                    const extraStats = [];
                    if (pData?.DEVELOPMENT_LEVEL !== undefined) extraStats.push(`발전도 Lv.${pData.DEVELOPMENT_LEVEL}`);
                    if (pData?.DOMINION_DEGREE !== undefined) extraStats.push(`지배력 ${pData.DOMINION_DEGREE}%`);
                    const popWithStats = extraStats.length > 0 ? `${provPop} (${extraStats.join(', ')})` : provPop;

                    let capInfoStr = '';
                    const capId = pData?.CAPITAL_CITY_ID ?? pData?.CAPITAL_CITY;
                    /**
                    if (capId !== undefined && capId !== null) {
                        const cityObj = mapState.cityData?.[capId] || mapState.cityData?.[String(capId)];
                        if (cityObj) {
                            capInfoStr = ` (수도: ${cityObj.CITY_NAME || cityObj.name || capId})`;
                        } else {
                            capInfoStr = ` (수도 ID: ${capId})`;
                        }
                    }
                    **/

                    const resStr = formatKeyValueList(pData?.RESOURCES || pData?.RESOURCE);
                    const buildStr = formatKeyValueList(pData?.REGIONAL_BUILDINGS || pData?.BUILDINGS);

                    const countryStr = spec?.COUNTRY_NAME ? ` (${spec.COUNTRY_NAME})` : '';
                    const fullProvDisplay = `${provName}${countryStr}${capInfoStr}`;

                    updateBottomPanel(`🌏${fullProvDisplay}`, formattedLatLon, formattedMapPos);

                    setText(elProvName, `🌏${provName}`);
                    setText(elProvMapPos, formattedMapPos);
                    setText(elProvLatLon, formattedLatLon);
                    setText(elProvPopulation, popWithStats);
                    setText(elProvResource, resStr);
                    setText(elProvBuildings, buildStr);
                } else {
                    updateBottomPanel(`❎(${landName})`, formattedLatLon, formattedMapPos);

                    setText(elProvName, `등록된 도시/프로빈스가 없습니다 (${landName})`);
                    setText(elProvMapPos, formattedMapPos);
                    setText(elProvLatLon, formattedLatLon);
                    setText(elProvPopulation, '-');
                    setText(elProvResource, '-');
                    setText(elProvBuildings, '-');
                }

            // C. LEVEL ('q') / CLIMATE ('e') 모드 클릭 시
            } else {
                if (cell.PROVINCE_SPEC) {
                    const spec = cell.PROVINCE_SPEC;
                    const pName = spec.PROVINCE_NAME || spec.REGION_NAME || '🤷‍♂️알 수 없음';
                    const fullName = `🤷${pName} (${spec.COUNTRY_NAME || '국가 미상'}) - ${landName}`;
                    const specLatLon = (spec.POSITION && Array.isArray(spec.POSITION))
                        ? `🌐${spec.POSITION[0].toFixed(2)}, ${spec.POSITION[1].toFixed(2)}`
                        : formattedLatLon;

                    updateBottomPanel(fullName, specLatLon, formattedMapPos);

                    setText(elName, '🌏'+fullName);
                    setText(elMapPos, '📌'+formattedMapPos);
                    setText(elLatLon, '🌐'+specLatLon);
                    setText(elElevation, `⛰️${Number(cell.ELEVATION || 0).toLocaleString()}m (인구: ${Number(spec.POPULATION || spec.REGION_POPULATION || 0).toLocaleString()}명)`);
                    setText(elClimate, '🌦️'+cell.CLIMATE || '-');
                    setText(elRiver, '🛶'+cell.RIVER ? '있음 (True)' : '없음 (False)');
                } else {
                    updateBottomPanel(landName, formattedLatLon, formattedMapPos);

                    setText(elName, landName);
                    setText(elMapPos, formattedMapPos);
                    setText(elLatLon, formattedLatLon);

                    if (cell.DEPTH !== undefined) {
                        setText(elElevation, `🪼수심 ${Number(cell.DEPTH).toLocaleString()}m (Level ${cell.LEVEL})`);
                        setText(elClimate, '🌊바다');
                        setText(elRiver, '해당 없음 (False)');
                    } else {
                        setText(elElevation, `🪼${Number(cell.ELEVATION || 0).toLocaleString()}m (Level ${cell.LEVEL || 0})`);
                        setText(elClimate, '🌦️'+cell.CLIMATE || '-');
                        setText(elRiver, '🛶'+cell.RIVER ? '있음 (True)' : '없음 (False)');
                    }
                }
            }
        });

        canvas.addEventListener('wheel', (e) => {
            if (!mapState.isDataLoaded) return;
            e.preventDefault();
            hideCustomPopup();

            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const zoomIntensity = 0.15;
            const delta = e.deltaY < 0 ? (1 + zoomIntensity) : (1 - zoomIntensity);

            const minScale = typeof getMinScale === 'function' ? getMinScale() : 1;
            const newScale = Math.min(Math.max(minScale, mapState.scale * delta), 15);

            mapState.offsetX = mouseX - (mouseX - mapState.offsetX) * (newScale / mapState.scale);
            mapState.offsetY = mouseY - (mouseY - mapState.offsetY) * (newScale / mapState.scale);

            mapState.scale = newScale;
            clampOffset();
            requestRender();
        }, { passive: false });
    }

    Object.defineProperty(window, 'initMapEvents', {
        value: initMapEvents,
        writable: false,
        configurable: false
    });
})();