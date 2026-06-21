const axios = require('axios');
const fs = require('fs');
const express = require('express');
const crypto = require('crypto');

// ==================== CẤU HÌNH ====================
const API_LC_HU = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8";
const USER_ID = "@tranhoang2286";
const PORT = process.env.PORT || 3001;

// ==================== EXPRESS APP ====================
const app = express();
app.use(express.json());

// ==================== BIẾN TOÀN CỤC ====================
let globalHistory = [];
let globalStats = { total: 0, correct: 0, wrong: 0, streak: 0, maxStreak: 0 };
let lastPrediction = null;
let lastPhien = null;
let patternLibrary = {};
let modelWeights = {};
let learningData = {};

// ==================== HÀM LOAD/SAVE ====================
function loadData() {
    try {
        if (fs.existsSync('./history.json')) {
            const data = JSON.parse(fs.readFileSync('./history.json', 'utf8'));
            globalHistory = data.history || [];
            globalStats = data.stats || { total: 0, correct: 0, wrong: 0, streak: 0, maxStreak: 0 };
            patternLibrary = data.patterns || {};
            modelWeights = data.weights || {};
            console.log(`[📂] Đã tải ${globalHistory.length} phiên lịch sử`);
        }
    } catch (e) {
        console.error('[❌] Lỗi load data:', e.message);
    }
}

function saveData() {
    try {
        fs.writeFileSync('./history.json', JSON.stringify({
            history: globalHistory,
            stats: globalStats,
            patterns: patternLibrary,
            weights: modelWeights
        }, null, 2));
    } catch (e) {
        console.error('[❌] Lỗi save data:', e.message);
    }
}

// ==================== THUẬT TOÁN PHÂN TÍCH CẤP ĐỘ 1 ====================

// 1.1 Phân tích chuỗi kết quả cơ bản
function analyzeBasicSequence(history) {
    if (history.length < 3) return null;
    const results = history.map(h => h.result);
    const total = results.length;
    const taiCount = results.filter(r => r === 'T').length;
    const xiuCount = total - taiCount;
    const taiRatio = taiCount / total;
    const xiuRatio = xiuCount / total;
    const imbalance = Math.abs(taiCount - xiuCount) / total;
    
    // Phân tích 3 phiên gần nhất
    const last3 = results.slice(-3);
    const last3Tai = last3.filter(r => r === 'T').length;
    const last3Pattern = last3.join('');
    
    // Phân tích 5 phiên gần nhất
    const last5 = results.slice(-5);
    const last5Tai = last5.filter(r => r === 'T').length;
    const last5Pattern = last5.join('');
    
    // Phân tích 10 phiên gần nhất
    const last10 = results.slice(-10);
    const last10Tai = last10.filter(r => r === 'T').length;
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (last3Tai === 3) {
        prediction = 'X';
        confidence = 72;
        reason = '3 phiên Tài liên tiếp, dự đoán Xỉu';
    } else if (last3Tai === 0) {
        prediction = 'T';
        confidence = 72;
        reason = '3 phiên Xỉu liên tiếp, dự đoán Tài';
    } else if (last5Tai >= 4) {
        prediction = 'X';
        confidence = 68;
        reason = `5 phiên có ${last5Tai} Tài, dự đoán Xỉu`;
    } else if (last5Tai <= 1) {
        prediction = 'T';
        confidence = 68;
        reason = `5 phiên có ${5-last5Tai} Xỉu, dự đoán Tài`;
    } else if (imbalance > 0.3) {
        prediction = taiCount > xiuCount ? 'X' : 'T';
        confidence = 60 + imbalance * 30;
        reason = `Mất cân bằng ${(imbalance*100).toFixed(0)}%, dự đoán bên yếu`;
    } else {
        prediction = results[results.length - 1] === 'T' ? 'X' : 'T';
        confidence = 52;
        reason = 'Theo xu hướng đảo chiều';
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        taiRatio,
        xiuRatio,
        imbalance,
        last3Pattern,
        last5Pattern,
        last10Tai
    };
}

// 1.2 Phân tích cầu bệt chi tiết
function analyzeDetailedStreak(history) {
    if (history.length < 3) return null;
    const results = history.map(h => h.result);
    
    // Đếm độ dài bệt hiện tại
    let currentStreak = 1;
    const lastResult = results[results.length - 1];
    for (let i = results.length - 2; i >= 0; i--) {
        if (results[i] === lastResult) currentStreak++;
        else break;
    }
    
    // Lịch sử bệt
    let streakHistory = [];
    let tempStreak = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[i-1]) {
            tempStreak++;
        } else {
            streakHistory.push(tempStreak);
            tempStreak = 1;
        }
    }
    streakHistory.push(tempStreak);
    
    // Thống kê bệt
    const avgStreak = streakHistory.reduce((a,b) => a + b, 0) / streakHistory.length;
    const maxStreak = Math.max(...streakHistory);
    const minStreak = Math.min(...streakHistory);
    const medianStreak = streakHistory.sort((a,b) => a-b)[Math.floor(streakHistory.length/2)];
    
    // Bệt của Tài và Xỉu
    let taiStreaks = [];
    let xiuStreaks = [];
    let tempResult = results[0];
    tempStreak = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === tempResult) {
            tempStreak++;
        } else {
            if (tempResult === 'T') taiStreaks.push(tempStreak);
            else xiuStreaks.push(tempStreak);
            tempResult = results[i];
            tempStreak = 1;
        }
    }
    if (tempResult === 'T') taiStreaks.push(tempStreak);
    else xiuStreaks.push(tempStreak);
    
    const avgTaiStreak = taiStreaks.length ? taiStreaks.reduce((a,b) => a+b, 0) / taiStreaks.length : 0;
    const avgXiuStreak = xiuStreaks.length ? xiuStreaks.reduce((a,b) => a+b, 0) / xiuStreaks.length : 0;
    const maxTaiStreak = taiStreaks.length ? Math.max(...taiStreaks) : 0;
    const maxXiuStreak = xiuStreaks.length ? Math.max(...xiuStreaks) : 0;
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (currentStreak >= 8) {
        prediction = lastResult === 'T' ? 'X' : 'T';
        confidence = Math.min(85, 60 + currentStreak * 2);
        reason = `Siêu bệt ${currentStreak} phiên, dự đoán bẻ`;
    } else if (currentStreak >= 5) {
        prediction = lastResult === 'T' ? 'X' : 'T';
        confidence = 65 + (currentStreak - 5) * 3;
        reason = `Bệt dài ${currentStreak} phiên (TB ${avgStreak.toFixed(1)}), dự đoán bẻ`;
    } else if (currentStreak >= 3) {
        if (currentStreak > avgStreak * 1.5) {
            prediction = lastResult === 'T' ? 'X' : 'T';
            confidence = 60 + (currentStreak - avgStreak) * 5;
            reason = `Bệt ${currentStreak} phiên (TB ${avgStreak.toFixed(1)}), dự đoán bẻ`;
        } else {
            prediction = lastResult;
            confidence = 60 + currentStreak * 3;
            reason = `Bệt ${currentStreak} phiên, tiếp tục`;
        }
    } else if (currentStreak <= 2) {
        prediction = lastResult === 'T' ? 'X' : 'T';
        confidence = 55 + (3 - currentStreak) * 2;
        reason = `Bệt ngắn ${currentStreak} phiên, dự đoán xen kẽ`;
    } else {
        prediction = lastResult;
        confidence = 50;
        reason = 'Không xác định';
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        currentStreak,
        avgStreak,
        maxStreak,
        minStreak,
        medianStreak,
        avgTaiStreak,
        avgXiuStreak,
        maxTaiStreak,
        maxXiuStreak,
        totalStreaks: streakHistory.length
    };
}

