const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 데이터 파일 경로 정의 (프로젝트 구조에 맞게 map 폴더 참조)
const GRID_DATA_PATH = path.join(__dirname, '..', 'map', 'earth_grid_400x800.json');
const PROVINCE_SPEC_PATH = path.join(__dirname, '..', 'map', 'province_specifications.json'); // 💡 프로빈스/도시 명세서 경로 추가

// 1. 미들웨어 설정
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// public 폴더를 정적 파일 제공 디렉토리로 설정 (이곳에 index.html을 둡니다)
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    const now = new Date().toISOString();
    console.log(`[${now}] ${req.method} ${req.url}`);
    next();
});

const checkFileExists = (filePath) => {
    return fs.existsSync(filePath);
};

// 2. API 라우트
app.get('/api/grid-data', (req, res) => {
    if (!checkFileExists(GRID_DATA_PATH)) {
        console.error(`[ERROR] 파일 없음: ${GRID_DATA_PATH}`);
        return res.status(404).json({
            error: 'Grid data not found',
            message: 'earth_grid_400x800.json 파일이 없습니다.'
        });
    }

    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(GRID_DATA_PATH, (err) => {
        if (err) {
            console.error('[ERROR] grid-data 전송 실패:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to send grid data' });
            }
        }
    });
});

// 💡 새로운 프로빈스/도시 명세서 제공 API 라우트 추가
app.get('/api/province-specifications', (req, res) => {
    if (!checkFileExists(PROVINCE_SPEC_PATH)) {
        console.error(`[ERROR] 파일 없음: ${PROVINCE_SPEC_PATH}`);
        return res.status(404).json({
            error: 'Province specifications not found',
            message: 'province_specifications.json 파일이 없습니다. 파이썬 스크립트를 먼저 실행해주세요.'
        });
    }

    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(PROVINCE_SPEC_PATH, (err) => {
        if (err) {
            console.error('[ERROR] province-specifications 전송 실패:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to send province specifications' });
            }
        }
    });
});

app.get('/api/status', (req, res) => {
    const hasGrid = checkFileExists(GRID_DATA_PATH);
    const hasProvinceSpec = checkFileExists(PROVINCE_SPEC_PATH); // 💡 상태 체크 추가
    res.json({
        status: 'online',
        uptime: process.uptime(),
        files: {
            'earth_grid_400x800.json': hasGrid ? 'OK' : 'Missing',
            'province_specifications.json': hasProvinceSpec ? 'OK' : 'Missing'
        }
    });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

app.use((err, req, res, next) => {
    console.error('[SERVER ERROR]', err.stack);
    res.status(500).json({
        error: 'Internal Server Error',
        message: err.message
    });
});

app.listen(PORT, () => {
    console.log(`=================================`);
    console.log(` Earth Grid & Province Server Started`);
    console.log(` URL: http://localhost:${PORT}`);
    console.log(` Grid Data Status:     ${checkFileExists(GRID_DATA_PATH) ? 'Ready' : 'NOT FOUND'}`);
    console.log(` Province Spec Status: ${checkFileExists(PROVINCE_SPEC_PATH) ? 'Ready' : 'NOT FOUND'}`); // 💡 콘솔 로그 추가
    console.log(`=================================`);
});