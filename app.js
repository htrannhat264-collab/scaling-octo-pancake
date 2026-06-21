const axios = require('axios');
const fs = require('fs');
const express = require('express');
const crypto = require('crypto');

// ==================== CẤU HÌNH ====================
const USER_ID = "@tranhoang2286";
const PORT = process.env.PORT || 3001;

// ==================== CẤU HÌNH ĐA GAME ====================
const GAME_CONFIGS = {
    'lc_hu': {
        name: 'LC HŨ',
        api: 'https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5',
        type: 'session',
        enabled: true
    },
    'md5': {
        name: 'MD5',
        api: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8',
        type: 'session',
        enabled: true
    }
};

// ==================== BIẾN TOÀN CỤC ====================
let gameHistories = {};
let gameStats = {};
let gamePredictions = {};
let gameLastPhien = {};
let modelWeights = {};

// Khởi tạo cho từng game
for (const [gameId, config] of Object.entries(GAME_CONFIGS)) {
    gameHistories[gameId] = [];
    gameStats[gameId] = { total: 0, correct: 0, wrong: 0, streak: 0, maxStreak: 0 };
    gamePredictions[gameId] = null;
    gameLastPhien[gameId] = null;
}

// ==================== FILE LƯU TRỮ ====================
function loadData() {
    try {
        if (fs.existsSync('./game_data.json')) {
            const data = JSON.parse(fs.readFileSync('./game_data.json', 'utf8'));
            for (const [gameId, config] of Object.entries(GAME_CONFIGS)) {
                if (data[gameId]) {
                    gameHistories[gameId] = data[gameId].history || [];
                    gameStats[gameId] = data[gameId].stats || { total: 0, correct: 0, wrong: 0, streak: 0, maxStreak: 0 };
                    gameLastPhien[gameId] = data[gameId].lastPhien || null;
                    console.log(`[📂] Đã tải ${gameHistories[gameId].length} phiên cho ${config.name}`);
                }
            }
        }
        if (fs.existsSync('./model_weights.json')) {
            modelWeights = JSON.parse(fs.readFileSync('./model_weights.json', 'utf8'));
        }
    } catch (e) {
        console.error('[❌] Lỗi load data:', e.message);
    }
}

function saveData() {
    try {
        const data = {};
        for (const [gameId, config] of Object.entries(GAME_CONFIGS)) {
            data[gameId] = {
                history: gameHistories[gameId] || [],
                stats: gameStats[gameId] || { total: 0, correct: 0, wrong: 0, streak: 0, maxStreak: 0 },
                lastPhien: gameLastPhien[gameId] || null
            };
        }
        fs.writeFileSync('./game_data.json', JSON.stringify(data, null, 2));
        fs.writeFileSync('./model_weights.json', JSON.stringify(modelWeights, null, 2));
    } catch (e) {
        console.error('[❌] Lỗi save data:', e.message);
    }
}

// ==================== THUẬT TOÁN PHÂN TÍCH ====================

// 1. Phân tích chuỗi cơ bản
function analyzeBasicSequence(history) {
    if (history.length < 3) return null;
    const results = history.map(h => h.result);
    const total = results.length;
    const taiCount = results.filter(r => r === 'T').length;
    const xiuCount = total - taiCount;
    const taiRatio = taiCount / total;
    const imbalance = Math.abs(taiCount - xiuCount) / total;
    
    const last3 = results.slice(-3);
    const last3Tai = last3.filter(r => r === 'T').length;
    const last5 = results.slice(-5);
    const last5Tai = last5.filter(r => r === 'T').length;
    
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
        reason = `Mất cân bằng ${(imbalance*100).toFixed(0)}%`;
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
        imbalance
    };
}