// 1.3 Phân tích cầu xen kẽ
function analyzeAlternatingPattern(history) {
    if (history.length < 6) return null;
    const results = history.map(h => h.result);
    
    // Đếm số lần xen kẽ
    let altCount = 0;
    let altRuns = [];
    let currentAltRun = 1;
    
    for (let i = 1; i < results.length; i++) {
        if (results[i] !== results[i-1]) {
            altCount++;
            currentAltRun++;
        } else {
            if (currentAltRun > 1) {
                altRuns.push(currentAltRun);
                currentAltRun = 1;
            }
        }
    }
    if (currentAltRun > 1) altRuns.push(currentAltRun);
    
    const altRatio = altCount / (results.length - 1);
    const avgAltRun = altRuns.length ? altRuns.reduce((a,b) => a+b, 0) / altRuns.length : 0;
    const maxAltRun = Math.max(...altRuns, 0);
    
    // Kiểm tra các cửa sổ
    const windows = [3, 5, 7, 10, 15];
    let windowData = {};
    for (const w of windows) {
        if (results.length >= w) {
            const recent = results.slice(-w);
            let count = 0;
            for (let i = 1; i < recent.length; i++) {
                if (recent[i] !== recent[i-1]) count++;
            }
            windowData[w] = {
                altRatio: count / (w - 1),
                isAlternating: count / (w - 1) > 0.65,
                count: count
            };
        }
    }
    
    // Phân tích pattern xen kẽ gần đây
    const last6 = results.slice(-6);
    let last6Alt = true;
    for (let i = 1; i < last6.length; i++) {
        if (last6[i] === last6[i-1]) {
            last6Alt = false;
            break;
        }
    }
    
    const last8 = results.slice(-8);
    let last8Alt = true;
    for (let i = 1; i < last8.length; i++) {
        if (last8[i] === last8[i-1]) {
            last8Alt = false;
            break;
        }
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    const lastResult = results[results.length - 1];
    const otherResult = lastResult === 'T' ? 'X' : 'T';
    
    if (altRatio > 0.8) {
        prediction = otherResult;
        confidence = 75;
        reason = `Xen kẽ cực mạnh (${(altRatio*100).toFixed(0)}%)`;
    } else if (altRatio > 0.7 && windowData[5]?.isAlternating) {
        prediction = otherResult;
        confidence = 70;
        reason = `Xen kẽ mạnh (${(altRatio*100).toFixed(0)}%), 5 phiên gần nhất xen kẽ`;
    } else if (altRatio > 0.6 && windowData[3]?.isAlternating) {
        prediction = otherResult;
        confidence = 65;
        reason = `Xen kẽ (${(altRatio*100).toFixed(0)}%), 3 phiên gần nhất xen kẽ`;
    } else if (last6Alt && altRatio > 0.5) {
        prediction = otherResult;
        confidence = 62;
        reason = '6 phiên gần nhất xen kẽ';
    } else if (last8Alt && altRatio > 0.45) {
        prediction = otherResult;
        confidence = 58;
        reason = '8 phiên gần nhất xen kẽ';
    } else if (altRatio < 0.3 && windowData[7]?.altRatio < 0.3) {
        prediction = lastResult;
        confidence = 60;
        reason = `Ít xen kẽ (${(altRatio*100).toFixed(0)}%), tiếp tục xu hướng`;
    } else {
        prediction = lastResult;
        confidence = 52;
        reason = 'Không có xen kẽ rõ ràng';
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        altRatio,
        avgAltRun,
        maxAltRun,
        windowData,
        last6Alt,
        last8Alt,
        totalAltRuns: altRuns.length
    };
}

// ==================== THUẬT TOÁN PHÂN TÍCH CẤP ĐỘ 2 ====================

// 2.1 Phân tích cầu 2-2 chi tiết
function analyzePattern22Detailed(history) {
    if (history.length < 8) return null;
    const results = history.map(h => h.result);
    
    // Đếm cầu 2-2
    let pattern22Count = 0;
    let pattern22Positions = [];
    let pattern22Results = [];
    
    for (let i = 0; i <= results.length - 4; i++) {
        if (results[i] === results[i+1] &&
            results[i+2] === results[i+3] &&
            results[i] !== results[i+2]) {
            pattern22Count++;
            pattern22Positions.push(i);
            pattern22Results.push({
                first: results[i],
                second: results[i+2],
                position: i,
                distance: results.length - i
            });
        }
    }
    
    const ratio = pattern22Count / Math.max(1, results.length - 3);
    
    // Kiểm tra 4 phiên gần nhất
    const last4 = results.slice(-4);
    const is22 = last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2];
    
    // Kiểm tra 6 phiên gần nhất
    const last6 = results.slice(-6);
    let has22Recent = false;
    for (let i = 0; i <= last6.length - 4; i++) {
        if (last6[i] === last6[i+1] && last6[i+2] === last6[i+3] && last6[i] !== last6[i+2]) {
            has22Recent = true;
            break;
        }
    }
    
    // Phân tích khoảng cách giữa các cầu 2-2
    let distances = [];
    for (let i = 1; i < pattern22Positions.length; i++) {
        distances.push(pattern22Positions[i] - pattern22Positions[i-1]);
    }
    const avgDistance = distances.length ? distances.reduce((a,b) => a+b, 0) / distances.length : 0;
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (is22) {
        prediction = last4[3] === 'T' ? 'X' : 'T';
        confidence = Math.min(85, 65 + ratio * 30);
        reason = `Cầu 2-2 (tần suất ${(ratio*100).toFixed(0)}%)`;
    } else if (has22Recent && !is22) {
        // Có thể sắp xuất hiện 2-2
        const last2 = results.slice(-2);
        if (last2[0] === last2[1]) {
            prediction = last2[0] === 'T' ? 'X' : 'T';
            confidence = 60 + ratio * 25;
            reason = `Có khả năng cầu 2-2 (tần suất ${(ratio*100).toFixed(0)}%)`;
        } else {
            prediction = results[results.length - 1];
            confidence = 55;
            reason = `Chờ tín hiệu cầu 2-2`;
        }
    } else if (ratio > 0.3 && pattern22Positions.length > 0) {
        const lastPos = pattern22Positions[pattern22Positions.length - 1];
        const distance = results.length - lastPos;
        if (distance > avgDistance * 1.5 && avgDistance > 0) {
            prediction = results[results.length - 1] === 'T' ? 'X' : 'T';
            confidence = 58 + ratio * 20;
            reason = `Có thể xuất hiện cầu 2-2 (cách ${distance} phiên)`;
        } else {
            prediction = results[results.length - 1];
            confidence = 52;
            reason = `Cầu 2-2 chưa đến`;
        }
    } else {
        prediction = results[results.length - 1];
        confidence = 50;
        reason = `Không có cầu 2-2`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        count: pattern22Count,
        ratio,
        is22,
        has22Recent,
        avgDistance,
        positions: pattern22Positions,
        results: pattern22Results
    };
}

