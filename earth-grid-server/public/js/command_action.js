(function() {
    'use strict';   

    // ==========================================
    // 0. 클라이언트 휘발성 관리 상태 및 턴 시스템
    // ==========================================
    const ClientRuntime = {
        commandQueue: [],      // 턴 동안 플레이어가 누른 명령 스택
        constructionQueue: [], // 서버에서 동기화받은 건설 대기열
        logs: []               // 메시지 패널 출력 로그
    };

    // 1. 커맨드 큐 수집 (클라이언트 임시 보관)
    function pushCommand(type, payload) {
        ClientRuntime.commandQueue.push({ type, payload });
        logMessage(`[명령 등록] ${type} - ${payload.buildingName || ''} (${payload.x}, ${payload.y}) 대기 중`);
    }

    // 2. 백엔드로 턴 진행 요청 (API 통신)
    async function sendTurnToServer() {
        try {
            logMessage(`🕛턴 정산 요청 중`);

            const response = await fetch('/api/turn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    commands: ClientRuntime.commandQueue
                })
            });

            if (!response.ok) throw new Error('⚠️정산 실패⚠️ : 새로고침을 눌러 진행해주세요');

            const result = await response.json();

            // 서버 연산 결과로 클라이언트 상태 갱신
            ClientRuntime.commandQueue = []; // 큐 비우기
            ClientRuntime.constructionQueue = result.constructionQueue || [];

            // 서버 로그 패치 및 UI 갱신
            if (result.logs) result.logs.forEach(msg => logMessage(msg));
            if (window.MapApp && typeof window.MapApp.render === 'function') {
                window.MapApp.render();
            }

        } catch (error) {
            logMessage(`[오류] ${error.message}`);
        }
    }

    // 3. 로그 출력 헬퍼
    function logMessage(text) {
        ClientRuntime.logs.push(text);
        const msgPanel = document.getElementById('message-panel');
        if (msgPanel) {
            const line = document.createElement('div');
            line.style.cssText = 'font-size: 13px; line-height: 1.4; color: #e0e0e0;';
            line.innerText = text;
            msgPanel.appendChild(line);
            msgPanel.scrollTop = msgPanel.scrollHeight;
        }
    }

    // 외부 모듈에서 접근 가능하도록 전역 바인딩
    window.ClientRuntime = ClientRuntime;
    window.pushCommand = pushCommand;
    window.sendTurnToServer = sendTurnToServer;
    window.logMessage = logMessage;

    // 캐시된 건물 데이터 저장 변수
    let buildingDataCache = null;

    // building.json 로드 함수
    async function fetchBuildingData() {
        if (buildingDataCache) return buildingDataCache;
        try {
            const res = await fetch('building.json');
            if (!res.ok) throw new Error('Building fetch failed');
            buildingDataCache = await res.json();
            return buildingDataCache;
        } catch (err) {
            console.error('건물 데이터 로드 실패:', err);
            return {};
        }
    }

    function showToast(message, isSuccess = true) {
        const toast = document.createElement('div');
        toast.innerText = message;
        toast.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #000000;
            color: ${isSuccess ? '#ffffff' : '#ff4d4d'};
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: bold;
            z-index: 100000;
            opacity: 0;
            transition: opacity 0.3s ease-in-out;
            pointer-events: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            white-space: nowrap;
        `;
        document.body.appendChild(toast);

        void toast.offsetWidth;
        toast.style.opacity = '1';

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 1500);
    }

    function showInfoModal(lines) {
        const existingModal = document.getElementById('map-info-modal');
        if (existingModal) existingModal.remove();
        const existingOverlay = document.getElementById('map-info-overlay');
        if (existingOverlay) existingOverlay.remove();

        const overlay = document.createElement('div');
        overlay.id = 'map-info-overlay';
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 19999;
            background: transparent;
        `;

        const modal = document.createElement('div');
        modal.id = 'map-info-modal';
        modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #000000;
            color: #ffffff;
            border: 1px solid #444;
            border-radius: 8px;
            padding: 20px 24px;
            z-index: 20000;
            box-shadow: 0 8px 24px rgba(0,0,0,0.7);
            min-width: 260px;
            max-width: 90vw;
            font-size: 14px;
            line-height: 1.6;
        `;

        function closeModal() {
            modal.remove();
            overlay.remove();
        }

        overlay.addEventListener('click', closeModal);

        const title = document.createElement('div');
        title.innerText = 'ℹ️ 정보';
        title.style.cssText = `
            text-align: center;
            font-weight: bold;
            font-size: 16px;
            margin-bottom: 14px;
        `;
        modal.appendChild(title);

        const content = document.createElement('div');
        content.style.cssText = `
            margin-bottom: 18px;
            white-space: pre-line;
        `;
        content.innerText = lines.join('\n');
        modal.appendChild(content);

        const closeBtn = document.createElement('button');
        closeBtn.innerText = '닫기';
        closeBtn.style.cssText = `
            display: block;
            width: 100%;
            padding: 8px;
            background: #222;
            color: #fff;
            border: 1px solid #555;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: bold;
            text-align: center;
        `;
        closeBtn.addEventListener('mouseenter', () => closeBtn.style.backgroundColor = '#333');
        closeBtn.addEventListener('mouseleave', () => closeBtn.style.backgroundColor = '#222');
        closeBtn.addEventListener('click', closeModal);
        modal.appendChild(closeBtn);

        document.body.appendChild(overlay);
        document.body.appendChild(modal);
    }

    function initContextMenu() {
        const { canvas, mapState, GRID_COLS, GRID_ROWS, CELL_SIZE } = window.MapApp;

        // 메인 팝업 컨테이너 생성
        let customPopup = document.getElementById('map-context-popup');
        if (!customPopup) {
            customPopup = document.createElement('div');
            customPopup.id = 'map-context-popup';
            customPopup.className = 'context-menu-level';
            customPopup.style.cssText = `
                position: absolute;
                display: none;
                background: #1e1e1e;
                color: #ffffff;
                border: 1px solid #444;
                border-radius: 4px;
                padding: 6px 0;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                z-index: 1000;
                min-width: 140px;
                font-size: 13px;
            `;
            document.body.appendChild(customPopup);
        }

        // 전체 컨텍스트 메뉴 닫기
        function hideCustomPopup() {
            if (customPopup) {
                customPopup.style.display = 'none';
            }
            // 모든 하위 서브메뉴 제거
            document.querySelectorAll('.map-submenu').forEach(el => el.remove());
        }

        window.MapApp.hideCustomPopup = hideCustomPopup;
        window.MapApp.customPopup = customPopup;

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#map-context-popup') && !e.target.closest('.map-submenu')) {
                hideCustomPopup();
            }
        });

        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // 서브메뉴 생성 및 좌/우 화면 공간 자동 계산 함수
        function createSubmenu(items, parentItemEl, level = 1) {
            // 동일 레벨 이하의 이전 서브메뉴 제거
            document.querySelectorAll(`.map-submenu[data-level="${level}"]`).forEach(el => el.remove());

            const submenu = document.createElement('div');
            submenu.className = 'map-submenu';
            submenu.dataset.level = level;
            submenu.style.cssText = `
                position: fixed;
                background: #1e1e1e;
                color: #ffffff;
                border: 1px solid #444;
                border-radius: 4px;
                padding: 6px 0;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                z-index: ${1000 + level};
                min-width: 130px;
                font-size: 13px;
                display: block;
                visibility: hidden; /* 위치 계산 전 렌더링 숨김 */
            `;

            items.forEach(item => {
                const menuItem = document.createElement('div');
                menuItem.style.cssText = `
                    padding: 8px 16px;
                    cursor: pointer;
                    white-space: nowrap;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                `;

                const labelSpan = document.createElement('span');
                labelSpan.innerText = item.label;
                menuItem.appendChild(labelSpan);

                if (item.children) {
                    const arrowSpan = document.createElement('span');
                    arrowSpan.innerText = '▶';
                    arrowSpan.style.cssText = 'font-size: 10px; margin-left: 12px; color: #888;';
                    menuItem.appendChild(arrowSpan);
                }

                menuItem.addEventListener('mouseenter', () => menuItem.style.backgroundColor = '#2a2d2e');
                menuItem.addEventListener('mouseleave', () => menuItem.style.backgroundColor = 'transparent');

                menuItem.addEventListener('click', (e) => {
                    e.stopPropagation();

                    if (item.children) {
                        createSubmenu(item.children, menuItem, level + 1);
                    } else if (item.callback) {
                        item.callback();
                        hideCustomPopup();
                    }
                });

                submenu.appendChild(menuItem);
            });

            document.body.appendChild(submenu);

            // --- 스마트 위치 계산 (좌/우 및 상/하 바운더리) ---
            const parentRect = parentItemEl.getBoundingClientRect();
            const submenuWidth = submenu.offsetWidth;
            const submenuHeight = submenu.offsetHeight;
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;

            let left = parentRect.right;
            // 우측 공간이 부족할 경우 좌측으로 배치
            if (left + submenuWidth > screenWidth) {
                left = parentRect.left - submenuWidth;
            }

            let top = parentRect.top;
            // 하단 공간이 부족할 경우 위로 조정
            if (top + submenuHeight > screenHeight) {
                top = Math.max(10, screenHeight - submenuHeight - 10);
            }

            submenu.style.left = `${left}px`;
            submenu.style.top = `${top}px`;
            submenu.style.visibility = 'visible';
        }

        // ----------------------------------------------------
        // 우클릭 이벤트 리스너
        // ----------------------------------------------------
        canvas.addEventListener('contextmenu', async (e) => {
            if (!mapState.isDataLoaded || mapState.isSpacePressed) return;
            e.preventDefault();

            hideCustomPopup();

            const infoPanel = document.getElementById('info-panel');
            if (infoPanel && infoPanel.contains(e.target)) return;

            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const mapX = (mouseX - mapState.offsetX) / mapState.scale;
            const mapY = (mouseY - mapState.offsetY) / mapState.scale;

            const gridY = Math.floor(mapY / CELL_SIZE);
            if (gridY < 0 || gridY >= GRID_ROWS) return;

            let gridX = Math.floor(mapX / CELL_SIZE);
            gridX = ((gridX % GRID_COLS) + GRID_COLS) % GRID_COLS;

            const targetCell = mapState.gridMap[gridY] ? mapState.gridMap[gridY][gridX] : null;

            // 건물 데이터 미리 로드
            const buildingData = await fetchBuildingData();

            // 건물 건설 클릭 핸들러 (커맨드 큐 등록으로 연동)
            const handleConstructBuilding = (buildingKey, buildingName) => {
                pushCommand('CONSTRUCT_BUILDING', {
                    buildingKey,
                    buildingName,
                    x: gridX,
                    y: gridY
                });
                showToast(`🏗️ [${buildingName}] 건설 명령 등록`, true);
            };

            // 메뉴 구조 정의
            const menuStructure = [
                {
                    label: '🌏 위치정보 복사',
                    callback: () => {
                        if (!targetCell) {
                            showToast('⛔복사 실패', false);
                            return;
                        }

                        let posText = '';
                        const pos = targetCell.POSITION;

                        if (Array.isArray(pos) && pos.length >= 2) {
                            posText = `${pos[0]}, ${pos[1]}`;
                        } else if (typeof pos === 'string') {
                            posText = pos;
                        } else {
                            const lat = targetCell.LATITUDE !== undefined ? targetCell.LATITUDE : targetCell.lat;
                            const lon = targetCell.LONGITUDE !== undefined ? targetCell.LONGITUDE : targetCell.lon;
                            if (lat !== undefined && lon !== undefined) posText = `${lat}, ${lon}`;
                        }

                        if (!posText) {
                            showToast('⛔복사 실패', false);
                            return;
                        }

                        navigator.clipboard.writeText(posText).then(() => {
                            showToast('📄복사 성공!', true);
                        }).catch(() => {
                            showToast('⛔복사 실패', false);
                        });
                    }
                },
                {
                    label: '📰 위치정보 확인',
                    callback: () => {
                        if (!targetCell) {
                            showToast('⛔정보 없음', false);
                            return;
                        }

                        const levelMap = { 1: '평야', 2: '구릉', 3: '저산지', 4: '고산지', 5: '산악' };
                        const depthMap = { 1: '표해', 2: '중해', 3: '반심해', 4: '심해', 5: '초심해' };

                        const posArr = targetCell.MAP_POSITION;
                        const posStr = Array.isArray(posArr) && posArr.length >= 2 ? `[${posArr[0]}, ${posArr[1]}]` : `[${gridX}, ${gridY}]`;
                        const isSea = targetCell.DEPTH !== undefined || targetCell.CLIMATE === undefined;

                        if (isSea) {
                            const seaName = targetCell.NAME || '알 수 없음';
                            const rawDepth = targetCell.LEVEL !== undefined ? targetCell.LEVEL : targetCell.DEPTH;
                            const depthText = depthMap[rawDepth] || rawDepth || '알 수 없음';

                            showInfoModal([
                                `🌊해역 이름 : ${seaName}`,
                                `🌐위치 : ${posStr}`,
                                `🪸수심 : ${depthText}`
                            ]);
                        } else {
                            const landName = targetCell.NAME || '알 수 없음';
                            const rawLevel = targetCell.LEVEL;
                            const levelText = levelMap[rawLevel] || rawLevel || '알 수 없음';
                            const climate = targetCell.CLIMATE || '알 수 없음';

                            const foundCity = mapState.capitals ? mapState.capitals.find(c => c.x === gridX && c.y === gridY) : null;

                            if (foundCity && foundCity.cityData) {
                                const cityName = foundCity.cityData.CITY_NAME || '알 수 없음';
                                const cityPop = foundCity.cityData.CITY_POPULATION || 0;
                                const provPop = foundCity.provinceData && foundCity.provinceData.PROV_POPULATION !== undefined 
                                    ? Number(foundCity.provinceData.PROV_POPULATION).toLocaleString() 
                                    : '0';

                                const rawDev = foundCity.cityData.DEVELOPMENT_LEVEL;
                                const devLevel = (rawDev !== undefined && rawDev !== null && rawDev !== '') ? rawDev : 0;

                                let buildingList = '없음';
                                const bList = foundCity.cityData.BUILDING_LIST;
                                if (bList) {
                                    if (Array.isArray(bList) && bList.length > 0) buildingList = bList.join(', ');
                                    else if (typeof bList === 'string' && bList.trim() !== '') buildingList = bList;
                                }

                                showInfoModal([
                                    `🏙️도시 이름 : ${cityName}(${landName})`,                                    
                                    `🌐위치 : ${posStr}`,
                                    `⛰️고도 : ${levelText}`,
                                    `🌦️기후 : ${climate}`,                                    
                                    `👨‍👩‍👧‍👦인구 : ${cityPop}명`,
                                    `🏭발전도 : ${devLevel}`,
                                    `🏢건물 목록 : ${buildingList}`
                                ]);
                            } else {
                                const provName = targetCell.provinceData && targetCell.provinceData.PROVINCE_NAME 
                                    ? targetCell.provinceData.PROVINCE_NAME 
                                    : '알 수 없음';
                                const provPop = targetCell.provinceData && targetCell.provinceData.PROV_POPULATION !== undefined 
                                    ? Number(targetCell.provinceData.PROV_POPULATION).toLocaleString() 
                                    : '0';

                                showInfoModal([
                                    `🌳지역 이름 : ${landName}`,
                                    `🌐위치 : ${posStr}`,
                                    `⛰️고도 : ${levelText}`,
                                    `🌦️기후 : ${climate}`,
                                    `🗺️지역 이름 : ${provName}`,
                                    `👨‍👩‍👧‍👦인구 : ${provPop}명`
                                ]);
                            }
                        }
                    }
                },
                {
                    label: '🛠️ 건물 건설',
                    children: [
                        {
                            label: '🏗️ 기반',
                            children: [
                                { label: '🛣️ 도로', callback: () => handleConstructBuilding('ROAD', '도로') },
                                { label: '⚓ 항만', callback: () => handleConstructBuilding('PORT', '항만') },
                                { label: '🏯 성채', callback: () => handleConstructBuilding('CASTLE', '성채') },
                                { label: '🏇 역참', callback: () => handleConstructBuilding('STATION', '역참') }
                            ]
                        },
                        {
                            label: '🏛️ 행정',
                            children: [
                                { label: '👑 관청', callback: () => handleConstructBuilding('HALL', '관청') },
                                { label: '🕌 사원', callback: () => handleConstructBuilding('TEMPLE', '사원') },
                                { label: '📚 학교', callback: () => handleConstructBuilding('SCHOOL', '학교') }
                            ]
                        },
                        {
                            label: '🗡️ 군사',
                            children: [
                                { label: '🪖 육군영', callback: () => handleConstructBuilding('BARRACK', '육군영') },
                                { label: '🚢 해군영', callback: () => handleConstructBuilding('NAVAL', '해군영') },
                                { label: '🔨 대장간', callback: () => handleConstructBuilding('SMITHY', '대장간') },
                                { label: '🛳️ 조선소', callback: () => handleConstructBuilding('SHIPYARD', '조선소') }
                            ]
                        },
                        {
                            label: '🪙 경제',
                            children: [
                                { label: '💱 시장', callback: () => handleConstructBuilding('MARKET', '시장') },
                                { label: '🧵 공방', callback: () => handleConstructBuilding('WORKSHOP', '공방') },
                                { label: '🪵 제재소', callback: () => handleConstructBuilding('LUMBERMILL', '제재소') },
                                { label: '🌾 농장', callback: () => handleConstructBuilding('FARM', '농장') },
                                { label: '🐂 목장', callback: () => handleConstructBuilding('PASTURE', '목장') },
                                { label: '⛏️ 광산', callback: () => handleConstructBuilding('MINE', '광산') },
                                { label: '🐟 어장', callback: () => handleConstructBuilding('FISHING', '어장') },
                                { label: '🏹 사냥터', callback: () => handleConstructBuilding('HUNTING', '사냥터') }
                            ]
                        }
                    ]
                }
            ];

            // 메인 팝업 노드 그리기
            customPopup.innerHTML = '';
            menuStructure.forEach(action => {
                const item = document.createElement('div');
                item.style.cssText = `
                    padding: 8px 16px;
                    cursor: pointer;
                    white-space: nowrap;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                `;

                const labelSpan = document.createElement('span');
                labelSpan.innerText = action.label;
                item.appendChild(labelSpan);

                if (action.children) {
                    const arrowSpan = document.createElement('span');
                    arrowSpan.innerText = '▶';
                    arrowSpan.style.cssText = 'font-size: 10px; margin-left: 12px; color: #888;';
                    item.appendChild(arrowSpan);
                }

                item.addEventListener('mouseenter', () => item.style.backgroundColor = '#2a2d2e');
                item.addEventListener('mouseleave', () => item.style.backgroundColor = 'transparent');

                item.addEventListener('click', (evt) => {
                    evt.stopPropagation();
                    if (action.children) {
                        createSubmenu(action.children, item, 1);
                    } else if (action.callback) {
                        action.callback();
                        hideCustomPopup();
                    }
                });

                customPopup.appendChild(item);
            });

            customPopup.style.left = `${e.pageX}px`;
            customPopup.style.top = `${e.pageY}px`;
            customPopup.style.display = 'block';
        });
    }

    // 다음 턴 버튼 이벤트 연결
    document.addEventListener('DOMContentLoaded', () => {
        const actionBtn = document.getElementById('action-btn');
        if (actionBtn) {
            actionBtn.innerText = '다음 턴';
            actionBtn.addEventListener('click', sendTurnToServer);
        }
    });

    window.initContextMenu = initContextMenu;
})();