// 2. Phân tích cầu bệt
function analyzeStreak(history) {
    if (history.length < 3) return null;
    const results = history.map(h => h.result);
    
    let currentStreak = 1;
    const lastResult = results[results.length - 1];
    for (let i = results.length - 2; i >= 0; i--) {
        if (results[i] === lastResult) currentStreak++;
        else break;
    }
    
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
    
    const avgStreak = streakHistory.reduce((a,b) => a + b, 0) / streakHistory.length;
    
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (currentStreak >= 6) {
        prediction = lastResult === 'T' ? 'X' : 'T';
        confidence = Math.min(85, 60 + currentStreak * 2);
        reason = `Bệt dài ${currentStreak} phiên, dự đoán bẻ`;
    } else if (currentStreak >= 3 && currentStreak > avgStreak * 1.5) {
        prediction = lastResult === 'T' ? 'X' : 'T';
        confidence = 60 + (currentStreak - avgStreak) * 5;
        reason = `Bệt ${currentStreak} phiên (TB ${avgStreak.toFixed(1)}), dự đoán bẻ`;
    } else if (currentStreak >= 3) {
        prediction = lastResult;
        confidence = 60 + currentStreak * 3;
        reason = `Bệt ${currentStreak} phiên, tiếp tục`;
    } else {
        prediction = lastResult === 'T' ? 'X' : 'T';
        confidence = 55 + (3 - currentStreak) * 2;
        reason = `Bệt ngắn ${currentStreak} phiên, dự đoán xen kẽ`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        currentStreak,
        avgStreak
    };
}

// 3. Phân tích cầu xen kẽ
function analyzeAlternating(history) {
    if (history.length < 6) return null;
    const results = history.map(h => h.result);
    
    let altCount = 0;
    for (let i = 1; i < results.length; i++) {
        if (results[i] !== results[i-1]) altCount++;
    }
    
    const altRatio = altCount / (results.length - 1);
    
    // Kiểm tra 5 phiên gần nhất
    const last5 = results.slice(-5);
    let last5Alt = true;
    for (let i = 1; i < last5.length; i++) {
        if (last5[i] === last5[i-1]) {
            last5Alt = false;
            break;
        }
    }
    
    const lastResult = results[results.length - 1];
    const otherResult = lastResult === 'T' ? 'X' : 'T';
    
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (altRatio > 0.75) {
        prediction = otherResult;
        confidence = 75;
        reason = `Xen kẽ cực mạnh (${(altRatio*100).toFixed(0)}%)`;
    } else if (altRatio > 0.65 && last5Alt) {
        prediction = otherResult;
        confidence = 68;
        reason = `Xen kẽ mạnh (${(altRatio*100).toFixed(0)}%), 5 phiên gần nhất xen kẽ`;
    } else if (altRatio > 0.5 && last5Alt) {
        prediction = otherResult;
        confidence = 60;
        reason = `Xen kẽ (${(altRatio*100).toFixed(0)}%)`;
    } else if (altRatio < 0.3) {
        prediction = lastResult;
        confidence = 58;
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
        altRatio
    };
}

// 4. Phân tích cầu 2-2
function analyzePattern22(history) {
    if (history.length < 6) return null;
    const results = history.map(h => h.result);
    
    let count = 0;
    for (let i = 0; i < results.length - 3; i++) {
        if (results[i] === results[i+1] && 
            results[i+2] === results[i+3] && 
            results[i] !== results[i+2]) {
            count++;
        }
    }
    
    const last4 = results.slice(-4);
    const is22 = last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2];
    const ratio = count / Math.max(1, results.length - 3);
    
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (is22) {
        prediction = last4[3] === 'T' ? 'X' : 'T';
        confidence = Math.min(85, 65 + ratio * 30);
        reason = `Cầu 2-2 (tần suất ${(ratio*100).toFixed(0)}%)`;
    } else if (ratio > 0.3) {
        const last2 = results.slice(-2);
        if (last2[0] === last2[1]) {
            prediction = last2[0] === 'T' ? 'X' : 'T';
            confidence = 60 + ratio * 20;
            reason = `Có khả năng cầu 2-2 (tần suất ${(ratio*100).toFixed(0)}%)`;
        } else {
            prediction = results[results.length - 1];
            confidence = 55;
            reason = 'Chờ tín hiệu cầu 2-2';
        }
    } else {
        prediction = results[results.length - 1];
        confidence = 50;
        reason = 'Không có cầu 2-2';
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        count,
        ratio,
        is22
    };
}