// 2.2 Phân tích cầu 3-3 chi tiết
function analyzePattern33Detailed(history) {
    if (history.length < 10) return null;
    const results = history.map(h => h.result);
    
    // Đếm cầu 3-3
    let pattern33Count = 0;
    let pattern33Positions = [];
    
    for (let i = 0; i <= results.length - 6; i++) {
        if (results[i] === results[i+1] && results[i+1] === results[i+2] &&
            results[i+3] === results[i+4] && results[i+4] === results[i+5] &&
            results[i] !== results[i+3]) {
            pattern33Count++;
            pattern33Positions.push(i);
        }
    }
    
    const ratio = pattern33Count / Math.max(1, results.length - 5);
    
    // Kiểm tra 6 phiên gần nhất
    const last6 = results.slice(-6);
    const is33 = last6[0] === last6[1] && last6[1] === last6[2] &&
                 last6[3] === last6[4] && last6[4] === last6[5] &&
                 last6[0] !== last6[3];
    
    // Kiểm tra 9 phiên gần nhất
    const last9 = results.slice(-9);
    let has33Recent = false;
    for (let i = 0; i <= last9.length - 6; i++) {
        if (last9[i] === last9[i+1] && last9[i+1] === last9[i+2] &&
            last9[i+3] === last9[i+4] && last9[i+4] === last9[i+5] &&
            last9[i] !== last9[i+3]) {
            has33Recent = true;
            break;
        }
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (is33) {
        prediction = last6[5] === 'T' ? 'X' : 'T';
        confidence = Math.min(85, 65 + ratio * 30);
        reason = `Cầu 3-3 (tần suất ${(ratio*100).toFixed(0)}%)`;
    } else if (has33Recent && !is33) {
        const last3 = results.slice(-3);
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
            prediction = last3[0] === 'T' ? 'X' : 'T';
            confidence = 60 + ratio * 25;
            reason = `Có khả năng cầu 3-3 (tần suất ${(ratio*100).toFixed(0)}%)`;
        } else {
            prediction = results[results.length - 1];
            confidence = 55;
            reason = `Chờ tín hiệu cầu 3-3`;
        }
    } else if (ratio > 0.2 && pattern33Positions.length > 0) {
        const lastPos = pattern33Positions[pattern33Positions.length - 1];
        const distance = results.length - lastPos;
        if (distance > 8) {
            prediction = results[results.length - 1] === 'T' ? 'X' : 'T';
            confidence = 55 + ratio * 20;
            reason = `Có thể xuất hiện cầu 3-3 (cách ${distance} phiên)`;
        } else {
            prediction = results[results.length - 1];
            confidence = 52;
            reason = `Cầu 3-3 chưa đến`;
        }
    } else {
        prediction = results[results.length - 1];
        confidence = 50;
        reason = `Không có cầu 3-3`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        count: pattern33Count,
        ratio,
        is33,
        has33Recent,
        positions: pattern33Positions
    };
}

