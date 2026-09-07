(function() {
    'use strict';

    function initMapEvents() {
        const {
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
        } = window.MapApp;

        const {
            elName, elMapPos, elLatLon, elElevation, elClimate, elRiver,
            elProvName, elProvMapPos, elProvLatLon, elProvPopulation, elProvResource, elProvBuildings
        } = domElements;

        // 우클릭 컨텍스트 메뉴 초기화 함수 호출 (command_action.js 연동)
        if (typeof window.initContextMenu === 'function') {
            window.initContextMenu();
        }

        // 팝업 숨기기 안전 호출 헬퍼
        function hideCustomPopup() {
            if (window.MapApp && typeof window.MapApp.hideCustomPopup === 'function') {
                window.MapApp.hideCustomPopup();
            }
        }

        // 화면 다른 곳을 누를 때 팝업 닫기
        window.addEventListener('click', (e) => {
            const popup = window.MapApp ? window.MapApp.customPopup : null;
            if (popup && !popup.contains(e.target)) {
                hideCustomPopup();
            }
        });

        // 단축키 매니저 (Q, W, E, Spacebar 핸들링)
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

        // 마우스 드래그 & 팬 이벤트
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

        // 클릭 이벤트 (셀 선택 및 패널 데이터 갱신)
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
            if (cell) {
                const calcLat = 90 - (cell.MAP_POSITION[1] / GRID_ROWS) * 180;
                const calcLon = (cell.MAP_POSITION[0] / GRID_COLS) * 360 - 180;

                if (mapState.renderMode === 'PROVINCE') {
                    if (cell.PROVINCE_SPEC) {
                        const spec = cell.PROVINCE_SPEC;
                        
                        let resourceStr = '-';
                        if (spec.RESOURCE && spec.RESOURCE.RESOURCE_NAME && spec.RESOURCE.RESOURCE_NAME.trim() !== "") {
                            const resName = spec.RESOURCE.RESOURCE_NAME;
                            const resLevel = spec.RESOURCE.RESOURCE_LEVEL !== undefined ? spec.RESOURCE.RESOURCE_LEVEL : '';
                            resourceStr = `${resName}${resLevel}`;
                        }

                        let buildingsStr = '없음';
                        const buildingList = spec.BUILDING_LIST || spec.BUILDINGS;
                        if (Array.isArray(buildingList) && buildingList.length > 0) {
                            buildingsStr = buildingList.join(', ');
                        } else if (typeof buildingList === 'string' && buildingList.trim() !== '') {
                            buildingsStr = buildingList;
                        }

                        elProvName.innerText = `${spec.PROVINCE_NAME} (${spec.COUNTRY_NAME})`;
                        elProvMapPos.innerText = `[${cell.MAP_POSITION[0]}, ${cell.MAP_POSITION[1]}]`;
                        elProvLatLon.innerText = `[${spec.POSITION[0].toFixed(2)}, ${spec.POSITION[1].toFixed(2)}]`;
                        elProvPopulation.innerText = `${spec.POPULATION.toLocaleString()}명`;
                        elProvResource.innerText = resourceStr;
                        elProvBuildings.innerText = buildingsStr;
                    } else {
                        elProvName.innerText = '등록된 도시/프로빈스가 없습니다';
                        elProvMapPos.innerText = `[${cell.MAP_POSITION[0]}, ${cell.MAP_POSITION[1]}]`;
                        elProvLatLon.innerText = `[${calcLat.toFixed(2)}, ${calcLon.toFixed(2)}]`;
                        elProvPopulation.innerText = '-';
                        elProvResource.innerText = '-';
                        elProvBuildings.innerText = '-';
                    }
                } else {
                    if (cell.PROVINCE_SPEC) {
                        const spec = cell.PROVINCE_SPEC;
                        elName.innerText = `${spec.PROVINCE_NAME} (${spec.COUNTRY_NAME})`;
                        elMapPos.innerText = `[${cell.MAP_POSITION[0]}, ${cell.MAP_POSITION[1]}]`;
                        elLatLon.innerText = `[${spec.POSITION[0].toFixed(2)}, ${spec.POSITION[1].toFixed(2)}]`;
                        elElevation.innerText = `${cell.ELEVATION}m (인구: ${spec.POPULATION.toLocaleString()}명)`;
                        elClimate.innerText = cell.CLIMATE;
                        elRiver.innerText = cell.RIVER ? '있음 (True)' : '없음 (False)';
                    } else {
                        elName.innerText = cell.NAME || '알 수 없음';
                        elMapPos.innerText = `[${cell.MAP_POSITION[0]}, ${cell.MAP_POSITION[1]}]`;        
                        elLatLon.innerText = `[${calcLat.toFixed(2)}, ${calcLon.toFixed(2)}]`;
                        
                        // 💡 바다 셀(DEPTH 존재)과 육지 셀(ELEVATION 존재) 분기 처리
                        if (cell.DEPTH !== undefined) {
                            elElevation.innerText = `수심 ${cell.DEPTH}m (Level ${cell.LEVEL})`;
                            elClimate.innerText = '바다';
                            elRiver.innerText = '해당 없음 (False)';
                        } else {
                            elElevation.innerText = `${cell.ELEVATION}m (Level ${cell.LEVEL})`;
                            elClimate.innerText = cell.CLIMATE || '-';
                            elRiver.innerText = cell.RIVER ? '있음 (True)' : '없음 (False)';
                        }
                    }
                }
            }
        });

        // 휠 줌 이벤트
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