// 5. Phân tích cầu 3-3
function analyzePattern33(history) {
    if (history.length < 8) return null;
    const results = history.map(h => h.result);
    
    let count = 0;
    for (let i = 0; i < results.length - 5; i++) {
        if (results[i] === results[i+1] && results[i+1] === results[i+2] &&
            results[i+3] === results[i+4] && results[i+4] === results[i+5] &&
            results[i] !== results[i+3]) {
            count++;
        }
    }
    
    const last6 = results.slice(-6);
    const is33 = last6[0] === last6[1] && last6[1] === last6[2] &&
                 last6[3] === last6[4] && last6[4] === last6[5] &&
                 last6[0] !== last6[3];
    const ratio = count / Math.max(1, results.length - 5);
    
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (is33) {
        prediction = last6[5] === 'T' ? 'X' : 'T';
        confidence = Math.min(85, 65 + ratio * 30);
        reason = `Cầu 3-3 (tần suất ${(ratio*100).toFixed(0)}%)`;
    } else if (ratio > 0.25) {
        const last3 = results.slice(-3);
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
            prediction = last3[0] === 'T' ? 'X' : 'T';
            confidence = 60 + ratio * 20;
            reason = `Có khả năng cầu 3-3 (tần suất ${(ratio*100).toFixed(0)}%)`;
        } else {
            prediction = results[results.length - 1];
            confidence = 55;
            reason = 'Chờ tín hiệu cầu 3-3';
        }
    } else {
        prediction = results[results.length - 1];
        confidence = 50;
        reason = 'Không có cầu 3-3';
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        count,
        ratio,
        is33
    };
}

// 6. Phân tích cân bằng
function analyzeBalance(history) {
    if (history.length < 10) return null;
    const results = history.map(h => h.result);
    
    const windows = [5, 10, 20];
    let windowData = {};
    
    for (const w of windows) {
        if (results.length >= w) {
            const recent = results.slice(-w);
            const taiCount = recent.filter(r => r === 'T').length;
            windowData[w] = {
                tai: taiCount,
                xiu: w - taiCount,
                ratio: taiCount / w
            };
        }
    }
    
    const w5 = windowData[5] || { ratio: 0.5 };
    const w10 = windowData[10] || { ratio: 0.5 };
    const w20 = windowData[20] || { ratio: 0.5 };
    
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (w5.ratio > 0.8) {
        prediction = 'X';
        confidence = 70 + (w5.ratio - 0.8) * 50;
        reason = `5 phiên Tài ${(w5.ratio*100).toFixed(0)}%, dự đoán Xỉu`;
    } else if (w5.ratio < 0.2) {
        prediction = 'T';
        confidence = 70 + (0.2 - w5.ratio) * 50;
        reason = `5 phiên Xỉu ${((1-w5.ratio)*100).toFixed(0)}%, dự đoán Tài`;
    } else if (w10.ratio > 0.7) {
        prediction = 'X';
        confidence = 60 + (w10.ratio - 0.7) * 40;
        reason = `10 phiên Tài ${(w10.ratio*100).toFixed(0)}%, dự đoán Xỉu`;
    } else if (w10.ratio < 0.3) {
        prediction = 'T';
        confidence = 60 + (0.3 - w10.ratio) * 40;
        reason = `10 phiên Xỉu ${((1-w10.ratio)*100).toFixed(0)}%, dự đoán Tài`;
    } else if (w20.ratio > 0.65) {
        prediction = 'X';
        confidence = 55 + (w20.ratio - 0.65) * 30;
        reason = `20 phiên Tài ${(w20.ratio*100).toFixed(0)}%, dự đoán Xỉu`;
    } else if (w20.ratio < 0.35) {
        prediction = 'T';
        confidence = 55 + (0.35 - w20.ratio) * 30;
        reason = `20 phiên Xỉu ${((1-w20.ratio)*100).toFixed(0)}%, dự đoán Tài`;
    } else {
        prediction = results[results.length - 1];
        confidence = 52;
        reason = 'Cân bằng, theo xu hướng cuối';
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        windowData
    };
}