// 2.3 Phân tích cầu 1-2-1 và 2-1-2
function analyzeSpecialPatternsDetailed(history) {
    if (history.length < 7) return null;
    const results = history.map(h => h.result);
    
    let pattern121Count = 0;
    let pattern212Count = 0;
    let pattern121Positions = [];
    let pattern212Positions = [];
    
    for (let i = 0; i <= results.length - 5; i++) {
        // 1-2-1: X T T X T
        if (results[i] !== results[i+1] &&
            results[i+1] === results[i+2] &&
            results[i+2] !== results[i+3] &&
            results[i+3] === results[i+4] &&
            results[i] === results[i+3]) {
            pattern121Count++;
            pattern121Positions.push(i);
        }
        // 2-1-2: T X X T X
        if (results[i] === results[i+1] &&
            results[i+1] !== results[i+2] &&
            results[i+2] === results[i+3] &&
            results[i+3] !== results[i+4] &&
            results[i] === results[i+3]) {
            pattern212Count++;
            pattern212Positions.push(i);
        }
    }
    
    const last5 = results.slice(-5);
    const is121 = last5[0] !== last5[1] && last5[1] === last5[2] &&
                  last5[2] !== last5[3] && last5[3] === last5[4] &&
                  last5[0] === last5[3];
    const is212 = last5[0] === last5[1] && last5[1] !== last5[2] &&
                  last5[2] === last5[3] && last5[3] !== last5[4] &&
                  last5[0] === last5[3];
    
    // Kiểm tra các pattern gần đây
    let recent121 = false;
    let recent212 = false;
    for (let i = results.length - 10; i <= results.length - 5; i++) {
        if (i >= 0) {
            const seg = results.slice(i, i + 5);
            if (seg[0] !== seg[1] && seg[1] === seg[2] &&
                seg[2] !== seg[3] && seg[3] === seg[4] &&
                seg[0] === seg[3]) {
                recent121 = true;
            }
            if (seg[0] === seg[1] && seg[1] !== seg[2] &&
                seg[2] === seg[3] && seg[3] !== seg[4] &&
                seg[0] === seg[3]) {
                recent212 = true;
            }
        }
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (is121) {
        prediction = last5[4] === 'T' ? 'X' : 'T';
        confidence = 76;
        reason = `Cầu 1-2-1 (xuất hiện ${pattern121Count} lần)`;
    } else if (is212) {
        prediction = last5[4] === 'T' ? 'X' : 'T';
        confidence = 76;
        reason = `Cầu 2-1-2 (xuất hiện ${pattern212Count} lần)`;
    } else if (recent121) {
        prediction = results[results.length - 1] === 'T' ? 'X' : 'T';
        confidence = 68;
        reason = `Có khả năng cầu 1-2-1 (${pattern121Count} lần)`;
    } else if (recent212) {
        prediction = results[results.length - 1] === 'T' ? 'X' : 'T';
        confidence = 68;
        reason = `Có khả năng cầu 2-1-2 (${pattern212Count} lần)`;
    } else if (pattern121Count > 0 || pattern212Count > 0) {
        prediction = results[results.length - 1];
        confidence = 55;
        reason = `Có pattern đặc biệt nhưng chưa đến`;
    } else {
        prediction = results[results.length - 1];
        confidence = 50;
        reason = `Không có cầu đặc biệt`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        pattern121Count,
        pattern212Count,
        is121,
        is212,
        recent121,
        recent212
    };
}

// ==================== THUẬT TOÁN PHÂN TÍCH CẤP ĐỘ 3 ====================

// 3.1 Phân tích cân bằng đa cửa sổ
function analyzeMultiWindowBalance(history) {
    if (history.length < 15) return null;
    const results = history.map(h => h.result);
    
    const windows = [3, 5, 7, 10, 15, 20, 30, 50];
    let windowData = {};
    let balanceScores = [];
    
    for (const w of windows) {
        if (results.length >= w) {
            const recent = results.slice(-w);
            const taiCount = recent.filter(r => r === 'T').length;
            const xiuCount = w - taiCount;
            const ratio = taiCount / w;
            const imbalance = Math.abs(taiCount - xiuCount) / w;
            const zScore = (ratio - 0.5) / Math.sqrt(0.25 / w);
            
            windowData[w] = {
                tai: taiCount,
                xiu: xiuCount,
                ratio: ratio,
                imbalance: imbalance,
                zScore: zScore,
                isSignificant: Math.abs(zScore) > 1.96
            };
            
            balanceScores.push({
                window: w,
                ratio: ratio,
                zScore: zScore
            });
        }
    }
    
    // Phân tích xu hướng qua các cửa sổ
    let trend = 'neutral';
    let trendStrength = 0;
    if (windowData[5] && windowData[10] && windowData[20] && windowData[30]) {
        const r5 = windowData[5].ratio;
        const r10 = windowData[10].ratio;
        const r20 = windowData[20].ratio;
        const r30 = windowData[30].ratio;
        
        const avg = (r5 + r10 + r20 + r30) / 4;
        const diff5 = r5 - avg;
        const diff10 = r10 - avg;
        const diff20 = r20 - avg;
        const diff30 = r30 - avg;
        
        if (diff5 > 0.05 && diff10 > 0.05 && diff20 > 0) {
            trend = 'tai_increasing';
            trendStrength = (diff5 + diff10 + diff20) / 3;
        } else if (diff5 < -0.05 && diff10 < -0.05 && diff20 < 0) {
            trend = 'xiu_increasing';
            trendStrength = -(diff5 + diff10 + diff20) / 3;
        } else if (r5 > 0.55 && r10 > 0.55) {
            trend = 'tai_dominant';
            trendStrength = (r5 + r10) / 2 - 0.5;
        } else if (r5 < 0.45 && r10 < 0.45) {
            trend = 'xiu_dominant';
            trendStrength = 0.5 - (r5 + r10) / 2;
        }
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    const w5 = windowData[5] || { ratio: 0.5, imbalance: 0 };
    const w10 = windowData[10] || { ratio: 0.5, imbalance: 0 };
    const w20 = windowData[20] || { ratio: 0.5, imbalance: 0 };
    
    // Mất cân bằng mạnh
    if (w5.imbalance > 0.6) {
        prediction = w5.ratio > 0.5 ? 'X' : 'T';
        confidence = Math.min(85, 65 + w5.imbalance * 30);
        reason = `Mất cân bằng cực mạnh (${(w5.imbalance*100).toFixed(0)}%)`;
    } else if (w5.imbalance > 0.4) {
        prediction = w5.ratio > 0.5 ? 'X' : 'T';
        confidence = Math.min(80, 60 + w5.imbalance * 25);
        reason = `Mất cân bằng mạnh (${(w5.imbalance*100).toFixed(0)}%)`;
    } else if (w10.imbalance > 0.35) {
        prediction = w10.ratio > 0.5 ? 'X' : 'T';
        confidence = 60 + w10.imbalance * 25;
        reason = `Mất cân bằng (${(w10.imbalance*100).toFixed(0)}%) trong 10 phiên`;
    } else if (w20.imbalance > 0.3) {
        prediction = w20.ratio > 0.5 ? 'X' : 'T';
        confidence = 58 + w20.imbalance * 20;
        reason = `Mất cân bằng (${(w20.imbalance*100).toFixed(0)}%) trong 20 phiên`;
    } else if (trend === 'tai_increasing' && trendStrength > 0.08) {
        prediction = 'T';
        confidence = 60 + trendStrength * 30;
        reason = `Xu hướng Tài tăng (${(trendStrength*100).toFixed(0)}%)`;
    } else if (trend === 'xiu_increasing' && trendStrength > 0.08) {
        prediction = 'X';
        confidence = 60 + trendStrength * 30;
        reason = `Xu hướng Xỉu tăng (${(trendStrength*100).toFixed(0)}%)`;
    } else if (trend === 'tai_dominant') {
        prediction = 'T';
        confidence = 55 + trendStrength * 20;
        reason = `Tài chiếm ưu thế (${(trendStrength*100).toFixed(0)}%)`;
    } else if (trend === 'xiu_dominant') {
        prediction = 'X';
        confidence = 55 + trendStrength * 20;
        reason = `Xỉu chiếm ưu thế (${(trendStrength*100).toFixed(0)}%)`;
    } else {
        prediction = results[results.length - 1];
        confidence = 52;
        reason = `Cân bằng, theo xu hướng cuối`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        windowData,
        trend,
        trendStrength,
        balanceScores
    };
}

// 3.2 Phân tích điểm số chi tiết
function analyzeDetailedScore(history) {
    if (history.length < 10) return null;
    const scores = history.map(h => h.score || 0);
    const results = history.map(h => h.result);
    
    // Thống kê điểm số
    const avg = scores.reduce((a,b) => a+b, 0) / scores.length;
    const max = Math.max(...scores);
    const min = Math.min(...scores);
    const last = scores[scores.length - 1];
    const last5 = scores.slice(-5).reduce((a,b) => a+b, 0) / Math.min(5, scores.length);
    const last10 = scores.slice(-10).reduce((a,b) => a+b, 0) / Math.min(10, scores.length);
    const last20 = scores.slice(-20).reduce((a,b) => a+b, 0) / Math.min(20, scores.length);
    
    // Độ lệch chuẩn
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);
    
    // Phân phối điểm số
    const scoreDistribution = { low: 0, mid: 0, high: 0 };
    for (const s of scores) {
        if (s <= 6) scoreDistribution.low++;
        else if (s <= 10) scoreDistribution.mid++;
        else scoreDistribution.high++;
    }
    const distRatio = {
        low: scoreDistribution.low / scores.length,
        mid: scoreDistribution.mid / scores.length,
        high: scoreDistribution.high / scores.length
    };
    
    // Xu hướng điểm số
    let scoreTrend = 'stable';
    let trendStrength = 0;
    if (scores.length >= 10) {
        const first5 = scores.slice(0, 5).reduce((a,b) => a+b, 0) / 5;
        const mid5 = scores.slice(5, 10).reduce((a,b) => a+b, 0) / 5;
        const last5_2 = scores.slice(-5).reduce((a,b) => a+b, 0) / 5;
        
        const diff1 = mid5 - first5;
        const diff2 = last5_2 - mid5;
        
        if (diff1 > 0.5 && diff2 > 0.5) {
            scoreTrend = 'increasing';
            trendStrength = (diff1 + diff2) / 2;
        } else if (diff1 < -0.5 && diff2 < -0.5) {
            scoreTrend = 'decreasing';
            trendStrength = -(diff1 + diff2) / 2;
        }
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    const lastScore = last;
    const avgScore = avg;
    const recentAvg = last10;
    
    if (lastScore > 14) {
        prediction = 'X';
        confidence = Math.min(85, 65 + (lastScore - 14) * 2);
        reason = `Điểm cực cao ${lastScore} (TB ${avgScore.toFixed(1)})`;
    } else if (lastScore < 6) {
        prediction = 'T';
        confidence = Math.min(85, 65 + (6 - lastScore) * 2);
        reason = `Điểm cực thấp ${lastScore} (TB ${avgScore.toFixed(1)})`;
    } else if (lastScore > 12 && recentAvg < 10) {
        prediction = 'X';
        confidence = 65;
        reason = `Điểm cao ${lastScore} so với TB ${avgScore.toFixed(1)}`;
    } else if (lastScore < 8 && recentAvg > 11) {
        prediction = 'T';
        confidence = 65;
        reason = `Điểm thấp ${lastScore} so với TB ${avgScore.toFixed(1)}`;
    } else if (scoreTrend === 'increasing' && trendStrength > 0.8) {
        prediction = 'X';
        confidence = 60 + trendStrength * 5;
        reason = `Xu hướng điểm tăng (${(trendStrength).toFixed(1)})`;
    } else if (scoreTrend === 'decreasing' && trendStrength > 0.8) {
        prediction = 'T';
        confidence = 60 + trendStrength * 5;
        reason = `Xu hướng điểm giảm (${(trendStrength).toFixed(1)})`;
    } else if (distRatio.high > 0.5) {
        prediction = 'X';
        confidence = 58;
        reason = `Điểm cao chiếm ${(distRatio.high*100).toFixed(0)}%`;
    } else if (distRatio.low > 0.5) {
        prediction = 'T';
        confidence = 58;
        reason = `Điểm thấp chiếm ${(distRatio.low*100).toFixed(0)}%`;
    } else {
        prediction = lastScore > 11 ? 'X' : 'T';
        confidence = 52;
        reason = `Điểm ${lastScore} ở mức ${lastScore > 11 ? 'cao' : 'thấp'}`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        avg,
        max,
        min,
        last,
        last5,
        last10,
        last20,
        stdDev,
        distribution: distRatio,
        scoreTrend,
        trendStrength
    };
}

// 3.3 Phân tích Markov nâng cao
function analyzeAdvancedMarkov(history) {
    if (history.length < 6) return null;
    const results = history.map(h => h.result);
    
    const orders = [2, 3, 4, 5];
    let allPredictions = [];
    let transitionData = {};
    
    for (const order of orders) {
        if (results.length < order + 1) continue;
        
        const transitions = {};
        for (let i = 0; i <= results.length - order - 1; i++) {
            const state = results.slice(i, i + order).join('');
            const next = results[i + order];
            if (!transitions[state]) transitions[state] = { T: 0, X: 0 };
            transitions[state][next]++;
        }
        
        const lastState = results.slice(-order).join('');
        if (transitions[lastState]) {
            const data = transitions[lastState];
            const total = data.T + data.X;
            if (total >= 2) {
                const taiProb = data.T / total;
                const xiuProb = data.X / total;
                const confidence = Math.abs(taiProb - xiuProb);
                const pred = taiProb > xiuProb ? 'T' : 'X';
                
                allPredictions.push({
                    order,
                    prediction: pred,
                    confidence: 50 + confidence * 45,
                    taiProb,
                    xiuProb,
                    total,
                    state: lastState
                });
            }
        }
        
        transitionData[order] = transitions;
    }
    
    if (allPredictions.length === 0) return null;
    
    // Trọng số theo bậc và độ tin cậy
    let tScore = 0, xScore = 0;
    let totalWeight = 0;
    let bestPred = allPredictions[0];
    
    for (const pred of allPredictions) {
        const weight = (pred.order / 5) * (pred.confidence / 100);
        if (pred.prediction === 'T') tScore += weight;
        else xScore += weight;
        totalWeight += weight;
        
        if (pred.confidence > bestPred.confidence) {
            bestPred = pred;
        }
    }
    
    // Kiểm tra sự đồng thuận
    let tCount = allPredictions.filter(p => p.prediction === 'T').length;
    let xCount = allPredictions.length - tCount;
    const consensus = Math.max(tCount, xCount) / allPredictions.length;
    
    const finalPred = tScore > xScore ? 'T' : 'X';
    let confidence = Math.round((Math.max(tScore, xScore) / totalWeight) * 100);
    if (consensus > 0.7) {
        confidence = Math.min(90, confidence + 5);
    }
    
    return {
        prediction: finalPred,
        confidence: Math.min(85, Math.max(50, confidence)),
        bestOrder: bestPred.order,
        bestConfidence: bestPred.confidence,
        consensus: consensus,
        tCount,
        xCount,
        details: allPredictions,
        reason: `Markov bậc ${bestPred.order} (${bestPred.confidence}%)`
    };
}

// ==================== THUẬT TOÁN PHÂN TÍCH CẤP ĐỘ 4 ====================

// 4.1 Phân tích chu kỳ
function analyzeCyclePattern(history) {
    if (history.length < 20) return null;
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    
    let cycles = {};
    let cycleStrengths = {};
    
    for (let cycle = 2; cycle <= 20; cycle++) {
        let matches = 0;
        let total = 0;
        let matchPositions = [];
        
        for (let i = cycle; i < results.length; i++) {
            if (results[i] === results[i - cycle]) {
                matches++;
                matchPositions.push(i);
            }
            total++;
        }
        
        const strength = matches / total;
        cycles[cycle] = {
            strength: strength,
            count: matches,
            total: total,
            positions: matchPositions
        };
        cycleStrengths[cycle] = strength;
    }
    
    // Tìm chu kỳ mạnh nhất
    let bestCycle = 2;
    let bestStrength = 0;
    for (const c in cycles) {
        if (cycles[c].strength > bestStrength) {
            bestStrength = cycles[c].strength;
            bestCycle = parseInt(c);
        }
    }
    
    // Kiểm tra chu kỳ đang lặp
    const lastCycle = results.slice(-bestCycle);
    const prevCycle = results.slice(-bestCycle*2, -bestCycle);
    const isRepeating = JSON.stringify(lastCycle) === JSON.stringify(prevCycle);
    
    // Tìm các chu kỳ con
    let subCycles = {};
    for (let cycle = 2; cycle <= 10; cycle++) {
        if (bestCycle % cycle === 0) {
            subCycles[cycle] = cycles[cycle]?.strength || 0;
        }
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (isRepeating && bestStrength > 0.7) {
        prediction = lastCycle[0] === 1 ? 'T' : 'X';
        confidence = Math.min(85, 65 + bestStrength * 25);
        reason = `Chu kỳ ${bestCycle} đang lặp (${(bestStrength*100).toFixed(0)}%)`;
    } else if (bestStrength > 0.65) {
        const nextPred = results[results.length - bestCycle] === 1 ? 'T' : 'X';
        prediction = nextPred;
        confidence = 60 + (bestStrength - 0.65) * 50;
        reason = `Phát hiện chu kỳ ${bestCycle} (${(bestStrength*100).toFixed(0)}%)`;
    } else if (bestStrength > 0.6) {
        prediction = results[results.length - 1] === 1 ? 'T' : 'X';
        confidence = 55 + (bestStrength - 0.6) * 30;
        reason = `Chu kỳ ${bestCycle} trung bình (${(bestStrength*100).toFixed(0)}%)`;
    } else if (Object.values(cycleStrengths).filter(s => s > 0.55).length >= 2) {
        prediction = results[results.length - 1] === 1 ? 'X' : 'T';
        confidence = 55;
        reason = `Nhiều chu kỳ yếu, dự đoán đảo`;
    } else {
        prediction = results[results.length - 1] === 1 ? 'T' : 'X';
        confidence = 50;
        reason = `Không có chu kỳ rõ ràng`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        bestCycle,
        bestStrength,
        isRepeating,
        subCycles,
        cycles,
        allStrengths: cycleStrengths
    };
}

// 4.2 Phân tích Fibonacci nâng cao
function analyzeAdvancedFibonacci(history) {
    if (history.length < 21) return null;
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    
    const fibs = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55];
    let fibMatches = {};
    let totalMatches = 0;
    let weightedScore = 0;
    let totalWeight = 0;
    let matchDetails = [];
    
    for (const f of fibs) {
        if (history.length > f) {
            const match = results[results.length - f] === results[results.length - 1];
            const weight = 1 / (1 + Math.log(f));
            fibMatches[f] = { match, weight };
            if (match) {
                totalMatches++;
                weightedScore += weight;
                matchDetails.push({
                    fib: f,
                    value: results[results.length - f],
                    current: results[results.length - 1]
                });
            }
            totalWeight += weight;
        }
    }
    
    const strength = totalWeight > 0 ? weightedScore / totalWeight : 0;
    const matchRatio = totalMatches / Object.keys(fibMatches).length;
    
    // Phân tích các vị trí Fibonacci
    let fibPositions = [];
    for (const f of fibs) {
        if (history.length > f) {
            fibPositions.push({
                position: f,
                value: results[results.length - f],
                current: results[results.length - 1],
                match: results[results.length - f] === results[results.length - 1]
            });
        }
    }
    
    // Phân tích xu hướng Fibonacci
    const taiFibs = fibPositions.filter(p => p.value === 1).length;
    const xiuFibs = fibPositions.filter(p => p.value === 0).length;
    const fibRatio = taiFibs / (taiFibs + xiuFibs);
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (strength > 0.7 || matchRatio > 0.6) {
        prediction = results[results.length - 1] === 1 ? 'X' : 'T';
        confidence = Math.min(88, 60 + strength * 35);
        reason = `Fibonacci cực mạnh (${(strength*100).toFixed(0)}%)`;
    } else if (strength > 0.55) {
        prediction = results[results.length - 1] === 1 ? 'X' : 'T';
        confidence = Math.min(80, 55 + strength * 30);
        reason = `Fibonacci mạnh (${(strength*100).toFixed(0)}%)`;
    } else if (fibRatio > 0.65) {
        prediction = 'X';
        confidence = 60;
        reason = `Vị trí Fibonacci nghiêng Tài (${(fibRatio*100).toFixed(0)}%)`;
    } else if (fibRatio < 0.35) {
        prediction = 'T';
        confidence = 60;
        reason = `Vị trí Fibonacci nghiêng Xỉu (${((1-fibRatio)*100).toFixed(0)}%)`;
    } else {
        prediction = results[results.length - 1] === 1 ? 'T' : 'X';
        confidence = 52;
        reason = `Fibonacci trung bình (${(strength*100).toFixed(0)}%)`;
    }
    
    return {
        prediction,
        confidence: Math.min(88, Math.max(50, confidence)),
        reason,
        strength,
        matchRatio,
        totalMatches,
        fibPositions,
        matchDetails,
        weightedScore,
        totalWeight,
        fibRatio
    };
}

// 4.3 Phân tích đảo chiều
function analyzeReversalDetailed(history) {
    if (history.length < 8) return null;
    const results = history.map(h => h.result);
    
    // Phân tích đảo chiều trong các cửa sổ
    const windows = [5, 7, 10, 15];
    let windowData = {};
    
    for (const w of windows) {
        if (results.length >= w) {
            const recent = results.slice(-w);
            let changes = 0;
            let changePositions = [];
            
            for (let i = 1; i < recent.length; i++) {
                if (recent[i] !== recent[i-1]) {
                    changes++;
                    changePositions.push(i);
                }
            }
            
            windowData[w] = {
                changes,
                ratio: changes / (w - 1),
                positions: changePositions,
                lastChange: changePositions.length > 0 ? changePositions[changePositions.length - 1] : null
            };
        }
    }
    
    // Phân tích các mẫu đảo chiều
    let reversalPatterns = [];
    
    // Mẫu đảo chiều 1-2-1
    if (results.length >= 5) {
        const last5 = results.slice(-5);
        if (last5[0] !== last5[1] && last5[1] !== last5[2] &&
            last5[2] === last5[3] && last5[3] !== last5[4]) {
            reversalPatterns.push({
                type: '1-2-1 reversal',
                confidence: 72,
                prediction: last5[4] === 'T' ? 'X' : 'T'
            });
        }
    }
    
    // Mẫu đảo chiều 2-1-2
    if (results.length >= 5) {
        const last5 = results.slice(-5);
        if (last5[0] === last5[1] && last5[1] !== last5[2] &&
            last5[2] !== last5[3] && last5[3] === last5[4]) {
            reversalPatterns.push({
                type: '2-1-2 reversal',
                confidence: 72,
                prediction: last5[4] === 'T' ? 'X' : 'T'
            });
        }
    }
    
    // Mẫu đảo chiều double
    if (results.length >= 6) {
        const last6 = results.slice(-6);
        if (last6[0] === last6[2] && last6[2] === last6[4] &&
            last6[0] !== last6[1] && last6[1] === last6[3] && last6[3] === last6[5]) {
            reversalPatterns.push({
                type: 'double reversal',
                confidence: 75,
                prediction: last6[5] === 'T' ? 'X' : 'T'
            });
        }
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    const w5 = windowData[5] || { ratio: 0.5 };
    const w7 = windowData[7] || { ratio: 0.5 };
    const w10 = windowData[10] || { ratio: 0.5 };
    
    if (reversalPatterns.length > 0) {
        const best = reversalPatterns.reduce((a, b) => a.confidence > b.confidence ? a : b);
        prediction = best.prediction;
        confidence = best.confidence;
        reason = `Phát hiện mẫu ${best.type}`;
    } else if (w5.ratio > 0.8) {
        prediction = results[results.length - 1] === 'T' ? 'X' : 'T';
        confidence = 70;
        reason = `Đảo chiều cực mạnh (${(w5.ratio*100).toFixed(0)}%)`;
    } else if (w7.ratio > 0.7) {
        prediction = results[results.length - 1] === 'T' ? 'X' : 'T';
        confidence = 65;
        reason = `Đảo chiều mạnh (${(w7.ratio*100).toFixed(0)}%)`;
    } else if (w10.ratio > 0.65) {
        prediction = results[results.length - 1] === 'T' ? 'X' : 'T';
        confidence = 60;
        reason = `Đảo chiều (${(w10.ratio*100).toFixed(0)}%)`;
    } else if (w5.ratio < 0.3 && w10.ratio < 0.3) {
        prediction = results[results.length - 1];
        confidence = 60;
        reason = `Xu hướng mạnh, ít đảo chiều`;
    } else {
        prediction = results[results.length - 1];
        confidence = 52;
        reason = `Không có đảo chiều rõ ràng`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        windowData,
        reversalPatterns,
        totalPatterns: reversalPatterns.length
    };
}

// ==================== THUẬT TOÁN TỔNG HỢP ULTIMATE ====================

function analyzeUltimate(history) {
    if (history.length < 5) {
        return {
            prediction: 'T',
            confidence: 50,
            reason: 'Chưa đủ dữ liệu (cần 5 phiên)',
            algos: 0,
            details: []
        };
    }
    
    const predictions = [];
    const algoResults = {};
    
    // Tất cả thuật toán
    const algos = [
        { name: 'BasicSequence', func: analyzeBasicSequence },
        { name: 'DetailedStreak', func: analyzeDetailedStreak },
        { name: 'AlternatingPattern', func: analyzeAlternatingPattern },
        { name: 'Pattern22Detailed', func: analyzePattern22Detailed },
        { name: 'Pattern33Detailed', func: analyzePattern33Detailed },
        { name: 'SpecialPatternsDetailed', func: analyzeSpecialPatternsDetailed },
        { name: 'MultiWindowBalance', func: analyzeMultiWindowBalance },
        { name: 'DetailedScore', func: analyzeDetailedScore },
        { name: 'AdvancedMarkov', func: analyzeAdvancedMarkov },
        { name: 'CyclePattern', func: analyzeCyclePattern },
        { name: 'AdvancedFibonacci', func: analyzeAdvancedFibonacci },
        { name: 'ReversalDetailed', func: analyzeReversalDetailed }
    ];
    
    for (const algo of algos) {
        try {
            const result = algo.func(history);
            if (result && result.prediction && result.confidence >= 50) {
                result.algo = algo.name;
                predictions.push(result);
                algoResults[algo.name] = result;
            }
        } catch (e) {
            // Bỏ qua lỗi
        }
    }
    
    if (predictions.length === 0) {
        const lastResult = history[history.length - 1].result;
        return {
            prediction: lastResult === 'T' ? 'X' : 'T',
            confidence: 50,
            reason: 'Không có tín hiệu, dùng fallback',
            algos: 0,
            details: []
        };
    }
    
    // Tính trọng số
    let tScore = 0, xScore = 0;
    let totalWeight = 0;
    let algoDetails = [];
    
    for (const pred of predictions) {
        const weight = (pred.confidence / 100) * (modelWeights[pred.algo] || 1.0);
        if (pred.prediction === 'T') tScore += weight;
        else xScore += weight;
        totalWeight += weight;
        
        algoDetails.push({
            algo: pred.algo,
            prediction: pred.prediction,
            confidence: pred.confidence,
            reason: pred.reason,
            weight: weight
        });
    }
    
    // Sắp xếp theo confidence
    algoDetails.sort((a, b) => b.confidence - a.confidence);
    
    // Top 5 lý do
    const topReasons = algoDetails.slice(0, 5).map(d => `${d.algo}: ${d.reason} (${d.confidence}%)`);
    
    // Điều chỉnh độ tin cậy
    const confidenceBonus = Math.min(10, Math.floor(predictions.length / 2));
    const finalPred = tScore > xScore ? 'T' : 'X';
    let finalConfidence = Math.round((Math.max(tScore, xScore) / totalWeight) * 100);
    finalConfidence = Math.min(95, Math.max(50, finalConfidence + confidenceBonus));
    
    const bestAlgo = algoDetails[0];
    
    return {
        prediction: finalPred,
        confidence: finalConfidence,
        reason: bestAlgo ? bestAlgo.reason : 'Tổng hợp từ nhiều thuật toán',
        algos: predictions.length,
        details: topReasons,
        algoDetails: algoDetails.slice(0, 8),
        tScore: Math.round(tScore),
        xScore: Math.round(xScore),
        bestAlgo: bestAlgo ? bestAlgo.algo : 'N/A',
        bestAlgoConfidence: bestAlgo ? bestAlgo.confidence : 0
    };
}

// ==================== API FUNCTIONS ====================

async function fetchData(apiUrl) {
    try {
        const response = await axios.get(apiUrl, { timeout: 5000 });
        if (response.status === 200 && response.data) {
            return response.data;
        }
    } catch (e) {
        console.error('[❌] Lỗi fetch:', e.message);
    }
    return null;
}

function parseSessions(data) {
    if (!data || !data.data || !data.data.sessions) return [];
    const sessions = data.data.sessions;
    const parsed = [];
    
    for (const session of sessions) {
        if (session.status === 2) {
            parsed.push({
                phien: session.session_id,
                result: session.value === 1 ? 'T' : 'X',
                score: session.total || 0,
                dice: session.results || [],
                timestamp: new Date(session.time || Date.now())
            });
        }
    }
    return parsed;
}

// ==================== EXPRESS ROUTES ====================

app.get('/', (req, res) => {
    const lastResult = globalHistory.length > 0 ? globalHistory[globalHistory.length - 1] : null;
    const pred = lastPrediction || { prediction: 'N/A', confidence: 0, algos: 0 };
    
    res.json({
        status: 'online',
        user: USER_ID,
        phien: lastResult?.phien || null,
        ket_qua: lastResult?.result || 'N/A',
        du_doan: pred.prediction === 'T' ? 'TÀI' : pred.prediction === 'X' ? 'XỈU' : 'N/A',
        ty_le: pred.confidence ? pred.confidence + '%' : '0%',
        so_thuat_toan: pred.algos || 0,
        thong_ke: {
            tong: globalStats.total,
            dung: globalStats.correct,
            sai: globalStats.wrong,
            ti_le: globalStats.total ? Math.round(globalStats.correct / globalStats.total * 100) + '%' : '0%',
            chuoi: globalStats.streak
        },
        id: USER_ID
    });
});

app.get('/api/predict', (req, res) => {
    if (globalHistory.length < 5) {
        return res.json({
            status: 'error',
            message: 'Chưa đủ dữ liệu',
            required: 5,
            current: globalHistory.length
        });
    }
    
    const prediction = analyzeUltimate(globalHistory);
    res.json({
        status: 'success',
        prediction: prediction.prediction === 'T' ? 'TÀI' : 'XỈU',
        confidence: prediction.confidence + '%',
        reason: prediction.reason,
        algorithms: prediction.algos,
        details: prediction.details,
        bestAlgo: prediction.bestAlgo,
        bestAlgoConfidence: prediction.bestAlgoConfidence + '%',
        id: USER_ID
    });
});

app.get('/api/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const recent = globalHistory.slice(-limit).reverse();
    res.json({
        total: globalHistory.length,
        data: recent,
        stats: globalStats
    });
});

app.get('/api/stats', (req, res) => {
    res.json({
        total: globalStats.total,
        correct: globalStats.correct,
        wrong: globalStats.wrong,
        rate: globalStats.total ? Math.round(globalStats.correct / globalStats.total * 100) + '%' : '0%',
        streak: globalStats.streak,
        maxStreak: globalStats.maxStreak,
        id: USER_ID
    });
});

app.get('/api/status', (req, res) => {
    res.json({
        status: 'running',
        user: USER_ID,
        history_length: globalHistory.length,
        last_update: globalHistory.length > 0 ? globalHistory[globalHistory.length - 1].timestamp : null,
        stats: globalStats
    });
});

// ==================== MAIN LOOP ====================

async function mainLoop() {
    try {
        const [data1, data2] = await Promise.all([
            fetchData(API_LC_HU),
            fetchData(API_MD5)
        ]);
        
        const sessions1 = parseSessions(data1);
        const sessions2 = parseSessions(data2);
        
        let allSessions = [...sessions1, ...sessions2];
        allSessions.sort((a, b) => a.phien - b.phien);
        
        if (allSessions.length === 0) return;
        
        const latest = allSessions[allSessions.length - 1];
        
        if (latest.phien === lastPhien) return;
        lastPhien = latest.phien;
        
        // Lưu lịch sử
        globalHistory.push(latest);
        if (globalHistory.length > 1000) globalHistory.shift();
        
        // Dự đoán
        if (globalHistory.length >= 5) {
            const prediction = analyzeUltimate(globalHistory);
            lastPrediction = prediction;
            
            // Cập nhật thống kê
            if (globalHistory.length >= 2) {
                const prev = globalHistory[globalHistory.length - 2]?.result;
                if (prev) {
                    const correct = prev === prediction.prediction;
                    globalStats.total++;
                    if (correct) {
                        globalStats.correct++;
                        globalStats.streak++;
                        if (globalStats.streak > globalStats.maxStreak) {
                            globalStats.maxStreak = globalStats.streak;
                        }
                    } else {
                        globalStats.wrong++;
                        globalStats.streak = 0;
                    }
                    saveData();
                }
            }
            
            const predLabel = prediction.prediction === 'T' ? 'TÀI' : 'XỈU';
            const rate = globalStats.total ? Math.round(globalStats.correct / globalStats.total * 100) : 0;
            
            console.log(`\n${'═'.repeat(60)}`);
            console.log(`🎲 PHIÊN ${latest.phien} | KQ: ${latest.result} (${latest.score})`);
            console.log(`📊 Lịch sử: ${globalHistory.slice(-10).map(h => h.result).join(' ')}`);
            console.log(`🎯 DỰ ĐOÁN: ${predLabel} | ${prediction.confidence}%`);
            console.log(`📈 STATS: ${globalStats.correct}/${globalStats.total} (${rate}%) | Chuỗi: ${globalStats.streak}`);
            console.log(`🧠 ALGOS: ${prediction.algos} | BEST: ${prediction.bestAlgo} (${prediction.bestAlgoConfidence}%)`);
            console.log(`📝 REASON: ${prediction.reason}`);
            console.log(`${'═'.repeat(60)}`);
        } else {
            console.log(`[⏳] Đang học... ${globalHistory.length}/5`);
        }
        
    } catch (e) {
        console.error('[❌] Lỗi main loop:', e.message);
    }
}

// ==================== START SERVER ====================

loadData();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`👤 User: ${USER_ID}`);
    console.log(`📡 API LC HŨ: ${API_LC_HU}`);
    console.log(`📡 API MD5: ${API_MD5}`);
    console.log(`📊 History: ${globalHistory.length} phiên`);
    console.log('⏳ Starting main loop...');
    
    // Chạy main loop mỗi 2 giây
    setInterval(mainLoop, 2000);
    
    // Chạy ngay lập tức
    setTimeout(mainLoop, 1000);
});

// ==================== EXPORT ====================
module.exports = app;
