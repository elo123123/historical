(function() {
    'use strict';

    function initContextMenu() {
        const {
            canvas,
            mapState,
            GRID_COLS,
            GRID_ROWS,
            CELL_SIZE
        } = window.MapApp;

        // ----------------------------------------------------
        // 우클릭 팝업 엘리먼트 동적 생성 및 스타일 주입
        // ----------------------------------------------------
        let customPopup = document.getElementById('map-context-popup');
        if (!customPopup) {
            customPopup = document.createElement('div');
            customPopup.id = 'map-context-popup';
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

        // 팝업 숨기기 공통 함수
        function hideCustomPopup() {
            if (customPopup) {
                customPopup.style.display = 'none';
            }
        }

        // 다른 파일(event.js 등)에서도 호출할 수 있도록 MapApp에 등록
        window.MapApp.hideCustomPopup = hideCustomPopup;
        window.MapApp.customPopup = customPopup;

        // ----------------------------------------------------
        // 우클릭 이벤트 리스너
        // ----------------------------------------------------
        canvas.addEventListener('contextmenu', (e) => {
            // 데이터가 없거나 스페이스바 누른 상태면 무시
            if (!mapState.isDataLoaded || mapState.isSpacePressed) return;
            
            // 브라우저 기본 우클릭 컨텍스트 메뉴 방지
            e.preventDefault();

            // 정보 패널 내부에서 발생한 이벤트인지 체크
            const infoPanel = document.getElementById('info-panel');
            if (infoPanel && infoPanel.contains(e.target)) {
                return;
            }

            // 클릭한 셀의 좌표 계산
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

            // 팝업 메뉴 구성 (추후 다양한 액션을 이 배열에 쉽게 추가/확장 가능)
            customPopup.innerHTML = '';
            
            const actions = [
                {
                    label: '🔍 상세 정보 보기',
                    callback: () => {
                        console.log('상세 정보 클릭됨:', targetCell);
                        // TODO: 상세 정보 모달 오픈 등 로직 구현
                    }
                },
                {
                    label: '📍 이 위치로 이동 (포커스)',
                    callback: () => {
                        console.log('위치 포커스:', gridX, gridY);
                        // TODO: 특정 좌표로 카메라 이동 로직 구현
                    }
                },
                {
                    label: '⚙️ 커스텀 액션 추가',
                    callback: () => {
                        alert(`선택한 좌표: [${gridX}, ${gridY}]`);
                    }
                }
            ];

            actions.forEach(action => {
                const item = document.createElement('div');
                item.innerText = action.label;
                item.style.cssText = `
                    padding: 8px 16px;
                    cursor: pointer;
                    white-space: nowrap;
                `;
                item.addEventListener('mouseenter', () => item.style.backgroundColor = '#2a2d2e');
                item.addEventListener('mouseleave', () => item.style.backgroundColor = 'transparent');
                item.addEventListener('click', () => {
                    action.callback();
                    hideCustomPopup();
                });
                customPopup.appendChild(item);
            });

            // 팝업 위치 지정 및 노출
            customPopup.style.left = `${e.pageX}px`;
            customPopup.style.top = `${e.pageY}px`;
            customPopup.style.display = 'block';
        });
    }

    window.initContextMenu = initContextMenu;
})();