// 7. Phân tích điểm số
function analyzeScore(history) {
    if (history.length < 10) return null;
    const scores = history.map(h => h.score || 0);
    const lastScore = scores[scores.length - 1];
    const avgScore = scores.reduce((a,b) => a+b, 0) / scores.length;
    const last5 = scores.slice(-5).reduce((a,b) => a+b, 0) / Math.min(5, scores.length);
    
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (lastScore > 14) {
        prediction = 'X';
        confidence = 65 + (lastScore - 14) * 2;
        reason = `Điểm cao ${lastScore} (TB ${avgScore.toFixed(1)})`;
    } else if (lastScore < 6) {
        prediction = 'T';
        confidence = 65 + (6 - lastScore) * 2;
        reason = `Điểm thấp ${lastScore} (TB ${avgScore.toFixed(1)})`;
    } else if (last5 > avgScore + 2) {
        prediction = 'X';
        confidence = 60;
        reason = `Điểm tăng (${last5.toFixed(1)} > ${avgScore.toFixed(1)})`;
    } else if (last5 < avgScore - 2) {
        prediction = 'T';
        confidence = 60;
        reason = `Điểm giảm (${last5.toFixed(1)} < ${avgScore.toFixed(1)})`;
    } else {
        prediction = lastScore > 11 ? 'X' : 'T';
        confidence = 52;
        reason = `Điểm ${lastScore} ở mức ${lastScore > 11 ? 'cao' : 'thấp'}`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        avgScore,
        lastScore,
        last5
    };
}

// 8. Phân tích Markov
function analyzeMarkov(history) {
    if (history.length < 6) return null;
    const results = history.map(h => h.result);
    const last3 = results.slice(-3).join('');
    let transitions = {};
    
    for (let i = 0; i < results.length - 3; i++) {
        const pattern = results.slice(i, i + 3).join('');
        const next = results[i + 3];
        if (!transitions[pattern]) transitions[pattern] = { T: 0, X: 0 };
        transitions[pattern][next]++;
    }
    
    if (transitions[last3]) {
        const data = transitions[last3];
        const total = data.T + data.X;
        if (total >= 2) {
            const taiProb = data.T / total;
            const xiuProb = data.X / total;
            if (taiProb > 0.6) {
                return {
                    prediction: 'T',
                    confidence: 55 + taiProb * 30,
                    reason: `Markov Tài ${(taiProb*100).toFixed(0)}%`
                };
            } else if (xiuProb > 0.6) {
                return {
                    prediction: 'X',
                    confidence: 55 + xiuProb * 30,
                    reason: `Markov Xỉu ${(xiuProb*100).toFixed(0)}%`
                };
            }
        }
    }
    return null;
}

// 9. Phân tích Fibonacci
function analyzeFibonacci(history) {
    if (history.length < 13) return null;
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    const fibs = [1, 2, 3, 5, 8, 13];
    let matches = 0;
    
    for (const f of fibs) {
        if (history.length > f) {
            if (results[results.length - f] === results[results.length - 1]) {
                matches++;
            }
        }
    }
    
    if (matches >= 4) {
        return {
            prediction: results[results.length - 1] === 1 ? 'X' : 'T',
            confidence: 65 + matches * 3,
            reason: `Fibonacci ${matches}/6 khớp`
        };
    }
    return null;
}

// 10. Phân tích cầu 1-2-1
function analyzePattern121(history) {
    if (history.length < 5) return null;
    const results = history.map(h => h.result);
    const last5 = results.slice(-5);
    
    if (last5[0] !== last5[1] && last5[1] === last5[2] &&
        last5[2] !== last5[3] && last5[3] === last5[4] &&
        last5[0] === last5[3]) {
        return {
            prediction: last5[4] === 'T' ? 'X' : 'T',
            confidence: 74,
            reason: 'Cầu 1-2-1'
        };
    }
    return null;
}

// 11. Phân tích cầu 2-1-2
function analyzePattern212(history) {
    if (history.length < 5) return null;
    const results = history.map(h => h.result);
    const last5 = results.slice(-5);
    
    if (last5[0] === last5[1] && last5[1] !== last5[2] &&
        last5[2] === last5[3] && last5[3] !== last5[4] &&
        last5[0] === last5[3]) {
        return {
            prediction: last5[4] === 'T' ? 'X' : 'T',
            confidence: 74,
            reason: 'Cầu 2-1-2'
        };
    }
    return null;
}

