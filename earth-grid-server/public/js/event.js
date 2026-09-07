(function() {
    'use strict';

    function initMapEvents() {
        const {
            canvas, container, mapState, GRID_COLS, GRID_ROWS, CELL_SIZE,
            domElements, updateInfoPanelVisibility, buildOffscreenMap, render, clampOffset, getMinScale
        } = window.MapApp;

        const {
            elName, elMapPos, elLatLon, elElevation, elClimate, elRiver,
            elProvName, elProvMapPos, elProvLatLon, elProvPopulation, elProvResource, elProvBuildings
        } = domElements;

        if (typeof window.initContextMenu === 'function') {
            window.initContextMenu();
        }

        function hideCustomPopup() {
            if (window.MapApp && typeof window.MapApp.hideCustomPopup === 'function') {
                window.MapApp.hideCustomPopup();
            }
        }

        window.addEventListener('click', (e) => {
            const popup = window.MapApp ? window.MapApp.customPopup : null;
            if (popup && !popup.contains(e.target)) {
                hideCustomPopup();
            }
        });

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                mapState.isSpacePressed = true;
                container.style.cursor = mapState.isDragging ? 'grabbing' : 'grab';
                e.preventDefault();
                return;
            }

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
                updateInfoPanelVisibility();
                buildOffscreenMap();
                render();
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                mapState.isSpacePressed = false;
                mapState.isDragging = false;
                container.style.cursor = 'crosshair';
            }
        });

        canvas.addEventListener('mousedown', (e) => {
            hideCustomPopup();
            if ((mapState.isSpacePressed && e.button === 0) || e.button === 1) {
                mapState.isDragging = true;
                container.style.cursor = 'grabbing';
                mapState.dragStartX = e.clientX - mapState.offsetX;
                mapState.dragStartY = e.clientY - mapState.offsetY;
                e.preventDefault();
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!mapState.isDataLoaded) return;
            if (mapState.isDragging) {
                mapState.offsetX = e.clientX - mapState.dragStartX;
                mapState.offsetY = e.clientY - mapState.dragStartY;
                clampOffset();
                render();
            }
        });

        window.addEventListener('mouseup', () => {
            if (mapState.isDragging) {
                mapState.isDragging = false;
                container.style.cursor = mapState.isSpacePressed ? 'grab' : 'crosshair';
            }
        });

        // 💡 요소 선택 통합 클릭 핸들러 (수도 아이콘 / 프로빈스 클릭 판정)
        canvas.addEventListener('click', (e) => {
            if (!mapState.isDataLoaded || mapState.isSpacePressed || e.button !== 0) return;

            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const mapX = (mouseX - mapState.offsetX) / mapState.scale;
            const mapY = (mouseY - mapState.offsetY) / mapState.scale;

            const gridY = Math.floor(mapY / CELL_SIZE);
            if (gridY < 0 || gridY >= GRID_ROWS) return;

            let gridX = Math.floor(mapX / CELL_SIZE);
            gridX = ((gridX % GRID_COLS) + GRID_COLS) % GRID_COLS;

            const cell = mapState.gridMap[gridY][gridX];
            const calcLat = 90 - (cell?.MAP_POSITION?.[1] / GRID_ROWS) * 180;
            const calcLon = (cell?.MAP_POSITION?.[0] / GRID_COLS) * 360 - 180;

            if (mapState.renderMode === 'PROVINCE') {
                let clickedCapital = null;
                
                // 지도 반복(tiling)을 고려한 정규화된 mapX 계산
                const mapWidth = GRID_COLS * CELL_SIZE;
                const normalizedMapX = ((mapX % mapWidth) + mapWidth) % mapWidth;
                
                // 1. 클릭 위치 반경 내에 위치한 '수도(Capital)'가 있는지 우선 검사 (반경 약 1.5셀 기준)
                for (let cap of mapState.capitals) {
                    const cx = cap.x * CELL_SIZE + CELL_SIZE / 2;
                    const cy = cap.y * CELL_SIZE + CELL_SIZE / 2;
                    const dx = normalizedMapX - cx;
                    const dy = mapY - cy;
                    
                    if (Math.sqrt(dx * dx + dy * dy) < CELL_SIZE * 1.5) {
                        clickedCapital = cap;
                        break;
                    }
                }

                if (clickedCapital) {
                    // [도시 정보 출력] (인구수 천 단위 쉼표 적용)
                    const cData = clickedCapital.cityData;
                    elProvName.innerText = `[도시] ${cData.CITY_NAME || cData.name || '알 수 없음'}`;
                    elProvMapPos.innerText = `[${clickedCapital.x}, ${clickedCapital.y}]`;
                    elProvLatLon.innerText = cData.POSITION ? `[${cData.POSITION[0]}, ${cData.POSITION[1]}]` : '-';
                    elProvPopulation.innerText = cData.CITY_POPULATION ? `${Number(cData.CITY_POPULATION).toLocaleString()}명` : '-';
                    elProvResource.innerText = '-'; 
                    elProvBuildings.innerText = cData.BUILDINGS ? cData.BUILDINGS.join(', ') : '-';
                } else if (cell && cell.provinceData) {
                    // [프로빈스 육지 정보 출력] (인구수 천 단위 쉼표 적용)
                    const pData = cell.provinceData;
                    elProvName.innerText = `[프로빈스] ${pData.PROVINCE_NAME || pData.ID || '알 수 없음'}`;
                    elProvMapPos.innerText = `[${cell.MAP_POSITION[0]}, ${cell.MAP_POSITION[1]}]`;
                    elProvLatLon.innerText = `[${calcLat.toFixed(2)}, ${calcLon.toFixed(2)}]`;
                    elProvPopulation.innerText = pData.PROV_POPULATION ? `${Number(pData.PROV_POPULATION).toLocaleString()}명` : '-';
                    elProvResource.innerText = pData.RESOURCE ? JSON.stringify(pData.RESOURCE) : '-';
                    elProvBuildings.innerText = '-';
                } else if (cell) {
                    // [비어있는 땅 / 바다]
                    elProvName.innerText = '등록된 도시/프로빈스가 없습니다';
                    elProvMapPos.innerText = `[${cell.MAP_POSITION[0]}, ${cell.MAP_POSITION[1]}]`;
                    elProvLatLon.innerText = `[${calcLat.toFixed(2)}, ${calcLon.toFixed(2)}]`;
                    elProvPopulation.innerText = '-';
                    elProvResource.innerText = '-';
                    elProvBuildings.innerText = '-';
                }
            } else {
                // 기본 LEVEL, CLIMATE 모드 로직 유지
                if (cell) {
                    if (cell.PROVINCE_SPEC) {
                        const spec = cell.PROVINCE_SPEC;
                        elName.innerText = `${spec.PROVINCE_NAME} (${spec.COUNTRY_NAME})`;
                        elMapPos.innerText = `[${cell.MAP_POSITION[0]}, ${cell.MAP_POSITION[1]}]`;
                        elLatLon.innerText = `[${spec.POSITION[0].toFixed(2)}, ${spec.POSITION[1].toFixed(2)}]`;
                        // 고도 및 인구수 천 단위 쉼표 적용
                        elElevation.innerText = `${Number(cell.ELEVATION).toLocaleString()}m (인구: ${Number(spec.POPULATION).toLocaleString()}명)`;
                        elClimate.innerText = cell.CLIMATE;
                        elRiver.innerText = cell.RIVER ? '있음 (True)' : '없음 (False)';
                    } else {
                        elName.innerText = cell.NAME || '알 수 없음';
                        elMapPos.innerText = `[${cell.MAP_POSITION[0]}, ${cell.MAP_POSITION[1]}]`;
                        elLatLon.innerText = `[${calcLat.toFixed(2)}, ${calcLon.toFixed(2)}]`;
                        
                        if (cell.DEPTH !== undefined) {
                            // 수심 천 단위 쉼표 적용
                            elElevation.innerText = `수심 ${Number(cell.DEPTH).toLocaleString()}m (Level ${cell.LEVEL})`;
                            elClimate.innerText = '바다';
                            elRiver.innerText = '해당 없음 (False)';
                        } else {
                            // 고도 천 단위 쉼표 적용
                            elElevation.innerText = `${Number(cell.ELEVATION).toLocaleString()}m (Level ${cell.LEVEL})`;
                            elClimate.innerText = cell.CLIMATE || '-';
                            elRiver.innerText = cell.RIVER ? '있음 (True)' : '없음 (False)';
                        }
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
            
            const minScale = getMinScale();  
            const newScale = Math.min(Math.max(minScale, mapState.scale * delta), 15);

            mapState.offsetX = mouseX - (mouseX - mapState.offsetX) * (newScale / mapState.scale);
            mapState.offsetY = mouseY - (mouseY - mapState.offsetY) * (newScale / mapState.scale);
            
            mapState.scale = newScale;
            clampOffset();
            render();
        }, { passive: false });
    }

    window.initMapEvents = initMapEvents;
})();