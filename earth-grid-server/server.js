const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 데이터 파일 경로 정의
const LAND_DATA_PATH = path.join(__dirname, '..', 'map', 'land.json');
const SEA_DATA_PATH = path.join(__dirname, '..', 'map', 'sea.json');
const PROVINCE_DATA_PATH = path.join(__dirname, '..', 'map', 'province.json');
const CITY_DATA_PATH = path.join(__dirname, '..', 'map', 'city.json');
// 🏛️ 건물 데이터 경로 추가 (Code/common/building/building.json)
const BUILDING_DATA_PATH = path.join(__dirname, '..', 'common', 'building', 'building.json');

// 서버 메모리 내 턴 세션 관리 상태 (건설 대기열 등)
let serverGameState = {
    turnCount: 1,
    constructionQueue: []
};

// 1. 미들웨어 설정
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/gfx', express.static(path.join(__dirname, '..', 'gfx'))); // 폰트 및 이미지 등 상위 gfx 디렉터리 정적 제공 라우트 추가

app.use((req, res, next) => {
    const now = new Date().toISOString();
    console.log(`[${now}] ${req.method} ${req.url}`);
    next();
});

const checkFileExists = (filePath) => {
    return fs.existsSync(filePath);
};

// 2. API 라우트
// ⛰️ 육지 데이터
app.get('/api/land-data', (req, res) => {
    if (!checkFileExists(LAND_DATA_PATH)) {
        return res.status(404).json({ error: 'Land data not found', message: 'land.json 파일이 없습니다.' });
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(LAND_DATA_PATH);
});

// 🌊 바다 데이터
app.get('/api/sea-data', (req, res) => {
    if (!checkFileExists(SEA_DATA_PATH)) {
        return res.status(404).json({ error: 'Sea data not found', message: 'sea.json 파일이 없습니다.' });
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(SEA_DATA_PATH);
});

// 🏰 지역 데이터
app.get('/province.json', (req, res) => {
    if (!checkFileExists(PROVINCE_DATA_PATH)) {
        return res.status(404).json({ error: 'Province data not found', message: 'province.json 파일이 없습니다.' });
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(PROVINCE_DATA_PATH);
});

// 🏙️ 도시 데이터
app.get('/city.json', (req, res) => {
    if (!checkFileExists(CITY_DATA_PATH)) {
        return res.status(404).json({ error: 'City data not found', message: 'city.json 파일이 없습니다.' });
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(CITY_DATA_PATH);
});

// 🛠️ 건물 데이터 제공 라우트 추가
app.get('/building.json', (req, res) => {
    if (!checkFileExists(BUILDING_DATA_PATH)) {
        console.error(`[ERROR] 파일 없음: ${BUILDING_DATA_PATH}`);
        return res.status(404).json({
            error: 'Building data not found',
            message: 'building.json 파일이 없습니다.'
        });
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(BUILDING_DATA_PATH);
});

// ⏳ 턴 정산 API
app.post('/api/turn', (req, res) => {
    try {
        const { commands } = req.body;
        const logs = [];
        
        serverGameState.turnCount += 1;
        logs.push(`${serverGameState.turnCount}번째 턴이 시작되었습니다.`);

        // 전달받은 커맨드 처리
        if (Array.isArray(commands) && commands.length > 0) {
            commands.forEach(cmd => {
                if (cmd.type === 'CONSTRUCT_BUILDING') {
                    const item = {
                        buildingKey: cmd.payload.buildingKey,
                        buildingName: cmd.payload.buildingName,
                        x: cmd.payload.x,
                        y: cmd.payload.y,
                        turnsRemaining: 1 // 필요 시 건물별 필요 턴 수 적용 가능
                    };
                    serverGameState.constructionQueue.push(item);
                    logs.push(`[서버 정산] 좌표 [${cmd.payload.x}, ${cmd.payload.y}]에 '${cmd.payload.buildingName}' 건설 시작`);
                }
            });
        } else {
            logs.push(`[서버 정산] 이번 턴에 등록된 명령이 없습니다.`);
        }

        // 건설 대기열 턴 진행 처리
        serverGameState.constructionQueue = serverGameState.constructionQueue.map(item => {
            item.turnsRemaining -= 1;
            return item;
        });

        // 완료된 건설 항목 로그 처리
        const completed = serverGameState.constructionQueue.filter(item => item.turnsRemaining <= 0);
        completed.forEach(item => {
            logs.push(`[건설 완료] 좌표 [${item.x}, ${item.y}]에 '${item.buildingName}' 건설이 완공되었습니다.`);
        });

        // 남은 건설 대기열만 유지
        serverGameState.constructionQueue = serverGameState.constructionQueue.filter(item => item.turnsRemaining > 0);

        res.json({
            success: true,
            turn: serverGameState.turnCount,
            constructionQueue: serverGameState.constructionQueue,
            logs
        });
    } catch (err) {
        console.error('[TURN ERROR]', err);
        res.status(500).json({ error: 'Turn processing failed', message: err.message });
    }
});

// 📊 서버 상태 체크 API
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        uptime: process.uptime(),
        currentTurn: serverGameState.turnCount,
        files: {
            'land.json': checkFileExists(LAND_DATA_PATH) ? 'OK' : 'Missing',
            'sea.json': checkFileExists(SEA_DATA_PATH) ? 'OK' : 'Missing',
            'province.json': checkFileExists(PROVINCE_DATA_PATH) ? 'OK' : 'Missing',
            'city.json': checkFileExists(CITY_DATA_PATH) ? 'OK' : 'Missing',
            'building.json': checkFileExists(BUILDING_DATA_PATH) ? 'OK' : 'Missing'
        }
    });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

app.use((err, req, res, next) => {
    console.error('[SERVER ERROR]', err.stack);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

app.listen(PORT, () => {
    console.log(`=================================`);
    console.log(` Earth Land, Sea & Province Server Started`);
    console.log(` URL: http://localhost:${PORT}`);
    console.log(` Land Data Status:     ${checkFileExists(LAND_DATA_PATH) ? 'Ready' : 'NOT FOUND'}`);
    console.log(` Sea Data Status:      ${checkFileExists(SEA_DATA_PATH) ? 'Ready' : 'NOT FOUND'}`);
    console.log(` Province Status:      ${checkFileExists(PROVINCE_DATA_PATH) ? 'Ready' : 'NOT FOUND'}`);
    console.log(` City Status:          ${checkFileExists(CITY_DATA_PATH) ? 'Ready' : 'NOT FOUND'}`);
    console.log(` Building Status:      ${checkFileExists(BUILDING_DATA_PATH) ? 'Ready' : 'NOT FOUND'}`);
    console.log(`=================================`);
});