// 12. Phân tích đảo chiều
function analyzeReversal(history) {
    if (history.length < 8) return null;
    const results = history.map(h => h.result);
    const last8 = results.slice(-8);
    let changes = 0;
    
    for (let i = 1; i < last8.length; i++) {
        if (last8[i] !== last8[i-1]) changes++;
    }
    
    const changeRatio = changes / (last8.length - 1);
    
    if (changeRatio > 0.75) {
        return {
            prediction: last8[last8.length - 1] === 'T' ? 'X' : 'T',
            confidence: 68,
            reason: 'Đảo chiều mạnh'
        };
    } else if (changeRatio < 0.3) {
        return {
            prediction: last8[last8.length - 1],
            confidence: 62,
            reason: 'Xu hướng mạnh'
        };
    }
    return null;
}

// ==================== TỔNG HỢP DỰ ĐOÁN ====================

function ensemblePredict(history) {
    if (history.length < 5) {
        return {
            prediction: 'T',
            confidence: 50,
            reason: 'Chưa đủ dữ liệu',
            algos: 0,
            details: []
        };
    }
    
    const predictions = [];
    const algos = [
        { name: 'BasicSequence', func: analyzeBasicSequence },
        { name: 'Streak', func: analyzeStreak },
        { name: 'Alternating', func: analyzeAlternating },
        { name: 'Pattern22', func: analyzePattern22 },
        { name: 'Pattern33', func: analyzePattern33 },
        { name: 'Balance', func: analyzeBalance },
        { name: 'Score', func: analyzeScore },
        { name: 'Markov', func: analyzeMarkov },
        { name: 'Fibonacci', func: analyzeFibonacci },
        { name: 'Pattern121', func: analyzePattern121 },
        { name: 'Pattern212', func: analyzePattern212 },
        { name: 'Reversal', func: analyzeReversal }
    ];
    
    for (const algo of algos) {
        try {
            const result = algo.func(history);
            if (result && result.prediction && result.confidence >= 50) {
                result.algo = algo.name;
                predictions.push(result);
            }
        } catch (e) {}
    }
    
    if (predictions.length === 0) {
        const last = history[history.length - 1].result;
        return {
            prediction: last === 'T' ? 'X' : 'T',
            confidence: 50,
            reason: 'Không có tín hiệu',
            algos: 0,
            details: []
        };
    }
    
    let tScore = 0, xScore = 0;
    let totalWeight = 0;
    let details = [];
    
    for (const pred of predictions) {
        const weight = (pred.confidence / 100) * (modelWeights[pred.algo] || 1.0);
        if (pred.prediction === 'T') tScore += weight;
        else xScore += weight;
        totalWeight += weight;
        details.push(`${pred.algo}: ${pred.reason} (${pred.confidence}%)`);
    }
    
    const finalPred = tScore > xScore ? 'T' : 'X';
    const confidence = Math.round((Math.max(tScore, xScore) / totalWeight) * 100);
    const bestAlgo = predictions.reduce((a, b) => a.confidence > b.confidence ? a : b);
    
    return {
        prediction: finalPred,
        confidence: Math.min(90, Math.max(50, confidence)),
        reason: bestAlgo.reason,
        algos: predictions.length,
        details: details.slice(0, 5),
        bestAlgo: bestAlgo.algo,
        bestAlgoConfidence: bestAlgo.confidence
    };
}

// ==================== API FUNCTIONS ====================

async function fetchGameData(gameId) {
    const config = GAME_CONFIGS[gameId];
    if (!config || !config.enabled) return null;
    
    try {
        const response = await axios.get(config.api, { timeout: 5000 });
        if (response.status === 200 && response.data) {
            return parseGameData(response.data, gameId);
        }
    } catch (e) {
        console.error(`[❌] Lỗi fetch ${config.name}:`, e.message);
    }
    return null;
}

function parseGameData(data, gameId) {
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
                timestamp: new Date(session.time || Date.now()).toISOString()
            });
        }
    }
    
    return parsed;
}

// ==================== EXPRESS APP ====================

const app = express();
app.use(express.json());

// ==================== ROUTES ====================

