const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 데이터 파일 경로 정의 (상위 폴더의 map 디렉토리 기준)
const LAND_DATA_PATH = path.join(__dirname, '..', 'map', 'land.json');
const SEA_DATA_PATH = path.join(__dirname, '..', 'map', 'sea.json');
const PROVINCE_DATA_PATH = path.join(__dirname, '..', 'map', 'province.json');
const CITY_DATA_PATH = path.join(__dirname, '..', 'map', 'city.json');

// 1. 미들웨어 설정
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// public 폴더를 정적 파일 제공 디렉토리로 설정
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

// ⛰️ 육지 데이터 제공 API
app.get('/api/land-data', (req, res) => {
    if (!checkFileExists(LAND_DATA_PATH)) {
        console.error(`[ERROR] 파일 없음: ${LAND_DATA_PATH}`);
        return res.status(404).json({
            error: 'Land data not found',
            message: 'land.json 파일이 없습니다.'
        });
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(LAND_DATA_PATH);
});

// 🌊 바다 데이터 제공 API
app.get('/api/sea-data', (req, res) => {
    if (!checkFileExists(SEA_DATA_PATH)) {
        console.error(`[ERROR] 파일 없음: ${SEA_DATA_PATH}`);
        return res.status(404).json({
            error: 'Sea data not found',
            message: 'sea.json 파일이 없습니다.'
        });
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(SEA_DATA_PATH);
});

// 🏰 프로빈스 데이터 제공 라우트 (클라이언트의 fetch('province.json') 대응)
app.get('/province.json', (req, res) => {
    if (!checkFileExists(PROVINCE_DATA_PATH)) {
        console.error(`[ERROR] 파일 없음: ${PROVINCE_DATA_PATH}`);
        return res.status(404).json({
            error: 'Province data not found',
            message: 'province.json 파일이 없습니다.'
        });
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(PROVINCE_DATA_PATH);
});

// 🏙️ 도시 데이터 제공 라우트 (클라이언트의 fetch('city.json') 대응)
app.get('/city.json', (req, res) => {
    if (!checkFileExists(CITY_DATA_PATH)) {
        console.error(`[ERROR] 파일 없음: ${CITY_DATA_PATH}`);
        return res.status(404).json({
            error: 'City data not found',
            message: 'city.json 파일이 없습니다.'
        });
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(CITY_DATA_PATH);
});

// 📊 서버 상태 체크 API
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        uptime: process.uptime(),
        files: {
            'land.json': checkFileExists(LAND_DATA_PATH) ? 'OK' : 'Missing',
            'sea.json': checkFileExists(SEA_DATA_PATH) ? 'OK' : 'Missing',
            'province.json': checkFileExists(PROVINCE_DATA_PATH) ? 'OK' : 'Missing',
            'city.json': checkFileExists(CITY_DATA_PATH) ? 'OK' : 'Missing'
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
    console.log(` Earth Land, Sea & Province Server Started`);
    console.log(` URL: http://localhost:${PORT}`);
    console.log(` Land Data Status:     ${checkFileExists(LAND_DATA_PATH) ? 'Ready' : 'NOT FOUND'}`);
    console.log(` Sea Data Status:      ${checkFileExists(SEA_DATA_PATH) ? 'Ready' : 'NOT FOUND'}`);
    console.log(` Province Status:      ${checkFileExists(PROVINCE_DATA_PATH) ? 'Ready' : 'NOT FOUND'}`);
    console.log(` City Status:          ${checkFileExists(CITY_DATA_PATH) ? 'Ready' : 'NOT FOUND'}`);
    console.log(`=================================`);
});