// Trang chủ
app.get('/', (req, res) => {
    const result = {
        status: 'online',
        user: USER_ID,
        games: {}
    };
    
    for (const [gameId, config] of Object.entries(GAME_CONFIGS)) {
        const history = gameHistories[gameId] || [];
        const stats = gameStats[gameId] || { total: 0, correct: 0, wrong: 0, streak: 0 };
        const pred = gamePredictions[gameId] || { prediction: 'N/A', confidence: 0, algos: 0 };
        const lastResult = history.length > 0 ? history[history.length - 1] : null;
        
        result.games[gameId] = {
            name: config.name,
            total_phien: history.length,
            last_phien: lastResult?.phien || null,
            last_result: lastResult?.result || 'N/A',
            last_score: lastResult?.score || 0,
            du_doan: pred.prediction === 'T' ? 'TÀI' : pred.prediction === 'X' ? 'XỈU' : 'N/A',
            ty_le: pred.confidence ? pred.confidence + '%' : '0%',
            so_thuat_toan: pred.algos || 0,
            stats: {
                tong: stats.total,
                dung: stats.correct,
                sai: stats.wrong,
                ti_le: stats.total ? Math.round(stats.correct / stats.total * 100) + '%' : '0%',
                chuoi: stats.streak || 0
            }
        };
    }
    
    res.json(result);
});

// Dự đoán theo game
app.get('/api/predict/:gameId', (req, res) => {
    const { gameId } = req.params;
    if (!GAME_CONFIGS[gameId]) {
        return res.status(404).json({ error: 'Game not found' });
    }
    
    const history = gameHistories[gameId] || [];
    if (history.length < 5) {
        return res.json({
            status: 'error',
            message: 'Chưa đủ dữ liệu',
            required: 5,
            current: history.length,
            game: gameId,
            game_name: GAME_CONFIGS[gameId].name
        });
    }
    
    const prediction = ensemblePredict(history);
    gamePredictions[gameId] = prediction;
    
    res.json({
        status: 'success',
        game: gameId,
        game_name: GAME_CONFIGS[gameId].name,
        phien_hien_tai: history[history.length - 1]?.phien || null,
        du_doan: prediction.prediction === 'T' ? 'TÀI' : 'XỈU',
        ty_le: prediction.confidence + '%',
        reason: prediction.reason,
        so_thuat_toan: prediction.algos,
        thuat_toan_tot_nhat: prediction.bestAlgo || 'N/A',
        details: prediction.details || [],
        stats: gameStats[gameId] || { total: 0, correct: 0, wrong: 0 },
        id: USER_ID
    });
});

// Lịch sử theo game
app.get('/api/history/:gameId', (req, res) => {
    const { gameId } = req.params;
    if (!GAME_CONFIGS[gameId]) {
        return res.status(404).json({ error: 'Game not found' });
    }
    
    const limit = parseInt(req.query.limit) || 20;
    const history = gameHistories[gameId] || [];
    const recent = history.slice(-limit).reverse();
    
    res.json({
        game: gameId,
        game_name: GAME_CONFIGS[gameId].name,
        total: history.length,
        data: recent,
        stats: gameStats[gameId] || { total: 0, correct: 0, wrong: 0, streak: 0 }
    });
});

// Thống kê theo game
app.get('/api/stats/:gameId', (req, res) => {
    const { gameId } = req.params;
    if (!GAME_CONFIGS[gameId]) {
        return res.status(404).json({ error: 'Game not found' });
    }
    
    const stats = gameStats[gameId] || { total: 0, correct: 0, wrong: 0, streak: 0, maxStreak: 0 };
    const rate = stats.total ? Math.round(stats.correct / stats.total * 100) : 0;
    
    res.json({
        game: gameId,
        game_name: GAME_CONFIGS[gameId].name,
        tong: stats.total,
        dung: stats.correct,
        sai: stats.wrong,
        ti_le: rate + '%',
        chuoi_hien_tai: stats.streak || 0,
        chuoi_max: stats.maxStreak || 0,
        id: USER_ID
    });
});

// Tất cả game
app.get('/api/all-games', (req, res) => {
    const result = {};
    for (const [gameId, config] of Object.entries(GAME_CONFIGS)) {
        const history = gameHistories[gameId] || [];
        const stats = gameStats[gameId] || { total: 0, correct: 0, wrong: 0 };
        const pred = gamePredictions[gameId] || { prediction: 'N/A', confidence: 0 };
        const lastResult = history.length > 0 ? history[history.length - 1] : null;
        
        result[gameId] = {
            name: config.name,
            total_phien: history.length,
            last_phien: lastResult?.phien || null,
            last_result: lastResult?.result || 'N/A',
            du_doan: pred.prediction === 'T' ? 'TÀI' : pred.prediction === 'X' ? 'XỈU' : 'N/A',
            ty_le: pred.confidence ? pred.confidence + '%' : '0%',
            stats: stats        };
    }
    res.json(result);
});

// ==================== MAIN LOOP ====================

async function mainLoop() {
    for (const [gameId, config] of Object.entries(GAME_CONFIGS)) {
        if (!config.enabled) continue;
        
        try {
            const data = await fetchGameData(gameId);
            if (!data || data.length === 0) continue;
            
            const latest = data[data.length - 1];
            if (!latest || !latest.phien) continue;
            
            // Kiểm tra phiên mới
            if (latest.phien === gameLastPhien[gameId]) continue;
            gameLastPhien[gameId] = latest.phien;
            
            // Thêm vào lịch sử
            gameHistories[gameId].push(latest);
            if (gameHistories[gameId].length > 500) {
                gameHistories[gameId].shift();
            }
            
            // Dự đoán nếu đủ dữ liệu
            if (gameHistories[gameId].length >= 5) {
                const prediction = ensemblePredict(gameHistories[gameId]);
                gamePredictions[gameId] = prediction;
                
                // Cập nhật thống kê
                if (gameHistories[gameId].length >= 2) {
                    const prev = gameHistories[gameId][gameHistories[gameId].length - 2]?.result;
                    if (prev) {
                        const correct = prev === prediction.prediction;
                        const stats = gameStats[gameId];
                        stats.total++;
                        if (correct) {
                            stats.correct++;
                            stats.streak = (stats.streak || 0) + 1;
                            if (stats.streak > (stats.maxStreak || 0)) {
                                stats.maxStreak = stats.streak;
                            }
                        } else {
                            stats.wrong++;
                            stats.streak = 0;
                        }
                    }
                }
                
                saveData();
                
                const predLabel = prediction.prediction === 'T' ? 'TÀI' : 'XỈU';
                const rate = gameStats[gameId].total ? 
                    Math.round(gameStats[gameId].correct / gameStats[gameId].total * 100) : 0;
                
                console.log(`🎮 ${config.name} | PHIÊN ${latest.phien} | KQ: ${latest.result} (${latest.score})`);
                console.log(`   📊 Lịch sử: ${gameHistories[gameId].slice(-10).map(h => h.result).join(' ')}`);
                console.log(`   🎯 DỰ ĐOÁN: ${predLabel} | ${prediction.confidence}%`);
                console.log(`   📈 STATS: ${gameStats[gameId].correct}/${gameStats[gameId].total} (${rate}%) | Chuỗi: ${gameStats[gameId].streak || 0}`);
                console.log(`   🧠 ALGOS: ${prediction.algos} | BEST: ${prediction.bestAlgo}`);
                console.log('');
            }
            
        } catch (e) {
            // Bỏ qua lỗi
        }
    }
}

// ==================== START SERVER ====================

loadData();

// Khởi tạo model weights mặc định
const defaultWeights = {
    'BasicSequence': 1.0,
    'Streak': 1.0,
    'Alternating': 1.0,
    'Pattern22': 1.0,
    'Pattern33': 1.0,
    'Balance': 1.0,
    'Score': 1.0,
    'Markov': 1.0,
    'Fibonacci': 1.0,
    'Pattern121': 1.0,
    'Pattern212': 1.0,
    'Reversal': 1.0
};

for (const key in defaultWeights) {
    if (!modelWeights[key]) modelWeights[key] = 1.0;
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`👤 User: ${USER_ID}`);
    console.log(`🎮 Games: ${Object.keys(GAME_CONFIGS).length}`);
    console.log(`📊 Data loaded: ${Object.values(gameHistories).reduce((sum, h) => sum + h.length, 0)} phiên`);
    console.log('⏳ Starting main loop...');
    
    // Chạy main loop mỗi 2 giây
    setInterval(mainLoop, 2000);
    
    // Chạy ngay lập tức
    setTimeout(mainLoop, 1000);
});

// ==================== EXPORT ====================
module.exports = app;
